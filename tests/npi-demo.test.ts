// Synthetic referral-workflow POC tests — pure model only (no DOM, no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCENARIOS, SAMPLE_ATTACHMENTS, ageFrom, applyStep, createTransaction, draftReferral, faxPlan, pageCount, parseRecord, pediatricMismatch, simulateInbound, snapshotMetrics, toDestination, webhookFor,
  type Destination,
} from "../src/npi/demo/model.ts";
import type { PracticeLocation, ReferralResearch } from "../src/npi/types.ts";

const snapshot = JSON.parse(readFileSync(new URL("../src/npi/demo/seattle-ent-research.json", import.meta.url), "utf8")) as ReferralResearch[];

const DEST: Destination = {
  npi: "1629168570", provider: "Clifford Robert Hume, MD", specialty: "Otolaryngology", practice: "UW Medicine — Otolaryngology-Head and Neck Surgery Center", address: "1959 NE Pacific St, Seattle, WA 98195",
  distanceMi: 2.4, phone: "(206) 598-4022", fax: "(206) 598-6611", faxKind: "referral", faxChecked: true, faxLabel: "Fax", faxSources: [], providerScore: 95, referralScore: 95, researchedAt: "2026-09-28T06:22:55.585Z",
};

test("every scenario is obviously synthetic and parses into a complete record", () => {
  assert.equal(SCENARIOS.length, 5);
  for (const s of SCENARIOS) {
    const p = parseRecord(s.record);
    assert.ok(/Example|Sample|Placeholder|Demo|Fictional/.test(p.name), s.patient);
    assert.equal(p.name, s.patient);
    assert.match(p.phone, /^\(555\) 010-/); // reserved fictional range
    assert.match(p.memberId, /^DEMO-/);
    assert.match(p.insurance, /^Example Health/);
    assert.ok(p.reason.length > 0);
    assert.equal(s.specialty, "ENT / Otolaryngology");
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
