// ── Provider Intelligence experiment — baselines, grading, metrics ───────────
// Pure functions over a recorded ExperimentRun + ground-truth cases. No network.
// Tested in tests/npi-experiment.test.ts; used by the page and the node script.
//
// Grading is deliberately asymmetric and conservative:
//   - UNRESOLVED is never counted as PASS. A provider the pipeline never looked
//     at is not a "correct rejection".
//   - A case with no established ground truth is UNRESOLVED, whatever the output.
//   - A Recommended result is "correct" only if outcome, fax AND location all PASS
//     against the expected facts; any FAIL makes it an incorrect recommendation;
//     anything unverifiable is reported as such, and bounds the false-rec rate.
import type { ContactNumber, PracticeLocation, ReferralView, ScoreItem } from "../types";
import { pickDestination } from "../demo/routing";
import { pediatricMismatch } from "../demo/model";
import { faxSemantics, specialtyConflict } from "../semantics";
import type { ExperimentRun, GroundTruthCase, RunCandidate, StageKind } from "./types";

// ── Baselines ────────────────────────────────────────────────────────────────

export type BaselineId = "A" | "B" | "C" | "D" | "S";

export const BASELINES: { id: BaselineId; label: string; rule: string; ai: boolean }[] = [
  { id: "A", label: "NPPES only", ai: false, rule: "Nearest in-radius NPPES practice location. Recommended if it has an NPPES fax and no pediatric wording (taxonomy / organization / site name) for an adult patient; pediatric → Needs review; no NPPES fax → Unresolved." },
  { id: "B", label: "NPPES + WA licence", ai: false, rule: "A, plus: WA DOH licence matched (by number or name) but not active → Needs review; licence for a different profession than the NPI taxonomy → Needs review." },
  { id: "C", label: "B + deterministic web corroboration", ai: false, rule: "One Brave search + ≤2 fetched pages per provider (api/_npi-discover.ts), then the product's scorer and routing (pickDestination / assessDestination). Not corroborated → Unresolved." },
  { id: "D", label: "C + AI research", ai: true, rule: "Where AI research exists (saved Sep-28 snapshot, or live operator research in this run), use it instead of C; otherwise C. Same scorer and routing." },
  { id: "S", label: "As shipped (what a viewer sees)", ai: true, rule: "Saved AI research where it exists; the Brave pass only for the 8 nearest un-researched providers; everyone else Unresolved. This is the product's current behaviour." },
];

export type Group = "recommended" | "review" | "unresolved";
export type FaxClass = "referral-verified" | "referral-unchecked" | "office" | "npi-only";

export interface Decision {
  baseline: BaselineId;
  group: Group;
  evidence: "nppes" | "nppes+licence" | "brave" | "ai-saved" | "ai-live" | "none";
  location: { name: string; line1: string; city: string; distanceMi: number | null } | null;
  fax: { digits: string; number: string; cls: FaxClass; label: string | null } | null;
  reasons: string[];
  verification: number | null;
  destination: number | null;
  scoreItems: { verification: ScoreItem[]; destination: ScoreItem[] } | null;
  evidenceUrls: string[];
}

const REQUESTED = "ENT";

function registryDecision(c: RunCandidate, age: number, baseline: "A" | "B"): Decision {
  const reasons: string[] = [];
  const fitText = [c.specialty, c.nearest.organization, c.nearest.name].filter(Boolean).join(" ");
  if (pediatricMismatch(fitText, age)) reasons.push(`Pediatric wording in NPPES (${fitText.match(/pediatric|paediatric|children['’]?s|childrens|kids/i)?.[0]}) — patient is ${age}`);
  if (baseline === "B" && c.license) {
    const lic = c.license.records.find((r) => /^active/i.test(r.status)) ?? c.license.records[0];
    if (lic && (c.license.match === "exact" || c.license.match === "name") && !/^active/i.test(lic.status)) reasons.push(`WA licence is ${lic.status.toLowerCase()}`);
    const conflict = specialtyConflict({ npiSpecialty: c.specialty, taxonomyCode: c.specialtyCode, licence: c.license, researchDifferent: false, researchSpecialty: null });
    if (conflict) reasons.push(`Licence is for a different profession (${conflict.rows.find((r) => r.kind === "state")?.value})`);
  }
  const fax = c.nearest.faxDigits ? { digits: c.nearest.faxDigits, number: c.nearest.fax!, cls: "npi-only" as const, label: null } : null;
  const location = { name: c.nearest.name, line1: c.nearest.line1, city: c.nearest.city, distanceMi: c.nearest.distanceMi };
  const group: Group = !fax ? "unresolved" : reasons.length ? "review" : "recommended";
  if (!fax) reasons.push("No NPPES fax at the nearest in-radius location");
  return { baseline, group, evidence: baseline === "A" ? "nppes" : "nppes+licence", location, fax, reasons, verification: null, destination: null, scoreItems: null, evidenceUrls: [] };
}

