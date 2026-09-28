// ── NPI demo — server library (TEMPORARY DEMO, delete with /npi-list) ─────────
// Underscore prefix = Vercel does not expose this file as a route.
// Web-standard fetch only (runs in the Edge runtime), no npm dependencies.
//
// NPI data: Anthropic's hosted NPI Registry MCP server (stateless JSON-RPC over
// HTTP, no auth), falling back to the public CMS NPPES API if it fails.
// Validation: OpenAI Responses API — one web_search research call, then one
// structured-output reconciliation call. OPENAI_API_KEY is read only here.

import type {
  Assessment,
  ConfidenceScore,
  EvidenceSource,
  FieldComparison,
  FieldKey,
  NpiSource,
  ProviderAddress,
  ProviderDetail,
  ProviderSummary,
  ScoreItem,
  SearchResponse,
  SourceType,
  ValidationEvent,
  ValidationResult,
} from "../src/npi/types";

const MCP_URL = "https://hcls.mcp.claude.com/npi_registry/mcp";
const CMS_URL = "https://npiregistry.cms.hhs.gov/api/";
const MCP_SOURCE: NpiSource = "Anthropic NPI Registry connector";
const CMS_SOURCE: NpiSource = "CMS NPPES API";
const SEARCH_LIMIT = 18;

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

// ── NPI Registry transport ────────────────────────────────────────────────────

let rpcId = 0;

async function mcpCall<T>(tool: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: tool, arguments: args } }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`MCP ${tool} HTTP ${res.status}`);
  const text = await res.text();
  // The server answers plain JSON today; tolerate an SSE-framed reply too.
  const payload = res.headers.get("content-type")?.includes("event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).pop() ?? "{}"
    : text;
  const msg = JSON.parse(payload);
  if (msg.error) throw new Error(`MCP ${tool}: ${msg.error.message ?? "error"}`);
  if (msg.result?.isError) throw new Error(`MCP ${tool}: ${msg.result?.content?.[0]?.text ?? "tool error"}`);
  const structured = msg.result?.structuredContent ?? JSON.parse(msg.result?.content?.[0]?.text ?? "null");
  if (!structured) throw new Error(`MCP ${tool}: empty result`);
  return structured as T;
}

// Raw NPPES v2.1 record — same shape from the MCP server (record.raw) and CMS.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawRecord = any;
type SearchParams = Record<string, string>;

async function cmsQuery(params: SearchParams): Promise<RawRecord[]> {
  const qs = new URLSearchParams({ version: "2.1", limit: String(SEARCH_LIMIT), ...params });
  const res = await fetch(`${CMS_URL}?${qs}`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`CMS HTTP ${res.status}`);
  const data = await res.json();
  if (data.Errors?.length) throw new Error(data.Errors.map((e: { description: string }) => e.description).join("; "));
  return data.results ?? [];
}

async function lookupRaw(npi: string): Promise<{ raw: RawRecord | null; source: NpiSource }> {
  try {
    const r = await mcpCall<{ found: boolean; record: { raw: RawRecord } | null }>("npi_lookup", { npi });
    return { raw: r.found ? r.record?.raw ?? null : null, source: MCP_SOURCE };
  } catch (err) {
    console.warn("[npi] MCP lookup failed, using CMS:", (err as Error).message);
    const results = await cmsQuery({ number: npi });
    return { raw: results[0] ?? null, source: CMS_SOURCE };
  }
}

async function searchRaw(params: SearchParams): Promise<{ records: RawRecord[]; source: NpiSource }> {
  try {
    const r = await mcpCall<{ items: { npi: string }[] }>("npi_search", { ...params, limit: SEARCH_LIMIT });
    // Search items are summaries; look each up for credentials, all addresses and taxonomies.
    const looked = await Promise.all(r.items.map((i) => mcpCall<{ found: boolean; record: { raw: RawRecord } | null }>("npi_lookup", { npi: i.npi }).catch(() => null)));
    const records = looked.map((l) => l?.record?.raw).filter(Boolean);
    if (records.length < r.items.length) throw new Error("some MCP lookups failed");
    return { records, source: MCP_SOURCE };
  } catch (err) {
    console.warn("[npi] MCP search failed, using CMS:", (err as Error).message);
    return { records: await cmsQuery(params), source: CMS_SOURCE };
  }
}

// ── Normalisation ─────────────────────────────────────────────────────────────

const KEEP_UPPER = new Set(["MD", "DO", "NP", "PA", "RN", "DDS", "DMD", "PHD", "LLC", "PC", "PLLC", "PA-C", "AUD", "CCC", "SLP", "II", "III", "IV", "NW", "NE", "SW", "SE", "PO", "US", "USA", "ENT", "MPH", "DPT", "OD", "APRN", "FNP", "CNM", "LCSW", "PT", "OT"]);

