// ── /api/npi-fax — CONTROLLED live test fax (TEMPORARY, SYNTHETIC ONLY) ───────
// POST JSON:
//   { action: "config" }                                  → is SRFax configured here? (no secrets)
//   { action: "send", destinationId, scenarioId, reference } → Queue_Fax to the controlled number only
//   { action: "status", faxId, statusToken }              → Get_FaxStatus (+ callback seen by this instance, if any)
//   { action: "receipt", faxId, statusToken }             → did the controlled endpoint's inbox receive it? (Get_Fax_Inbox, own fax only)
//   send also takes letterhead: "demo" | "pms" (a fixed server-side clinic header).
// SRFax completion callback: POST /api/npi-fax?n=<reference>&s=<token> (sNotifyURL,
// registered with each send when this server has a public https origin).
// No access key (private POC): the boundary is that only the controlled
// synthetic destination id may send, the number is fixed server-side
// (api/_npi-fax.ts), the PDF is built here from a canned scenario, and sends
// are rate limited. status needs the token issued with the send.
// An SRFax failure is returned as a failure.
import { LIVE_TO, SRFAX_URL, faxInboxForm, faxStatusForm, letterheadOf, matchReceipt, notifyToken, notifyUrl, parseNotify, safeEqual, statusToken, liveDestinationAllowed, parseQueue, parseStatus, queueFaxForm, referralLines, srfaxConfig, textPdf, type SrfaxConfig } from "./_npi-fax";
import { CONTROLLED_FAX } from "../src/npi/demo/controlled";

export const config = { runtime: "edge" };

// Best-effort brake per isolate (the real limit is the POC owner's discipline).
const MAX_SENDS_PER_HOUR = 3;
const sends: number[] = [];

// Completion callbacks this isolate has processed, keyed by FaxDetailsID. There is
// no database in this POC, so this is best-effort memory: a status lookup served
// by a different instance simply won't see it, and polling remains the source of
// truth. Duplicate deliveries of the same (fax, status) are recognised and ignored.
export interface CallbackRecord { receivedAt: string; reference: string; claimedStatus: string; verifiedStatus: string | null; verified: boolean; deliveries: number }
export const callbacks = new Map<string, CallbackRecord>();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function srfax(form: URLSearchParams): Promise<unknown> {
  const res = await fetch(SRFAX_URL, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { Status: "Failed", Result: `HTTP ${res.status} — non-JSON response` }; }
}

