// Provider Intelligence experiment harness — pure grading/baseline logic, plus
// consistency checks on the recorded run and the ground-truth cases. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BASELINES, decideA, decideAll, decideB, foreignProfile, gradeAll, gradeDecision, metrics, pipelineStages, streetKey, type Decision } from "../src/npi/experiment/evaluate.ts";
import type { ExperimentRun, GroundTruthCase, RunCandidate } from "../src/npi/experiment/types.ts";

const read = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8")) as T;
const run = read<ExperimentRun>("../src/npi/experiment/data/run.json");
const cases = read<GroundTruthCase[]>("../src/npi/experiment/data/cases.json");

const cand = (o: Partial<RunCandidate> = {}): RunCandidate => ({
  npi: "1234567893", name: "Jane Q Doe", credential: "MD", enumerationType: "Individual", status: "Active",
  specialty: "Otolaryngology", specialtyCode: "207Y00000X", lastUpdated: "2020-01-01",
  nearest: { name: "Doe ENT", organization: null, line1: "100 Main St", city: "Seattle", postalCode: "98115", distanceMi: 2, phone: "(206) 555-0100", fax: "(206) 555-0101", faxDigits: "2065550101" },
  sharedAddressOrgs: [], license: null, baselineVerification: 45, ...o,
});
const gt = (e: Partial<GroundTruthCase["expected"]> = {}): GroundTruthCase => ({
  npi: "1234567893", name: "Jane Q Doe", cohort: "pipeline-evaluated", checkedAt: "2026-09-28", checkedBy: "test", humanVerified: false,
  expected: { identity: { official: true, note: "" }, licence: null, specialty: { value: "ENT", category: "ent", url: null, quote: null }, practices: [{ name: "Doe ENT", line1: "100 Main Street", city: "Seattle", url: "u", quote: "q" }], faxes: [{ digits: "2065550101", label: "Fax", referral: false, location: "100 Main", url: "u", quote: "q" }], seesAdults: "yes", outcome: "recommend", outcomeBasis: "b", outcomeIsJudgement: false, wrongEvidence: [], ...e },
  notes: "", failures: [],
});
const dec = (o: Partial<Decision> = {}): Decision => ({ baseline: "D", group: "recommended", evidence: "ai-saved", location: { name: "Doe ENT", line1: "100 Main St", city: "Seattle", distanceMi: 2 }, fax: { digits: "2065550101", number: "(206) 555-0101", cls: "office", label: "Fax" }, reasons: [], verification: 90, destination: 80, scoreItems: null, evidenceUrls: ["https://doe-ent.example/providers/jane-doe"], ...o });

test("streetKey: house number + first street word, directionals ignored", () => {
  assert.equal(streetKey("4800 Sand Point Way NE"), "4800 sand");
  assert.equal(streetKey("West Clinic, 325 9th Ave., Fl 4"), "325 9th");
  assert.equal(streetKey("10330 Meridian Ave. N, Suite 270"), streetKey("10330 Meridian Ave N Ste 270"));
  assert.equal(streetKey("1560 N 115th St"), "1560 115th");
});

test("foreignProfile: catches the Doximity sidebar hit, ignores own profile and non-person slugs", () => {
  assert.equal(foreignProfile("https://www.doximity.com/pub/henry-ou-md", "Thomas"), "henry-ou-md");
  assert.equal(foreignProfile("https://www.doximity.com/pub/herbert-thomas-md", "Thomas"), null);
  assert.equal(foreignProfile("https://www.bbb.org/us/wa/seattle/profile/plastic-surgery/sound-plastic-surgery-1296-1000030498", "Sharma"), null);
  assert.equal(foreignProfile("https://www.seattlechildrens.org/directory/juliana-bonilla-velez/", "Bonilla-Velez"), null);
});

test("outcome grading: false recommendation is FAIL; review of a not-recommend case is PASS", () => {
  const e = gt({ outcome: "not_recommend" });
  assert.equal(gradeDecision(cand(), dec(), e, "D").outcome.v, "FAIL");
  assert.match(gradeDecision(cand(), dec(), e, "D").outcome.why, /FALSE RECOMMENDATION/);
  assert.equal(gradeDecision(cand(), dec({ group: "review" }), e, "D").overall, "PASS");
});

test("UNRESOLVED is never turned into PASS", () => {
  // Pipeline never resolved a provider that should not be recommended: not a correct rejection.
  const g = gradeDecision(cand(), dec({ group: "unresolved", fax: null, location: null, evidenceUrls: [] }), gt({ outcome: "not_recommend" }), "C");
  assert.equal(g.outcome.v, "UNRESOLVED");
  assert.equal(g.overall, "UNRESOLVED");
  // No ground truth for the outcome: UNRESOLVED whatever the pipeline said.
  assert.equal(gradeDecision(cand(), dec(), gt({ outcome: "unknown" }), "D").overall, "UNRESOLVED");
  // Expected usable but sent to review: a miss, not a pass.
  assert.equal(gradeDecision(cand(), dec({ group: "review" }), gt(), "D").overall, "UNRESOLVED");
  // Provider missing from the run.
  assert.equal(gradeDecision(null, null, gt(), "D").overall, "UNRESOLVED");
});

