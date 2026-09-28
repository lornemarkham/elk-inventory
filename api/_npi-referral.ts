// ── NPI demo — outbound referral research + destination model (TEMPORARY) ─────
// Provider → practice/organization → practice location → contact route.
//
// OpenAI PROPOSES: one web_search research call gathers evidence per location;
// one structured-output call extracts sources, locations, numbers and verbatim
// labels. Deterministic code DECIDES: unknown source ids, off-provider sources,
// numbers that never appear in the cited research text, and "referral fax"
// labels that don't actually say "referral" are all dropped here, source
// families are assigned by domain rules where possible, and scores come from
// api/_npi-score.ts.

import type {
  Claim,
  Conflict,
  ContactNumber,
  Coords,
  EvidenceSource,
  FaxKind,
  LicenseCheck,
  NpiRelationship,
  PracticeLocation,
  ProviderDetail,
  ReferralResearch,
  ReferralView,
  ResearchEvent,
  SourceFamily,
} from "../src/npi/types";
import { formatPhone, getProvider } from "./_npi-lib";
import { addressKey, geocodeAddresses, geocodeOne, haversineMiles, matchesSpecialty, resolveSpecialty, roundMiles, type SpecialtyDef } from "./_npi-geo";
import { checkWaLicenses } from "./_npi-wa";
import { countingFamilies, fieldConfidence, fieldFrom, pickBestFax, scoreProvider, scoreReferral, sourceFamiliesOf } from "./_npi-score";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

export const NPPES_SOURCE_ID = "NPPES";
export const WA_SOURCE_ID = "WA-DOH";

// ── Numbers ──────────────────────────────────────────────────────────────────

export const digitsOnly = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

// Every 10-digit US number that appears in a block of text, digit-normalised.
export function numbersInText(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g)) out.add(digitsOnly(m[0]));
  return out;
}

// Only an explicit label can make a fax a referral fax ("referral" or "intake").
export function classifyFax(modelKind: string | null | undefined, label: string | null | undefined): { kind: FaxKind; downgraded: boolean } {
  const l = (label ?? "").toLowerCase();
  if (/referr|intake/.test(l)) return { kind: "referral", downgraded: false };
  const claimed = modelKind === "referral";
  if (/schedul|appointment/.test(l)) return { kind: "scheduling", downgraded: claimed };
  if (/office|clinic|main/.test(l)) return { kind: "office", downgraded: claimed };
  if (/fax/.test(l)) return { kind: "general", downgraded: claimed };
  return { kind: claimed ? "unknown" : ((["scheduling", "office", "general"].includes(modelKind ?? "") ? modelKind : "unknown") as FaxKind), downgraded: claimed };
}

// "New Appointment Request Form; Fax referral to 206-985-3121 Attn: Clinical Intake"
// → [{ digits: "2069853121", label: "Fax referral to 206-985-3121" }]. Only when the
// text itself says referral; a bare "fax:" in instructions stays a plain fax.
export function referralFaxesIn(text: string): { digits: string; label: string }[] {
  const out: { digits: string; label: string }[] = [];
  for (const clause of text.split(/[;\n]|\.\s/)) {
    if (!/\bfax/i.test(clause) || !/referr|intake/i.test(clause)) continue;
    for (const m of clause.matchAll(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g)) {
      // Only numbers that follow the word "fax" (not the nurse line after it).
      const before = clause.slice(0, m.index);
      if (!/\bfax\b/i.test(before) || /\b(line|phone|call|tel)\b[^0-9]*$/i.test(before)) continue;
      out.push({ digits: digitsOnly(m[0]), label: clause.trim().slice(0, 160) });
    }
  }
  return out;
}

// ── Addresses ────────────────────────────────────────────────────────────────