// SRFax → us. Never trusts the body: it must carry our token for that reference,
// and the status is re-read from SRFax with our own credentials before it counts.
async function handleCallback(req: Request, url: URL, cfg: SrfaxConfig | null): Promise<Response> {
  const at = new Date().toISOString();
  const reference = url.searchParams.get("n") ?? "";
  const audit = (o: Record<string, unknown>) => console.log(JSON.stringify({ evt: "srfax.notify", at, reference, ...o }));
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!cfg) return json({ ok: false, code: "not_configured" }, 503);
  if (!/^[A-Z0-9-]{1,20}$/i.test(reference) || !safeEqual(url.searchParams.get("s") ?? "", await notifyToken(cfg, reference))) {
    audit({ outcome: "rejected_token" });
    return json({ ok: false, code: "forbidden" }, 403);
  }
  const raw = await req.text();
  let vars: URLSearchParams;
  try { vars = raw.trim().startsWith("{") ? new URLSearchParams(Object.entries(JSON.parse(raw) as Record<string, string>).map(([k, v]) => [k, String(v)])) : new URLSearchParams(raw); }
  catch { audit({ outcome: "unparseable" }); return json({ ok: false, error: "unparseable" }, 400); }
  const { faxId, claimed } = parseNotify(vars);
  if (!faxId) { audit({ outcome: "no_fax_id" }); return json({ ok: false, error: "FaxDetailsID required" }, 400); }
  const claimedStatus = claimed.ok ? claimed.status.sentStatus : "";
  let verifiedStatus: string | null = null;
  let verified = false;
  try {
    const v = parseStatus(await srfax(faxStatusForm(cfg, faxId)));
    if (v.ok) {
      verifiedStatus = v.status.sentStatus;
      // Ours, to the controlled number, and SRFax agrees with what was posted.
      verified = v.status.accountCode === reference && (v.status.toFaxNumber ?? "").replace(/\D/g, "").endsWith(LIVE_TO.slice(1)) && verifiedStatus === claimedStatus;
    }
  } catch (err) { audit({ outcome: "verify_unreachable", faxId, error: (err as Error).message }); }
  const prev = callbacks.get(faxId);
  const duplicate = Boolean(prev && prev.claimedStatus === claimedStatus);
  callbacks.set(faxId, { receivedAt: prev?.receivedAt ?? at, reference, claimedStatus, verifiedStatus, verified: verified || Boolean(prev?.verified && duplicate), deliveries: (prev?.deliveries ?? 0) + 1 });
  audit({ outcome: verified ? "verified" : "unverified", faxId, claimedStatus, verifiedStatus, duplicate });
  // 200 either way once authenticated, so SRFax doesn't retry a callback we have logged.
  return json({ ok: true, duplicate, verified });
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.searchParams.has("n")) return handleCallback(req, url, srfaxConfig());
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const cfg = srfaxConfig();

  if (body.action === "config") return json({ ok: true, configured: Boolean(cfg), destination: CONTROLLED_FAX });

  if (body.action === "send") {
    // Destination check first: a real provider never gets further than this.
    if (!liveDestinationAllowed(body.destinationId)) return json({ ok: false, code: "forbidden", error: "Live fax is only available for the controlled synthetic test destination. Real providers are always simulated." }, 403);
    if (!cfg) return json({ ok: false, code: "not_configured", error: "SRFax is not configured on this server (SRFAX_ACCESS_ID, SRFAX_ACCESS_PWD, SRFAX_CALLER_ID, SRFAX_SENDER_EMAIL)." }, 503);
    const reference = String(body.reference ?? "").replace(/[^A-Z0-9-]/gi, "").slice(0, 20) || "SYNTH-TEST";
    const lines = referralLines(String(body.scenarioId ?? ""), reference, new Date(), letterheadOf(body.letterhead));
    if (!lines) return json({ ok: false, error: "Unknown synthetic scenario" }, 400);
    const now = Date.now();
    while (sends.length && now - sends[0] > 3600_000) sends.shift();
    if (sends.length >= MAX_SENDS_PER_HOUR) return json({ ok: false, code: "rate_limited", error: "Live test fax limit reached. Try again later." }, 429);
    sends.push(now);
    const submittedAt = new Date().toISOString();
    try {
      const notify = await notifyUrl(cfg, url.origin, reference);
      const r = parseQueue(await srfax(queueFaxForm(cfg, textPdf(lines), reference, notify)));
      return r.ok ? json({ ok: true, faxId: r.faxId, statusToken: await statusToken(cfg, r.faxId), to: LIVE_TO, submittedAt, callbackRegistered: Boolean(notify) }) : json({ ok: false, error: r.error, submittedAt }, 502);
    } catch (err) {
      console.error("[npi-fax] send", (err as Error).message);
      return json({ ok: false, error: "Couldn't reach SRFax — the fax may or may not have been queued. Check the SRFax portal before retrying.", submittedAt }, 502);
    }
  }

  if (body.action === "status" || body.action === "receipt") {
    if (!cfg) return json({ ok: false, code: "not_configured", error: "SRFax is not configured on this server." }, 503);
    const faxId = String(body.faxId ?? "").replace(/\D/g, "");
    if (!faxId) return json({ ok: false, error: "faxId required" }, 400);
    if (body.statusToken !== (await statusToken(cfg, faxId))) return json({ ok: false, code: "forbidden", error: "Status is only available for faxes sent from this demo." }, 403);
    try {
      const r = parseStatus(await srfax(faxStatusForm(cfg, faxId)));
      if (!r.ok) return json({ ok: false, error: r.error }, 502);
      if (body.action === "status") return json({ ok: true, checkedAt: new Date().toISOString(), status: r.status, callback: callbacks.get(faxId) ?? null });
      if (r.status.phase !== "sent") return json({ ok: true, checkedAt: new Date().toISOString(), receipt: { found: false, receivedAt: null, pages: null, receiveStatus: null, basis: "not checked: SRFax does not report the fax as Sent" } });
      const sent = Date.now();
      const m = matchReceipt(await srfax(faxInboxForm(cfg, new Date(sent - 86400_000), new Date(sent + 86400_000))), { callerId: cfg.callerId, pages: r.status.pages, dateSent: r.status.dateSent, duration: r.status.duration });
      return "error" in m ? json({ ok: false, error: m.error }, 502) : json({ ok: true, checkedAt: new Date().toISOString(), receipt: m });
    } catch (err) {
      console.error("[npi-fax] status", (err as Error).message);
      return json({ ok: false, error: "Couldn't reach SRFax for status." }, 502);
    }
  }

  return json({ ok: false, error: "Unknown action" }, 400);
}