test("a Recommended result is correct only if outcome, fax and location all PASS", () => {
  assert.equal(gradeDecision(cand(), dec(), gt(), "D").rec, "correct");
  assert.equal(gradeDecision(cand(), dec({ fax: { digits: "2065559999", number: "(206) 555-9999", cls: "office", label: "Fax" } }), gt(), "D").rec, "incorrect");
  assert.equal(gradeDecision(cand(), dec({ location: { name: "x", line1: "9 Other Rd", city: "Seattle", distanceMi: 3 } }), gt(), "D").rec, "incorrect");
  assert.equal(gradeDecision(cand(), dec(), gt({ faxes: null }), "D").rec, "unverifiable");
  assert.equal(gradeDecision(cand(), dec(), gt({ practices: null }), "D").rec, "unverifiable");
});

test("referral-fax claims: unconfirmed → UNRESOLVED, contradicted → FAIL", () => {
  const claim = dec({ fax: { digits: "2065550101", number: "(206) 555-0101", cls: "referral-verified", label: "Referral fax" } });
  assert.equal(gradeDecision(cand(), claim, gt(), "D").fax.v, "UNRESOLVED");
  const withReferral = gt({ faxes: [{ digits: "2065550101", label: "Fax", referral: false, location: "", url: "", quote: "" }, { digits: "2065550199", label: "Referrals fax", referral: true, location: "", url: "", quote: "" }] });
  assert.equal(gradeDecision(cand(), claim, withReferral, "D").fax.v, "FAIL");
});

test("identity: evidence about someone else fails the case", () => {
  const g = gradeDecision(cand({ name: "Herbert C Thomas" }), dec({ group: "review", evidenceUrls: ["https://www.doximity.com/pub/henry-ou-md"] }), gt({ outcome: "not_recommend" }), "C");
  assert.equal(g.identity.v, "FAIL");
  assert.equal(g.overall, "FAIL");
  assert.equal(gradeDecision(cand(), dec({ evidenceUrls: ["https://x.example/a"] }), gt({ wrongEvidence: ["https://x.example/a"] }), "D").identity.v, "FAIL");
});

test("baselines A/B: NPPES fax → recommended; pediatric → review; licence problems only in B", () => {
  assert.equal(decideA(cand(), 46).group, "recommended");
  assert.equal(decideA(cand({ nearest: { ...cand().nearest, fax: null, faxDigits: null } }), 46).group, "unresolved");
  assert.equal(decideA(cand({ specialty: "Pediatric Otolaryngology" }), 46).group, "review");
  assert.equal(decideA(cand({ specialty: "Pediatric Otolaryngology" }), 8).group, "recommended");
  const expired = cand({ license: { state: "WA", source: "", sourceUrl: "", checkedAt: "", match: "exact", matchNote: "", records: [{ credentialNumber: "MD.MD.1", credentialType: "Physician And Surgeon License", status: "Expired", name: "", firstIssued: null, lastIssued: null, expires: null, actionTaken: null }] } });
  assert.equal(decideA(expired, 46).group, "recommended");
  assert.equal(decideB(expired, 46).group, "review");
  const audiologist = cand({ license: { state: "WA", source: "", sourceUrl: "", checkedAt: "", match: "exact", matchNote: "", records: [{ credentialNumber: "AUD.LD.1", credentialType: "Audiologist License", status: "Active", name: "", firstIssued: null, lastIssued: null, expires: null, actionTaken: null }] } });
  assert.equal(decideB(audiologist, 46).group, "review");
});

test("ground-truth cases are well-formed and honestly labelled", () => {
  assert.equal(new Set(cases.map((c) => c.npi)).size, cases.length);
  for (const c of cases) {
    assert.match(c.npi, /^\d{10}$/);
    assert.equal(c.humanVerified, false, `${c.name}: no case has been verified by a person yet`);
    for (const f of c.expected.faxes ?? []) assert.match(f.digits, /^\d{10}$/, `${c.name} fax ${f.digits}`);
    if (c.expected.outcome !== "unknown") assert.ok(c.expected.outcomeBasis.length > 10, `${c.name} needs a stated basis`);
  }
  assert.equal(cases.filter((c) => c.cohort === "random-sample").length, 5);
});

test("recorded run: shipped grouping (S) is the product's own routing, and AI never ran live", () => {
  const d = decideAll(run);
  const s = Object.values(d).map((x) => x.S);
  assert.equal(s.length, run.nearby.data!.results.length);
  assert.equal(Object.keys(run.liveAi).length, 0);
  // Every S decision backed by AI comes from the saved snapshot; every Brave-backed one from a production pick.
  for (const [npi, x] of Object.entries(d)) {
    if (x.S.evidence === "ai-saved") assert.ok(run.savedAi[npi]?.ok);
    if (x.S.evidence === "brave") assert.equal(run.discovery[npi].role, "production");
    if (x.S.group !== "unresolved") assert.notEqual(x.S.evidence, "none");
  }
  const ai = pipelineStages(run, d).find((r) => r.stage === "AI research")!;
  assert.equal(ai.in, 0);
  assert.equal(ai.kind, "AI");
});

test("metrics: false-recommendation bounds are ordered and counts add up", () => {
  const g = gradeAll(run, cases);
  for (const m of metrics(run, g)) {
    assert.equal(m.recommended, m.correct + m.incorrect + m.unverifiable);
    assert.equal(m.cases, m.recommended + m.review + m.unresolved);
    assert.equal(m.cases, m.pass + m.fail + m.unresolvedVerdicts);
    if (m.falseRecRate.lower !== null) assert.ok(m.falseRecRate.lower <= m.falseRecRate.upper!);
    if (m.baseline === "A" || m.baseline === "B" || m.baseline === "C") assert.equal(m.aiCalls, 0);
  }
  assert.deepEqual(BASELINES.map((b) => b.id), ["A", "B", "C", "D", "S"]);
});
