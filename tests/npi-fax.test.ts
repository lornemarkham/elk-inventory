// M021 — controlled live fax (SRFax) boundary + real-provider research seam.
// No network: global fetch is replaced and every call is recorded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  LIVE_TO, DOC_BANNER, faxStatusForm, liveDestinationAllowed, statusToken, parseQueue, parseStatus, phaseOf, queueFaxForm, referralLines, srfaxConfig, textPdf,
} from "../api/_npi-fax.ts";
import handler from "../api/npi-fax.ts";
import { CONTROLLED, controlledDestination } from "../src/npi/demo/controlled.ts";
import { applySend, applyStatus, canSendLive, newLiveFax, operationalEvidence, type SrfaxStatus } from "../src/npi/demo/live.ts";
import { assessDestination, noDestinationReason, type AssessInput } from "../src/npi/demo/routing.ts";
import type { Destination } from "../src/npi/demo/model.ts";

const ENV = { SRFAX_ACCESS_ID: "12345", SRFAX_ACCESS_PWD: "pw-test", SRFAX_CALLER_ID: "(778) 506-2042", SRFAX_SENDER_EMAIL: "test@example.com" };

const REAL: Destination = {
  kind: "researched", reviewReasons: [], npi: "1629168570", provider: "Clifford Robert Hume, MD", specialty: "Otolaryngology", practice: "UW Medicine",
  address: "1959 NE Pacific St, Seattle, WA 98195", distanceMi: 2.4, phone: "(206) 598-4022", fax: "(206) 598-6611", faxKind: "referral", faxChecked: true,
  faxLabel: "Fax", faxSources: [], providerScore: 95, referralScore: 95, researchedAt: "2026-09-28T06:22:55.585Z",
};

