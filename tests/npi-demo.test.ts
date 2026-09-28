// Synthetic referral-workflow POC tests — pure model only (no DOM, no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCENARIOS, SAMPLE_ATTACHMENTS, ageFrom, applyStep, createTransaction, draftReferral, faxPlan, pageCount, parseRecord, pediatricMismatch, simulateInbound, snapshotMetrics, toDestination, webhookFor,
  type Destination,
} from "../src/npi/demo/model.ts";
import type { LicenseCheck, PracticeLocation, ReferralResearch } from "../src/npi/types.ts";
import { REFERRAL_TYPES, assessDestination, groupDestinations, intentKey, resultsMatchIntent, savedResearchFor, snapshotAppliesTo, type AssessInput } from "../src/npi/demo/routing.ts";
import { CONTROLLED, CONTROLLED_FAX, controlledDestination, controlledFit, isControlled } from "../src/npi/demo/controlled.ts";
import { TERMS, faxSemantics, specialtyConflict } from "../src/npi/semantics.ts";
import { resolveSpecialty } from "../api/_npi-geo.ts";
import { readdirSync } from "node:fs";

const snapshot = JSON.parse(readFileSync(new URL("../src/npi/demo/seattle-ent-research.json", import.meta.url), "utf8")) as ReferralResearch[];

const DEST: Destination = {
  kind: "researched", reviewReasons: [],
  npi: "1629168570", provider: "Clifford Robert Hume, MD", specialty: "Otolaryngology", practice: "UW Medicine — Otolaryngology-Head and Neck Surgery Center", address: "1959 NE Pacific St, Seattle, WA 98195",
  distanceMi: 2.4, phone: "(206) 598-4022", fax: "(206) 598-6611", faxKind: "referral", faxChecked: true, faxLabel: "Fax", faxSources: [], providerScore: 95, referralScore: 95, researchedAt: "2026-09-28T06:22:55.585Z",
};

test("every scenario is obviously synthetic and parses into a complete record", () => {
  assert.equal(SCENARIOS.length, 6);
  for (const s of SCENARIOS) {
    const p = parseRecord(s.record);
    assert.ok(/Example|Sample|Placeholder|Demo|Fictional|Testcase/.test(p.name), s.patient);
    assert.equal(p.name, s.patient);
    assert.match(p.phone, /^\(555\) 010-/); // reserved fictional range
    assert.match(p.memberId, /^DEMO-/);
    assert.match(p.insurance, /^Example Health/);
    assert.ok(p.reason.length > 0);
    assert.ok(REFERRAL_TYPES.some((t) => t.value === s.referralType), s.referralType);
  }
  const jamie = parseRecord(SCENARIOS[0].record);
  assert.deepEqual([jamie.name, jamie.dob, jamie.location], ["Jamie Example", "01/01/1980", "Seattle, WA 98115"]);
  assert.match(jamie.audiology, /Asymmetric sensorineural hearing loss, left worse than right\.\nWord recognition/);
});

test("parseRecord tolerates user edits: inline section text, missing fields", () => {
  const p = parseRecord("Patient: Pat Test\nReason for referral: ENT please\nmore detail\nNotes:\n");
  assert.equal(p.name, "Pat Test");
  assert.equal(p.reason, "ENT please\nmore detail");
  assert.equal(p.dob, "");
  assert.equal(p.notes, "");
});

test("age and pediatric-practice fit", () => {
  assert.equal(ageFrom("01/01/1980", new Date("2026-09-27")), 46);
  assert.equal(ageFrom("12/31/1980", new Date("2026-09-27")), 45);
  assert.equal(ageFrom("not a date"), null);
  assert.equal(pediatricMismatch("Pediatric Otolaryngology Seattle Children's", 46), true);
  assert.equal(pediatricMismatch("Pediatric Otolaryngology", 9), false);
  assert.equal(pediatricMismatch("Otolaryngology UW Medicine", 46), false);
  assert.equal(pediatricMismatch("Seattle Children’s Hospital – Otolaryngology", 46), true); // typographic apostrophe
});

test("draft uses the record's reason and the scenario's priority; page count", () => {
  const s = SCENARIOS[1];
  const d = draftReferral(parseRecord(s.record), s, DEST);
  assert.equal(d.priority, "Urgent");
  assert.equal(d.reason, "Urgent ENT evaluation of sudden sensorineural hearing loss, right ear.");
  assert.match(d.coverNote, /UW Medicine/);
  assert.deepEqual(d.attachmentIds, ["audiogram", "report", "insurance"]);
  assert.equal(pageCount(d.attachmentIds.map((id) => SAMPLE_ATTACHMENTS[id as keyof typeof SAMPLE_ATTACHMENTS])), 6); // cover + letter + 1 + 2 + 1
});

