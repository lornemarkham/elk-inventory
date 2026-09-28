// M024 — fake-PMS wrapper: fax lifecycle wording, SRFax completion callback,
// endpoint-receipt matching, simulated inbound + document pipeline, embed helpers.
// No network: global fetch is replaced and every call is recorded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTIFY_MAX, matchReceipt, naiveSeconds, notifyToken, notifyUrl, queueFaxForm, referralLines, srfaxConfig, statusToken, textPdf } from "../api/_npi-fax.ts";
import handler, { callbacks } from "../api/npi-fax.ts";
import { CONTROLLED, controlledDestination } from "../src/npi/demo/controlled.ts";
import { applyReceipt, applyStatus, newLiveFax, applySend, type LiveFax } from "../src/npi/demo/live.ts";
import type { Destination } from "../src/npi/demo/model.ts";
import { PMS_CLINIC, PMS_PATIENT } from "../src/npi/pms/data.ts";
import { createOutbox, freshState, referralStatus, simulatedState, transportOf, type OutboxItem, type PmsState } from "../src/npi/pms/model.ts";
import { extractFields, processDocument, proposeMatch, receiveInboundFax, simulatedInboundEvent, simulatedOcr } from "../src/npi/pms/inbound.ts";
import { resolveReferralType } from "../src/npi/pms/embed.ts";

const ENV = { SRFAX_ACCESS_ID: "12345", SRFAX_ACCESS_PWD: "pw-test", SRFAX_CALLER_ID: "(778) 506-2042", SRFAX_SENDER_EMAIL: "test@example.com" };
const CFG = srfaxConfig(ENV)!;

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

