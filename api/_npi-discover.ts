// ── NPI demo — cheap public-web corroboration before paid AI research (TEMPORARY) ─
// registry candidate → ONE Brave web search → candidate URLs → FETCH ≤2 pages →
// deterministic checks on the fetched page text → a ReferralResearch that the
// EXISTING scorer (api/_npi-score.ts via buildView) turns into confidence.
//
// SEARCH DISCOVERS URLs. SEARCH RESULTS ARE NEVER EVIDENCE.
//   - WebSearchHit has no snippet/description field; Brave's are never read.
//   - The hit title is used only to decide which URLs to fetch.
//   - Only text on the fetched page can add a source, and only when the page
//     names the provider AND publishes a deterministic identifier from the NPI
//     record (NPI number, practice street address, phone or fax). A name match
//     alone justifies a fetch, never confidence.
//   - A search failure (no key, timeout, HTTP error) is reported as a failure,
//     never as "no evidence exists".
// No AI, no crawling, no persistence beyond a per-isolate cache.

import type { ContactNumber, DiscoveryLog, DiscoveryPage, EvidenceSource, PracticeLocation, ProviderDetail, ReferralResearch, SourceFamily, WebSearchHit } from "../src/npi/types";
import { formatPhone } from "./_npi-lib";
import type { SpecialtyDef } from "./_npi-geo";
import { AGGREGATOR, classifyFamily, digitsOnly, domainOf, htmlToText, isReferralPage, normUrl, npiLocations, numbersInText, pageSupportsReferralFax } from "./_npi-referral";
import { fieldConfidence, fieldFrom } from "./_npi-score";

// ── Search contract ──────────────────────────────────────────────────────────

export type { WebSearchHit };

export type SearchOutcome =
  | { status: "ok"; hits: WebSearchHit[] } // hits may be empty: a real zero-result search
  | { status: "not_configured" | "timeout" | "http_error" | "error"; error: string }; // NOT "no evidence"

export const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";
export const MAX_HITS = 8;
export const MAX_FETCH = 2;

// Only url + title leave this function. Brave's description / extra_snippets are dropped here.
export function parseBraveHits(data: unknown, limit = MAX_HITS): WebSearchHit[] {
  const results = (data as { web?: { results?: unknown[] } })?.web?.results;
  const out: WebSearchHit[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(results) ? results : []) {
    const url = (r as { url?: unknown }).url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
    const key = normUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = (r as { title?: unknown }).title;
    out.push(typeof title === "string" ? { url, title: title.replace(/<[^>]+>/g, "") } : { url });
    if (out.length >= limit) break;
  }
  return out;
}

export async function braveSearch(query: string, opts: { country?: string; limit?: number; fetcher?: typeof fetch } = {}): Promise<SearchOutcome> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return { status: "not_configured", error: "BRAVE_SEARCH_API_KEY is not set on this server" };
  const limit = Math.min(opts.limit ?? MAX_HITS, MAX_HITS);
  const qs = new URLSearchParams({ q: query, count: String(limit), result_filter: "web" });
  if (opts.country) qs.set("country", opts.country);
  const f = opts.fetcher ?? fetch;
  // BRAVE_SEARCH_URL: local test harness only (a stub returning Brave-shaped url+title hits).
  const endpoint = process.env.BRAVE_SEARCH_URL || BRAVE_URL;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await f(`${endpoint}?${qs}`, { headers: { Accept: "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": key }, signal: AbortSignal.timeout(8000) });
      // Brave's low tiers allow ~1 request/second: one polite retry on 429.
      if (res.status === 429 && attempt === 0) { await new Promise((r) => setTimeout(r, 1200)); continue; }
      if (!res.ok) return { status: "http_error", error: `Brave HTTP ${res.status}` };
      return { status: "ok", hits: parseBraveHits(await res.json(), limit) };
    } catch (err) {
      const name = (err as Error).name;
      return name === "TimeoutError" || name === "AbortError" ? { status: "timeout", error: "Brave search timed out" } : { status: "error", error: (err as Error).message.slice(0, 200) };
    }
  }
  return { status: "http_error", error: "Brave HTTP 429 (rate limited)" };
}

// ── Query + which hits to fetch ──────────────────────────────────────────────

