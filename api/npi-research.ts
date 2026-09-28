// ── /api/npi-research?npi=[&fresh=1&lat=&lon=&radius=&specialty=] — TEMPORARY ─
// Outbound-referral web research for one provider. Streams newline-delimited
// JSON ResearchEvents (progress + keeps the Edge 25s first-byte limit happy).
// Paid OpenAI calls: requires the demo key (X-Demo-Key) — see api/_npi-guard.ts.
import { clientIp, demoKeyOk, takeResearchSlot } from "./_npi-guard";
import { buildView, licenseFor, originFrom, researchProvider, specialtyFromParam } from "./_npi-referral";
import type { ResearchEvent } from "../src/npi/types";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const npi = (params.get("npi") ?? "").replace(/\D/g, "");
  const fresh = params.get("fresh") === "1";
  const enc = new TextEncoder();
  const keyOk = await demoKeyOk(req);

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ResearchEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      const ping = setInterval(() => emit({ type: "ping" }), 8000);
      try {
        if (npi.length !== 10) emit({ type: "error", message: "An NPI is exactly 10 digits." });
        else if (!keyOk) emit({ type: "error", code: "locked", message: "AI research uses paid AI calls and is limited to authorized operators in this POC." });
        else {
          const r = await researchProvider(npi, fresh, emit, () => takeResearchSlot(clientIp(req)));
          if (r) {
            const view = await buildView(r.provider, r.research, { ...originFrom(params), specialty: specialtyFromParam(params.get("specialty")), license: await licenseFor(r.provider) });
            emit({ type: "result", view });
          }
        }
      } catch (err) {
        console.error("[npi-research]", (err as Error).message);
        const timedOut = (err as Error).name === "TimeoutError";
        emit({ type: "error", message: timedOut ? "Web research took too long. Try again." : "Web research failed. NPI and licence data are unaffected." });
      } finally {
        clearInterval(ping);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
