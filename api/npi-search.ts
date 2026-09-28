// ── /api/npi-search?q= — TEMPORARY NPI demo (see api/_npi-lib.ts) ─────────────
import { json, searchProviders } from "./_npi-lib";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 120);
  if (!q) return json({ error: "Enter a provider name, NPI, specialty or location." }, 400);
  try {
    return json(await searchProviders(q), 200, { "Cache-Control": "public, s-maxage=3600" });
  } catch (err) {
    console.error("[npi-search]", (err as Error).message);
    return json({ error: "The NPI Registry didn't respond. Try again in a moment." }, 502);
  }
}
