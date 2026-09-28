// ── /api/npi-discover?npi=&lat=&lon=&radius=&specialty=[&org=…&city=&state=] — TEMPORARY ─
// Cheap public-web corroboration for ONE registry candidate (api/_npi-discover.ts):
// one Brave search, ≤2 fetched pages, deterministic checks, re-scored with the
// existing model. No AI, so no access key; Brave usage is bounded per call.
// GET ?probe=1 → { configured } (is BRAVE_SEARCH_API_KEY set? no secrets).
import { getProvider, json } from "./_npi-lib";
import { buildView, licenseFor, originFrom, specialtyFromParam } from "./_npi-referral";
import { discoverProvider } from "./_npi-discover";
import type { DiscoverResponse } from "../src/npi/types";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const p = new URL(req.url).searchParams;
  if (p.get("probe") === "1") return json({ configured: Boolean(process.env.BRAVE_SEARCH_API_KEY) }, 200, { "Cache-Control": "no-store" });
  const npi = (p.get("npi") ?? "").replace(/\D/g, "");
  if (npi.length !== 10) return json({ error: "An NPI is exactly 10 digits." }, 400);
  const orgs = p.getAll("org").map((o) => o.trim().slice(0, 120)).filter(Boolean).slice(0, 3);
  const city = (p.get("city") ?? "").slice(0, 60), state = (p.get("state") ?? "").toUpperCase().slice(0, 2);
  try {
    const provider = await getProvider(npi);
    if (!provider) return json({ error: "No active provider has this NPI." }, 404);
    const def = specialtyFromParam(p.get("specialty"));
    const { log, research } = await discoverProvider(provider, def, { orgs }, city && state ? { city, state } : null);
    const view = research ? await buildView(provider, research, { ...originFrom(p), specialty: def, license: await licenseFor(provider) }) : null;
    const body: DiscoverResponse = { log, view };
    return json(body, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("[npi-discover]", (err as Error).message);
    return json({ error: "The public-web check failed. Registry data is unaffected." }, 502);
  }
}
