// ── /api/npi-validate?npi=[&fresh=1] — TEMPORARY NPI demo ─────────────────────
// Streams newline-delimited JSON ValidationEvents so the UI can show real
// progress, and so the Edge runtime's 25s first-byte limit never bites while
// web research runs. OPENAI_API_KEY is read in api/_npi-lib.ts, server-side only.
import { validateProvider } from "./_npi-lib";
import type { ValidationEvent } from "../src/npi/types";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const npi = (params.get("npi") ?? "").replace(/\D/g, "");
  const fresh = params.get("fresh") === "1";
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ValidationEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      const ping = setInterval(() => emit({ type: "ping" }), 8000);
      try {
        if (npi.length !== 10) emit({ type: "error", message: "An NPI is exactly 10 digits." });
        else await validateProvider(npi, fresh, emit);
      } catch (err) {
        console.error("[npi-validate]", (err as Error).message);
        const timedOut = (err as Error).name === "TimeoutError";
        emit({ type: "error", message: timedOut ? "Independent research took too long. Try again." : "Independent research failed. The NPI Registry data is unaffected." });
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
