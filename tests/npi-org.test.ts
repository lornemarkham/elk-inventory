// Shared Organizational Knowledge POC — trust engine + demo scenes (src/npi/org/*).
// Pure and deterministic: fetch is replaced with a thrower, so any network/AI call fails the run.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { append, assess, DEFAULT_POLICY, independenceKey, type Observation, type Policy } from "../src/npi/org/model.ts";
import { IMPORT_ID, initialState, ORG, PROVIDERS, SCENES, sceneEnd, sceneStart, STORY, STORY_ID, seedLog } from "../src/npi/org/seed.ts";

const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = (() => { throw new Error("network call in the trust workflow"); }) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; });

const NORTH = { orgId: ORG.id, clinicId: "sea-north" };
const SOUTH = { orgId: ORG.id, clinicId: "sea-south" };
const CORP = { orgId: ORG.id, clinicId: null };
const at = (d: string) => `2026-${d}T17:00:00.000Z`;
const confirm = (log: Observation[], clinicId: string, value: string, when: string, extra: Partial<Parameters<typeof append>[1]> = {}) =>
  append(log, { providerId: STORY_ID, value, sourceType: "clinic_confirmation", source: clinicId, orgId: ORG.id, clinicId, actor: "t", method: "called_practice", observedAt: when, ...extra });
const A = (log: Observation[], viewer = NORTH, now = at("09-30"), policy: Policy = DEFAULT_POLICY, id = STORY_ID) => assess(id, log, policy, viewer, now, ORG);

test("1. parent organization has multiple clinics", () => {
  assert.equal(ORG.name, "Lornsco Hearing");
  assert.ok(ORG.clinics.length >= 2);
  assert.deepEqual(ORG.clinics.map((c) => c.name), ["Lornsco Seattle North", "Lornsco Seattle South"]);
  assert.equal(ORG.totalClinics, 100);
});

test("2. the same provider is visible from both clinic contexts; NPPES-only is registry_only", () => {
  const log = seedLog();
  for (const v of [NORTH, SOUTH, CORP]) {
    const a = A(log, v);
    assert.equal(a.status, "registry_only");
    assert.equal(a.directory, true);
    assert.equal(a.registry?.value, STORY.nppes);
    assert.equal(a.registry?.source, "CMS/NPPES");
  }
});

test("10. NPPES-only destination cannot transmit PHI (any context, any policy)", () => {
  const log = seedLog();
  const lax: Policy = { corporateImportTrusted: true, singleConfirmationScope: "organization", orgTrustThreshold: 2, reconfirmAfterDays: 9999 };
  for (const p of PROVIDERS.filter((x) => x.id !== IMPORT_ID)) {
    for (const v of [NORTH, SOUTH]) for (const pol of [DEFAULT_POLICY, lax]) {
      const a = A(log, v, at("09-30"), pol, p.id);
      assert.equal(a.phiAllowed, false, p.name);
      assert.equal(a.destinationConfirmed, false);
    }
  }
});

test("registry copies share NPPES lineage and are not independent", () => {
  const log = seedLog();
  const byId = new Map(log.map((o) => [o.id, o]));
  const story = log.filter((o) => o.providerId === STORY_ID);
  assert.equal(story.length, 3);
  assert.equal(new Set(story.map((o) => independenceKey(o, byId))).size, 1);
  assert.equal(A(log).registry?.copies, 2);
});

test("3+4. Clinic A's confirmation is usable at A and visible (with provenance) at B", () => {
  const log = confirm(seedLog(), "sea-north", "206-555-2222", at("09-24"), { note: "coordinator" });
  const north = A(log, NORTH);
  assert.equal(north.status, "usable_locally");
  assert.equal(north.value, STORY.confirmed);
  assert.equal(north.phiAllowed, true);
  const south = A(log, SOUTH);
  assert.equal(south.value, STORY.confirmed, "B sees A's value");
  assert.deepEqual(south.confirmingClinics, ["sea-north"]);
  assert.equal(south.supporting[0].latest.method, "called_practice");
  assert.equal(south.supporting[0].latest.observedAt, at("09-24"));
  assert.equal(south.phiAllowed, false, "default policy: one confirmation is usable locally only");
  assert.equal(A(log, SOUTH, at("09-30"), { ...DEFAULT_POLICY, singleConfirmationScope: "organization" }).phiAllowed, true, "policy can widen it");
  assert.equal(south.registry?.agrees, false, "registry disagreement is surfaced");
});

test("3. persistence: the scene log round-trips through JSON (the localStorage format)", () => {
  const s = sceneEnd(2);
  const restored = JSON.parse(JSON.stringify(s)) as typeof s;
  assert.deepEqual(A(restored.log, SOUTH, restored.clock), A(s.log, SOUTH, s.clock));
  assert.equal(A(restored.log, SOUTH, restored.clock).value, STORY.confirmed);
});