test("fake fax: delivery plan plays through to delivered and a delivered webhook", () => {
  const plan = faxPlan("deliver", 5, DEST.fax);
  assert.deepEqual([...new Set(plan.map((p) => p.stage))], ["preparing", "queued", "dialing", "sending", "delivered"]);
  assert.equal(plan.filter((p) => p.stage === "sending").length, 5);
  let tx = createTransaction({ patient: parseRecord(SCENARIOS[0].record), destination: DEST, pages: 5, outcome: "deliver", id: "DEMO-FAX-10482" });
  for (const step of plan) tx = applyStep(tx, step);
  assert.equal(tx.status, "delivered");
  assert.equal(tx.attempts, 1);
  assert.ok(tx.completedAt);
  const hook = webhookFor(tx);
  assert.equal(hook.simulated, true);
  assert.equal(hook.event, "fax.outbound.delivered");
  assert.deepEqual([hook.status, hook.pages, hook.fax, hook.transactionId, hook.errorCode], ["Delivered", 5, "(206) 598-6611", "DEMO-FAX-10482", null]);
});

test("fake fax: failure plan retries three times, never sends pages, fails with NO_ANSWER", () => {
  const plan = faxPlan("fail", 5, DEST.fax);
  assert.equal(plan.some((p) => p.stage === "sending"), false);
  let tx = createTransaction({ patient: parseRecord(SCENARIOS[0].record), destination: DEST, pages: 5, outcome: "fail" });
  for (const step of plan) tx = applyStep(tx, step);
  assert.equal(tx.status, "failed");
  assert.equal(tx.attempts, 3);
  const hook = webhookFor(tx);
  assert.deepEqual([hook.event, hook.status, hook.pages, hook.errorCode], ["fax.outbound.failed", "Failed", 0, "NO_ANSWER"]);
  assert.match(tx.id, /^DEMO-FAX-\d{5}$/);
});

test("simulated inbound response matches the referral and schedules on a weekday", () => {
  const tx = createTransaction({ patient: parseRecord(SCENARIOS[0].record), destination: DEST, pages: 5, outcome: "deliver", id: "DEMO-FAX-10482" });
  const f = simulateInbound(tx, SCENARIOS[0], new Date("2026-09-25T10:00:00")); // Friday
  assert.equal(f.id, "DEMO-INFAX-10482");
  assert.equal(f.simulated, true);
  assert.equal(f.matchedPatient, "Jamie Example");
  assert.equal(f.extractedStatus, "Appointment scheduled");
  const d = new Date(f.appointment);
  assert.ok(d.getDay() >= 1 && d.getDay() <= 5);
  assert.ok(d > new Date("2026-10-06"));
  const urgent = new Date(simulateInbound(tx, SCENARIOS[1], new Date("2026-09-25T10:00:00")).appointment);
  assert.ok(urgent < d);
});

test("snapshot is the M016 Seattle ENT research and yields the opportunity-page facts", () => {
  assert.deepEqual(snapshot.map((r) => r.npi).sort(), ["1033377064", "1427046473", "1447340823", "1457222895", "1487065926", "1629168570", "1790313880"]);
  const m = snapshotMetrics(snapshot);
  assert.equal(m.providers, 7);
  assert.equal(m.sources, 47);
  assert.equal(m.researchedOn, "2026-09-28");
  assert.equal(m.avgSeconds, 107);
  assert.equal(m.searchCalls, 113);
  assert.equal(m.inputTokens, 502900);
  assert.equal(m.outputTokens, 57384);
  assert.equal(m.providersWithReferralFax, 2); // Horn (Seattle Children's) and Hume (UW)
  assert.ok(m.referralFaxes >= 2);
  assert.ok(m.locationsCorroborated <= m.locations && m.faxesCorroborated <= m.faxes);
  assert.equal(m.specialtyDifferent, 2); // Balogun (aesthetic medicine), Song (audiology)
});

test("toDestination keeps the location's own fax, label and page-check", () => {
  const hume = snapshot.find((r) => r.npi === "1629168570")!;
  const loc = hume.locations.find((l: PracticeLocation) => l.bestFax?.faxKind === "referral")!;
  const d = toDestination({ npi: hume.npi, name: "Clifford Robert Hume", credential: "MD", specialty: "Otolaryngology", loc, fax: loc.bestFax!, providerScore: 95, researchedAt: hume.researchedAt, sources: hume.sources });
  assert.equal(d.provider, "Clifford Robert Hume, MD");
  assert.equal(d.fax, "(206) 598-6611");
  assert.equal(d.faxKind, "referral");
  assert.equal(d.faxChecked, true);
  assert.ok(d.faxSources.length > 0);
});