// Specialty words to look for on a fetched page (and to put in the query).
const SPECIALTY_WORDS: Record<string, { query: string; page: RegExp }> = {
  ent: { query: "otolaryngology", page: /otolaryng|\bENT\b|ear,? nose,? (?:and|&) throat/i },
  "peds-ent": { query: "pediatric otolaryngology", page: /otolaryng|\bENT\b|ear,? nose,? (?:and|&) throat/i },
  otology: { query: "otology neurotology", page: /otolog|neurotolog|otolaryng/i },
  neurology: { query: "neurology", page: /neurolog/i },
  allergy: { query: "allergy immunology", page: /allerg|immunolog/i },
  audiology: { query: "audiology", page: /audiolog/i },
  "hearing-aid": { query: "hearing aid", page: /hearing (?:aid|instrument)/i },
  slp: { query: "speech language pathology", page: /speech/i },
};
const specialtyWords = (def: SpecialtyDef | null) => (def ? SPECIALTY_WORDS[def.key] ?? { query: def.label.toLowerCase(), page: new RegExp(def.label.split(/\W+/)[0], "i") } : null);

export interface Hints {
  orgs: string[]; // NPPES organizations registered at the provider's nearest address (from the nearby search)
}

// "<first last>" credential <organization> <city> <ST> <specialty>. Only the
// name is quoted: quoting every term makes Brave return nothing for most providers.
export function discoveryQuery(p: ProviderDetail, def: SpecialtyDef | null, hints: Hints, near: { city: string; state: string } | null): string {
  const name = p.enumerationType === "Organization" ? p.name : [p.firstName, p.lastName].filter(Boolean).join(" ");
  const org = hints.orgs[0] ? `"${hints.orgs[0]}"` : "";
  const loc = near ?? p.addresses.find((a) => a.purpose !== "Mailing") ?? null;
  return [`"${name}"`, p.credential?.split(",")[0] ?? "", org, loc?.city ?? "", loc?.state ?? "", specialtyWords(def)?.query ?? ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

// Significant tokens of an organization name ("MultiCare Health System" → multicare).
const ORG_STOP = new Set(["health", "medical", "center", "centre", "clinic", "clinics", "group", "system", "services", "associates", "hospital", "physicians", "the", "and", "inc", "llc", "pllc", "pc", "ps", "of", "care", "partners", "practice", "university"]);
function orgTokens(orgs: string[]): string[] {
  return [...new Set(orgs.flatMap((o) => o.toLowerCase().split(/[^a-z0-9]+/)).filter((t) => t.length >= 4 && !ORG_STOP.has(t)))];
}

// Deterministic first-party rule: the page's registrable domain label is a
// significant word of an NPPES organization registered at the provider's
// address (e.g. multicare.org for "MultiCare Health System"). Otherwise the
// page is "independent" (or aggregator/payer/… by the existing domain rules).
export function familyForPage(url: string, orgs: string[]): { family: SourceFamily; reason: string } {
  const domain = domainOf(url);
  const base = classifyFamily(url, domain, "independent");
  if (base.family !== "independent") return base;
  const labels = domain.toLowerCase().split(".").slice(0, -1).flatMap((l) => l.split("-"));
  const toks = orgTokens(orgs);
  const hit = labels.find((l) => l.length >= 4 && toks.some((t) => l === t || (t.length >= 5 && l.includes(t))));
  return hit
    ? { family: "first_party", reason: `Domain rule: “${hit}” matches the NPPES organization registered at this address (${orgs.join("; ")})` }
    : { family: "independent", reason: "Domain rule: not a known aggregator, payer, society or .gov, and not tied to an NPPES organization at this address" };
}

export interface RankedHit extends WebSearchHit { skip: string | null; priority: number }

// Which URLs are worth fetching. Uses URL/domain/title only — to choose, never as evidence.
export function rankHits(hits: WebSearchHit[], p: ProviderDetail, orgs: string[]): RankedHit[] {
  const last = (p.lastName ?? p.name.split(" ").pop() ?? "").toLowerCase();
  return hits.map((h) => {
    const domain = domainOf(h.url);
    let skip: string | null = null;
    if (!/^https:\/\//i.test(h.url)) skip = "not https";
    else if (/^\d+\.\d+\.\d+\.\d+$|^\[/.test(domain)) skip = "IP-address host";
    else if (AGGREGATOR.test(domain)) skip = "NPI mirror / aggregator directory — copies NPPES, not independent";
    else if (/\.(pdf|docx?|xlsx?)(\?|$)/i.test(h.url)) skip = "document, not an HTML page";
    else if (/(^|\.)(nppes\.cms\.hhs\.gov|npiregistry\.cms\.hhs\.gov)$/i.test(domain)) skip = "the NPI Registry itself — already the baseline";
    const fam = familyForPage(h.url, orgs).family;
    let priority = 0;
    if (fam === "first_party") priority += 4;
    if (fam === "payer" || fam === "professional" || fam === "state") priority += 1;
    if (last && `${h.title ?? ""} ${h.url}`.toLowerCase().includes(last)) priority += 2;
    if (/\/(providers?|doctors?|physicians?|find-a-(doctor|provider)|profiles?|staff|team|our-team|people|bio)\b/i.test(h.url)) priority += 1;
    return { ...h, skip, priority };
  });
}

// ── Page corroboration (the only place evidence is created) ──────────────────

export interface PageEvidence extends DiscoveryPage {
  // per NPI practice location (index into the non-mailing addresses)
  locations: { index: number; address: boolean; phone: string | null; fax: string | null; referralFax: boolean; extraFax: string | null }[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "Jane Doe", "Jane Q. Doe", "Jane Quinn Doe", "Doe, Jane". Last name alone never counts.
function nameRe(first: string, last: string): RegExp {
  const f = esc(first.split(/\s+/)[0]), l = esc(last.split(/\s+/).pop()!);
  return new RegExp(`\\b${f}\\b(?:\\s+[A-Za-z][A-Za-z'’-]*\\.?){0,2}\\s+${l}\\b|\\b${l},\\s*${f}\\b`, "gi");
}
export function nameOnPage(text: string, first: string | null, last: string | null): boolean {
  return Boolean(first && last) && nameRe(first!, last!).test(text);
}
// Specialty wording near the provider's name — a hospital page lists every specialty somewhere.
export function specialtyNearName(text: string, first: string | null, last: string | null, page: RegExp): boolean {
  if (!first || !last) return false;
  return [...text.matchAll(nameRe(first, last))].some((m) => page.test(text.slice(Math.max(0, m.index! - 300), m.index! + m[0].length + 300)));
}

const DIR = "(?:(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West)\\.?\\s+)?";
// "1560 N 115th St" on the page as "1560 North 115th Street" / "1560 N. 115th St".
export function addressOnPage(text: string, line1: string): boolean {
  const toks = line1.replace(/[.,#]/g, " ").split(/\s+/).filter(Boolean);
  const numIdx = toks.findIndex((t) => /^\d+[A-Za-z]?$/.test(t));
  if (numIdx < 0) return false;
  const rest = toks.slice(numIdx + 1).filter((t) => !/^(N|S|E|W|NE|NW|SE|SW|North|South|East|West)$/i.test(t));
  const word = rest[0];
  if (!word || word.length < 2) return false;
  return new RegExp(`\\b${esc(toks[numIdx])}\\s+${DIR}${esc(word)}\\b`, "i").test(text);
}

// Numbers labelled "fax" on the page (label within ~25 characters before the number).
export function faxNumbersOnPage(text: string): Set<string> {
  const out = new Set<string>();
  const t = text.replace(/\s+/g, " ");
  for (const m of t.matchAll(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g)) {
    const before = t.slice(Math.max(0, m.index! - 25), m.index!);
    if (/\bfax\b|\bf\s*[:.]/i.test(before)) out.add(digitsOnly(m[0]));
  }
  return out;
}

// Positions of a phone/fax or address occurrence, for "is this fax next to that address?"
function positions(text: string, re: RegExp): number[] {
  return [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))].map((m) => m.index!);
}
const digitsRe = (d: string) => new RegExp(`\\(?${d.slice(0, 3)}\\)?[\\s.\\-]?${d.slice(3, 6)}[\\s.\\-]?${d.slice(6)}`, "g");

export function corroboratePage(
  p: ProviderDetail,
  def: SpecialtyDef | null,
  orgs: string[],
  page: { url: string; finalUrl: string; html: string; title: string },
): PageEvidence {
  const text = htmlToText(page.html).replace(/\s+/g, " ");
  const domain = domainOf(page.finalUrl || page.url);
  const { family, reason: familyReason } = familyForPage(page.finalUrl || page.url, orgs);
  const numbers = numbersInText(text);
  const faxes = faxNumbersOnPage(text);
  const referralPage = isReferralPage(page.finalUrl || page.url, page.html);
  const isOrg = p.enumerationType === "Organization";
  const named = isOrg ? new RegExp(`\\b${esc(p.name)}\\b`, "i").test(text) : nameOnPage(text, p.firstName, p.lastName);
  const npiOn = new RegExp(`\\b${p.npi}\\b`).test(text);
  const words = specialtyWords(def);
  const specialtyOn = Boolean(words && (isOrg ? words.page.test(text) : specialtyNearName(text, p.firstName, p.lastName, words.page)));
  const orgOn = orgs.find((o) => new RegExp(`\\b${esc(o)}\\b`, "i").test(text)) ?? null;

  const npiLocs = p.addresses.filter((a) => a.purpose !== "Mailing");
  const locations = npiLocs.map((a, index) => {
    const address = addressOnPage(text, a.line1);
    const ph = digitsOnly(a.phone);
    const fx = digitsOnly(a.fax);
    const phone = ph.length === 10 && numbers.has(ph) ? ph : null;
    const fax = fx.length === 10 && faxes.has(fx) ? fx : null;
    const referralFax = Boolean(fax && (pageSupportsReferralFax(text, fax) || (referralPage && pageSupportsReferralFax(text, fax, true))));
    // A fax the NPI record doesn't have: only when it sits within ~400 characters
    // of THIS location's street address on the page, so it can't be borrowed from
    // another site listed on the same page.
    let extraFax: string | null = null;
    if (address && !fax) {
      const at = positions(text, new RegExp(`\\b${esc(a.line1.replace(/[.,#]/g, " ").split(/\s+/).find((t) => /^\d+[A-Za-z]?$/.test(t)) ?? "~")}\\s`, "i"));
      for (const d of faxes) {
        if (d === ph) continue;
        if (positions(text, digitsRe(d)).some((i) => at.some((j) => Math.abs(i - j) <= 400))) { extraFax = d; break; }
      }
    }
    return { index, address, phone, fax, referralFax, extraFax };
  });

  const identifiers = [npiOn && "NPI number", locations.some((l) => l.address) && "practice street address", locations.some((l) => l.phone) && "practice phone", locations.some((l) => l.fax) && "practice fax"].filter(Boolean) as string[];
  let accepted = false;
  let reason: string;
  if (family === "aggregator") reason = "Rejected: aggregator / NPI-mirror domain";
  // A non-official directory that prints the NPI number is almost always a copy of
  // NPPES, so matching it corroborates nothing (same as the existing aggregator rule).
  else if (npiOn && family === "independent") reason = "Rejected: republishes the NPI number and is not an official, payer, society or government site — treated as an NPI-registry copy";
  else if (!named) reason = isOrg ? "Rejected: organization name not found on the page" : "Rejected: provider's first + last name not found on the page";
  else if (!identifiers.length) reason = "Rejected: name found, but no NPI-record identifier (NPI, street address, phone or fax) on the page — a name match alone is not identity";
  else { accepted = true; reason = `Accepted: name + ${identifiers.join(", ")} found on the fetched page`; }

  return { url: page.url, finalUrl: page.finalUrl, domain, fetched: "ok", httpStatus: 200, nameOnPage: named, npiOnPage: npiOn, specialtyOnPage: specialtyOn, orgOnPage: orgOn, referralPage, locations, accepted, reason, family, familyReason, title: page.title };
}

// ── Accepted pages → ReferralResearch (scored later by the existing model) ───

export function researchFromPages(p: ProviderDetail, def: SpecialtyDef | null, pages: PageEvidence[], queries: string[], startedAt: number): ReferralResearch | null {
  const good = pages.filter((x) => x.accepted);
  if (!good.length) return null;
  const now = new Date().toISOString();
  const sources: EvidenceSource[] = good.map((g, i) => ({
    id: `W${i + 1}`, url: g.finalUrl || g.url, title: g.title, domain: g.domain, name: g.title || g.domain,
    family: g.family, familyReason: g.familyReason,
    summary: pageSummary(p, g), currentness: "unknown", researchedAt: now,
  }));
  const idOf = (g: PageEvidence) => sources[good.indexOf(g)].id;
  const famOf = (g: PageEvidence) => sources[good.indexOf(g)].family;

  const locations: PracticeLocation[] = npiLocations(p);
  locations.forEach((loc, index) => {
    for (const g of good) {
      const e = g.locations.find((x) => x.index === index);
      if (!e) continue;
      const add = (n: ContactNumber) => {
        n.sourceIds = [...new Set([...n.sourceIds, idOf(g)])];
        n.families = [...new Set([...n.families, famOf(g)])];
        n.confidence = fieldConfidence(n.families, { npiAgrees: true }).confidence;
      };
      if (e.address) {
        loc.sourceIds = [...new Set([...loc.sourceIds, idOf(g)])];
        loc.families = [...new Set([...loc.families, famOf(g)])];
        loc.origin = "both";
        loc.status = "current";
        loc.statusNote = null;
      }
      if (e.phone) { const n = loc.phones.find((x) => x.digits === e.phone); if (n) add(n); }
      if (e.fax) {
        const n = loc.faxes.find((x) => x.digits === e.fax);
        if (n) {
          add(n);
          n.faxKind = e.referralFax ? "referral" : "general";
          n.label = e.referralFax ? (g.referralPage ? "Fax listed on the source's referrals page" : "Referral fax (wording checked on the page)") : "Fax";
          if (e.referralFax) n.labelCheck = "page";
        }
      }
      if (e.extraFax && !loc.faxes.some((x) => x.digits === e.extraFax)) {
        loc.faxes.push({ number: formatPhone(e.extraFax)!, digits: e.extraFax, label: "Fax (next to this address on the page)", faxKind: "general", sourceIds: [idOf(g)], families: [famOf(g)], inNpi: false, confidence: fieldConfidence([famOf(g)]).confidence });
      }
    }
  });

  const idIds = good.map(idOf);
  const spIds = good.filter((g) => g.specialtyOnPage).map(idOf);
  const fpOrg = good.find((g) => g.family === "first_party" && g.orgOnPage);
  const corroboratedLoc = locations.some((l) => l.origin === "both");
  const confirmedLabel = p.enumerationType === "Organization" ? p.name : [p.firstName, p.lastName].filter(Boolean).join(" ");
  return {
    npi: p.npi,
    researchedAt: now,
    method: "public_web",
    summary: `Public-web check (no AI): ${good.length} fetched page${good.length > 1 ? "s" : ""} name this provider alongside NPI-record identifiers. ${corroboratedLoc ? "At least one registry practice address is published on the page." : "No registry practice address was found on the page."}`,
    relationship: corroboratedLoc
      ? { kind: "npi_current", explanation: "A fetched public page lists this provider at an address from the NPI record.", sourceIds: idIds }
      : { kind: "no_evidence", explanation: "Fetched pages confirm the provider's identity but not a registry practice address.", sourceIds: [] },
    identity: { ...fieldFrom(confirmedLabel, idIds, sources), confirmed: true, conflict: false },
    specialty: spIds.length && def ? { ...fieldFrom(def.label, spIds, sources), status: "same" } : { ...fieldFrom(null, [], sources), status: "unknown" },
    affiliations: fpOrg ? [{ value: fpOrg.orgOnPage!, sourceIds: [idOf(fpOrg)], current: "unknown", families: ["first_party"] }] : [],
    organization: fpOrg ? fieldFrom(fpOrg.orgOnPage, [idOf(fpOrg)], sources) : fieldFrom(null, [], sources),
    locations,
    conflicts: [],
    webLicense: [],
    sources,
    dropped: pages.filter((x) => !x.accepted).map((x) => ({ reason: x.reason, detail: x.domain })),
    searchQueries: queries,
    usage: { researchModel: "none (Brave search + page fetch)", extractModel: "none (deterministic)", searchCalls: queries.length, inputTokens: 0, outputTokens: 0, durationMs: Date.now() - startedAt },
  };
}

function pageSummary(p: ProviderDetail, g: PageEvidence): string {
  const npiLocs = p.addresses.filter((a) => a.purpose !== "Mailing");
  const parts = ["provider name"];
  if (g.npiOnPage) parts.push(`NPI ${p.npi}`);
  for (const l of g.locations) {
    const a = npiLocs[l.index];
    if (l.address) parts.push(`address ${a.line1}`);
    if (l.phone) parts.push(`phone ${formatPhone(l.phone)}`);
    if (l.fax) parts.push(`fax ${formatPhone(l.fax)}${l.referralFax ? " (referral wording next to it)" : ""}`);
    if (l.extraFax) parts.push(`fax ${formatPhone(l.extraFax)} next to ${a.line1}`);
  }
  if (g.specialtyOnPage) parts.push("specialty wording");
  if (g.orgOnPage) parts.push(`organization “${g.orgOnPage}”`);
  return `Found on the fetched page: ${parts.join(", ")}.`;
}

// ── One provider, end to end ─────────────────────────────────────────────────

async function fetchPage(url: string, fetcher: typeof fetch): Promise<{ ok: true; html: string; finalUrl: string; title: string } | { ok: false; status: number | null; reason: "failed" | "not_html" }> {
  try {
    const res = await fetcher(url, { headers: { "User-Agent": "Mozilla/5.0 (referral-demo public-web check)", Accept: "text/html" }, signal: AbortSignal.timeout(7000), redirect: "follow" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) return { ok: false, status: res.status, reason: "failed" };
    if (!type.includes("html")) return { ok: false, status: res.status, reason: "not_html" };
    const html = (await res.text()).slice(0, 1_500_000);
    return { ok: true, html, finalUrl: res.url || url, title: (html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 140) };
  } catch {
    return { ok: false, status: null, reason: "failed" };
  }
}

const cache = new Map<string, { at: number; log: DiscoveryLog; research: ReferralResearch | null }>();

export async function discoverProvider(
  p: ProviderDetail,
  def: SpecialtyDef | null,
  hints: Hints,
  near: { city: string; state: string } | null,
  opts: { fetcher?: typeof fetch; search?: typeof braveSearch } = {},
): Promise<{ log: DiscoveryLog; research: ReferralResearch | null }> {
  const cacheKey = `${p.npi}|${def?.key ?? "-"}|${hints.orgs.join(";")}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < 6 * 3600_000 && !opts.fetcher) return hit;

  const started = Date.now();
  const fetcher = opts.fetcher ?? fetch;
  const query = discoveryQuery(p, def, hints, near);
  const s = await (opts.search ?? braveSearch)(query, { country: "US", limit: MAX_HITS, fetcher });
  const log: DiscoveryLog = { npi: p.npi, query, search: { status: s.status, error: s.status === "ok" ? null : s.error, hits: s.status === "ok" ? s.hits : [] }, candidates: [], pages: [], outcome: "not_corroborated", durationMs: 0 };
  if (s.status !== "ok") {
    log.outcome = "search_failed";
    log.durationMs = Date.now() - started;
    return { log, research: null }; // never cached: a failure is not a finding
  }
  if (!s.hits.length) log.outcome = "no_results";

  const ranked = rankHits(s.hits, p, hints.orgs);
  const toFetch = ranked.filter((h) => !h.skip).sort((a, b) => b.priority - a.priority).slice(0, MAX_FETCH);
  log.candidates = ranked.map((h) => ({ url: h.url, title: h.title, skip: h.skip, priority: h.priority, fetched: toFetch.includes(h) }));

  const pages: PageEvidence[] = await Promise.all(toFetch.map(async (h) => {
    const r = await fetchPage(h.url, fetcher);
    if (!r.ok) {
      return { url: h.url, finalUrl: h.url, domain: domainOf(h.url), fetched: r.reason, httpStatus: r.status, nameOnPage: false, npiOnPage: false, specialtyOnPage: false, orgOnPage: null, referralPage: false, locations: [], accepted: false, reason: r.reason === "not_html" ? "Rejected: not an HTML page" : `Rejected: page could not be fetched${r.status ? ` (HTTP ${r.status})` : ""}`, family: "independent", familyReason: "", title: "" } satisfies PageEvidence;
    }
    return corroboratePage(p, def, hints.orgs, { url: h.url, finalUrl: r.finalUrl, html: r.html, title: r.title });
  }));

  const research = researchFromPages(p, def, pages, [query], started);
  log.pages = pages.map(({ locations: _l, ...rest }) => ({ ...rest, evidence: rest.accepted ? pageSummary(p, pages.find((x) => x.url === rest.url)!) : undefined }));
  if (research) log.outcome = "corroborated";
  log.durationMs = Date.now() - started;
  const out = { log, research };
  if (!opts.fetcher) cache.set(cacheKey, { at: Date.now(), ...out });
  return out;
}