const DIRS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "NORTH", "SOUTH", "EAST", "WEST"]);
// "1560 N 115th St, Suite 201" + "98133" → "1560|115TH|98133". Ignores suite/floor, directionals, formatting.
export function streetKey(line1: string, zipOrCity: string): string {
  const s = line1.toUpperCase().replace(/[.,#]/g, " ").replace(/\b(STE|SUITE|UNIT|FL|FLOOR|BLDG|BUILDING|RM|ROOM|APT)\b.*$/, "").trim();
  const toks = s.split(/\s+/).filter(Boolean);
  const num = toks.find((t) => /^\d+[A-Z]?$/.test(t)) ?? "";
  const rest = toks.slice(toks.indexOf(num) + 1).filter((t) => !DIRS.has(t));
  const word = (rest[0] ?? "").replace(/^(\d+)(ST|ND|RD|TH)$/, "$1");
  return `${num}|${word}|${zipOrCity.slice(0, 5).toUpperCase()}`;
}

function sameAddress(a: { line1: string; postalCode: string; city: string }, b: { line1: string; postalCode: string; city: string }): boolean {
  const za = a.postalCode.slice(0, 5), zb = b.postalCode.slice(0, 5);
  if (za && zb) return streetKey(a.line1, za) === streetKey(b.line1, zb);
  return streetKey(a.line1, a.city) === streetKey(b.line1, b.city);
}

// ── Source families ──────────────────────────────────────────────────────────

const AGGREGATOR = /(npiprofile|npichecker|npir\.org|healthprovidersdata|npidb|hipaaspace|npino|opennpi|npi-lookup|npinumberlookup|npiregistry\.us|nppes\.us|findnpi|npi\.report|zoominfo|bloomberg|healthgrades|vitals\.com|webmd|sharecare|wellness\.com|caredash|md\.com|ratemds|doctor\.com|health\.usnews|usnews\.com|castleconnolly|medicarelist|healthcare4ppl|providerdata|opengovus|buzzfile|mapquest|yellowpages|yelp|manta\.com|birdeye|chamberofcommerce)/i;
const FEDERAL = /(^|\.)(cms\.gov|medicare\.gov|hhs\.gov)$/i;
const FEDERAL_CARE = /(^|\.)(va\.gov|ihs\.gov)$/i; // federal health systems are first-party for their own facilities
const PAYER = /(uhc\.com|uhcprovider|myuhc|aetna\.com|cigna\.com|humana\.com|anthem\.com|bcbs|bluecross|blueshield|premera\.com|regence\.com|molinahealthcare|coordinatedcarehealth|wellcare|ambetter|amerigroup|centene|healthnet|hioscar|oscar\.com|harvardpilgrim|tuftshealthplan|point32health|pacificsource|modahealth|healthplans\.providence|kaiserpermanente\.org\/.*provider|carefirst|emblemhealth|highmark|wellpoint|caresource|medica\.com|priorityhealth|geisinger.*plan|mass\.gov\/.*masshealth)/i;
const PROFESSIONAL = /(entnet\.org|audiology\.org|asha\.org|abms\.org|certificationmatters|aao-hns|triological|ama-assn|doximity\.com|abpn\.org|aafprs)/i;
const MODEL_FAMILIES: SourceFamily[] = ["first_party", "payer", "professional", "independent", "aggregator", "state", "federal"];

export function classifyFamily(url: string, domain: string, modelFamily: string | null | undefined): { family: SourceFamily; reason: string } {
  const full = `${domain}${(() => { try { return new URL(url).pathname; } catch { return ""; } })()}`;
  if (AGGREGATOR.test(domain)) return { family: "aggregator", reason: "Domain rule: known NPI mirror / aggregator directory" };
  if (FEDERAL.test(domain)) return { family: "federal", reason: "Domain rule: federal .gov" };
  if (FEDERAL_CARE.test(domain)) return { family: "first_party", reason: "Domain rule: federal health system (VA / IHS) site" };
  if (/\.gov$|\.state\.[a-z]{2}\.us$/i.test(domain)) return { family: "state", reason: "Domain rule: state / local government" };
  if (PAYER.test(full)) return { family: "payer", reason: "Domain rule: insurer / plan directory" };
  if (PROFESSIONAL.test(domain)) return { family: "professional", reason: "Domain rule: professional / specialty body" };
  const m = MODEL_FAMILIES.includes(modelFamily as SourceFamily) ? (modelFamily as SourceFamily) : "independent";
  // Only a .gov domain can make a source federal/state.
  if (m === "federal" || m === "state") return { family: "independent", reason: `Model said ${m}, but the domain is not .gov` };
  return { family: m, reason: "Model classification" };
}

// ── Locations from the NPI record ───────────────────────────────────────────

function npiNumber(num: string | null, isFax: boolean): ContactNumber | null {
  if (!num) return null;
  const digits = digitsOnly(num);
  if (digits.length !== 10) return null;
  const c = fieldConfidence(["federal"], { npiAgrees: true, npiOnlyBase: isFax ? 40 : 45 });
  return { number: formatPhone(digits)!, digits, label: null, faxKind: isFax ? "unknown" : undefined, sourceIds: [NPPES_SOURCE_ID], families: ["federal"], inNpi: true, confidence: Math.min(c.confidence, isFax ? 40 : 45) };
}

export function npiLocations(p: ProviderDetail): PracticeLocation[] {
  return p.addresses.filter((a) => a.purpose !== "Mailing").map((a, i) => {
    const phone = npiNumber(a.phone, false);
    const fax = npiNumber(a.fax, true);
    return blankLocation({
      id: `npi-${i}`,
      name: p.enumerationType === "Organization" ? p.name : a.line1,
      organization: p.enumerationType === "Organization" ? p.name : null,
      line1: a.line1, line2: a.line2, city: a.city, state: a.state, postalCode: a.postalCode,
      origin: "npi", npiPurpose: a.purpose as PracticeLocation["npiPurpose"], status: "npi_only",
      phones: phone ? [phone] : [], faxes: fax ? [fax] : [],
      sourceIds: [NPPES_SOURCE_ID], families: ["federal"],
    });
  });
}

function blankLocation(p: Partial<PracticeLocation> & Pick<PracticeLocation, "id" | "name" | "line1" | "city" | "state" | "postalCode" | "origin">): PracticeLocation {
  const empty = { value: null, confidence: 0, basis: "", sourceIds: [] };
  return {
    organization: null, line2: null, coords: null, geoPrecision: null, distanceMi: null, inRadius: null,
    npiPurpose: null, status: "npi_only", statusNote: null, phones: [], faxes: [], bestFax: null,
    referralInstructions: null, acceptingNewPatients: null, sourceIds: [], families: [],
    fields: { location: empty, phone: empty, fax: empty, referralFax: empty },
    referral: { score: 0, band: "Very low", items: [] },
    ...p,
  };
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

const OPENAI_URL = "https://api.openai.com/v1/responses";
const RESEARCH_MODELS = ["gpt-5.4", "gpt-4.1"];
const EXTRACT_MODELS = ["gpt-4.1-mini", "gpt-4o-mini"];

async function openai(apiKey: string, models: string[], build: (model: string) => Record<string, unknown>, timeoutMs: number): Promise<{ data: Raw; model: string }> {
  let lastErr = "no model";
  for (const model of models) {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(build(model)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { data: await res.json(), model };
    lastErr = `OpenAI ${res.status} on ${model}: ${(await res.text().catch(() => "")).slice(0, 300)}`;
    console.error("[npi-research]", lastErr);
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(lastErr);
}

function npiFacts(p: ProviderDetail): string {
  return [
    `NPI: ${p.npi} (${p.enumerationType}, status ${p.status})`,
    `Name: ${p.name}${p.credential ? `, ${p.credential}` : ""}`,
    p.otherNames.length ? `Other names: ${p.otherNames.join("; ")}` : null,
    `Taxonomies: ${p.taxonomies.map((t) => `${t.desc}${t.primary ? " (primary)" : ""}${t.license ? ` license ${t.license} ${t.state ?? ""}` : ""}`).join("; ") || "none"}`,
    ...p.addresses.filter((a) => a.purpose !== "Mailing").map((a) => `${a.purpose} location: ${[a.line1, a.line2, a.city, a.state, a.postalCode].filter(Boolean).join(", ")}${a.phone ? ` · phone ${a.phone}` : ""}${a.fax ? ` · fax ${a.fax}` : ""}`),
    p.authorizedOfficial ? `Authorized official: ${p.authorizedOfficial}` : null,
    `NPPES last updated: ${p.lastUpdated ?? "unknown"}`,
  ].filter(Boolean).join("\n");
}

const RESEARCH_PROMPT = `You support an AUDIOLOGY clinic that needs to send an OUTBOUND REFERRAL to the provider below. Your job is not to "validate an NPI record" — it is to find out WHERE and HOW a referral to this provider can be sent today, using web search.

Find, with a source URL for every fact:
1. Is this the same provider (name, credentials, specialty)? Watch for different people with the same name.
2. Current practice / clinic / health-system affiliation(s). Note former affiliations as former.
3. EVERY current physical practice location — a provider often works at several sites of one health system. List each location separately with its own street address.
4. Specialty / subspecialty as stated by the practice — and say clearly if the provider now practises something different from the NPI taxonomy.
5. For EACH location: the phone number and the fax number, and the EXACT label the source puts next to each number, quoted verbatim (e.g. "Referral Fax:", "Fax:", "Scheduling fax", "Clinic fax"). Never describe a fax as a referral fax unless the source literally says so.
6. Referral instructions or referral forms, if the practice publishes them.
7. Whether new patients / referrals are accepted — only if a source explicitly says so.
8. Official website / profile page.
9. State licence information, if you find it on a state licensing site.
10. Payer / insurer provider-directory listings, if any (name the insurer).
11. Anything stale or conflicting: moved practices, renamed or acquired practices, numbers that differ between sources, locations that only the NPI record lists.

Clinic, department and location pages count as evidence for a site's address, phone and fax even when they don't name the provider — use them once another source ties the provider to that site.

Source preference: 1) the practice's or health system's own pages, 2) insurer directories, 3) state licensing, 4) specialty societies, 5) other reputable sources. NPI mirror sites (npiprofile, npidb, hipaaspace, npino …) and generic doctor directories (Healthgrades, Vitals, WebMD …) often just copy NPPES — say when a fact comes ONLY from them.

Rules: report only what sources state; write phone/fax numbers exactly as published; cite the URL next to every fact; say "not found" when you cannot find something; say when a page looks old.

Finish with a per-location summary: location name, organization, street address, phone (label), fax (verbatim label), referral instructions, source URLs.`;

const EXTRACT_PROMPT = `You convert a web-research report about a healthcare provider into structured referral-destination data. You receive the provider's NPI record, the research report, and a numbered list of the source URLs that web search actually returned.

Strict rules:
- Use ONLY facts stated in the research report. Never invent numbers, addresses, names or URLs.
- Every item must cite source ids from the numbered list (e.g. "S3"). No source id → omit the item.
- sources: one entry per source id you use. aboutDifferentProvider=true ONLY when the page describes a different person or organization that merely shares a name. Clinic, department, location, "find a doctor" and insurer-directory pages that give the address/phone/fax of a site where this provider practises are NOT different providers, even if the page does not name the provider. family: first_party (the practice, clinic, hospital or health system's own site), payer (insurer / health-plan directory), professional (specialty society, board, professional network), state (state licensing / government), federal (CMS / NPPES / federal government), aggregator (ONLY NPI mirrors and multi-provider doctor directories that copy NPPES, e.g. Healthgrades, Vitals, WebMD, npiprofile — a practice's own website is first_party however small), independent (anything else reputable). currentness: "current" if the page is evidently maintained/current, "possibly_stale" if it looks old or contradicts newer sources, else "unknown".
- locations: one per distinct physical site. Put each phone and fax under the location the SOURCE ties it to. Do not copy a number from one location onto another.
- faxes[].label: the verbatim label text next to the number in the source (e.g. "Referral Fax", "Fax"), or null if the report gives none. faxKind: "referral" ONLY when the label explicitly says referral; "scheduling" when it says scheduling/appointments; "office" or "general" for plain fax; "unknown" otherwise.
- currentness per location: "current", "former" (sources say the provider left or the site closed), or "unknown".
- relationship: how the NPI record relates to what the web shows — npi_current (web agrees with NPI locations), additional_locations (NPI correct but incomplete), npi_stale_moved (provider now practises elsewhere), successor_practice (same phone/fax but renamed/acquired practice), ambiguous_identity (cannot tell if sources are the same provider), no_evidence. Explain in one or two sentences a business user understands. Do not force a conclusion the evidence does not support.
- specialty.value: the specialty the provider CURRENTLY practises, in six words or fewer. specialty.status: "same" if it matches the NPI taxonomy; "different" if sources show the provider now practises a different specialty than the NPI taxonomy says (e.g. an ENT now doing only aesthetics, or an audiologist registered under an ENT taxonomy); "unknown" otherwise.
- identity.confirmed: true only if a source clearly describes this same provider. identity.conflict: true only if sources contradict the identity (e.g. different credential/specialty for the same name and place).
- acceptingNewPatients only when a source explicitly says so.
- conflicts: real disagreements between sources (fax numbers, addresses, practice names), each with source ids.`;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const ids = { type: "array", items: { type: "string" } };
const numberItem = (fax: boolean) => ({
  type: "object",
  additionalProperties: false,
  required: fax ? ["number", "label", "faxKind", "sourceIds"] : ["number", "label", "sourceIds"],
  properties: {
    number: { type: "string" },
    label: { type: ["string", "null"] },
    ...(fax ? { faxKind: { type: "string", enum: ["referral", "scheduling", "office", "general", "unknown"] } } : {}),
    sourceIds: ids,
  },
});

const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "relationship", "identity", "specialty", "affiliations", "sources", "locations", "conflicts", "licenses"],
  properties: {
    summary: { type: "string", description: "2-3 sentences: where this provider can be referred and how reliable the contact routes look." },
    relationship: {
      type: "object", additionalProperties: false, required: ["kind", "explanation", "sourceIds"],
      properties: { kind: { type: "string", enum: ["npi_current", "additional_locations", "npi_stale_moved", "successor_practice", "ambiguous_identity", "no_evidence"] }, explanation: { type: "string" }, sourceIds: ids },
    },
    identity: { type: "object", additionalProperties: false, required: ["confirmed", "conflict", "note", "sourceIds"], properties: { confirmed: { type: "boolean" }, conflict: { type: "boolean" }, note: { type: "string" }, sourceIds: ids } },
    specialty: { type: "object", additionalProperties: false, required: ["value", "status", "sourceIds"], properties: { value: { type: ["string", "null"] }, status: { type: "string", enum: ["same", "different", "unknown"] }, sourceIds: ids } },
    affiliations: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "current", "sourceIds"], properties: { name: { type: "string" }, current: { type: "string", enum: ["current", "former", "unknown"] }, sourceIds: ids } } },
    sources: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "name", "family", "aboutDifferentProvider", "currentness", "summary"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          family: { type: "string", enum: MODEL_FAMILIES },
          aboutDifferentProvider: { type: "boolean", description: "true only if the page is about a different person/organization with a similar name" },
          currentness: { type: "string", enum: ["current", "possibly_stale", "unknown"] },
          summary: { type: "string" },
        },
      },
    },
    locations: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "organization", "line1", "line2", "city", "state", "postalCode", "currentness", "sourceIds", "phones", "faxes", "referralInstructions", "acceptingNewPatients"],
        properties: {
          name: { type: "string", description: "Clinic / site name as the source gives it" },
          organization: { type: ["string", "null"] },
          line1: { type: "string" },
          line2: { type: ["string", "null"] },
          city: { type: "string" },
          state: { type: "string" },
          postalCode: { type: "string" },
          currentness: { type: "string", enum: ["current", "former", "unknown"] },
          sourceIds: ids,
          phones: { type: "array", items: numberItem(false) },
          faxes: { type: "array", items: numberItem(true) },
          referralInstructions: nullable({ type: "object", additionalProperties: false, required: ["text", "sourceIds"], properties: { text: { type: "string" }, sourceIds: ids } }),
          acceptingNewPatients: nullable({ type: "object", additionalProperties: false, required: ["accepting", "text", "sourceIds"], properties: { accepting: { type: "boolean" }, text: { type: "string" }, sourceIds: ids } }),
        },
      },
    },
    conflicts: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "description", "sourceIds"], properties: { field: { type: "string" }, description: { type: "string" }, sourceIds: ids } } },
    licenses: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "sourceIds"], properties: { text: { type: "string" }, sourceIds: ids } } },
  },
};

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

