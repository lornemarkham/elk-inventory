// ── /api/npi-fax — CONTROLLED live test fax (TEMPORARY, SYNTHETIC ONLY) ───────
// POST JSON:
//   { action: "config" }                                  → is SRFax configured here? (no secrets)
//   { action: "send", destinationId, scenarioId, reference } → Queue_Fax to the controlled number only
//   { action: "status", faxId }                           → Get_FaxStatus
// send/status need the demo key (X-Demo-Key). Real providers are refused: only
// the controlled synthetic destination id may send, and the number is fixed
// server-side (api/_npi-fax.ts). An SRFax failure is returned as a failure.
import { demoKeyOk } from "./_npi-guard";
import { LIVE_TO, SRFAX_URL, faxStatusForm, liveDestinationAllowed, parseQueue, parseStatus, queueFaxForm, referralLines, srfaxConfig, textPdf } from "./_npi-fax";
import { CONTROLLED_FAX } from "../src/npi/demo/controlled";

export const config = { runtime: "edge" };

// Best-effort brake per isolate (the real limit is the POC owner's discipline).
const MAX_SENDS_PER_HOUR = 3;
const sends: number[] = [];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function srfax(form: URLSearchParams): Promise<unknown> {
  const res = await fetch(SRFAX_URL, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { Status: "Failed", Result: `HTTP ${res.status} — non-JSON response` }; }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const cfg = srfaxConfig();

  if (body.action === "config") return json({ ok: true, configured: Boolean(cfg), destination: CONTROLLED_FAX });

  if (body.action === "send") {
    // Destination check first: a real provider never gets further than this.
    if (!liveDestinationAllowed(body.destinationId)) return json({ ok: false, code: "forbidden", error: "Live fax is only available for the controlled synthetic test destination. Real providers are always simulated." }, 403);
    if (!(await demoKeyOk(req))) return json({ ok: false, code: "locked", error: "Live test fax needs the demo access key." }, 401);
    if (!cfg) return json({ ok: false, code: "not_configured", error: "SRFax is not configured on this server (SRFAX_ACCESS_ID, SRFAX_ACCESS_PWD, SRFAX_CALLER_ID, SRFAX_SENDER_EMAIL)." }, 503);
    const reference = String(body.reference ?? "").replace(/[^A-Z0-9-]/gi, "").slice(0, 20) || "SYNTH-TEST";
    const lines = referralLines(String(body.scenarioId ?? ""), reference);
    if (!lines) return json({ ok: false, error: "Unknown synthetic scenario" }, 400);
    const now = Date.now();
    while (sends.length && now - sends[0] > 3600_000) sends.shift();
    if (sends.length >= MAX_SENDS_PER_HOUR) return json({ ok: false, code: "rate_limited", error: "Live test fax limit reached. Try again later." }, 429);
    sends.push(now);
    const submittedAt = new Date().toISOString();
    try {
      const r = parseQueue(await srfax(queueFaxForm(cfg, textPdf(lines), reference)));
      return r.ok ? json({ ok: true, faxId: r.faxId, to: LIVE_TO, submittedAt }) : json({ ok: false, error: r.error, submittedAt }, 502);
    } catch (err) {
      console.error("[npi-fax] send", (err as Error).message);
      return json({ ok: false, error: "Couldn't reach SRFax — the fax may or may not have been queued. Check the SRFax portal before retrying.", submittedAt }, 502);
    }
  }

  if (body.action === "status") {
    if (!(await demoKeyOk(req))) return json({ ok: false, code: "locked", error: "Needs the demo access key." }, 401);
    if (!cfg) return json({ ok: false, code: "not_configured", error: "SRFax is not configured on this server." }, 503);
    const faxId = String(body.faxId ?? "").replace(/\D/g, "");
    if (!faxId) return json({ ok: false, error: "faxId required" }, 400);
    try {
      const r = parseStatus(await srfax(faxStatusForm(cfg, faxId)));
      return r.ok ? json({ ok: true, checkedAt: new Date().toISOString(), status: r.status }) : json({ ok: false, error: r.error }, 502);
    } catch (err) {
      console.error("[npi-fax] status", (err as Error).message);
      return json({ ok: false, error: "Couldn't reach SRFax for status." }, 502);
    }
  }

  return json({ ok: false, error: "Unknown action" }, 400);
}