// ── M018: deterministic-first routing ────────────────────────────────────────

test("referral intent propagates: every referral type resolves to the same server specialty key", () => {
  for (const t of REFERRAL_TYPES) assert.equal(resolveSpecialty(t.value)?.key, t.key, t.value);
  assert.equal(intentKey("Neurology"), "neurology");
  assert.equal(SCENARIOS.find((s) => s.id === "F")!.referralType, "Neurology");
});

test("Neurology can never render ENT results or the saved ENT cohort", () => {
  assert.equal(resultsMatchIntent("Neurology", { specialty: { key: "ent" } }), false);
  assert.equal(resultsMatchIntent("Neurology", { specialty: { key: "neurology" } }), true);
  assert.equal(resultsMatchIntent("ENT / Otolaryngology", { specialty: { key: "ent" } }), true);
  assert.equal(snapshotAppliesTo("neurology"), false);
  const cohort = new Map(snapshot.map((r) => [r.npi, r]));
  for (const r of snapshot) {
    assert.equal(savedResearchFor("neurology", cohort, r.npi), null, r.npi);
    assert.equal(savedResearchFor("allergy", cohort, r.npi), null, r.npi);
    assert.equal(savedResearchFor("ent", cohort, r.npi), r);
  }
});

// Assess a saved-cohort provider the way the demo card does. Saved locations are
// unscored (the server re-scores them per search), so the destination score is
// supplied: 85 = "high destination confidence".
const WA = (credentialType: string): LicenseCheck => ({ state: "WA", source: "WA DOH", sourceUrl: "", checkedAt: "", match: "exact", matchNote: "", records: [{ credentialNumber: "X", credentialType, status: "Active", name: "", firstIssued: null, lastIssued: null, expires: null, actionTaken: "No" }] });
function assess(npi: string, o: Partial<AssessInput> & { npiSpecialty: string; taxonomyCode: string }) {
  const r = snapshot.find((x) => x.npi === npi)!;
  const loc = r.locations.filter((l) => l.status !== "former").sort((a, b) => Number(Boolean(b.bestFax && b.bestFax.faxKind === "referral")) - Number(Boolean(a.bestFax && a.bestFax.faxKind === "referral")) || Number(Boolean(b.bestFax)) - Number(Boolean(a.bestFax)))[0];
  return assessDestination({
    requested: "ENT", npiActive: true, licence: WA("Physician And Surgeon License"), researchSpecialty: { status: r.specialty.status, value: r.specialty.value },
    identityConflict: r.identity.conflict, location: loc, providerScore: 90, destinationScore: 85, patientAge: 46, faxFailedThisSession: false, ...o,
  });
}

test("patient fit is separate from destination confidence (David Horn)", () => {
  const a = assess("1033377064", { npiSpecialty: "Otolaryngology", taxonomyCode: "207Y00000X" });
  assert.ok(a.destination.score >= 80);
  assert.equal(a.destination.fax.kind, "referral");
  assert.deepEqual(a.destination.issues, []);
  assert.equal(a.fit.ok, false);
  assert.match(a.fit.summary, /Pediatric practice — this synthetic patient is 46/);
  assert.equal(a.group, "review");
  const child = assess("1033377064", { npiSpecialty: "Otolaryngology", taxonomyCode: "207Y00000X", patientAge: 9 });
  assert.equal(child.group, "recommended");
});

test("office fax vs referral fax (Tonn, Hume) and both recommended", () => {
  const tonn = assess("1487065926", { npiSpecialty: "Otolaryngology", taxonomyCode: "207Y00000X" });
  assert.equal(tonn.destination.fax.kind, "office");
  assert.equal(tonn.destination.fax.title, "Office fax");
  assert.equal(tonn.group, "recommended");
  const hume = assess("1629168570", { npiSpecialty: "Otolaryngology", taxonomyCode: "207Y00000X" });
  assert.equal(hume.destination.fax.kind, "referral");
  assert.equal(hume.destination.fax.title, "Referral fax");
  assert.equal(hume.group, "recommended");
});

