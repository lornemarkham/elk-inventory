// ── /api/npi-nearby?specialty=&location=&radius= — TEMPORARY NPI demo ─────────
// Geographic referral search. Free public APIs only (see api/_npi-nearby.ts).
import { json } from "./_npi-lib.ts";
import { NearbyError, RADII, searchNearby } from "./_npi-nearby.ts";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const p = new URL(req.url).searchParams;
  const specialty = (p.get("specialty") ?? "").trim().slice(0, 60);
  const location = (p.get("location") ?? "").trim().slice(0, 120);
  const radius = Number(p.get("radius") ?? 10);
  if (!specialty || !location) return json({ error: "Enter a specialty and a location." }, 400);
  if (!RADII.includes(radius)) return json({ error: `Radius must be one of ${RADII.join(", ")} miles.` }, 400);
  try {
    return json(await searchNearby(specialty, location, radius), 200, { "Cache-Control": "public, s-maxage=3600" });
  } catch (err) {
    if (err instanceof NearbyError) return json({ error: err.message }, 422);
    console.error("[npi-nearby]", (err as Error).message);
    return json({ error: "A public data source (NPPES, Census geocoder or WA DOH) didn't respond. Try again in a moment." }, 502);
  }
}
