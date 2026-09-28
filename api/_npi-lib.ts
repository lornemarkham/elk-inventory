// ── NPI demo — server library (TEMPORARY DEMO, delete with /npi-list) ─────────
// Underscore prefix = Vercel does not expose this file as a route.
// Web-standard fetch only (runs in the Edge runtime), no npm dependencies.
//
// NPI data: Anthropic's hosted NPI Registry MCP server (stateless JSON-RPC over
// HTTP, no auth), falling back to the public CMS NPPES API if it fails.
// Referral research (OpenAI) lives in api/_npi-referral.ts, geography in
// api/_npi-geo.ts, Washington licensing in api/_npi-wa.ts, scoring in api/_npi-score.ts.

import type { NpiSource, ProviderAddress, ProviderDetail, ProviderSummary, SearchResponse } from "../src/npi/types";

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

// Bulk candidate fetch for geographic search. CMS directly, not the MCP connector:
// MCP npi_search returns summaries without secondary practice locations or fax,
// and would need one npi_lookup per record. Both expose the same NPPES dataset.
export async function cmsQueryAll(params: SearchParams, max = 1200): Promise<{ records: RawRecord[]; truncated: boolean }> {
  const records: RawRecord[] = [];
  for (let skip = 0; skip < max; skip += 200) {
    const qs = new URLSearchParams({ version: "2.1", limit: "200", skip: String(skip), ...params });
    const res = await fetch(`${CMS_URL}?${qs}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`CMS HTTP ${res.status}`);
    const data = await res.json();
    if (data.Errors?.length) throw new Error(data.Errors.map((e: { description: string }) => e.description).join("; "));
    const page: RawRecord[] = data.results ?? [];
    records.push(...page);
    if (page.length < 200) return { records, truncated: false };
  }
  return { records, truncated: true };
}

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
