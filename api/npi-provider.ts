// ── /api/npi-provider?npi= — TEMPORARY NPI demo (see api/_npi-lib.ts) ─────────
import { getProvider, json, scoreProvider } from "./_npi-lib";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const npi = (new URL(req.url).searchParams.get("npi") ?? "").replace(/\D/g, "");
  if (npi.length !== 10) return json({ error: "An NPI is exactly 10 digits." }, 400);
  try {
    const provider = await getProvider(npi);
    if (!provider) return json({ error: "No active provider has this NPI." }, 404);
    return json({ provider, baseline: scoreProvider(provider, null) }, 200, { "Cache-Control": "public, s-maxage=3600" });
  } catch (err) {
    console.error("[npi-provider]", (err as Error).message);
    return json({ error: "The NPI Registry didn't respond. Try again in a moment." }, 502);
  }
}