const post = (url: string, body: unknown, form = false) =>
  handler(new Request(url, { method: "POST", headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" }, body: form ? String(body) : JSON.stringify(body) }));

// ── Fax document letterhead ─────────────────────────────────────────────────

test("PMS letterhead is fixed server-side and the document stays synthetic", () => {
  const text = referralLines("A", "PMS-TEST", new Date("2026-09-28T12:00:00Z"), "pms")!.join("\n");
  assert.match(text, /Costco Hearing Aid Center - Demo Location \(fictional demo tenant - no real clinic\)/);
  assert.match(text, /Jamie Example/);
  assert.match(text, /SYNTHETIC TEST REFERRAL/);
  assert.ok(!/\bNPI\b|licen[cs]e|\b\d{10}\b/i.test(text), "no fake professional identifiers");
  // Default is unchanged for the standalone demo.
  assert.match(referralLines("A", "X")!.join("\n"), /Example Hearing Clinic/);
});

test("the send's letterhead choice can't smuggle text: anything but 'pms' is the demo header", async () => {
  const m = mockFetch(() => ({ Status: "Success", Result: "4242" }));
  try {
    await withEnv(ENV, async () => {
      const res = await post("http://x/api/npi-fax", { action: "send", destinationId: CONTROLLED.id, scenarioId: "A", reference: "PMS-L1", letterhead: "Evil Clinic <script>" });
      assert.equal(res.status, 200);
    });
    const pdf = Buffer.from(m.calls[0].get("sFileContent_1")!, "base64").toString();
    assert.match(pdf, /Example Hearing Clinic/);
    assert.ok(!pdf.includes("Evil"));
  } finally { m.restore(); }
});

// ── SRFax completion callback (sNotifyURL) ──────────────────────────────────

test("sNotifyURL is only registered for a public https origin, within SRFax's 110-char limit", async () => {
  assert.equal(await notifyUrl(CFG, "http://localhost:5201", "PMS-1"), null);
  const url = (await notifyUrl(CFG, "https://elk-inventory.vercel.app", "PMS-MG3K2ZAB12"))!;
  assert.ok(url.length <= NOTIFY_MAX, url);
  assert.match(url, /^https:\/\/elk-inventory\.vercel\.app\/api\/npi-fax\?n=PMS-MG3K2ZAB12&s=[0-9a-f]{32}$/);
  assert.equal(await notifyUrl(CFG, "https://" + "a".repeat(80) + ".vercel.app", "PMS-1"), null);
  const form = queueFaxForm(CFG, textPdf(["x"]), "PMS-1", url);
  assert.equal(form.get("sNotifyURL"), url);
  assert.equal(queueFaxForm(CFG, textPdf(["x"]), "PMS-1").get("sNotifyURL"), null);
  // The destination guard is unaffected.
  assert.equal(form.get("sToFaxNumber"), "17785062042");
});

test("send registers the callback on https and says so; http (local dev) doesn't", async () => {
  const m = mockFetch(() => ({ Status: "Success", Result: "777" }));
  try {
    await withEnv(ENV, async () => {
      const a = await (await post("https://elk-inventory.vercel.app/api/npi-fax", { action: "send", destinationId: CONTROLLED.id, scenarioId: "A", reference: "PMS-CB1", letterhead: "pms" })).json();
      const b = await (await post("http://localhost:5201/api/npi-fax", { action: "send", destinationId: CONTROLLED.id, scenarioId: "A", reference: "PMS-CB2", letterhead: "pms" })).json();
      assert.equal(a.callbackRegistered, true);
      assert.equal(b.callbackRegistered, false);
    });
    assert.match(m.calls[0].get("sNotifyURL")!, /\?n=PMS-CB1&s=/);
    assert.equal(m.calls[1].get("sNotifyURL"), null);
  } finally { m.restore(); }
});

test("callback: a bad or missing token is refused before any SRFax call", async () => {
  const m = mockFetch(() => ({ Status: "Success", Result: [{}] }));
  try {
    await withEnv(ENV, async () => {
      for (const q of ["n=PMS-X&s=deadbeef", "n=PMS-X", `n=PMS-Y&s=${await notifyToken(CFG, "PMS-X")}`, "n=bad%20ref&s=x"]) {
        const res = await post(`https://h/api/npi-fax?${q}`, "FaxDetailsID=1&SentStatus=Sent", true);
        assert.equal(res.status, 403, q);
      }
    });
    assert.equal(m.calls.length, 0);
  } finally { m.restore(); }
  // Not configured → no processing at all.
  const res = await post("https://h/api/npi-fax?n=PMS-X&s=x", "FaxDetailsID=1", true);
  if (!process.env.SRFAX_ACCESS_ID) assert.equal(res.status, 503);
});

test("callback: body is only a claim — verified by re-reading Get_FaxStatus; duplicates are idempotent", async () => {
  callbacks.clear();
  let srfaxSays: Record<string, string> = { SentStatus: "Sent", AccountCode: "PMS-CB9", ToFaxNumber: "17785062042", Pages: "1" };
  const m = mockFetch((f) => (f.get("action") === "Get_FaxStatus" ? { Status: "Success", Result: [srfaxSays] } : { Status: "Failed", Result: "?" }));
  try {
    await withEnv(ENV, async () => {
      const url = `https://h/api/npi-fax?n=PMS-CB9&s=${await notifyToken(CFG, "PMS-CB9")}`;
      const body = "FaxDetailsID=9001&SentStatus=Sent&AccountCode=PMS-CB9&ToFaxNumber=17785062042&Pages=1";
      const first = await (await post(url, body, true)).json();
      assert.deepEqual({ ok: first.ok, verified: first.verified, duplicate: first.duplicate }, { ok: true, verified: true, duplicate: false });
      const again = await (await post(url, body, true)).json();
      assert.equal(again.duplicate, true);
      assert.equal(callbacks.get("9001")!.deliveries, 2);
      assert.equal(callbacks.get("9001")!.verified, true);
      // The status lookup carries what this instance saw.
      const tok = await statusToken(CFG, "9001");
      const st = await (await post("https://h/api/npi-fax", { action: "status", faxId: "9001", statusToken: tok })).json();
      assert.equal(st.callback.claimedStatus, "Sent");
      assert.equal(st.callback.verified, true);
      // A body claiming "Sent" that SRFax doesn't confirm is logged but NOT verified.
      srfaxSays = { SentStatus: "In Progress", AccountCode: "PMS-CB9", ToFaxNumber: "17785062042" };
      const url2 = `https://h/api/npi-fax?n=PMS-CB9&s=${await notifyToken(CFG, "PMS-CB9")}`;
      const liar = await (await post(url2, "FaxDetailsID=9002&SentStatus=Sent", true)).json();
      assert.equal(liar.verified, false);
      // A fax that isn't ours (different AccountCode) never verifies.
      srfaxSays = { SentStatus: "Sent", AccountCode: "SOMEONE-ELSE", ToFaxNumber: "17785062042" };
      assert.equal((await (await post(url2, "FaxDetailsID=9003&SentStatus=Sent", true)).json()).verified, false);
    });
  } finally { m.restore(); callbacks.clear(); }
});

// ── Endpoint receipt (controlled line's own inbox) ──────────────────────────

test("naive SRFax dates parse in both observed shapes", () => {
  assert.equal(naiveSeconds("2026-09-28 03:12:00") !== null, true);
  assert.equal(naiveSeconds("Sep 28/26 03:12 PM")! - naiveSeconds("Sep 28/26 03:12 AM")!, 12 * 3600);
  assert.equal(naiveSeconds("Sep 28/26 03:12 PM"), naiveSeconds("2026-09-28 15:12"));
  // Verbatim DateSent observed from production Get_FaxStatus (FaxDetailsID 1752976627).
  assert.equal(naiveSeconds("Sep 28, 2026 03:13 AM"), naiveSeconds("2026-09-28 03:13"));
  assert.equal(naiveSeconds("Sep 28, 2026 03:13 PM"), naiveSeconds("2026-09-28 15:13"));
  assert.equal(naiveSeconds("Sep 28, 2026 12:05 AM"), naiveSeconds("2026-09-28 00:05"));
  assert.equal(naiveSeconds("garbage"), null);
  assert.equal(naiveSeconds(null), null);
});

test("receipt: exactly one matching inbound fax (caller ID, pages, time) — otherwise nothing is claimed", () => {
  const sent = { callerId: "7785062042", pages: 1, dateSent: "2026-09-28 10:00:00" };
  const row = (o: Record<string, unknown>) => ({ CallerID: "7785062042", Pages: 1, Date: "2026-09-28 10:01:10", ReceiveStatus: "Ok", FileName: "secret|123", ViewedStatus: "N", ...o });
  const hit = matchReceipt({ Status: "Success", Result: [row({})] }, sent);
  assert.ok(!("error" in hit) && hit.found);
  assert.ok(!JSON.stringify(hit).includes("secret") && !JSON.stringify(hit).includes("Viewed"), "no file names, no read flag");
  for (const miss of [row({ CallerID: "2065550100" }), row({ Pages: 2 }), row({ Date: "2026-09-28 13:00:00" }), row({ Date: "2026-09-28 10:05:00" })]) {
    const r = matchReceipt({ Status: "Success", Result: [miss] }, sent);
    assert.ok(!("error" in r) && !r.found);
  }
  const amb = matchReceipt({ Status: "Success", Result: [row({}), row({ Date: "2026-09-28 09:59:30" })] }, sent);
  assert.ok(!("error" in amb) && !amb.found && /ambiguous/.test(amb.basis));
  // Production shape: two test sends five minutes apart are told apart.
  const prod = [row({ Date: "Sep 28, 2026 03:13 AM" }), row({ Date: "Sep 28, 2026 03:18 AM" }), row({ Date: "Sep 28, 2026 02:40 AM" })];
  const second = matchReceipt({ Status: "Success", Result: prod }, { callerId: "7785062042", pages: 1, dateSent: "Sep 28, 2026 03:18 AM", duration: 1 });
  assert.ok(!("error" in second) && second.found && second.receivedAt === "Sep 28, 2026 03:18 AM");
  const noDate = matchReceipt({ Status: "Success", Result: [row({})] }, { ...sent, dateSent: null });
  assert.ok(!("error" in noDate) && !noDate.found);
  assert.ok("error" in matchReceipt({ Status: "Failed", Result: "bad creds" }, sent));
});

test("receipt action needs the status token and only looks once SRFax says Sent", async () => {
  const m = mockFetch((f) => f.get("action") === "Get_FaxStatus"
    ? { Status: "Success", Result: [{ SentStatus: "Sent", Pages: "1", DateSent: "2026-09-28 10:00:00", ToFaxNumber: "17785062042" }] }
    : { Status: "Success", Result: [{ CallerID: "7785062042", Pages: 1, Date: "2026-09-28 10:00:40" }] });
  try {
    await withEnv(ENV, async () => {
      assert.equal((await post("https://h/api/npi-fax", { action: "receipt", faxId: "55" })).status, 403);
      const r = await (await post("https://h/api/npi-fax", { action: "receipt", faxId: "55", statusToken: await statusToken(CFG, "55") })).json();
      assert.equal(r.receipt.found, true);
    });
    assert.deepEqual(m.calls.map((c) => c.get("action")), ["Get_FaxStatus", "Get_Fax_Inbox"]);
    assert.equal(m.calls[1].get("sPeriod"), "RANGE");
  } finally { m.restore(); }
});

// ── Outbox lifecycle wording ────────────────────────────────────────────────

const status = (sentStatus: string, extra: Record<string, unknown> = {}) => ({ ok: true as const, checkedAt: "2026-09-28T18:00:05Z", status: { sentStatus, phase: sentStatus === "Sent" ? "sent" as const : sentStatus === "Failed" ? "failed" as const : "in_progress" as const, dateQueued: null, dateSent: null, epochTime: null, toFaxNumber: "17785062042", pages: 1, duration: 30, errorCode: null, remoteId: null, ...extra } });

function liveItem(l: LiveFax): OutboxItem {
  const st = freshState();
  return { ...createOutbox(st, controlledDestination(), "live", l), live: l };
}

test("live lifecycle: Preparing → Queued → Sending → Sent → Received by endpoint, each backed by SRFax evidence", () => {
  let l = newLiveFax("PMS-LIFE");
  assert.equal(transportOf(liveItem(l)).state, "preparing");
  l = applySend(l, { ok: true, faxId: "321", statusToken: "t", to: "17785062042", submittedAt: "2026-09-28T18:00:00Z", callbackRegistered: true });
  assert.equal(transportOf(liveItem(l)).label, "Queued");
  assert.equal(l.callbackRegistered, true);
  l = applyStatus(l, status("In Progress"));
  assert.equal(transportOf(liveItem(l)).label, "Sending");
  l = applyStatus(l, status("Sent"));
  const sent = transportOf(liveItem(l));
  assert.equal(sent.label, "Sent");
  assert.match(sent.claim, /transmission completed/);
  // A receipt miss or lookup failure never changes "Sent".
  l = applyReceipt(l, { ok: false, error: "x" });
  l = applyReceipt(l, { ok: true, checkedAt: "t", receipt: { found: false, receivedAt: null, pages: null, receiveStatus: null, basis: "b" } });
  assert.equal(transportOf(liveItem(l)).label, "Sent");
  l = applyReceipt(l, { ok: true, checkedAt: "t", receipt: { found: true, receivedAt: "2026-09-28 10:01", pages: 1, receiveStatus: "Ok", basis: "b" } });
  const rec = transportOf(liveItem(l));
  assert.equal(rec.label, "Received by endpoint");
  // Never read / reviewed / accepted — those only ever appear as NOT proven.
  for (const t of [sent, rec]) {
    assert.ok(!/\bread\b|reviewed|accepted|delivered/i.test(`${t.label} ${t.claim}`), t.claim);
    assert.ok(t.notProven.some((x) => /read/.test(x)) && t.notProven.some((x) => /accepted/.test(x)));
  }
  assert.equal(applyStatus(l, status("Failed", { errorCode: "No Answer" })).phase, "failed");
  assert.equal(transportOf(liveItem(applyStatus(newLiveFax("F"), status("Failed", { errorCode: "No Answer" })))).label, "Failed");
  assert.equal(transportOf(liveItem(applySend(newLiveFax("E"), { ok: false, error: "SRFax: bad" }))).label, "Not sent");
});

test("callback observations are recorded once, as events, without changing the polled status", () => {
  let l = applySend(newLiveFax("PMS-CBE"), { ok: true, faxId: "1", statusToken: "t", to: "x", submittedAt: "2026-09-28T18:00:00Z" });
  const cb = { receivedAt: "2026-09-28T18:00:40Z", claimedStatus: "Sent", verifiedStatus: "Sent", verified: true, deliveries: 1 };
  l = applyStatus(l, { ...status("Sent"), callback: cb });
  l = applyStatus(l, { ...status("Sent"), callback: cb });
  assert.equal(l.events.filter((e) => e.label === "SRFax completion callback").length, 1);
  assert.equal(l.phase, "sent");
});

test("real providers: simulated timeline, labelled simulated, never 'Received by endpoint'", () => {
  const st = freshState();
  const o = createOutbox(st, REAL, "simulated", null, new Date("2026-09-28T18:00:00Z"));
  const t0 = Date.parse(o.createdAt);
  assert.deepEqual([0, 2000, 4000, 8000, 60000].map((d) => simulatedState(o.createdAt, t0 + d)), ["preparing", "queued", "sending", "sent", "sent"]);
  const t = transportOf(o, t0 + 60000);
  assert.equal(t.label, "Sent (simulated)");
  assert.match(t.claim, /SIMULATED — nothing was transmitted/);
  assert.equal(o.live, null);
});

test("referral status in the PMS follows the evidence, and 'Response received' only after confirmation", () => {
  let st: PmsState = freshState();
  assert.match(referralStatus(st).label, /Referral required/);
  st = { ...st, referral: { ...st.referral, destination: controlledDestination() } };
  assert.match(referralStatus(st).label, /Destination selected — not sent/);
  const l = applyStatus(applySend(newLiveFax("PMS-RS"), { ok: true, faxId: "1", statusToken: "t", to: "x", submittedAt: "2026-09-28T18:00:00Z" }), status("Sent"));
  const item = liveItem(l);
  st = { ...st, outbox: [item], referral: { ...st.referral, outboxId: item.id } };
  assert.equal(referralStatus(st).label, "Fax sent — awaiting response");
  st = { ...st, referral: { ...st.referral, response: { inboxId: "IN-1", receivedAt: "t", confirmedAt: "2026-09-28T18:05:00Z", summary: "s", followUp: null } } };
  assert.equal(referralStatus(st).label, "Response received");
});

// ── Inbound: simulated adapter → boundary → pipeline → proposal ─────────────

function sentState(dest: Destination): PmsState {
  const st = freshState();
  const item = createOutbox({ ...st }, dest, dest.kind === "controlled" ? "live" : "simulated", null, new Date("2026-09-28T18:00:00Z"));
  return { ...st, outbox: [item], referral: { ...st.referral, destination: dest, outboxId: item.id } };
}

test("simulated inbound fax: synthetic, from the controlled destination only, idempotent at the boundary", () => {
  const st = sentState(controlledDestination());
  const ev = simulatedInboundEvent(st.outbox[0], new Date("2026-09-28T18:10:00Z"));
  assert.equal(ev.source, "simulated");
  assert.equal(ev.fromFax, CONTROLLED.fax);
  assert.match(ev.document.lines[0], /SIMULATED INBOUND FAX - SYNTHETIC - NO REAL PATIENT INFORMATION/);
  const text = ev.document.lines.join("\n");
  assert.ok(!text.includes(REAL.provider) && !/\b\d{10}\b/.test(text));
  const a = receiveInboundFax([], ev);
  const b = receiveInboundFax(a.inbox, ev);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(b.inbox.length, 1);
  assert.equal(a.item.stage, "received");
  assert.equal(a.item.processing, null, "nothing is processed or filed on arrival");
});

test("OCR + extraction are labelled simulated; every extracted value cites its source line", () => {
  const st = sentState(controlledDestination());
  const ev = simulatedInboundEvent(st.outbox[0], new Date("2026-09-28T18:10:00Z"));
  const ocr = simulatedOcr(ev.document);
  assert.match(ocr.engine, /^SIMULATED OCR/);
  const x = extractFields(ocr.text);
  assert.match(x.engine, /^SIMULATED AI extraction/);
  const get = (k: string) => x.fields.find((f) => f.key === k)!;
  assert.equal(get("patient").value, "Jamie Example");
  assert.equal(get("dob").value, "01/01/1980");
  assert.equal(get("reference").value, st.outbox[0].id);
  assert.equal(get("docType").value, "Referral response");
  assert.equal(get("date").value, "2026-09-28");
  for (const f of x.fields) if (f.value) assert.ok(f.evidence && ocr.text.includes(f.evidence), f.key);
  // Follow-up is only extracted when explicitly stated.
  const noFollow = extractFields(ocr.text.replace(/^Follow-up:.*$/m, ""));
  assert.equal(noFollow.fields.find((f) => f.key === "followUp")!.value, null);
});

test("match proposal: all checks pass for the controlled referral; nothing is proposed without name AND DOB", () => {
  const st = sentState(controlledDestination());
  const item = receiveInboundFax([], simulatedInboundEvent(st.outbox[0])).item;
  const p = processDocument(item, st.referral, st.outbox);
  assert.equal(p.match.found, true);
  assert.equal(p.match.score, 100);
  assert.equal(p.match.patientRef, PMS_PATIENT.ref);
  assert.equal(p.match.appointmentId, "APT-DEMO-0928");
  assert.ok(p.match.update.some((u) => /Response received/.test(u)));
  // Different DOB → no proposal at all.
  const x = extractFields(p.ocr.text.replace("DOB: 01/01/1980", "DOB: 02/02/1990"));
  const q = proposeMatch(x, st.referral, st.outbox);
  assert.equal(q.found, false);
  assert.deepEqual(q.update, []);
});

test("match proposal is honest when the referral went to a real provider (simulated send)", () => {
  const st = sentState(REAL);
  const item = receiveInboundFax([], simulatedInboundEvent(st.outbox[0])).item;
  const p = processDocument(item, st.referral, st.outbox);
  const faxCheck = p.match.checks.find((c) => /Responding fax/.test(c.label))!;
  assert.equal(faxCheck.ok, false, "a response from the synthetic line doesn't match a real destination's fax");
  assert.ok(p.match.score < 100);
  // …so it may be filed to the chart, but it is never recorded as that provider's response.
  assert.equal(p.match.found, true);
  assert.equal(p.match.referralId, null);
  assert.ok(!p.match.update.some((u) => /Response received/.test(u)));
});

// ── Embed boundary ──────────────────────────────────────────────────────────

test("embed: referral type resolves from the clinician's choice, never substituted", () => {
  assert.equal(resolveReferralType("ENT"), "ENT / Otolaryngology");
  assert.equal(resolveReferralType("ent"), "ENT / Otolaryngology");
  assert.equal(resolveReferralType("Neurology"), "Neurology");
  assert.equal(resolveReferralType("Cardiology"), null);
  assert.equal(resolveReferralType(""), null);
});

test("embed SDK: postMessage boundary with origin + source checks, no context in the URL, isolated frame", () => {
  const sdk = readFileSync(new URL("../public/npi-sdk/provider-intelligence.js", import.meta.url), "utf8");
  assert.match(sdk, /ev\.source !== frame\.contentWindow \|\| ev\.origin !== PI_ORIGIN/);
  assert.match(sdk, /setAttribute\("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"\)/);
  assert.match(sdk, /frame\.src = PI_ORIGIN \+ PI_PATH;/);
  assert.match(sdk, /postMessage\(\{ protocol: PROTOCOL, type: "init"[^}]*\}, PI_ORIGIN\)/);
  assert.match(sdk, /attachShadow/);
  const page = readFileSync(new URL("../src/npi/pms/EmbedPI.tsx", import.meta.url), "utf8");
  assert.match(page, /ev\.source !== window\.parent \|\| !ALLOWED_HOSTS\.includes\(ev\.origin\)/);
  assert.match(page, /type: "destination:selected", destination \}, init\.origin\)/);
  // The embedded UI is the existing finder, not a second one.
  assert.match(page, /import Specialists from "\.\.\/demo\/Specialists"/);
});

test("PMS data is visibly synthetic", () => {
  assert.match(PMS_PATIENT.email, /\.invalid$/);
  for (const n of [PMS_PATIENT.phone, PMS_CLINIC.phone, PMS_CLINIC.fax]) assert.match(n, /\(555\) 010-/);
  assert.equal(PMS_PATIENT.name, "Jamie Example");
});