function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  return fn().finally(() => { for (const k of Object.keys(env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });
}

function mockFetch(reply: (form: URLSearchParams) => unknown) {
  const calls: URLSearchParams[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const form = init.body as URLSearchParams;
    calls.push(form);
    return new Response(JSON.stringify(reply(form)), { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

const call = (body: unknown) =>
  handler(new Request("http://x/api/npi-fax", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

test("live destination is hard-bounded to (778) 506-2042", () => {
  assert.equal(LIVE_TO, "17785062042");
  const form = queueFaxForm(srfaxConfig(ENV)!, textPdf(["x"]), "SYN-1");
  assert.equal(form.get("sToFaxNumber"), "17785062042");
  assert.equal(form.get("sFaxType"), "SINGLE");
  assert.equal(form.get("action"), "Queue_Fax");
});

test("only the controlled synthetic destination can use the live branch", () => {
  assert.ok(liveDestinationAllowed(CONTROLLED.id));
  for (const id of ["1629168570", "", null, undefined, "SYNTHETIC-CONTROLLED-2", { id: CONTROLLED.id }]) assert.equal(liveDestinationAllowed(id), false);
  assert.ok(canSendLive(controlledDestination()));
  assert.equal(canSendLive(REAL), false);
  // A real provider dressed up as controlled but carrying its own NPI or fax is still refused.
  assert.equal(canSendLive({ ...REAL, kind: "controlled" }), false);
  assert.equal(canSendLive({ ...controlledDestination(), fax: "(206) 598-6611" }), false);
});

test("a real provider can never invoke SRFax — server refuses before any fetch", async () => {
  const m = mockFetch(() => ({ Status: "Success", Result: "1" }));
  try {
    await withEnv(ENV, async () => {
      for (const destinationId of ["1629168570", "1234567893", undefined]) {
        const res = await call({ action: "send", destinationId, scenarioId: "F" });
        assert.equal(res.status, 403);
        assert.match((await res.json()).error, /only available for the controlled synthetic/);
      }
    });
    assert.equal(m.calls.length, 0);
  } finally { m.restore(); }
});

test("the request cannot choose the number; no access key, but config is required", async () => {
  const m = mockFetch(() => ({ Status: "Success", Result: "987654" }));
  try {
    await withEnv(ENV, async () => {
      const res = await call({ action: "send", destinationId: CONTROLLED.id, scenarioId: "F", sToFaxNumber: "12065986611", to: "12065986611", fax: "(206) 598-6611" });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.deepEqual({ ok: body.ok, faxId: body.faxId, to: body.to }, { ok: true, faxId: "987654", to: "17785062042" });
      assert.equal(body.statusToken, await statusToken(srfaxConfig(ENV)!, "987654"));
    });
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].get("sToFaxNumber"), "17785062042");
    assert.deepEqual(m.calls[0].getAll("sToFaxNumber"), ["17785062042"]);
  } finally { m.restore(); }
  // Not configured → explicit 503, never a fake success.
  const res = await call({ action: "send", destinationId: CONTROLLED.id, scenarioId: "F" });
  if (!process.env.SRFAX_ACCESS_ID) assert.equal(res.status, 503);
});

test("status needs the server-issued token for that fax", async () => {
  const m = mockFetch(() => ({ Status: "Success", Result: [{ SentStatus: "Sent", ToFaxNumber: "17785062042" }] }));
  try {
    await withEnv(ENV, async () => {
      const tok = await statusToken(srfaxConfig(ENV)!, "555");
      assert.equal((await call({ action: "status", faxId: "556", statusToken: tok })).status, 403);
      assert.equal((await call({ action: "status", faxId: "555" })).status, 403);
      assert.equal((await call({ action: "status", faxId: "555", statusToken: tok })).status, 200);
      assert.notEqual(tok, await statusToken(srfaxConfig({ ...ENV, SRFAX_ACCESS_PWD: "other" })!, "555"));
    });
    assert.equal(m.calls.length, 1);
  } finally { m.restore(); }
});

test("SRFax credentials stay server-side", async () => {
  const cfg = await call({ action: "config" });
  const text = await withEnv(ENV, async () => (await call({ action: "config" })).text());
  assert.ok(!text.includes("pw-test") && !text.includes("12345"));
  assert.ok(cfg.ok);
  // Nothing under src/ (the browser bundle) references SRFax credentials or the SRFax host.
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
  for (const f of walk(new URL("../src", import.meta.url).pathname).filter((f) => /\.(ts|tsx)$/.test(f))) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/SRFAX_|access_pwd|srfax\.com/i.test(src), f);
  }
});

test("synthetic document: prominent TEST / NO PHI wording, canned scenario only, no fake identifiers", () => {
  const lines = referralLines("F", "SYN-TEST")!;
  assert.deepEqual(lines.slice(0, 3), ["SYNTHETIC TEST REFERRAL", "NO REAL PATIENT INFORMATION", "NOT FOR CLINICAL USE"]);
  assert.deepEqual(lines.slice(-3), DOC_BANNER);
  const text = lines.join("\n");
  assert.match(text, /Lorne Markham, MD/);
  assert.match(text, /Synthetic Neurologist/);
  assert.match(text, /Controlled SRFax Test Destination/);
  assert.match(text, /\(778\) 506-2042/);
  assert.match(text, /Jordan Testcase/);
  assert.ok(!/\bNPI\b|licen[cs]e|\b\d{10}\b/i.test(text), "no fake professional identifiers");
  assert.equal(referralLines("Z", "x"), null);
  const pdf = new TextDecoder().decode(textPdf(lines));
  assert.ok(pdf.startsWith("%PDF-1.4") && pdf.trimEnd().endsWith("%%EOF"));
  assert.match(pdf, /\(SYNTHETIC TEST REFERRAL\) Tj/);
  assert.match(pdf, /\(NO REAL PATIENT INFORMATION\) Tj/);
  // xref offsets point at the objects
  const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
  assert.ok(pdf.slice(xref).startsWith("xref"));
  const offs = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offs.forEach((o, i) => assert.ok(pdf.slice(o).startsWith(`${i + 1} 0 obj`)));
});

test("SRFax submission ID and status are preserved verbatim", () => {
  assert.deepEqual(parseQueue({ Status: "Success", Result: "123456" }), { ok: true, faxId: "123456" });
  const st = parseStatus({ Status: "Success", Result: [{ FileName: "f.pdf", SentStatus: "Sent", DateQueued: "Sep/28/2026 10:00 PM", DateSent: "Sep/28/2026 10:01 PM", EpochTime: "1790000000", ToFaxNumber: "17785062042", Pages: "1", Duration: "34", RemoteID: "", ErrorCode: "", Size: "900" }] });
  assert.ok(st.ok);
  assert.equal(st.ok && st.status.sentStatus, "Sent");
  assert.equal(st.ok && st.status.pages, 1);
  let l = applySend(newLiveFax("SYN-1"), { ok: true, faxId: "123456", statusToken: "t", to: LIVE_TO, submittedAt: "2026-09-28T22:00:00Z" });
  assert.equal(l.faxId, "123456");
  assert.equal(l.phase, "submitted");
  l = applyStatus(l, { ok: true, checkedAt: "2026-09-28T22:00:10Z", status: { ...(st.ok ? st.status : {} as SrfaxStatus), sentStatus: "In Progress", phase: "in_progress" } });
  assert.equal(l.phase, "in_progress");
  l = applyStatus(l, { ok: true, checkedAt: "2026-09-28T22:01:10Z", status: st.ok ? st.status : ({} as SrfaxStatus) });
  assert.equal(l.phase, "sent");
  assert.deepEqual(l.events.map((e) => e.label), ["Prepared", "Submitted to SRFax", "SRFax: In Progress", "SRFax: Sent"]);
  assert.deepEqual(["In Progress", "Sent", "Failed", "Sending Email", "???"].map(phaseOf), ["in_progress", "sent", "failed", "in_progress", "unknown"]);
  assert.equal(faxStatusForm(srfaxConfig(ENV)!, "123456").get("sFaxDetailsID"), "123456");
});

test("SRFax failure remains a failure", async () => {
  assert.deepEqual(parseQueue({ Status: "Failed", Result: "Invalid Access ID" }), { ok: false, error: "SRFax: Invalid Access ID" });
  assert.equal(parseQueue({ Status: "Success", Result: "" }).ok, false);
  assert.equal(parseQueue("<html>").ok, false);
  const m = mockFetch(() => ({ Status: "Failed", Result: "Insufficient funds" }));
  try {
    await withEnv(ENV, async () => {
      const res = await call({ action: "send", destinationId: CONTROLLED.id, scenarioId: "F" });
      assert.equal(res.status, 502);
      const b = await res.json();
      assert.equal(b.ok, false);
      assert.match(b.error, /Insufficient funds/);
    });
  } finally { m.restore(); }
  const l = applySend(newLiveFax("SYN-2"), { ok: false, error: "SRFax: Insufficient funds" });
  assert.equal(l.phase, "error");
  assert.equal(l.faxId, null);
  const failed = applyStatus(applySend(newLiveFax("SYN-3"), { ok: true, faxId: "9", statusToken: "t", to: LIVE_TO, submittedAt: "t" }), { ok: true, checkedAt: "t2", status: { sentStatus: "Failed", phase: "failed", errorCode: "No Answer", dateQueued: null, dateSent: null, epochTime: null, toFaxNumber: LIVE_TO, pages: 0, duration: 0, remoteId: null } });
  assert.equal(failed.phase, "failed");
  assert.match(operationalEvidence(failed).claim, /failed \(No Answer\)/);
  // A failed status LOOKUP is not reported as a fax failure or success.
  const lookup = applyStatus(applySend(newLiveFax("SYN-4"), { ok: true, faxId: "9", statusToken: "t", to: LIVE_TO, submittedAt: "t" }), { ok: false, error: "SRFax: timeout" });
  assert.equal(lookup.phase, "submitted");
});

test("operational fax evidence is not provider, ownership, referral-purpose or fit evidence", () => {
  const sent = applyStatus(applySend(newLiveFax("SYN-5"), { ok: true, faxId: "1", statusToken: "t", to: LIVE_TO, submittedAt: "t" }), { ok: true, checkedAt: "t", status: { sentStatus: "Sent", phase: "sent", errorCode: null, dateQueued: null, dateSent: "d", epochTime: null, toFaxNumber: LIVE_TO, pages: 1, duration: 30, remoteId: null } });
  const ev = operationalEvidence(sent);
  assert.equal(ev.claim, "SRFax reports successful delivery to this fax endpoint.");
  assert.equal(ev.notProven.length, 4);
  assert.ok(ev.notProven.some((x) => /owns/.test(x)) && ev.notProven.some((x) => /referrals/.test(x)) && ev.notProven.some((x) => /read/.test(x)) && ev.notProven.some((x) => /accepted/.test(x)));
  // The live record carries no provider scores and the destination carries no fax outcome.
  assert.ok(!("providerScore" in sent) && !("referralScore" in sent));
  const d = controlledDestination();
  assert.equal(d.providerScore, null);
  assert.equal(d.referralScore, null);
  assert.equal(d.faxChecked, false);
  assert.ok(!Object.keys(d).some((k) => /status|delivered|srfax/i.test(k)));
  // assessDestination has no input for transmission outcomes.
  const keys: (keyof AssessInput)[] = ["requested", "npiSpecialty", "taxonomyCode", "npiActive", "licence", "researchSpecialty", "identityConflict", "location", "providerScore", "destinationScore", "patientAge", "faxFailedThisSession"];
  assert.ok(!keys.some((k) => /srfax|delivered|sent/i.test(k)));
});

// ── Real provider seam ───────────────────────────────────────────────────────

const loc = (o: Partial<AssessInput["location"]> = {}): AssessInput["location"] => ({ name: "Neurology Clinic", organization: "Example Health", status: "current", bestFax: { number: "(206) 555-0100", digits: "2065550100", label: "Fax", faxKind: "general", sourceIds: ["S1"], families: ["practice"], inNpi: false, confidence: 80 }, acceptingNewPatients: null, ...o });
const neuro = (o: Partial<AssessInput> = {}): AssessInput => ({
  requested: "Neurology", npiSpecialty: "Neurology", taxonomyCode: "2084N0400X", npiActive: true, licence: null,
  researchSpecialty: { status: "same", value: "Neurology" }, identityConflict: false, location: loc(), providerScore: 85, destinationScore: 80, patientAge: 43, faxFailedThisSession: false, ...o,
});

test("a researched Neurology provider with supporting evidence becomes a recommended destination", () => {
  const a = assessDestination(neuro());
  assert.equal(a.group, "recommended");
  assert.ok(a.fit.ok);
});

test("a researched provider with insufficient/conflicting evidence stays Needs review with explicit reasons", () => {
  assert.deepEqual(assessDestination(neuro({ location: loc({ bestFax: null }) })).reviewReasons, ["No fax found for this destination"]);
  assert.match(assessDestination(neuro({ identityConflict: true })).reviewReasons.join(), /conflicts with this provider's identity/);
  assert.match(assessDestination(neuro({ destinationScore: 30 })).reviewReasons.join(), /Destination evidence is weak \(30%\)/);
  assert.match(assessDestination(neuro({ location: loc({ status: "possibly_stale" }) })).reviewReasons.join(), /may be out of date/);
  assert.match(assessDestination(neuro({ researchSpecialty: { status: "different", value: "Sleep Medicine" } })).reviewReasons.join(), /Sleep Medicine, not Neurology/);
  for (const i of [neuro({ location: loc({ bestFax: null }) }), neuro({ identityConflict: true })]) assert.equal(assessDestination(i).group, "review");
});

test("research that can't establish any current location says why (no destination manufactured)", () => {
  assert.match(noDestinationReason([]), /no practice location/);
  assert.match(noDestinationReason([{ status: "former" }, { status: "former" }]), /left every known location/);
});

// Last: the per-isolate send counter is module state and would starve later tests.
test("live sends are rate limited", async () => {
  const m = mockFetch(() => ({ Status: "Success", Result: "1" }));
  try {
    await withEnv(ENV, async () => {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await call({ action: "send", destinationId: CONTROLLED.id, scenarioId: "F" })).status);
      assert.equal(codes.at(-1), 429);
    });
  } finally { m.restore(); }
});