export const decideA = (c: RunCandidate, age: number) => registryDecision(c, age, "A");
export const decideB = (c: RunCandidate, age: number) => registryDecision(c, age, "B");

function faxClass(f: ContactNumber): FaxClass {
  if (!f.families.some((x) => x !== "federal")) return "npi-only";
  const k = faxSemantics(f).kind;
  return k === "referral" ? "referral-verified" : k === "referral_unchecked" ? "referral-unchecked" : "office";
}

// C / D / S: the product's own routing over a research-scored view.
export function decideFromView(c: RunCandidate, view: ReferralView | null, age: number, baseline: BaselineId, evidence: Decision["evidence"], why: string): Decision {
  const empty: Decision = { baseline, group: "unresolved", evidence: "none", location: null, fax: null, reasons: [why], verification: null, destination: null, scoreItems: null, evidenceUrls: [] };
  const r = view?.research;
  if (!view || !r) return empty;
  const pick = pickDestination({
    requested: REQUESTED, npiSpecialty: c.specialty, taxonomyCode: c.specialtyCode, npiActive: c.status === "Active", licence: view.license,
    researchSpecialty: { status: r.specialty.status, value: r.specialty.value }, identityConflict: r.identity.conflict,
    locations: view.locations, providerScore: view.providerScore.score, patientAge: age,
  });
  const urls = r.sources.filter((s) => s.family !== "aggregator").map((s) => s.url);
  if (!pick) return { ...empty, evidence, reasons: ["Researched — no usable (non-former) location"], evidenceUrls: urls };
  const loc: PracticeLocation = pick.best;
  const f = loc.bestFax;
  return {
    baseline, group: pick.assessment.group, evidence,
    location: { name: loc.name, line1: loc.line1, city: loc.city, distanceMi: loc.distanceMi },
    fax: f ? { digits: f.digits, number: f.number, cls: faxClass(f), label: f.label } : null,
    reasons: pick.assessment.reviewReasons,
    verification: view.providerScore.score, destination: loc.referral.score,
    scoreItems: { verification: view.providerScore.items, destination: loc.referral.items },
    evidenceUrls: urls,
  };
}

export type Decisions = Record<string, Record<BaselineId, Decision>>;

export function decideAll(run: ExperimentRun): Decisions {
  const age = run.meta.input.patientAge;
  const out: Decisions = {};
  for (const c of run.nearby.data?.results ?? []) {
    const disc = run.discovery[c.npi];
    const live = run.liveAi[c.npi]?.data?.view ?? null;
    const saved = run.savedAi[c.npi]?.data ?? null;
    const cView = disc?.data?.view ?? null;
    const cWhy = !disc ? "Web check not run for this provider" : !disc.ok ? `Web check failed (${disc.error}) — not evidence of absence` : disc.data?.log.outcome === "search_failed" ? `Brave search failed (${disc.data.log.search.error}) — not evidence of absence` : "Fetched pages did not corroborate this provider";
    const C = decideFromView(c, cView, age, "C", "brave", cWhy);
    const D = live ? decideFromView(c, live, age, "D", "ai-live", "")
      : saved ? decideFromView(c, saved, age, "D", "ai-saved", "")
      : { ...C, baseline: "D" as const };
    const S = saved ? decideFromView(c, saved, age, "S", "ai-saved", "")
      : disc?.role === "production" ? { ...C, baseline: "S" as const }
      : { ...decideFromView(c, null, age, "S", "none", "Not researched and not among the 8 nearest the product auto-checks"), baseline: "S" as const };
    out[c.npi] = { A: decideA(c, age), B: decideB(c, age), C, D, S };
  }
  return out;
}