function titleCase(s: string | null | undefined): string | null {
  if (!s || s === "--") return null;
  return s
    .toLowerCase()
    .replace(/\b([a-z])([a-z']*)/g, (w, a: string, b: string) => (KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : a.toUpperCase() + b))
    .replace(/\bMc([a-z])/g, (_m, c: string) => "Mc" + c.toUpperCase())
    .replace(/\b([OD])'([a-z])/g, (_m, a: string, c: string) => `${a}'${c.toUpperCase()}`);
}

export function formatPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

function formatZip(z: string | null | undefined): string {
  if (!z) return "";
  return z.length === 9 ? `${z.slice(0, 5)}-${z.slice(5)}` : z;
}

function cleanTaxonomy(desc: string | null | undefined): string {
  return (desc ?? "").replace(/[,\s]+$/, "").trim();
}

function addressFrom(a: RawRecord, purpose: ProviderAddress["purpose"]): ProviderAddress {
  return {
    purpose,
    line1: titleCase(a.address_1) ?? "",
    line2: titleCase(a.address_2),
    city: titleCase(a.city) ?? "",
    state: a.state ?? "",
    postalCode: formatZip(a.postal_code),
    phone: formatPhone(a.telephone_number),
    fax: formatPhone(a.fax_number),
  };
}

function personName(b: RawRecord): string {
  return [b.first_name, b.middle_name, b.last_name, b.name_suffix]
    .filter((p) => p && p !== "--")
    .map((p: string) => titleCase(p))
    .join(" ");
}

export function normalize(raw: RawRecord, source: NpiSource): ProviderDetail {
  const b = raw.basic ?? {};
  const isOrg = raw.enumeration_type === "NPI-2";
  const addrs: RawRecord[] = raw.addresses ?? [];
  const loc = addrs.find((a) => a.address_purpose === "LOCATION");
  const mail = addrs.find((a) => a.address_purpose === "MAILING");
  const addresses: ProviderAddress[] = [];
  if (loc) addresses.push(addressFrom(loc, "Primary practice"));
  for (const p of raw.practiceLocations ?? []) addresses.push(addressFrom(p, "Additional practice"));
  if (mail) addresses.push(addressFrom(mail, "Mailing"));

  const taxonomies = (raw.taxonomies ?? []).map((t: RawRecord) => ({
    code: t.code,
    desc: cleanTaxonomy(t.desc),
    primary: Boolean(t.primary),
    state: t.state ?? null,
    license: t.license ?? null,
  }));
  const primaryTax = taxonomies.find((t: { primary: boolean }) => t.primary) ?? taxonomies[0];

  const otherNames: string[] = (raw.other_names ?? [])
    .map((o: RawRecord) => titleCase(o.organization_name) ?? personName(o))
    .filter(Boolean);

  const orgName = isOrg ? titleCase(b.organization_name) : null;
  const authorizedOfficial = isOrg && b.authorized_official_last_name
    ? [titleCase(b.authorized_official_first_name), titleCase(b.authorized_official_last_name)].filter(Boolean).join(" ") +
      (b.authorized_official_title_or_position ? `, ${titleCase(b.authorized_official_title_or_position)}` : "")
    : null;

  const primary = addresses[0];
  return {
    npi: String(raw.number),
    name: isOrg ? orgName ?? "Unknown organization" : personName(b),
    credential: b.credential ? [...new Set(b.credential.replace(/\./g, "").toUpperCase().split(/\s*,\s*/).filter(Boolean))].join(", ") : null,
    enumerationType: isOrg ? "Organization" : "Individual",
    specialty: primaryTax?.desc ?? null,
    city: primary?.city ?? null,
    state: primary?.state ?? null,
    postalCode: primary?.postalCode ?? null,
    phone: primary?.phone ?? null,
    organization: isOrg ? (b.organizational_subpart === "YES" && b.parent_organization_legal_business_name ? titleCase(b.parent_organization_legal_business_name) : null) : null,
    status: b.status === "A" ? "Active" : "Deactivated",
    lastUpdated: b.last_updated ?? null,
    practiceLocationCount: addresses.filter((a) => a.purpose !== "Mailing").length,
    taxonomyCount: taxonomies.length,
    firstName: titleCase(b.first_name),
    lastName: titleCase(b.last_name),
    sex: b.sex === "M" ? "Male" : b.sex === "F" ? "Female" : null,
    soleProprietor: b.sole_proprietor ? b.sole_proprietor === "YES" : null,
    enumerationDate: b.enumeration_date ?? null,
    certificationDate: b.certification_date ?? null,
    addresses,
    taxonomies,
    identifiers: (raw.identifiers ?? []).map((i: RawRecord) => ({ desc: i.desc, identifier: i.identifier, issuer: i.issuer ?? null, state: i.state ?? null })),
    otherNames,
    authorizedOfficial,
    endpointCount: (raw.endpoints ?? []).length,
    source,
    fetchedAt: new Date().toISOString(),
  };
}

export function toSummary(d: ProviderDetail): ProviderSummary {
  const { npi, name, credential, enumerationType, specialty, city, state, postalCode, phone, organization, status, lastUpdated, practiceLocationCount, taxonomyCount } = d;
  return { npi, name, credential, enumerationType, specialty, city, state, postalCode, phone, organization, status, lastUpdated, practiceLocationCount, taxonomyCount };
}

// ── Free-text query → NPPES search criteria ──────────────────────────────────

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};
const STATE_CODES = new Set(Object.values(STATES));

// Common words → NPPES taxonomy_description values (verified against the registry).
const SPECIALTIES: [RegExp, string][] = [
  [/\b(ent|otolaryngolog(y|ist)s?|ear nose (and|&) throat)\b/i, "Otolaryngology"],
  [/\b(audiolog(y|ists?)|hearing)\b/i, "Audiologist"],
  [/\b(cardiolog(y|ists?)|heart doctors?)\b/i, "Cardiovascular Disease"],
  [/\bdermatolog(y|ists?)\b/i, "Dermatology"],
  [/\b(pediatrics?|pediatricians?|paediatricians?)\b/i, "Pediatrics"],
  [/\b(family (medicine|doctors?|physicians?|practice)|gp)\b/i, "Family Medicine"],
  [/\b(internal medicine|internists?)\b/i, "Internal Medicine"],
  [/\b(orthopa?edic( surgery| surgeons?)?|orthopa?edists?)\b/i, "Orthopaedic Surgery"],
  [/\b(ob\/?gyn|obgyn|gynecolog(y|ists?)|obstetrici?ans?)\b/i, "Obstetrics & Gynecology"],
  [/\b(nurse practitioners?|np)\b/i, "Nurse Practitioner"],
  [/\b(psychiatr(y|ists?))\b/i, "Psychiatry"],
  [/\b(psycholog(y|ists?))\b/i, "Psychologist"],
  [/\b(oncolog(y|ists?)|hematolog(y|ists?))\b/i, "Hematology & Oncology"],
  [/\b(dentists?|dental|dentistry)\b/i, "Dentist"],
  [/\b(physical therap(y|ists?)|physiotherap(y|ists?))\b/i, "Physical Therapist"],
  [/\b(speech( language)? (patholog(y|ists?)|therap(y|ists?))|slp)\b/i, "Speech-Language Pathologist"],
  [/\bgastroenterolog(y|ists?)\b/i, "Gastroenterology"],
  [/\boptometr(y|ists?)\b/i, "Optometrist"],
  [/\bophthalmolog(y|ists?)\b/i, "Ophthalmology"],
  [/\bneurolog(y|ists?)\b/i, "Neurology"],
  [/\burolog(y|ists?)\b/i, "Urology"],
  [/\bradiolog(y|ists?)\b/i, "Radiology"],
  [/\bendocrinolog(y|ists?)\b/i, "Endocrinology"],
  [/\banesthesiolog(y|ists?)\b/i, "Anesthesiology"],
  [/\bchiropract(ic|ors?)\b/i, "Chiropractor"],
  [/\bpodiatr(y|ists?)\b/i, "Podiatrist"],
  [/\bpharmac(y|ists?)\b/i, "Pharmacist"],
  [/\b(physician assistants?)\b/i, "Physician Assistant"],
  [/\b(occupational therap(y|ists?))\b/i, "Occupational Therapist"],
];
const ORG_WORDS = /\b(clinic|hospital|health|medical|center|centre|group|associates|practice|pharmacy|llc|inc|pc|pllc|care|institute|university|partners|services)\b/i;

interface Plan {
  label: string;
  params: SearchParams;
}

export function planSearch(q: string): { npi: string | null; interpretation: { label: string; value: string }[]; plans: Plan[] } {
  const digits = q.replace(/\D/g, "");
  if (/^\s*\d{10}\s*$/.test(q) || (digits.length === 10 && q.replace(/[\d\s-]/g, "") === "")) {
    return { npi: digits, interpretation: [{ label: "NPI", value: digits }], plans: [] };
  }

  let rest = ` ${q.replace(/,/g, " ").replace(/\s+/g, " ").trim()} `;
  const base: SearchParams = {};
  const interp: { label: string; value: string }[] = [];

  const zip = rest.match(/\s(\d{5})(-\d{4})?\s/);
  if (zip) { base.postal_code = zip[1]; rest = rest.replace(zip[0], " "); }

  let specialty: string | null = null;
  for (const [re, tax] of SPECIALTIES) {
    const m = rest.match(re);
    if (m) { specialty = tax; rest = rest.replace(m[0], " "); break; }
  }

  // State: full name anywhere, or a 2-letter code as the last token (or typed in caps).
  const lower = rest.toLowerCase();
  for (const name of Object.keys(STATES).sort((a, b) => b.length - a.length)) {
    const i = lower.search(new RegExp(`\\s${name}\\s`));
    if (i >= 0) { base.state = STATES[name]; rest = rest.slice(0, i) + " " + rest.slice(i + name.length + 1); break; }
  }
  if (!base.state) {
    const toks = rest.trim().split(" ").filter(Boolean);
    const last = toks[toks.length - 1];
    const capsIdx = toks.findIndex((t) => /^[A-Z]{2}$/.test(t) && STATE_CODES.has(t));
    if (last && last.length === 2 && STATE_CODES.has(last.toUpperCase()) && toks.length > 1) {
      base.state = last.toUpperCase(); toks.pop(); rest = ` ${toks.join(" ")} `;
    } else if (capsIdx >= 0) {
      base.state = toks[capsIdx]; toks.splice(capsIdx, 1); rest = ` ${toks.join(" ")} `;
    }
  }

  const words = rest.trim().split(" ").filter(Boolean);
  const phrase = words.join(" ");
  if (specialty) interp.push({ label: "Specialty", value: specialty });

  const plans: Plan[] = [];
  // With location criteria, match practice locations only (not mailing addresses).
  const withBase = (p: SearchParams) => {
    const params = { ...base, ...p };
    if (params.city || params.state || params.postal_code) params.address_purpose = "LOCATION";
    return params;
  };

  if (specialty) {
    if (phrase) {
      plans.push({ label: "City", params: withBase({ taxonomy_description: specialty, city: phrase }) });
      if (words.length >= 2) plans.push({ label: "Name", params: withBase({ taxonomy_description: specialty, first_name: words[0], last_name: words[words.length - 1] }) });
      plans.push({ label: "Name", params: withBase({ taxonomy_description: specialty, last_name: words[words.length - 1] }) });
      plans.push({ label: "Organization", params: withBase({ taxonomy_description: specialty, organization_name: `${phrase}*` }) });
    } else {
      plans.push({ label: "", params: withBase({ taxonomy_description: specialty }) });
    }
  } else if (phrase && ORG_WORDS.test(phrase)) {
    plans.push({ label: "Organization", params: withBase({ organization_name: `${phrase}*` }) });
  } else if (words.length >= 2) {
    plans.push({ label: "Name", params: withBase({ first_name: words[0], last_name: words[words.length - 1] }) });
    plans.push({ label: "Name", params: withBase({ first_name: `${words[0].slice(0, 3)}*`, last_name: words[words.length - 1] }) });
    plans.push({ label: "City", params: withBase({ city: phrase, enumeration_type: "NPI-1" }) });
    plans.push({ label: "Organization", params: withBase({ organization_name: `${phrase}*` }) });
  } else if (words.length === 1) {
    plans.push({ label: "Last name", params: withBase({ last_name: words[0] }) });
    plans.push({ label: "Specialty", params: withBase({ taxonomy_description: words[0] }) });
    plans.push({ label: "Organization", params: withBase({ organization_name: `${words[0]}*` }) });
    plans.push({ label: "City", params: withBase({ city: words[0] }) });
  } else if (base.postal_code) {
    plans.push({ label: "", params: withBase({}) });
  }

  if (base.postal_code) interp.push({ label: "ZIP", value: base.postal_code });
  if (base.state) interp.push({ label: "State", value: base.state });
  return { npi: null, interpretation: interp, plans };
}

function describePlan(p: Plan): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const { first_name, last_name, city, organization_name } = p.params;
  if (first_name || last_name) out.push({ label: "Name", value: [first_name, last_name].filter(Boolean).join(" ").replace(/\*/g, "…") });
  if (city) out.push({ label: "City", value: titleCase(city) ?? city });
  if (organization_name) out.push({ label: "Organization", value: organization_name.replace(/\*$/, "") });
  if (p.label === "Specialty") out.push({ label: "Specialty", value: p.params.taxonomy_description });
  return out;
}

export async function searchProviders(q: string): Promise<SearchResponse> {
  const plan = planSearch(q);
  if (plan.npi) {
    const { raw, source } = await lookupRaw(plan.npi);
    let note: string | null = null;
    if (!raw) {
      const v = await mcpCall<{ is_valid: boolean; message?: string }>("npi_validate", { npi: plan.npi }).catch(() => null);
      note = v && !v.is_valid
        ? "That number fails the NPI check-digit test, so it can't be a real NPI."
        : "That NPI has a valid format but isn't assigned to an active provider in NPPES.";
    }
    return { query: q, interpretation: plan.interpretation, results: raw ? [toSummary(normalize(raw, source))] : [], source, note };
  }
  if (!plan.plans.length) {
    return { query: q, interpretation: plan.interpretation, results: [], source: MCP_SOURCE, note: "Add a name, specialty or city — the NPI Registry can't search by state alone." };
  }
  let lastSource: NpiSource = MCP_SOURCE;
  for (const p of plan.plans) {
    try {
      const { records, source } = await searchRaw(p.params);
      lastSource = source;
      if (records.length) {
        const results = rank(records.map((r) => normalize(r, source)), p.params).map(toSummary);
        const interpretation = [...plan.interpretation.filter((i) => !(p.label === "Specialty" && i.label === "Specialty")), ...describePlan(p)];
        const ambiguous = records.length >= SEARCH_LIMIT
          ? `Showing the first ${SEARCH_LIMIT} matches — add a city, state or specialty to narrow it down.`
          : null;
        return { query: q, interpretation, results, source, note: ambiguous };
      }
    } catch (err) {
      console.warn("[npi] plan failed", p.params, (err as Error).message);
    }
  }
  return { query: q, interpretation: plan.interpretation, results: [], source: lastSource, note: null };
}

// Primary practice address in the searched place first, then exact name matches.
function rank(list: ProviderDetail[], params: SearchParams): ProviderDetail[] {
  const city = params.city?.toLowerCase();
  const first = params.first_name && !params.first_name.includes("*") ? params.first_name.toLowerCase() : null;
  const last = params.last_name?.toLowerCase();
  const score = (d: ProviderDetail) => {
    const a = d.addresses[0];
    let s = 0;
    if (city && a?.city.toLowerCase() === city) s += 4;
    if (params.state && a?.state === params.state) s += 2;
    if (params.postal_code && a?.postalCode.startsWith(params.postal_code)) s += 4;
    if (first && d.firstName?.toLowerCase() === first) s += 1;
    if (last && d.lastName?.toLowerCase() === last) s += 1;
    if (d.status !== "Active") s -= 10;
    return s;
  };
  return list.map((d, i) => ({ d, i, s: score(d) })).sort((x, y) => y.s - x.s || x.i - y.i).map((x) => x.d);
}

export async function getProvider(npi: string): Promise<ProviderDetail | null> {
  const { raw, source } = await lookupRaw(npi);
  return raw ? normalize(raw, source) : null;
}

// ── OpenAI: research (web_search) + reconciliation (structured output) ────────

const OPENAI_URL = "https://api.openai.com/v1/responses";
// First model that the Responses API accepts wins; later ones are fallbacks.
const RESEARCH_MODELS = ["gpt-5.4", "gpt-4.1"];
const RECONCILE_MODELS = ["gpt-4.1-mini", "gpt-4o-mini"];

interface Usage { input: number; output: number }

async function openai(apiKey: string, models: string[], build: (model: string) => Record<string, unknown>, timeoutMs: number): Promise<{ data: RawRecord; model: string }> {
  let lastErr = "no model";
  for (const model of models) {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(build(model)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { data: await res.json(), model };
    const detail = await res.text().catch(() => "");
    lastErr = `OpenAI ${res.status} on ${model}: ${detail.slice(0, 300)}`;
    console.error("[npi-validate]", lastErr);
    // Only fall through to the next model for model/parameter problems.
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(lastErr);
}

function normUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    for (const k of [...url.searchParams.keys()]) if (k.startsWith("utm_")) url.searchParams.delete(k);
    return url.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
}

function domainOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}

function npiFacts(p: ProviderDetail): string {
  const lines = [
    `NPI: ${p.npi} (${p.enumerationType}, status ${p.status})`,
    `Name: ${p.name}${p.credential ? `, ${p.credential}` : ""}`,
    p.otherNames.length ? `Other names: ${p.otherNames.join("; ")}` : null,
    `Taxonomies: ${p.taxonomies.map((t) => `${t.desc}${t.primary ? " (primary)" : ""}${t.license ? ` license ${t.license} ${t.state ?? ""}` : ""}`).join("; ") || "none"}`,
    ...p.addresses.map((a) => `${a.purpose} address: ${[a.line1, a.line2, a.city, a.state, a.postalCode].filter(Boolean).join(", ")}${a.phone ? ` · phone ${a.phone}` : ""}${a.fax ? ` · fax ${a.fax}` : ""}`),
    p.authorizedOfficial ? `Authorized official: ${p.authorizedOfficial}` : null,
    `NPPES last updated: ${p.lastUpdated ?? "unknown"}; enumerated ${p.enumerationDate ?? "unknown"}`,
  ];
  return lines.filter(Boolean).join("\n");
}

const RESEARCH_PROMPT = `You are a healthcare provider-directory analyst. Independently verify a provider's NPI Registry record using web search.

Search the open web for this provider and find current evidence for:
- identity (is this the same person/organization; credentials)
- practice / organization / health system they work for
- current practice location address(es)
- phone and fax numbers
- specialty
- official website or profile page

Prefer sources in this order: 1) provider or practice official website, 2) health-system official profile, 3) state licensing / medical board, 4) payer provider directory, 5) specialty association, 6) other credible directories (e.g. Healthgrades, Doximity, WebMD, CMS Care Compare). NPI mirror sites (npiprofile, npidb, hipaaspace, npino etc.) only copy NPPES and are NOT independent — do not count them as confirmation.