const researchCache = new Map<string, { at: number; research: ReferralResearch }>();
const CACHE_TTL_MS = 24 * 3600_000;

export async function researchProvider(npi: string, fresh: boolean, emit: (e: ResearchEvent) => void, takeSlot: () => boolean = () => true): Promise<{ provider: ProviderDetail; research: ReferralResearch } | null> {
  const provider = await getProvider(npi);
  if (!provider) {
    emit({ type: "error", message: "Couldn't load this NPI from the registry, so there is nothing to research." });
    return null;
  }
  const hit = researchCache.get(npi);
  if (hit && !fresh && Date.now() - hit.at < CACHE_TTL_MS) return { provider, research: { ...hit.research, cached: true } };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    emit({ type: "error", message: "Web research is unavailable on this server (no OpenAI key configured). NPI and licence data are unaffected." });
    return null;
  }
  if (!takeSlot()) {
    emit({ type: "error", code: "rate_limited", message: "Research limit reached for this demo session. Try again later." });
    return null;
  }

  const started = Date.now();
  emit({ type: "stage", stage: "research", message: "Searching the web for current locations, phone and fax" });
  const primary = provider.addresses[0];
  const research = await openai(apiKey, RESEARCH_MODELS, (model) => ({
    model,
    tools: [{ type: "web_search", search_context_size: "medium", user_location: { type: "approximate", country: "US", ...(primary?.city ? { city: primary.city } : {}), ...(primary?.state ? { region: primary.state } : {}) } }],
    include: ["web_search_call.action.sources"],
    ...(model.startsWith("gpt-5") ? { reasoning: { effort: "low" } } : {}),
    instructions: RESEARCH_PROMPT,
    input: `Provider (from the NPI Registry):\n${npiFacts(provider)}`,
    max_output_tokens: 8000,
  }), 170_000);

  const out: Raw[] = research.data.output ?? [];
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
        for (const a of c.annotations ?? []) if (a.type === "url_citation" && a.url) found.set(normUrl(a.url), { url: a.url, title: a.title ?? found.get(normUrl(a.url))?.title ?? "" });
      }
    }
  }
  const searchCalls = out.filter((i: Raw) => i.type === "web_search_call").length;
  const cited = new Set<string>();
  for (const m of reportText.matchAll(/https?:\/\/[^\s)\]>"']+/g)) cited.add(normUrl(m[0].replace(/[.,;]+$/, "")));
  const list = [...found.entries()].sort((a, b) => Number(cited.has(b[0])) - Number(cited.has(a[0]))).slice(0, 30);
  const numbered = list.map(([, s], i) => ({ id: `S${i + 1}`, url: s.url, title: s.title, domain: domainOf(s.url) }));
  emit({ type: "sources", sources: numbered.map(({ url, title, domain }) => ({ url, title, domain })), queries: [...new Set(queries)].slice(0, 12) });

  const u1 = usageOf(research.data);
  let parsed: Raw = null;
  let extractModel = "—";
  let u2 = { input: 0, output: 0 };
  if (reportText.trim() && numbered.length) {
    emit({ type: "stage", stage: "extract", message: "Separating locations, phones and faxes by source" });
    const ex = await openai(apiKey, EXTRACT_MODELS, (model) => ({
      model,
      instructions: EXTRACT_PROMPT,
      input: `## NPI record\n${npiFacts(provider)}\n\n## Research report\n${reportText.slice(0, 24_000)}\n\n## Sources returned by web search\n${numbered.map((s) => `${s.id}: ${s.url}${s.title ? ` — ${s.title}` : ""}`).join("\n")}`,
      text: { format: { type: "json_schema", name: "referral_destinations", strict: true, schema: EXTRACT_SCHEMA } },
      max_output_tokens: 6000,
    }), 90_000);
    const textOut = (ex.data.output ?? []).flatMap((i: Raw) => i.content ?? []).find((c: Raw) => c.type === "output_text")?.text;
    if (!textOut) throw new Error("Extraction returned no output");
    parsed = JSON.parse(textOut);
    extractModel = ex.model;
    u2 = usageOf(ex.data);
  }

  emit({ type: "stage", stage: "score", message: "Checking evidence and scoring each destination" });
  const result = await finalizeResearch(provider, parsed, numbered, reportText, {
    researchModel: research.model, extractModel, searchCalls, inputTokens: u1.input + u2.input, outputTokens: u1.output + u2.output, durationMs: Date.now() - started,
  }, [...new Set(queries)].slice(0, 12));
  researchCache.set(npi, { at: Date.now(), research: result });
  return { provider, research: result };
}