test("5+6+11. Clinic B independently corroborates → two independent confirmations → trusted org-wide, PHI allowed", () => {
  let log = confirm(seedLog(), "sea-north", STORY.confirmed, at("09-24"));
  log = confirm(log, "sea-south", "(206) 555-2222", at("09-29"));
  for (const v of [NORTH, SOUTH]) {
    const a = A(log, v);
    assert.equal(a.status, "trusted_org");
    assert.equal(a.independentConfirmations, 2);
    assert.equal(a.phiAllowed, true);
    assert.equal(a.destinationConfirmed, true);
  }
  assert.equal(log.filter((o) => o.sourceType === "clinic_confirmation").length, 2, "A's observation is kept, not overwritten");
  // threshold is policy-controlled
  assert.equal(A(log, SOUTH, at("09-30"), { ...DEFAULT_POLICY, orgTrustThreshold: 3 }).status, "usable_locally");
});

test("7. duplicate evidence does NOT count as independent corroboration", () => {
  // same clinic twice
  let log = confirm(seedLog(), "sea-north", STORY.confirmed, at("09-24"));
  log = confirm(log, "sea-north", STORY.confirmed, at("09-25"));
  let a = A(log, SOUTH);
  assert.equal(a.independentConfirmations, 1);
  assert.equal(a.status, "usable_locally");
  assert.equal(a.duplicates, 1);
  // Clinic B copies A's value (declared lineage) — whether flagged as reuse or as a derived confirmation
  const first = log.find((o) => o.sourceType === "clinic_confirmation")!;
  const reuse = confirm(log, "sea-south", STORY.confirmed, at("09-26"), { method: "reused_shared", derivedFrom: first.id });
  assert.equal(A(reuse, SOUTH).independentConfirmations, 1);
  assert.equal(A(reuse, SOUTH).status, "usable_locally");
  const derived = confirm(log, "sea-south", STORY.confirmed, at("09-26"), { derivedFrom: first.id });
  assert.equal(A(derived, SOUTH).independentConfirmations, 1);
  // one corporate spreadsheet imported into 10 clinics = one source
  let imp: Observation[] = [];
  for (let i = 0; i < 10; i++) imp = append(imp, { providerId: "x", value: "2065550000", sourceType: "corporate_import", source: "corp", orgId: ORG.id, clinicId: `c${i}`, actor: null, method: "spreadsheet_import", observedAt: at("09-01"), importBatch: "sheet.xlsx" });
  const ia = assess("x", imp, { ...DEFAULT_POLICY, corporateImportTrusted: false }, NORTH, at("09-30"), ORG);
  assert.equal(ia.supporting.length, 1);
  assert.equal(ia.duplicates, 9);
  assert.equal(ia.independentConfirmations, 0);
  assert.equal(ia.status, "org_unconfirmed");
  assert.equal(ia.phiAllowed, false);
});

test("corporate import → trusted org-wide only while policy says so (seeded Dr. Sample)", () => {
  const log = seedLog();
  const on = A(log, SOUTH, at("09-30"), DEFAULT_POLICY, IMPORT_ID);
  assert.equal(on.status, "trusted_org");
  assert.equal(on.supporting.length, 1, "two clinic imports of one batch = one source");
  assert.equal(on.duplicates, 1);
  assert.equal(A(log, SOUTH, at("09-30"), { ...DEFAULT_POLICY, corporateImportTrusted: false }, IMPORT_ID).phiAllowed, false);
});

test("8+9. a conflicting observation → review required; nothing is replaced or deleted", () => {
  let log = confirm(seedLog(), "sea-north", STORY.confirmed, at("09-24"));
  log = confirm(log, "sea-south", STORY.confirmed, at("09-29"));
  const before = structuredClone(log);
  log = confirm(log, "sea-north", STORY.conflicting, at("10-06"));
  assert.deepEqual(log.slice(0, before.length), before, "earlier observations are byte-identical");
  for (const v of [NORTH, SOUTH, CORP]) {
    const a = A(log, v, at("10-07"));
    assert.equal(a.status, "review_required");
    assert.equal(a.phiAllowed, false);
    assert.equal(a.value, null);
    const vals = a.conflict!.map((c) => c.value);
    assert.deepEqual(vals, [STORY.confirmed, STORY.conflicting], "majority value listed first, both kept");
    assert.equal(a.conflict![0].groups.length, 2);
  }
  // re-confirming the old value does not auto-resolve the conflict
  const again = confirm(log, "sea-south", STORY.confirmed, at("10-08"));
  assert.equal(A(again, SOUTH, at("10-09")).status, "review_required");
  // only an explicit corporate review resolves it — and history is still whole
  const resolved = append(again, { providerId: STORY_ID, value: STORY.conflicting, sourceType: "review", source: "corp", orgId: ORG.id, clinicId: null, actor: "Dana", method: "corporate_review", observedAt: at("10-10"), note: "called manager" });
  const r = A(resolved, SOUTH, at("10-11"));
  assert.equal(r.status, "trusted_org");
  assert.equal(r.value, STORY.conflicting);
  assert.equal(resolved.filter((o) => o.providerId === STORY_ID).length, again.filter((o) => o.providerId === STORY_ID).length + 1);
  // a new disagreement after the review re-opens review
  assert.equal(A(confirm(resolved, "sea-north", STORY.confirmed, at("10-12")), SOUTH, at("10-13")).status, "review_required");
});