Rules:
- Report only what sources actually state. Never guess or fill in missing values.
- For every fact, cite the exact source URL inline.
- Be careful about different people with the same name — check city, specialty and credentials match before attributing a source to this provider. If unsure, say so.
- Note when a source looks outdated, or when sources disagree with each other or with the NPI record.
- If you cannot find something, say "not found".

Finish with a concise per-field summary (identity, organization, address, phone, fax, specialty, website), each with source URLs.`;

const RECONCILE_PROMPT = `You reconcile provider-directory evidence. You get (1) the provider's NPI Registry record, (2) a web research report, and (3) a numbered list of source URLs that the web search actually returned.

Produce structured output. Strict rules:
- Use ONLY facts stated in the research report. Never invent phone numbers, addresses, names, or websites.
- Every finding must reference one or more source ids from the list (e.g. "S2"). If a fact has no source in the list, omit it.
- Exclude NPI mirror/aggregator sites that just copy NPPES (npiprofile, npidb, hipaaspace, npino, opennpi, etc.) from findings — they are not independent.
- Exclude sources that are about a different person with the same name.
- field meanings: identity = the provider is who the NPI says (name/credential/specialty match); organization = practice or health system; address = current practice address; phone; fax; specialty; website = the official practice/provider page URL.
- npiValue: what the NPI record says for that field (null if the NPI record has nothing, e.g. organization and website for individuals).
- assessment: "agrees" if independent sources match the NPI value; "conflict" if independent sources show a different current value; "new_information" if the NPI record has no value but sources provide one; "not_found" if no independent evidence.
- For addresses treat the same street + ZIP as agreement even if formatting differs. Suite differences are minor.
- likelyCurrent: the value you judge most likely current, or null if unknown. Prefer official practice/health-system pages and more recent sources over the NPI record, which providers often leave stale.
- confidence: 0-100, your confidence in likelyCurrent.
- reason: one or two plain sentences a business user understands.
- sourceType: official_practice, health_system, state_board, payer_directory, specialty_association, government, directory, other.
- Include all 7 fields exactly once.`;

const FIELD_KEYS: FieldKey[] = ["identity", "organization", "address", "phone", "fax", "specialty", "website"];
const SOURCE_TYPES: SourceType[] = ["official_practice", "health_system", "state_board", "payer_directory", "specialty_association", "government", "directory", "other"];

const RECONCILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "identityConfirmed", "sources", "fields"],
  properties: {
    summary: { type: "string", description: "2-3 sentence plain-English verdict on how well the NPI record holds up." },
    identityConfirmed: { type: "boolean" },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "sourceType", "confirms", "summary"],
        properties: {
          id: { type: "string" },
          name: { type: "string", description: "Human name of the source, e.g. 'Mass Eye and Ear — provider profile'" },
          sourceType: { type: "string", enum: SOURCE_TYPES },
          confirms: { type: "array", items: { type: "string", enum: FIELD_KEYS } },
          summary: { type: "string", description: "What this source says about the provider, one sentence." },
        },
      },
    },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "npiValue", "findings", "assessment", "likelyCurrent", "confidence", "reason"],
        properties: {
          field: { type: "string", enum: FIELD_KEYS },
          npiValue: { type: ["string", "null"] },
          findings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["value", "sourceIds"],
              properties: { value: { type: "string" }, sourceIds: { type: "array", items: { type: "string" } } },
            },
          },
          assessment: { type: "string", enum: ["agrees", "conflict", "not_found", "new_information"] },
          likelyCurrent: { type: ["string", "null"] },
          confidence: { type: "integer" },
          reason: { type: "string" },
        },
      },
    },
  },
};

const MIRROR_DOMAINS = /(npiprofile|npidb|hipaaspace|npino|opennpi|npi-lookup|npinumberlookup|nppes\.cms|npiregistry\.cms|bloomberg|zoominfo|findnpi|npi\.report)/i;

const digitsOnly = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

// Transparent demo scoring — NOT calibrated. Every point is shown in the UI.
export function scoreProvider(p: ProviderDetail, v: { identityConfirmed: boolean; fields: FieldComparison[]; sources: EvidenceSource[] } | null): ConfidenceScore {
  const items: ScoreItem[] = [];
  const add = (kind: ScoreItem["kind"], label: string, points: number) => items.push({ kind, label, points });

  if (p.status === "Active") add("pass", "Active NPI identity in the NPI Registry", 30);
  else add("fail", "NPI is deactivated", 0);

  const years = p.lastUpdated ? (Date.now() - Date.parse(p.lastUpdated)) / (365.25 * 864e5) : null;
  if (years !== null && years > 3) add("warn", `NPI record last updated ${Math.floor(years)} years ago`, -5);

  if (!v) {
    add("unknown", "Not yet checked against independent sources", 0);
  } else {
    const f = (k: FieldKey) => v.fields.find((x) => x.field === k);
    const officialTypes = new Set<SourceType>(["official_practice", "health_system", "state_board", "government"]);
    const official = v.sources.some((s) => officialTypes.has(s.sourceType) && s.confirms.length);

    if (v.identityConfirmed) add("pass", official ? "Identity confirmed by an official source" : "Identity confirmed by an independent source", official ? 20 : 15);
    else add("fail", "Identity not independently confirmed", -15);

    const site = f("website");
    if (site && site.findings.length) add("pass", "Official practice / provider page found", 5);
    else add("unknown", "No official practice website found", 0);

    const scored: [FieldKey, string, number][] = [["address", "Address", 10], ["phone", "Phone", 10], ["specialty", "Specialty", 10], ["fax", "Fax", 5]];
    for (const [key, label, pts] of scored) {
      const c = f(key);
      const n = new Set(c?.findings.flatMap((x) => x.sourceIds)).size;
      if (!c || c.assessment === "not_found") add("unknown", `${label} could not be independently confirmed`, 0);
      else if (c.assessment === "agrees") add("pass", `${label} confirmed${n > 1 ? ` by ${n} sources` : ""}`, pts + (n > 1 ? Math.round(pts / 2) : 0));
      else if (c.assessment === "conflict") add("warn", `${label} differs from NPI record`, key === "fax" ? -3 : -8);
      else add("pass", `${label} found (missing from NPI record)`, Math.round(pts / 2));
    }

    const domains = new Set(v.sources.filter((s) => s.confirms.length).map((s) => s.domain));
    if (domains.size >= 3) add("pass", `${domains.size} independent sources agree on core facts`, 5);
  }

  const raw = items.reduce((s, i) => s + i.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  const band = score >= 80 ? "High" : score >= 60 ? "Moderate" : score >= 40 ? "Low" : "Very low";
  return { score, band, items };
}

const validationCache = new Map<string, { at: number; result: ValidationResult }>();
const CACHE_TTL_MS = 24 * 3600_000;

export async function validateProvider(npi: string, fresh: boolean, emit: (e: ValidationEvent) => void): Promise<void> {
  const hit = validationCache.get(npi);
  if (hit && !fresh && Date.now() - hit.at < CACHE_TTL_MS) {
    emit({ type: "result", result: { ...hit.result, cached: true } });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[npi-validate] OPENAI_API_KEY is not set");
    emit({ type: "error", message: "AI validation is unavailable on this server (no OpenAI key configured). NPI Registry data above is unaffected." });
    return;
  }

  const started = Date.now();
  const provider = await getProvider(npi);
  if (!provider) {
    emit({ type: "error", message: "Couldn't load this NPI from the registry, so there is nothing to validate." });
    return;
  }

  // 1. Research — OpenAI web_search.
  emit({ type: "stage", stage: "research", message: "Searching the open web for this provider" });
  const primary = provider.addresses[0];
  const research = await openai(apiKey, RESEARCH_MODELS, (model) => ({
    model,
    tools: [{
      type: "web_search",
      search_context_size: "medium",
      user_location: { type: "approximate", country: "US", ...(primary?.city ? { city: primary.city } : {}), ...(primary?.state ? { region: primary.state } : {}) },
    }],
    include: ["web_search_call.action.sources"],
    ...(model.startsWith("gpt-5") ? { reasoning: { effort: "low" } } : {}),
    instructions: RESEARCH_PROMPT,
    input: `NPI Registry record to verify:\n${npiFacts(provider)}`,
    max_output_tokens: 6000,
  }), 150_000);

  const out: RawRecord[] = research.data.output ?? [];
  const queries: string[] = [];
  const found = new Map<string, { url: string; title: string }>();
  let reportText = "";
  for (const item of out) {
    if (item.type === "web_search_call") {
      if (item.action?.query) queries.push(item.action.query);
      for (const q of item.action?.queries ?? []) queries.push(q);
      for (const s of item.action?.sources ?? []) if (s.url) found.set(normUrl(s.url), { url: s.url, title: s.title ?? "" });
    }
    if (item.type === "message") {
      for (const c of item.content ?? []) {
        if (c.type !== "output_text") continue;
        reportText += c.text;
        for (const a of c.annotations ?? []) {
          if (a.type === "url_citation" && a.url) found.set(normUrl(a.url), { url: a.url, title: a.title ?? found.get(normUrl(a.url))?.title ?? "" });
        }
      }
    }
  }
  const searchCalls = out.filter((i: RawRecord) => i.type === "web_search_call").length;
  // Cited URLs first (they back specific claims), then the rest, capped.
  const cited = new Set<string>();
  for (const m of reportText.matchAll(/https?:\/\/[^\s)\]>"']+/g)) cited.add(normUrl(m[0].replace(/[.,;]+$/, "")));
  const list = [...found.entries()].sort((a, b) => Number(cited.has(b[0])) - Number(cited.has(a[0]))).slice(0, 30);
  const numbered = list.map(([, s], i) => ({ id: `S${i + 1}`, url: s.url, title: s.title, domain: domainOf(s.url) }));

  emit({ type: "sources", sources: numbered.map(({ url, title, domain }) => ({ url, title, domain })), queries: [...new Set(queries)].slice(0, 12) });

  if (!reportText.trim() || numbered.length === 0) {
    const result = finalize(provider, { summary: "Web research did not find independent sources for this provider. The NPI Registry record stands on its own.", identityConfirmed: false, sources: [], fields: [] }, numbered, queries, research.model, "—", searchCalls, usageOf(research.data), started);
    emit({ type: "result", result });
    return;
  }

  // 2. Reconcile — structured output, sources referenced by id only.
  emit({ type: "stage", stage: "reconcile", message: "Comparing evidence against the NPI record" });
  const reconcile = await openai(apiKey, RECONCILE_MODELS, (model) => ({
    model,
    instructions: RECONCILE_PROMPT,
    input: `## NPI Registry record\n${npiFacts(provider)}\n\n## Research report\n${reportText.slice(0, 20_000)}\n\n## Sources returned by web search\n${numbered.map((s) => `${s.id}: ${s.url}${s.title ? ` — ${s.title}` : ""}`).join("\n")}`,
    text: { format: { type: "json_schema", name: "provider_reconciliation", strict: true, schema: RECONCILE_SCHEMA } },
    max_output_tokens: 4000,
  }), 60_000);

  const textOut = (reconcile.data.output ?? []).flatMap((i: RawRecord) => i.content ?? []).find((c: RawRecord) => c.type === "output_text")?.text;
  if (!textOut) throw new Error("Reconciliation returned no output");
  const parsed = JSON.parse(textOut);

  emit({ type: "stage", stage: "score", message: "Scoring confidence" });
  const u1 = usageOf(research.data);
  const u2 = usageOf(reconcile.data);
  const result = finalize(provider, parsed, numbered, queries, research.model, reconcile.model, searchCalls, { input: u1.input + u2.input, output: u1.output + u2.output }, started);
  validationCache.set(npi, { at: Date.now(), result });
  emit({ type: "result", result });
}