test("specialty conflicts are stated with the actual values (Balogun, Song)", () => {
  const bal = assess("1427046473", { npiSpecialty: "Otolaryngology", taxonomyCode: "207Y00000X" });
  assert.deepEqual(bal.verification.conflict!.rows.map((r) => [r.source, r.value]), [["NPI Registry", "Otolaryngology"], ["Current practice evidence", "Aesthetic and regenerative medicine"]]);
  assert.match(bal.verification.conflict!.explanation, /Current practice evidence suggests/);
  assert.equal(bal.destination.fax.kind, "none");
  assert.ok(bal.reviewReasons.includes("No fax found for this destination"));
  assert.equal(bal.group, "review");
  const weak = assess("1629168570", { npiSpecialty: "Otolaryngology", taxonomyCode: "207Y00000X", destinationScore: 30 });
  assert.equal(weak.group, "review");
  assert.ok(weak.reviewReasons.includes("Destination evidence is weak (30 of 100 rule points; threshold 50)"));
  const song = assess("1457222895", { npiSpecialty: "Otolaryngology, Otolaryngology/Facial Plastic Surgery", taxonomyCode: "207YX0905X", licence: WA("Audiologist License") });
  assert.deepEqual(song.verification.conflict!.rows.map((r) => r.source), ["NPI Registry", "Washington licence", "Current practice evidence"]);
  assert.equal(song.verification.conflict!.rows[1].value, "Audiologist (active)");
  assert.equal(song.group, "review");
  assert.equal(specialtyConflict({ npiSpecialty: "Otolaryngology", taxonomyCode: "207Y00000X", licence: WA("Physician And Surgeon License"), researchDifferent: false, researchSpecialty: "Otolaryngology" }), null);
});

test("grouping keeps review cases, separately, and the machine phrase is gone", () => {
  const all = snapshot.map((r) => ({ npi: r.npi, distanceMi: 1, assessment: assess(r.npi, { npiSpecialty: "Otolaryngology", taxonomyCode: "207Y00000X", licence: r.npi === "1457222895" ? WA("Audiologist License") : WA("Physician And Surgeon License") }) }));
  const g = groupDestinations(all);
  assert.equal(g.recommended.length + g.review.length, snapshot.length);
  assert.ok(g.review.some((c) => c.npi === "1033377064") && g.review.some((c) => c.npi === "1427046473") && g.review.some((c) => c.npi === "1457222895"));
  assert.ok(g.recommended.some((c) => c.npi === "1629168570") && g.recommended.some((c) => c.npi === "1487065926"));
  assert.ok(!readFileSync(new URL("../src/npi/ui.tsx", import.meta.url), "utf8").includes("Current specialty differs from NPI"));
  assert.deepEqual([TERMS.verification.label, TERMS.destination.label, TERMS.fit.label], ["Provider verification", "Destination evidence", "Referral fit"]);
});

test("fax semantic labels", () => {
  const n = { number: "(206) 555-0100", digits: "2065550100", label: null, sourceIds: [], families: [], inNpi: false, confidence: 0 };
  assert.equal(faxSemantics({ ...n, faxKind: "referral", labelCheck: "page" }).title, "Referral fax");
  assert.equal(faxSemantics({ ...n, faxKind: "referral", labelCheck: "unverifiable" }).kind, "referral_unchecked");
  assert.equal(faxSemantics({ ...n, faxKind: "general" }).title, "Office fax");
  assert.match(faxSemantics({ ...n, faxKind: "general" }).detail, /referral use is not confirmed/);
  assert.equal(faxSemantics(null).title, "No fax found");
  assert.match(faxSemantics(null).detail, /doesn't mean the practice has no fax/);
});

test("controlled synthetic destination: fixed fax, no real-provider claims, isolated from search and scoring", () => {
  assert.equal(CONTROLLED_FAX, "(778) 506-2042");
  const d = controlledDestination();
  assert.equal(isControlled(d), true);
  assert.deepEqual([d.npi, d.providerScore, d.referralScore, d.distanceMi, d.phone, d.researchedAt], [null, null, null, null, null, null]);
  assert.equal(d.fax, "(778) 506-2042");
  assert.equal(d.faxChecked, false); // designated by the POC owner, not source-verified
  assert.doesNotMatch(d.address, /\d/); // no physical address
  assert.deepEqual(CONTROLLED.labels, ["SYNTHETIC TEST PROVIDER", "NOT A REAL CLINICIAN", "CONTROLLED FAX DESTINATION"]);
  assert.equal(controlledFit("neurology").matches, true);
  assert.equal(controlledFit("ent").matches, false);
  assert.match(controlledFit("ent").text, /does not match the requested referral type/);
  // Never in the real data: not in the saved research, not in any server code.
  assert.ok(!JSON.stringify(snapshot).includes("5062042"));
  for (const f of readdirSync(new URL("../api/", import.meta.url))) {
    const src = readFileSync(new URL(`../api/${f}`, import.meta.url), "utf8");
    assert.ok(!/506-?2042|Lorne Markham/.test(src), f);
  }
  // A synthetic fax failure is keyed by the controlled id, never by a real NPI.
  assert.equal(d.npi ?? CONTROLLED.id, "SYNTHETIC-CONTROLLED-1");
});
