// ── /api/npi-provider?npi=[&lat=&lon=&radius=&specialty=] — TEMPORARY NPI demo ─
// GET: registry + licence baseline view. POST { research }: the same view
// re-scored with research the browser already holds (no OpenAI call), so a
// cached result can be shown for a different search origin.
import { getProvider, json } from "./_npi-lib.ts";
import { buildView, licenseFor, originFrom, specialtyFromParam } from "./_npi-referral.ts";
import type { ReferralResearch } from "../src/npi/types";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const p = new URL(req.url).searchParams;
  const npi = (p.get("npi") ?? "").replace(/\D/g, "");
  if (npi.length !== 10) return json({ error: "An NPI is exactly 10 digits." }, 400);
  let research: ReferralResearch | null = null;
  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    research = body?.research?.npi === npi ? body.research : null;
  }
  try {
    const provider = await getProvider(npi);
    if (!provider) return json({ error: "No active provider has this NPI." }, 404);
    const view = await buildView(provider, research, { ...originFrom(p), specialty: specialtyFromParam(p.get("specialty")), license: await licenseFor(provider) });
    return json(view, 200, req.method === "GET" ? { "Cache-Control": "public, s-maxage=3600" } : {});
  } catch (err) {
    console.error("[npi-provider]", (err as Error).message);
    return json({ error: "The NPI Registry didn't respond. Try again in a moment." }, 502);
  }
}