function usageOf(data: RawRecord): Usage {
  return { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 };
}

// Enforce provenance: drop any source id the web search didn't return, any
// mirror site, and any finding left without a source.
function finalize(
  provider: ProviderDetail,
  parsed: { summary: string; identityConfirmed: boolean; sources: RawRecord[]; fields: RawRecord[] },
  numbered: { id: string; url: string; title: string; domain: string }[],
  queries: string[],
  researchModel: string,
  reconcileModel: string,
  searchCalls: number,
  usage: Usage,
  started: number,
): ValidationResult {
  const now = new Date().toISOString();
  const byId = new Map(numbered.filter((s) => !MIRROR_DOMAINS.test(s.domain)).map((s) => [s.id, s]));

  const fields: FieldComparison[] = FIELD_KEYS.map((key) => {
    const f = parsed.fields.find((x) => x.field === key);
    const findings = (f?.findings ?? [])
      .map((x: RawRecord) => ({ value: String(x.value), sourceIds: (x.sourceIds ?? []).filter((id: string) => byId.has(id)) }))
      .filter((x: { sourceIds: string[] }) => x.sourceIds.length);
    let assessment: Assessment = findings.length ? (f?.assessment ?? "not_found") : "not_found";
    const npiValue = f?.npiValue ?? null;

    // Phone/fax: check agreement by digits rather than trusting the model.
    if ((key === "phone" || key === "fax") && findings.length) {
      const npiNums = new Set(provider.addresses.flatMap((a) => [key === "phone" ? a.phone : a.fax]).map(digitsOnly).filter(Boolean));
      if (!npiNums.size) assessment = "new_information";
      else assessment = findings.some((x: { value: string }) => npiNums.has(digitsOnly(x.value))) ? "agrees" : "conflict";
    }
    if (assessment === "agrees" && !findings.length) assessment = "not_found";

    return {
      field: key,
      npiValue,
      findings,
      assessment,
      likelyCurrent: findings.length ? f?.likelyCurrent ?? null : npiValue,
      confidence: Math.max(0, Math.min(100, Number(f?.confidence ?? 0))),
      reason: findings.length ? f?.reason ?? "" : "No independent source confirmed this.",
    };
  });

  const usedIds = new Set(fields.flatMap((f) => f.findings.flatMap((x) => x.sourceIds)));
  const sources: EvidenceSource[] = numbered
    .filter((s) => byId.has(s.id))
    .map((s) => {
      const meta = parsed.sources.find((x) => x.id === s.id);
      const confirms = FIELD_KEYS.filter((k) => fields.find((f) => f.field === k)?.findings.some((x) => x.sourceIds.includes(s.id)));
      return {
        ...s,
        name: meta?.name || s.title || s.domain,
        sourceType: SOURCE_TYPES.includes(meta?.sourceType) ? meta!.sourceType : "other",
        confirms,
        summary: meta?.summary ?? "",
        researchedAt: now,
      };
    })
    .filter((s) => usedIds.has(s.id) || s.summary);

  const identityConfirmed = Boolean(parsed.identityConfirmed) && fields.find((f) => f.field === "identity")!.findings.length > 0;
  const score = scoreProvider(provider, { identityConfirmed, fields, sources });

  return {
    npi: provider.npi,
    validatedAt: now,
    summary: parsed.summary,
    identityConfirmed,
    fields,
    sources,
    searchQueries: [...new Set(queries)].slice(0, 12),
    score,
    usage: { researchModel, reconcileModel, searchCalls, inputTokens: usage.input, outputTokens: usage.output, durationMs: Date.now() - started },
  };
}