function usageOf(data: Raw): { input: number; output: number } {
  return { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 };
}

// ── Deterministic filtering + merge ──────────────────────────────────────────

export async function finalizeResearch(
  provider: ProviderDetail,
  parsed: Raw | null,
  numbered: { id: string; url: string; title: string; domain: string }[],
  reportText: string,
  usage: ReferralResearch["usage"],
  searchQueries: string[],
): Promise<ReferralResearch> {
  const now = new Date().toISOString();
  const dropped: ReferralResearch["dropped"] = [];
  const p = parsed ?? { summary: "Web research found no usable independent sources for this provider.", relationship: { kind: "no_evidence", explanation: "No web evidence was found.", sourceIds: [] }, identity: { confirmed: false, conflict: false, note: "", sourceIds: [] }, specialty: { value: null, status: "unknown", sourceIds: [] }, affiliations: [], sources: [], locations: [], conflicts: [], licenses: [] };

  // Sources: must be one web search actually returned, and about this provider.
  const meta = new Map<string, Raw>((p.sources ?? []).map((s: Raw) => [s.id, s]));
  const sources: EvidenceSource[] = [];
  for (const s of numbered) {
    const m = meta.get(s.id);
    if (!m) continue;
    if (m.aboutDifferentProvider === true) { dropped.push({ reason: "Source is about a different provider", detail: s.domain }); continue; }
    const { family, reason } = classifyFamily(s.url, s.domain, m.family);
    sources.push({ id: s.id, url: s.url, title: s.title, domain: s.domain, name: m.name || s.title || s.domain, family, familyReason: reason, summary: m.summary ?? "", currentness: m.currentness ?? "unknown", researchedAt: now });
  }
  for (const id of meta.keys()) if (!numbered.some((s) => s.id === id)) dropped.push({ reason: "Model cited a source id web search never returned", detail: id });
  const valid = new Set(sources.map((s) => s.id));
  const keep = (list: string[] | undefined, what: string): string[] => {
    const good = (list ?? []).filter((id) => valid.has(id));
    const bad = (list ?? []).filter((id) => !valid.has(id));
    if (bad.length) dropped.push({ reason: "Unknown or off-provider source id removed", detail: `${what}: ${bad.join(", ")}` });
    return good;
  };
  const fams = (list: string[]) => sourceFamiliesOf(list, sources);
  const inReport = numbersInText(reportText);

  const npiLocs = npiLocations(provider);
  const npiPhones = new Set(npiLocs.flatMap((l) => l.phones.map((n) => n.digits)));
  const npiFaxes = new Set(npiLocs.flatMap((l) => l.faxes.map((n) => n.digits)));

  const makeNumber = (n: Raw, isFax: boolean, where: string): ContactNumber | null => {
    const digits = digitsOnly(n.number);
    if (digits.length !== 10) { dropped.push({ reason: "Not a 10-digit US number", detail: `${where}: ${n.number}` }); return null; }
    if (!inReport.has(digits)) { dropped.push({ reason: "Number does not appear in the cited research text", detail: `${where}: ${n.number}` }); return null; }
    const sids = keep(n.sourceIds, `${where} ${n.number}`);
    if (!sids.length) { dropped.push({ reason: "Number has no valid source", detail: `${where}: ${n.number}` }); return null; }
    const f = fams(sids);
    const inNpi = (isFax ? npiFaxes : npiPhones).has(digits);
    let faxKind: FaxKind | undefined;
    if (isFax) {
      const c = classifyFax(n.faxKind, n.label);
      faxKind = c.kind;
      if (c.downgraded) dropped.push({ reason: "“Referral fax” claim not supported by the source label — shown as a plain fax", detail: `${where}: ${n.number} (label: ${n.label ?? "none"})` });
    }
    const { confidence } = fieldConfidence(f, { npiAgrees: inNpi });
    const label = typeof n.label === "string" ? n.label.replace(/^[#*\s]+|[*\s]+$/g, "") || null : null;
    return { number: formatPhone(digits)!, digits, label, faxKind, sourceIds: sids, families: f, inNpi, confidence };
  };

  // Research locations.
  const researched: PracticeLocation[] = [];
  (p.locations ?? []).forEach((l: Raw, i: number) => {
    const where = l.name || l.line1;
    const sids = keep(l.sourceIds, `location ${where}`);
    const phones = (l.phones ?? []).map((n: Raw) => makeNumber(n, false, where)).filter(Boolean) as ContactNumber[];
    const faxes = (l.faxes ?? []).map((n: Raw) => makeNumber(n, true, where)).filter(Boolean) as ContactNumber[];
    const allIds = [...new Set([...sids, ...phones.flatMap((n) => n.sourceIds), ...faxes.flatMap((n) => n.sourceIds)])];
    if (!allIds.length || !l.line1) { dropped.push({ reason: "Location has no valid source or street address", detail: where }); return; }
    const ri = l.referralInstructions ? { value: l.referralInstructions.text, sourceIds: keep(l.referralInstructions.sourceIds, "referral instructions") } : null;
    const anp = l.acceptingNewPatients ? { value: l.acceptingNewPatients.text, accepting: Boolean(l.acceptingNewPatients.accepting), sourceIds: keep(l.acceptingNewPatients.sourceIds, "accepting new patients") } : null;
    // A fax number written inside referral instructions ("Fax referrals to …") is a
    // referral fax by the source's own words — still subject to the same checks.
    if (ri && ri.sourceIds.length) {
      for (const f of referralFaxesIn(ri.value)) {
        if (faxes.some((x) => x.digits === f.digits && x.faxKind === "referral")) continue;
        const n = makeNumber({ number: f.digits, label: f.label, faxKind: "referral", sourceIds: ri.sourceIds }, true, where);
        if (n) { const same = faxes.findIndex((x) => x.digits === n.digits); if (same >= 0) faxes.splice(same, 1); faxes.push(n); }
      }
    }
    researched.push(blankLocation({
      id: `web-${i}`, name: l.name || l.organization || l.line1, organization: l.organization ?? null,
      line1: l.line1, line2: l.line2 ?? null, city: l.city ?? "", state: (l.state ?? "").toUpperCase().slice(0, 2), postalCode: l.postalCode ?? "",
      origin: "research", status: l.currentness === "former" ? "former" : "current",
      statusNote: l.currentness === "former" ? "Sources say the provider no longer practises here" : null,
      phones: dedupeNumbers(phones), faxes: dedupeNumbers(faxes),
      referralInstructions: ri && ri.sourceIds.length ? ri : null,
      acceptingNewPatients: anp && anp.sourceIds.length ? anp : null,
      sourceIds: allIds, families: fams(allIds),
    }));
  });

  // Merge research locations that describe the same address.
  const merged: PracticeLocation[] = [];
  for (const r of researched) {
    const same = merged.find((m) => sameAddress(m, r));
    if (same) mergeInto(same, r);
    else merged.push(r);
  }

  // Merge NPI locations into matching research locations; keep unmatched NPI ones.
  const locations: PracticeLocation[] = [...merged];
  for (const n of npiLocs) {
    const noStreet = !/\d/.test(n.line1);
    const shares = (m: PracticeLocation) => [...m.phones, ...m.faxes].some((x) => [...n.phones, ...n.faxes].some((y) => y.digits === x.digits));
    const match = merged.find((m) => sameAddress(m, n)) ??
      (noStreet ? merged.find((m) => m.postalCode.slice(0, 5) === n.postalCode.slice(0, 5) && shares(m)) : undefined);
    if (match) {
      match.origin = "both";
      match.npiPurpose = n.npiPurpose;
      mergeInto(match, n);
    } else {
      // Successor / relocation signal: a researched location reuses this NPI location's phone or fax.
      const sharing = merged.find((m) => m.status !== "former" && [...m.phones, ...m.faxes].some((x) => [...n.phones, ...n.faxes].some((y) => y.digits === x.digits)));
      n.status = sharing ? "possibly_stale" : "npi_only";
      n.statusNote = sharing
        ? `Only the NPI record lists this address. Its phone/fax now appear for “${sharing.name}” at ${sharing.line1}, ${sharing.city} — the practice has likely moved or been renamed.`
        : merged.length ? "Only the NPI record lists this address — web research did not find the provider here." : "Only the NPI record lists this address.";
      locations.push(n);
    }
  }
  for (const l of locations) {
    l.bestFax = pickBestFax(l.faxes);
  }

  // Geocode researched addresses (NPI ones are geocoded with the view).
  await Promise.all(locations.filter((l) => l.origin !== "npi").map(async (l) => {
    const g = await geocodeOne({ key: addressKey(l.line1, l.postalCode || l.city), line1: l.line1, city: l.city, state: l.state, zip5: l.postalCode.slice(0, 5) }).catch(() => null);
    if (g) { l.coords = g.coords; l.geoPrecision = g.precision; }
  }));

  const identityIds = keep(p.identity?.sourceIds, "identity");
  const specialtyIds = keep(p.specialty?.sourceIds, "specialty");
  const affiliations = (p.affiliations ?? []).map((a: Raw) => {
    const sids = keep(a.sourceIds, `affiliation ${a.name}`);
    return { value: a.name, sourceIds: sids, current: a.current, families: fams(sids) };
  }).filter((a: { sourceIds: string[] }) => a.sourceIds.length);
  const currentAff = affiliations.find((a: { current: string }) => a.current === "current") ?? null;

  const conflicts: Conflict[] = (p.conflicts ?? []).map((c: Raw) => ({ field: c.field, description: c.description, sourceIds: keep(c.sourceIds, "conflict") }));
  const relIds = keep(p.relationship?.sourceIds, "relationship");
  const kind: NpiRelationship = p.relationship?.kind ?? "no_evidence";

  const identityConfirmed = Boolean(p.identity?.confirmed) && countingFamilies(fams(identityIds)).length > 0;
  return {
    npi: provider.npi,
    researchedAt: now,
    summary: p.summary ?? "",
    relationship: { kind: relIds.length || kind === "no_evidence" ? kind : "no_evidence", explanation: p.relationship?.explanation ?? "", sourceIds: relIds },
    identity: { ...fieldFrom(identityConfirmed ? provider.name : null, identityIds, sources, { conflict: Boolean(p.identity?.conflict) }), confirmed: identityConfirmed, conflict: Boolean(p.identity?.conflict) && identityIds.length > 0 },
    specialty: { ...fieldFrom(specialtyIds.length ? p.specialty?.value ?? null : null, specialtyIds, sources), status: specialtyIds.length && countingFamilies(fams(specialtyIds)).length ? (p.specialty?.status ?? "unknown") : "unknown" },
    affiliations,
    organization: fieldFrom(currentAff?.value ?? null, currentAff?.sourceIds ?? [], sources),
    locations,
    conflicts: conflicts.filter((c) => c.sourceIds.length),
    webLicense: (p.licenses ?? []).map((l: Raw) => ({ value: l.text, sourceIds: keep(l.sourceIds, "licence") })).filter((l: Claim) => l.sourceIds.length),
    sources,
    dropped,
    searchQueries,
    usage,
  };
}

function dedupeNumbers(list: ContactNumber[]): ContactNumber[] {
  const out: ContactNumber[] = [];
  for (const n of list) {
    const same = out.find((o) => o.digits === n.digits);
    if (!same) { out.push({ ...n }); continue; }
    same.sourceIds = [...new Set([...same.sourceIds, ...n.sourceIds])];
    same.families = [...new Set([...same.families, ...n.families])];
    same.inNpi ||= n.inNpi;
    if ((n.faxKind === "referral" && same.faxKind !== "referral") || (!same.label && n.label)) { same.faxKind = n.faxKind; same.label = n.label; }
    same.confidence = Math.max(same.confidence, n.confidence);
  }
  return out;
}

function mergeInto(target: PracticeLocation, other: PracticeLocation) {
  target.phones = dedupeNumbers([...target.phones, ...other.phones]);
  target.faxes = dedupeNumbers([...target.faxes, ...other.faxes]);
  target.sourceIds = [...new Set([...target.sourceIds, ...other.sourceIds])];
  target.families = [...new Set([...target.families, ...other.families])];
  target.referralInstructions ??= other.referralInstructions;
  target.acceptingNewPatients ??= other.acceptingNewPatients;
  target.organization ??= other.organization;
  if (other.status === "former" && target.status !== "former") { target.status = "possibly_stale"; target.statusNote = "Sources disagree on whether the provider still practises here"; }
}

// ── View: license + distances + scores ───────────────────────────────────────

export interface ViewOptions {
  origin: Coords | null;
  radiusMi: number | null;
  specialty: SpecialtyDef | null;
  license: LicenseCheck | null;
}

export async function licenseFor(provider: ProviderDetail): Promise<LicenseCheck | null> {
  if (provider.enumerationType === "Organization") return null;
  const states = new Set([...provider.addresses.filter((a) => a.purpose !== "Mailing").map((a) => a.state), ...provider.taxonomies.map((t) => t.state)]);
  if (!states.has("WA")) {
    return { state: [...states].filter(Boolean)[0] ?? "—", source: "—", sourceUrl: "", checkedAt: new Date().toISOString(), match: "unsupported_state", matchNote: "Automated licence verification is implemented for Washington only in this demo.", records: [] };
  }
  const m = await checkWaLicenses([{ npi: provider.npi, firstName: provider.firstName, lastName: provider.lastName, isOrg: false, licenses: provider.taxonomies }]).catch(() => null);
  return m?.get(provider.npi) ?? null;
}

export async function buildView(provider: ProviderDetail, research: ReferralResearch | null, o: ViewOptions): Promise<ReferralView> {
  // Fresh copies so cached research is never mutated by per-origin distances.
  const locations: PracticeLocation[] = structuredClone(research ? research.locations : npiLocations(provider));

  const needGeo = locations.filter((l) => !l.coords);
  if (needGeo.length) {
    const geo = await geocodeAddresses(needGeo.map((l) => ({ key: addressKey(l.line1, l.postalCode || l.city), line1: l.line1, city: l.city, state: l.state, zip5: l.postalCode.slice(0, 5) }))).catch(() => new Map());
    for (const l of needGeo) {
      const g = geo.get(addressKey(l.line1, l.postalCode || l.city));
      if (g) { l.coords = g.coords; l.geoPrecision = g.precision; }
    }
  }
  const yearsOld = provider.lastUpdated ? (Date.now() - Date.parse(provider.lastUpdated)) / (365.25 * 864e5) : null;
  const allSources = research?.sources ?? [];

  // Fax published for one location but the NPI lists it at another.
  const faxOwners = new Map<string, PracticeLocation[]>();
  for (const l of locations) for (const f of l.faxes) if (f.families.some((x) => x !== "federal")) faxOwners.set(f.digits, [...(faxOwners.get(f.digits) ?? []), l]);

  for (const l of locations) {
    if (o.origin && l.coords) {
      l.distanceMi = roundMiles(haversineMiles(o.origin, l.coords));
      l.inRadius = o.radiusMi !== null ? l.distanceMi <= o.radiusMi : null;
    }
    const general = l.faxes.filter((f) => f.faxKind !== "referral" && f.faxKind !== "scheduling" && f.families.some((x) => x !== "federal"));
    const faxConflict = new Set(general.map((f) => f.digits)).size > 1 && !l.faxes.some((f) => f.faxKind === "referral");
    const npiFax = l.faxes.find((f) => f.inNpi && f.families.length === 1 && f.families[0] === "federal");
    const elsewhere = npiFax ? (faxOwners.get(npiFax.digits) ?? []).find((x) => x !== l) : undefined;
    const firstPartyCurrent = l.sourceIds.some((id) => { const s = allSources.find((x) => x.id === id); return s?.family === "first_party" && s.currentness === "current"; });

    l.bestFax = pickBestFax(l.faxes);
    const stale = l.status === "possibly_stale" || l.status === "former";
    const locFams = l.families;
    const loc = fieldConfidence(locFams, { stale, npiAgrees: l.origin !== "research", npiOnlyBase: 45 });
    const phone = l.phones[0];
    const fax = l.bestFax;
    l.fields = {
      location: { value: [l.line1, l.city, l.state].join(", "), ...loc, sourceIds: l.sourceIds },
      phone: phone ? { value: phone.number, confidence: phone.confidence, basis: fieldConfidence(phone.families, { npiAgrees: phone.inNpi, npiOnlyBase: 45 }).basis, sourceIds: phone.sourceIds } : { value: null, confidence: 0, basis: "Not found", sourceIds: [] },
      fax: fax ? { value: fax.number, confidence: Math.max(0, fax.confidence - (faxConflict ? 25 : 0)), basis: fieldConfidence(fax.families, { npiAgrees: fax.inNpi, conflict: faxConflict, npiOnlyBase: 40 }).basis, sourceIds: fax.sourceIds } : { value: null, confidence: 0, basis: "Not found", sourceIds: [] },
      referralFax: fax?.faxKind === "referral"
        ? { value: fax.number, ...fieldConfidence(fax.families), sourceIds: fax.sourceIds }
        : { value: null, confidence: 0, basis: fax ? "No source labels a fax here as a referral fax" : "No fax found", sourceIds: [] },
    };
    l.referral = scoreReferral(l, { researched: Boolean(research), firstPartyCurrent, specialtyMismatch: research?.specialty.status === "different" ? research.specialty.value : null, faxConflict, npiFaxElsewhere: elsewhere ? `${elsewhere.name}, ${elsewhere.city}` : null, npiUpdatedYearsAgo: yearsOld });
  }

  // Order: usable first, then inside the search radius, then referral confidence, then distance.
  locations.sort((a, b) => Number(a.status === "former") - Number(b.status === "former") || Number(a.inRadius === false) - Number(b.inRadius === false) || b.referral.score - a.referral.score || (a.distanceMi ?? 1e9) - (b.distanceMi ?? 1e9));

  const codes = provider.taxonomies.map((t) => t.code);
  const spec = o.specialty;
  const specMatch = spec
    ? { matched: matchesSpecialty(spec, codes), label: spec.label, requested: true, licenseTypes: spec.licenseTypes }
    : { matched: codes.length > 0, label: provider.specialty ?? "no taxonomy", requested: false };
  const practiceState = provider.addresses[0]?.state ?? null;

  const providerScore = scoreProvider({
    active: provider.status === "Active",
    specialtyMatch: specMatch,
    license: o.license,
    licenseStateSupported: o.license?.match !== "unsupported_state",
    practiceState,
    isOrg: provider.enumerationType === "Organization",
    npiUpdatedYearsAgo: yearsOld,
    research,
  });

  const matchedTax = spec ? provider.taxonomies.find((t) => matchesSpecialty(spec, [t.code])) : provider.taxonomies.find((t) => t.primary);
  const specialtyField = research?.specialty.value
    ? { ...research.specialty, confidence: Math.min(97, research.specialty.confidence + (specMatch.matched ? 6 : 0)), basis: `${research.specialty.basis}${specMatch.matched ? " · NPI taxonomy agrees" : ""}` }
    : { value: matchedTax?.desc ?? provider.specialty, confidence: matchedTax ? 70 : 0, basis: matchedTax ? `NPI taxonomy ${matchedTax.code}` : "No matching taxonomy", sourceIds: [NPPES_SOURCE_ID] };
  const lic = o.license;
  const licenseField = !lic || lic.match === "unsupported_state" || lic.match === "error" || lic.match === "none"
    ? { value: null, confidence: 0, basis: lic?.matchNote ?? "Not checked", sourceIds: [] }
    : { value: `${lic.records[0]?.credentialType ?? ""}: ${lic.records[0]?.status ?? ""}`, confidence: lic.match === "exact" ? 95 : lic.match === "name" ? 70 : 40, basis: lic.matchNote, sourceIds: [WA_SOURCE_ID] };

  return {
    provider,
    license: lic,
    research,
    locations,
    providerScore,
    fields: { specialty: specialtyField, license: licenseField, organization: research?.organization ?? { value: null, confidence: 0, basis: "Not researched", sourceIds: [] } },
  };
}

export function specialtyFromParam(s: string | null): SpecialtyDef | null {
  return s ? resolveSpecialty(s) : null;
}

export function originFrom(p: URLSearchParams): { origin: Coords | null; radiusMi: number | null } {
  const lat = Number(p.get("lat")), lon = Number(p.get("lon")), r = Number(p.get("radius"));
  const ok = p.has("lat") && p.has("lon") && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return { origin: ok ? { lat, lon } : null, radiusMi: ok && r > 0 ? r : null };
}