test("append never mutates and rejects malformed values", () => {
  const log = seedLog();
  const snap = JSON.stringify(log);
  const next = confirm(log, "sea-north", STORY.confirmed, at("09-24"));
  assert.equal(JSON.stringify(log), snap);
  assert.equal(next.length, log.length + 1);
  assert.equal(next.at(-1)!.seq, log.length + 1);
  assert.throws(() => confirm(log, "sea-north", "555-2222", at("09-24")), /10 digits/);
});

test("old confirmations require reconfirmation (policy period)", () => {
  let log = confirm(seedLog(), "sea-north", STORY.confirmed, at("09-24"));
  log = confirm(log, "sea-south", STORY.confirmed, at("09-29"));
  const later = "2027-11-01T17:00:00.000Z";
  const a = A(log, SOUTH, later);
  assert.equal(a.status, "reconfirm_required");
  assert.equal(a.phiAllowed, false);
  assert.equal(a.expired.length, 2);
  assert.equal(A(log, SOUTH, later, { ...DEFAULT_POLICY, reconfirmAfterDays: 730 }).status, "trusted_org");
  // one fresh reconfirmation → usable locally again; the stale ones stay in history
  const re = confirm(log, "sea-south", STORY.confirmed, "2027-10-30T17:00:00.000Z");
  assert.equal(A(re, SOUTH, later).status, "usable_locally");
});

test("organization boundary: another organization's observations are ignored", () => {
  const log = append(seedLog(), { providerId: STORY_ID, value: STORY.confirmed, sourceType: "clinic_confirmation", source: "Other Co", orgId: "other-co", clinicId: "x", actor: null, method: "called_practice", observedAt: at("09-24") });
  assert.equal(A(log, SOUTH).status, "registry_only");
});

test("the five scenes produce the demo story", () => {
  const s = (n: number) => sceneEnd(n);
  const st = (n: number, v = SOUTH) => A(s(n).log, v, s(n).clock).status;
  assert.equal(st(1), "registry_only");
  assert.equal(st(2, NORTH), "usable_locally");
  assert.equal(st(3), "usable_locally");
  assert.equal(sceneStart(3).context, "sea-south");
  assert.equal(st(4), "trusted_org");
  assert.equal(st(5), "review_required");
  assert.equal(s(5).log.filter((o) => o.providerId === STORY_ID).length, 3 + 3, "3 seed + 3 clinic observations");
  assert.equal(SCENES.length, 5);
  assert.equal(initialState().log.length, s(1).log.length);
});

test("13. no AI/network in the trust workflow (fetch is a thrower for this whole file)", () => {
  assert.throws(() => fetch("https://example.com"));
  for (const n of [1, 2, 3, 4, 5]) A(sceneEnd(n).log, SOUTH, sceneEnd(n).clock);
  const src = ["model.ts", "seed.ts", "store.ts"].map((f) => readFileSync(new URL(`../src/npi/org/${f}`, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(src, /fetch\(|\/api\/|openai|anthropic/i);
});

test("public candidates are real NPPES values from the recorded run, never organization data", () => {
  const seed = JSON.parse(readFileSync(new URL("../src/npi/org/seed-candidates.json", import.meta.url), "utf8"));
  const run = JSON.parse(readFileSync(new URL("../src/npi/experiment/data/run.json", import.meta.url), "utf8"));
  assert.equal(seed.runId, run.meta.runId);
  assert.ok(seed.candidates.length <= 10);
  for (const c of seed.candidates) {
    const r = run.nearby.data.results.find((x: { npi: string }) => x.npi === c.npi);
    assert.equal(r.nearest.faxDigits, c.fax);
  }
  const log = seedLog();
  for (const c of seed.candidates) assert.ok(log.filter((o) => o.providerId === c.npi).every((o) => o.sourceType === "registry" && !o.simulated));
});