// ── Grading against ground truth ─────────────────────────────────────────────

export type Verdict = "PASS" | "FAIL" | "UNRESOLVED" | "N/A";
export interface Check { v: Verdict; why: string }
export interface CaseGrade {
  npi: string;
  baseline: BaselineId;
  decision: Decision | null;
  outcome: Check;
  fax: Check;
  location: Check;
  identity: Check;
  overall: Verdict;
  rec: "correct" | "incorrect" | "unverifiable" | null; // only for Recommended
}

// "4800 Sand Point Way NE" → "4800 sand"; "West Clinic, 325 9th Ave., Fl 4" → "325 9th".
export function streetKey(line1: string): string {
  const toks = line1.toLowerCase().replace(/[.,#]/g, " ").split(/\s+/).filter(Boolean);
  const i = toks.findIndex((t) => /^\d+[a-z]?$/.test(t));
  if (i < 0) return toks.slice(0, 2).join(" ");
  const rest = toks.slice(i + 1).filter((t) => !/^(n|s|e|w|ne|nw|se|sw|north|south|east|west)$/.test(t));
  return `${toks[i]} ${rest[0] ?? ""}`.trim();
}

const PROFILE_PATH = /\/(pub|cv|directory|providers?|doctors?|physicians?|people|person|bio|bios)\/([^/?#]+)\/?(?:[?#]|$)/i;
// A person slug: 2–4 name tokens, optionally a credential ("henry-ou-md", "jason-park-lockrow").
const PERSON_SLUG = /^[a-z]+(?:-[a-z]+){1,3}(?:-(?:md|do|phd|aud|mbbs|facs|ms))*(?:-\d+)?$/;

// Deterministic heuristic: a person-profile URL whose slug doesn't contain this
// provider's last name is someone else's profile (e.g. a Doximity sidebar hit).
// Heuristic only — it can miss (non-slug URLs) and, rarely, misfire (name changes).
export function foreignProfile(url: string, lastName: string): string | null {
  const m = url.match(PROFILE_PATH);
  if (!m || !lastName) return null;
  const slug = decodeURIComponent(m[2]).toLowerCase();
  if (!PERSON_SLUG.test(slug)) return null;
  const last = lastName.toLowerCase().split(/[\s-]+/).filter((t) => t.length > 1);
  return last.some((t) => slug.includes(t)) ? null : slug;
}

const lastNameOf = (c: RunCandidate) => (c.enumerationType === "Organization" ? "" : c.name.replace(/,.*$/, "").split(/\s+/).filter((t) => !/^(MD|DO|PHD|AUD|MS)$/i.test(t)).pop() ?? "");

export function gradeDecision(c: RunCandidate | null, d: Decision | null, gt: GroundTruthCase, baseline: BaselineId): CaseGrade {
  const e = gt.expected;
  const na: Check = { v: "N/A", why: "Not recommended — no fax/location asserted" };
  if (!c || !d) {
    const why = "Provider not in this run's in-radius candidates";
    return { npi: gt.npi, baseline, decision: d, outcome: { v: "UNRESOLVED", why }, fax: na, location: na, identity: { v: "N/A", why }, overall: "UNRESOLVED", rec: null };
  }

  let outcome: Check;
  if (e.outcome === "unknown") outcome = { v: "UNRESOLVED", why: "No ground truth for the expected outcome" };
  else if (e.outcome === "recommend") outcome = d.group === "recommended" ? { v: "PASS", why: "Expected a usable destination; recommended" } : { v: "UNRESOLVED", why: d.group === "review" ? "Expected usable; sent to human review (not a decision)" : "Expected usable; pipeline did not resolve it" };
  else outcome = d.group === "recommended" ? { v: "FAIL", why: `FALSE RECOMMENDATION — expected not to recommend: ${e.outcomeBasis}` } : d.group === "review" ? { v: "PASS", why: "Correctly withheld (Needs review)" } : { v: "UNRESOLVED", why: "Never resolved — not counted as a correct rejection" };

  let fax: Check = na, location: Check = na;
  if (d.group === "recommended") {
    if (!d.fax) fax = { v: "FAIL", why: "Recommended with no fax" };
    else if (!e.faxes || !e.faxes.length) fax = { v: "UNRESOLVED", why: "No expected fax established — cannot verify" };
    else {
      const hit = e.faxes.find((f) => f.digits === d.fax!.digits);
      const refs = e.faxes.filter((f) => f.referral);
      if (!hit) fax = { v: "FAIL", why: `Fax ${d.fax.number} is not among the expected faxes (${e.faxes.map((f) => `${f.digits}${f.referral ? " referral" : ""}`).join(", ")})` };
      else if (d.fax.cls === "referral-verified" && !hit.referral && refs.length) fax = { v: "FAIL", why: `Claimed as a verified referral fax, but the official referral fax is ${refs.map((f) => f.digits).join(", ")}` };
      else if (d.fax.cls === "referral-verified" && !hit.referral) fax = { v: "UNRESOLVED", why: `Number matches an official office fax (“${hit.label}”), but ground truth could not confirm the pipeline's claim that it is a referral fax` };
      else fax = { v: "PASS", why: `Matches expected ${hit.referral ? "referral" : "office"} fax (“${hit.label}”)${!hit.referral && refs.length ? ` — note: official referral fax is ${refs.map((f) => f.digits).join(", ")}` : ""}` };
    }
    if (!d.location) location = { v: "FAIL", why: "Recommended with no location" };
    else if (!e.practices || !e.practices.length) location = { v: "UNRESOLVED", why: "No current practice established — cannot verify" };
    else {
      const k = streetKey(d.location.line1);
      location = e.practices.some((p) => streetKey(p.line1) === k) ? { v: "PASS", why: `${d.location.line1} is an established current practice` } : { v: "FAIL", why: `${d.location.line1} is not among the established practices (${e.practices.map((p) => p.line1).join("; ")})` };
    }
  }

  let identity: Check = { v: "N/A", why: "No web evidence used" };
  if (d.evidenceUrls.length) {
    const wrong = d.evidenceUrls.filter((u) => e.wrongEvidence.includes(u));
    const foreign = d.evidenceUrls.map((u) => [u, foreignProfile(u, lastNameOf(c))] as const).filter(([, s]) => s);
    identity = wrong.length ? { v: "FAIL", why: `Evidence known to be about someone else: ${wrong.join(", ")}` }
      : foreign.length ? { v: "FAIL", why: `Evidence is another person's profile page (slug “${foreign[0][1]}”): ${foreign[0][0]}` }
      : { v: "PASS", why: `${d.evidenceUrls.length} evidence URL(s); none known or detected to be about someone else` };
  }

  const checks = [outcome, fax, location, identity];
  const overall: Verdict = checks.some((x) => x.v === "FAIL") ? "FAIL" : checks.some((x) => x.v === "UNRESOLVED") ? "UNRESOLVED" : "PASS";
  const rec = d.group !== "recommended" ? null : overall === "FAIL" ? "incorrect" : overall === "PASS" ? "correct" : "unverifiable";
  return { npi: gt.npi, baseline, decision: d, outcome, fax, location, identity, overall, rec };
}

export function gradeAll(run: ExperimentRun, cases: GroundTruthCase[], decisions = decideAll(run)): Record<BaselineId, CaseGrade[]> {
  const byNpi = new Map((run.nearby.data?.results ?? []).map((c) => [c.npi, c]));
  const out = {} as Record<BaselineId, CaseGrade[]>;
  for (const b of BASELINES) out[b.id] = cases.map((gt) => gradeDecision(byNpi.get(gt.npi) ?? null, decisions[gt.npi]?.[b.id] ?? null, gt, b.id));
  return out;
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export interface Metrics {
  baseline: BaselineId;
  cases: number;
  recommended: number;
  correct: number;
  incorrect: number;
  unverifiable: number;
  review: number;
  unresolved: number;
  pass: number;
  fail: number;
  unresolvedVerdicts: number;
  falseRecRate: { lower: number | null; upper: number | null }; // incorrect / rec … (incorrect+unverifiable) / rec
  verifiedReferralFax: number; // recommended with a page-checked referral fax that matches ground truth
  missed: number; // expected recommend, not recommended
  aiCalls: number; // model calls behind this baseline's evidence (2 per AI-researched provider)
  aiTokens: { input: number; output: number };
  aiGenerationMs: number; // wall time when the AI evidence was generated
  aiLiveCalls: number; // made during THIS run
  braveQueries: number;
  pagesFetched: number;
  latencyMs: { search: number; perProviderMedian: number | null };
}

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function metrics(run: ExperimentRun, grades: Record<BaselineId, CaseGrade[]>): Metrics[] {
  const searchMs = run.nearby.ms;
  return BASELINES.map(({ id }) => {
    const g = grades[id];
    const rec = g.filter((x) => x.decision?.group === "recommended");
    const incorrect = rec.filter((x) => x.rec === "incorrect").length;
    const unverifiable = rec.filter((x) => x.rec === "unverifiable").length;
    const npis = g.map((x) => x.npi);
    const usesBrave = id === "C" || id === "D" || id === "S";
    const aiNpis = id === "D" || id === "S" ? npis.filter((n) => g.find((x) => x.npi === n)?.decision?.evidence.startsWith("ai")) : [];
    const aiView = (n: string) => run.liveAi[n]?.data?.view ?? run.savedAi[n]?.data ?? null;
    const usage = aiNpis.map((n) => aiView(n)?.research?.usage).filter(Boolean) as NonNullable<ReferralView["research"]>["usage"][];
    const braveNpis = usesBrave ? npis.filter((n) => run.discovery[n] && (id !== "S" || run.discovery[n].role === "production") && !(id === "D" && aiNpis.includes(n))) : [];
    const perProvider = npis.map((n) => {
      let ms = 0;
      if (braveNpis.includes(n)) ms += run.discovery[n].ms;
      if (aiNpis.includes(n)) ms += run.liveAi[n]?.ms ?? run.savedAi[n]?.ms ?? 0;
      return ms;
    }).filter((ms) => ms > 0);
    return {
      baseline: id, cases: g.length, recommended: rec.length,
      correct: rec.filter((x) => x.rec === "correct").length, incorrect, unverifiable,
      review: g.filter((x) => x.decision?.group === "review").length,
      unresolved: g.filter((x) => !x.decision || x.decision.group === "unresolved").length,
      pass: g.filter((x) => x.overall === "PASS").length, fail: g.filter((x) => x.overall === "FAIL").length, unresolvedVerdicts: g.filter((x) => x.overall === "UNRESOLVED").length,
      falseRecRate: rec.length ? { lower: incorrect / rec.length, upper: (incorrect + unverifiable) / rec.length } : { lower: null, upper: null },
      verifiedReferralFax: rec.filter((x) => x.decision?.fax?.cls === "referral-verified" && x.fax.v === "PASS").length,
      missed: g.filter((x) => x.outcome.v === "UNRESOLVED" && x.decision && x.decision.group !== "recommended" && /Expected usable/.test(x.outcome.why)).length,
      aiCalls: usage.length * 2,
      aiTokens: { input: usage.reduce((s, u) => s + u.inputTokens, 0), output: usage.reduce((s, u) => s + u.outputTokens, 0) },
      aiGenerationMs: usage.reduce((s, u) => s + u.durationMs, 0),
      aiLiveCalls: aiNpis.filter((n) => run.liveAi[n]?.data?.view).length * 2,
      braveQueries: braveNpis.length,
      pagesFetched: braveNpis.reduce((s, n) => s + (run.discovery[n].data?.log.pages.filter((p) => p.fetched === "ok").length ?? 0), 0),
      latencyMs: { search: searchMs, perProviderMedian: median(perProvider) },
    };
  });
}

// Whole-cohort counts (no ground truth) — the denominator.
export function cohortCounts(run: ExperimentRun, decisions = decideAll(run)): Record<BaselineId, Record<Group, number>> {
  const out = {} as Record<BaselineId, Record<Group, number>>;
  for (const b of BASELINES) {
    out[b.id] = { recommended: 0, review: 0, unresolved: 0 };
    for (const d of Object.values(decisions)) out[b.id][d[b.id].group]++;
  }
  return out;
}

// ── The pipeline run, stage by stage ─────────────────────────────────────────

export interface StageRow {
  n: number;
  stage: string;
  kind: StageKind | "DET over cached AI";
  source: string;
  input: string;
  output: string;
  in: number | null;
  out: number | null;
  ms: number | null;
  cost: string;
  failures: string[];
}

export function pipelineStages(run: ExperimentRun, decisions = decideAll(run)): StageRow[] {
  const nb = run.nearby.data;
  const rows: StageRow[] = [];
  const add = (r: Omit<StageRow, "n">) => rows.push({ n: rows.length, ...r });
  const i = run.meta.input;
  add({ stage: "Referral input", kind: "HUMAN", source: "audiologist (synthetic scenario A)", input: "—", output: `${i.specialty} · ${i.location} · ${i.radius} mi · patient age ${i.patientAge}`, in: null, out: 1, ms: null, cost: "$0", failures: [] });
  if (!nb) {
    add({ stage: "Registry search", kind: "EXTERNAL", source: "/api/npi-nearby", input: "—", output: "FAILED", in: null, out: null, ms: run.nearby.ms, cost: "$0", failures: [run.nearby.error ?? "unknown"] });
    return rows;
  }
  const names: Record<string, string> = { specialty: "Referral type → taxonomy codes", origin: "Location → coordinates", nppes: "NPPES query", taxonomy: "Active + taxonomy filter", geocode: "Geocode practice addresses", prefilter: "Geographic pre-filter", licence: "Licence validation (WA only)", radius: "Radius filter + baseline rule points" };
  if (nb.trace) for (const t of nb.trace) add({ stage: names[t.id] ?? t.id, kind: t.kind, source: t.source, input: t.id === "nppes" ? "1 query" : `${t.in}`, output: t.detail, in: t.in, out: t.out, ms: t.ms, cost: "$0 (free public API)", failures: t.id === "geocode" && t.in !== t.out ? [`${t.in - t.out} addresses could not be mapped — those locations are dropped`] : [] });
  else add({ stage: "Registry search (server stages not traced by this deployment)", kind: "EXTERNAL", source: "CMS NPPES + Census + WA DOH", input: "1 query", output: `${nb.scanned.records} records → ${nb.results.length} in radius`, in: nb.scanned.records, out: nb.results.length, ms: run.nearby.ms, cost: "$0", failures: [] });
  add({ stage: "Whole registry search (client wall time)", kind: "EXTERNAL", source: "GET /api/npi-nearby", input: "specialty, location, radius", output: `${nb.results.length} candidates; notes: ${nb.notes.join(" ")}`, in: null, out: nb.results.length, ms: run.nearby.ms, cost: "$0", failures: nb.scanned.truncated ? ["NPPES result TRUNCATED at 1,200 records"] : [] });

  const saved = Object.entries(run.savedAi);
  const savedFail = saved.filter(([, t]) => !t.ok);
  const ages = run.meta.snapshotResearchedAt.map((s) => s.slice(0, 10));
  add({ stage: "Load saved AI research + re-score", kind: "DET over cached AI", source: `bundled snapshot (researched ${[...new Set(ages)].join(", ") || "—"}) → POST /api/npi-provider`, input: `${saved.length} providers with saved research`, output: `${saved.length - savedFail.length} views re-scored for this search; 0 live AI calls`, in: saved.length, out: saved.length - savedFail.length, ms: saved.reduce((s, [, t]) => s + t.ms, 0), cost: "$0 now (AI cost was paid when the snapshot was generated)", failures: savedFail.map(([n, t]) => `${n}: ${t.error}`) });

  const disc = Object.entries(run.discovery);
  const prod = disc.filter(([, d]) => d.role === "production");
  const logs = disc.map(([npi, d]) => ({ npi, role: d.role, log: d.data?.log ?? null, err: d.error }));
  const searchFail = logs.filter((l) => !l.log || l.log.outcome === "search_failed");
  const hits = logs.reduce((s, l) => s + (l.log?.search.hits.length ?? 0), 0);
  add({ stage: "Brave searches", kind: "EXTERNAL", source: "Brave Search API (paid per query; plan price not recorded)", input: `${disc.length} providers (${prod.length} product picks + ${disc.length - prod.length} baseline-only)`, output: `${hits} candidate URLs (URL + title only; snippets discarded)`, in: disc.length, out: hits, ms: logs.reduce((s, l) => s + (l.log?.timings?.searchMs ?? 0), 0) || null, cost: `${disc.length} Brave queries · $ unknown`, failures: searchFail.map((l) => `${l.npi}: ${l.err ?? l.log?.search.error}`) });
  const cands = logs.reduce((s, l) => s + (l.log?.candidates.filter((c) => c.fetched).length ?? 0), 0);
  const skipped = logs.flatMap((l) => l.log?.candidates.filter((c) => c.skip).map((c) => c.skip!) ?? []);
  const pages = logs.flatMap((l) => l.log?.pages ?? []);
  const fetchedOk = pages.filter((p) => p.fetched === "ok");
  add({ stage: "Pages fetched", kind: "EXTERNAL", source: "direct HTTP GET of third-party sites (UA 'referral-demo public-web check')", input: `${hits} URLs → ${cands} chosen (≤2 per provider; ${skipped.length} skipped by rule)`, output: `${fetchedOk.length} fetched OK`, in: cands, out: fetchedOk.length, ms: logs.reduce((s, l) => s + (l.log?.timings?.fetchMs ?? 0), 0) || null, cost: "$0 (compute only)", failures: pages.filter((p) => p.fetched !== "ok").map((p) => `${p.domain}: ${p.reason}`) });
  const accepted = fetchedOk.filter((p) => p.accepted);
  const reasons = new Map<string, number>();
  for (const p of fetchedOk.filter((x) => !x.accepted)) reasons.set(p.reason.split(" — ")[0], (reasons.get(p.reason.split(" — ")[0]) ?? 0) + 1);
  add({ stage: "Deterministic corroboration", kind: "DET", source: "corroboratePage (api/_npi-discover.ts)", input: `${fetchedOk.length} pages`, output: `${accepted.length} accepted (name + NPI-record identifier anywhere on the page) · ${logs.filter((l) => l.log?.outcome === "corroborated").length} providers corroborated`, in: fetchedOk.length, out: accepted.length, ms: null, cost: "$0", failures: [...reasons].map(([r, n]) => `${n}× ${r}`) });

  const live = Object.entries(run.liveAi);
  const usage = saved.map(([, t]) => t.data?.research?.usage).filter(Boolean) as NonNullable<ReferralView["research"]>["usage"][];
  add({ stage: "AI research", kind: "AI", source: live.length ? "OpenAI Responses API (live, operator)" : "none live — saved snapshot only", input: live.length ? `${live.length} providers (operator key)` : "0 providers (cold viewer: AI never runs)", output: live.length ? `${live.filter(([, t]) => t.ok).length} completed` : `0 live calls · ${usage.length} cached results (${usage.length * 2} model calls when generated)`, in: live.length, out: live.filter(([, t]) => t.ok).length, ms: live.reduce((s, [, t]) => s + t.ms, 0) || null, cost: live.length ? "paid — tokens below; $ not recorded" : "$0 in this run", failures: live.filter(([, t]) => !t.ok).map(([n, t]) => `${n}: ${t.error}`) });

  const aiViews = [...saved.map(([, t]) => t.data), ...live.map(([, t]) => t.data?.view)].filter(Boolean) as ReferralView[];
  const claims = aiViews.reduce((s, v) => s + v.research!.locations.length + v.research!.sources.length, 0);
  const dropped = aiViews.reduce((s, v) => s + v.research!.dropped.length, 0);
  add({ stage: "Extracted claims (from AI)", kind: "AI", source: "gpt-4.1-mini structured extraction (at generation time)", input: `${aiViews.length} research reports`, output: `${aiViews.reduce((s, v) => s + v.research!.sources.length, 0)} sources, ${aiViews.reduce((s, v) => s + v.research!.locations.length, 0)} locations, ${aiViews.reduce((s, v) => s + v.research!.conflicts.length, 0)} model-reported conflicts (conflicts are NOT used by any rule)`, in: aiViews.length, out: claims, ms: null, cost: "incl. above", failures: [] });
  add({ stage: "Deterministic filters on AI claims", kind: "DET", source: "finalizeResearch (api/_npi-referral.ts)", input: `${claims + dropped} claims`, output: `${dropped} dropped (unreturned source ids, numbers not in report, unchecked referral labels, specialty overrides)`, in: claims + dropped, out: claims, ms: null, cost: "$0", failures: [] });

  const s = Object.values(decisions).map((d) => d.S);
  const researched = s.filter((d) => d.evidence !== "none");
  add({ stage: "Deterministic rules → classification", kind: "DET", source: "buildView/_npi-score.ts + pickDestination/assessDestination (routing.ts)", input: `${nb.results.length} candidates (${researched.length} with any web evidence)`, output: `${s.filter((d) => d.group === "recommended").length} Recommended · ${s.filter((d) => d.group === "review").length} Needs review · ${s.filter((d) => d.group === "unresolved").length} Unresolved`, in: nb.results.length, out: s.filter((d) => d.group === "recommended").length, ms: null, cost: "$0", failures: [] });
  add({ stage: "Choose destination", kind: "HUMAN", source: "coordinator", input: "Recommended + Needs review cards", output: "not part of this measurement", in: null, out: null, ms: null, cost: "staff time", failures: [] });
  return rows;
}

// Which fields of an AI-researched view are model judgements (vs. code or registry).
export function aiJudgements(v: ReferralView): { field: string; value: string; effect: string }[] {
  const r = v.research!;
  const out: { field: string; value: string; effect: string }[] = [];
  out.push({ field: "identity.confirmed", value: String(r.identity.confirmed), effect: r.identity.confirmed ? "+10/+20 verification points (if a non-aggregator source is cited)" : "no points" });
  out.push({ field: "identity.conflict", value: String(r.identity.conflict), effect: r.identity.conflict ? "−25 and Needs review" : "none" });
  out.push({ field: "specialty.status / value", value: `${r.specialty.status} · ${r.specialty.value ?? "—"}`, effect: r.specialty.status === "different" ? "−25 and Needs review (unless code's word-stem override flips it)" : r.specialty.value ? "+10 verification" : "none" });
  const modelFam = r.sources.filter((s) => /^Model/.test(s.familyReason));
  out.push({ field: "source family (unknown domains)", value: `${modelFam.length}/${r.sources.length} sources typed by the model (${[...new Set(modelFam.map((s) => s.family))].join(", ") || "—"})`, effect: "decides official (+30/+20) vs other (+18/+10) points" });
  out.push({ field: "source currentness", value: r.sources.map((s) => s.currentness).filter((c) => c !== "unknown").join(", ") || "all unknown", effect: "+5 when an official source is 'current'" });
  const former = r.locations.filter((l) => l.status === "former" || l.status === "possibly_stale");
  out.push({ field: "location status", value: former.map((l) => `${l.line1}: ${l.status}`).join("; ") || "none former/stale", effect: "former → excluded; stale → −15 and Needs review" });
  const anp = r.locations.filter((l) => l.acceptingNewPatients);
  out.push({ field: "accepting new patients", value: anp.map((l) => `${l.line1}: ${l.acceptingNewPatients!.accepting}`).join("; ") || "—", effect: "false → Needs review" });
  out.push({ field: "which number belongs to which location + verbatim fax label", value: `${r.locations.reduce((s, l) => s + l.faxes.length, 0)} faxes assigned`, effect: "decides the fax shown; 'referral' label only survives a live page check" });
  out.push({ field: "relationship", value: r.relationship.kind, effect: "shown only" });
  out.push({ field: "conflicts (model-listed)", value: `${r.conflicts.length}`, effect: "NONE — ignored by every rule (known gap)" });
  return out;
}
