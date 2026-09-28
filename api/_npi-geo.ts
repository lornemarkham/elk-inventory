// ── NPI demo — geography + specialty aliases (TEMPORARY DEMO) ─────────────────
// Origin geocoding, provider-address geocoding and distance. No keys, no deps:
//   - US Census Geocoder (street addresses; one-line + batch)   geocoding.geo.census.gov
//   - Zippopotam.us (ZIP → centroid; city+state → its ZIPs)     api.zippopotam.us
// Distances are great-circle (Haversine) miles, computed here, never estimated.

import type { Coords, Origin } from "../src/npi/types";

const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations";
const ZIPPO = "https://api.zippopotam.us/us";

// ── Specialty aliases ────────────────────────────────────────────────────────
// Small explicit alias layer: plain words → NPPES taxonomy search + the exact
// taxonomy codes that count as a match. Candidates are filtered by CODE, so a
// word search in NPPES can never silently broaden "ENT" into another specialty.

export interface SpecialtyDef {
  key: string;
  label: string;
  nppesQuery: string; // taxonomy_description sent to NPPES
  codes: string[]; // taxonomy code prefixes that qualify
  aliases: RegExp;
}

export const SPECIALTY_DEFS: SpecialtyDef[] = [
  { key: "otology", label: "Otology & Neurotology", nppesQuery: "Otolaryngology", codes: ["207YX0901X"], aliases: /^(otolog(y|ists?)|neurotolog(y|ists?)|otology (and|&) neurotology|ear surgeons?)$/i },
  { key: "peds-ent", label: "Pediatric Otolaryngology", nppesQuery: "Otolaryngology", codes: ["207YP0228X"], aliases: /^(pediatric (ent|otolaryngology|otolaryngologists?)|peds ent)$/i },
  { key: "ent", label: "Otolaryngology (ENT)", nppesQuery: "Otolaryngology", codes: ["207Y"], aliases: /^(ent|e\.n\.t\.?|otolaryngolog(y|ists?)|otorhinolaryngolog(y|ists?)|ear,? nose (and|&) throat( doctors?| specialists?)?|ent \/ otolaryngology|otolaryngology \(ent\))$/i },
  { key: "audiology", label: "Audiologist", nppesQuery: "Audiologist", codes: ["231H", "237600000X"], aliases: /^(audiolog(y|ists?)|hearing (doctors?|tests?|testing))$/i },
  { key: "hearing-aid", label: "Hearing Instrument Specialist", nppesQuery: "Hearing Instrument Specialist", codes: ["237700000X"], aliases: /^(hearing (aid|instrument) (specialists?|dispensers?|fitters?)|hearing aids?)$/i },
  { key: "slp", label: "Speech-Language Pathologist", nppesQuery: "Speech-Language Pathologist", codes: ["235Z"], aliases: /^(speech(-| )language patholog(y|ists?)|slp|speech therap(y|ists?))$/i },
  { key: "neurology", label: "Neurology", nppesQuery: "Neurology", codes: ["2084N0400X", "2084N0402X", "2084N0008X"], aliases: /^(neurolog(y|ists?))$/i },
  { key: "allergy", label: "Allergy & Immunology", nppesQuery: "Allergy", codes: ["207K"], aliases: /^(allerg(y|ists?)|allergy (and|&) immunology|immunolog(y|ists?))$/i },
];

export function resolveSpecialty(input: string): SpecialtyDef | null {
  const s = input.trim().replace(/\s+/g, " ");
  return SPECIALTY_DEFS.find((d) => d.key === s.toLowerCase() || d.label.toLowerCase() === s.toLowerCase() || d.aliases.test(s)) ?? null;
}

export function matchesSpecialty(def: SpecialtyDef, taxonomyCodes: string[]): boolean {
  return taxonomyCodes.some((c) => def.codes.some((p) => c.startsWith(p)));
}

// ── Distance ─────────────────────────────────────────────────────────────────

const EARTH_RADIUS_MI = 3958.7613;

export function haversineMiles(a: Coords, b: Coords): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const roundMiles = (m: number) => Math.round(m * 10) / 10;

export function withinRadius(origin: Coords, point: Coords | null, radiusMi: number): boolean {
  return point !== null && haversineMiles(origin, point) <= radiusMi;
}

// ── Geocoding ────────────────────────────────────────────────────────────────

const zipCache = new Map<string, Coords & { city: string; state: string } | null>();

async function zipCentroid(zip5: string): Promise<(Coords & { city: string; state: string }) | null> {
  if (zipCache.has(zip5)) return zipCache.get(zip5)!;
  try {
    const res = await fetch(`${ZIPPO}/${zip5}`, { signal: AbortSignal.timeout(8000) });
    const d = res.ok ? await res.json() : null;
    const p = d?.places?.[0];
    const v = p ? { lat: Number(p.latitude), lon: Number(p.longitude), city: p["place name"], state: p["state abbreviation"] } : null;
    zipCache.set(zip5, v);
    return v;
  } catch {
    return null; // not cached: transient failure
  }
}

async function censusOneLine(address: string): Promise<{ coords: Coords; matched: string; state: string } | null> {
  const qs = new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "json" });
  const res = await fetch(`${CENSUS}/onelineaddress?${qs}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const m = (await res.json())?.result?.addressMatches?.[0];
  return m ? { coords: { lat: m.coordinates.y, lon: m.coordinates.x }, matched: m.matchedAddress, state: m.addressComponents?.state ?? "" } : null;
}

const STATE_RE = /\b(A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|P[AR]|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/;

// Origin: street address → Census (rooftop-ish); ZIP → ZIP centroid; City, ST → mean of its ZIP centroids.
export async function resolveOrigin(input: string): Promise<Origin | null> {
  const text = input.trim().replace(/\s+/g, " ");
  const zip = text.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null;
  const hasStreet = /^\d+\s+\S+/.test(text) && text.includes(",");

  if (hasStreet) {
    const c = await censusOneLine(text).catch(() => null);
    if (c) return { input: text, label: titleWords(c.matched), coords: c.coords, precision: "address", method: "US Census Geocoder (address match)", state: c.state };
  }
  if (zip) {
    const z = await zipCentroid(zip);
    if (z) return { input: text, label: `${z.city}, ${z.state} ${zip}`, coords: { lat: z.lat, lon: z.lon }, precision: "zip", method: "ZIP code centroid (Zippopotam.us / GeoNames)", state: z.state };
  }
  const st = text.toUpperCase().match(STATE_RE)?.[1] ?? null;
  const city = text.replace(/,?\s*\b[A-Za-z]{2}\b\s*$/, "").replace(/,/g, " ").trim();
  if (st && city) {
    try {
      const res = await fetch(`${ZIPPO}/${st.toLowerCase()}/${encodeURIComponent(city.toLowerCase())}`, { signal: AbortSignal.timeout(8000) });
      const places: { latitude: string; longitude: string }[] = res.ok ? (await res.json())?.places ?? [] : [];
      if (places.length) {
        const lat = places.reduce((s, p) => s + Number(p.latitude), 0) / places.length;
        const lon = places.reduce((s, p) => s + Number(p.longitude), 0) / places.length;
        return { input: text, label: `${titleWords(city)}, ${st}`, coords: { lat, lon }, precision: "city", method: `City centre (mean of ${places.length} ZIP centroids, Zippopotam.us)`, state: st };
      }
    } catch { /* fall through */ }
  }
  return null;
}

function titleWords(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Wa|Ne|Nw|Se|Sw|Ste)\b/g, (w) => (w === "Ste" ? w : w.toUpperCase()));
}

export interface GeoAddress {
  key: string;
  line1: string;
  city: string;
  state: string;
  zip5: string;
}

export type GeoResult = { coords: Coords; precision: "address" | "zip" } | null;

export const addressKey = (line1: string, zip: string) => `${line1.toUpperCase().replace(/[^A-Z0-9]/g, "")}|${zip.slice(0, 5)}`;

const geoCache = new Map<string, GeoResult>();

// Census batch geocoder: one multipart POST for up to 10k addresses. Anything it
// can't match falls back to the ZIP centroid, flagged as approximate.
export async function geocodeAddresses(list: GeoAddress[]): Promise<Map<string, GeoResult>> {
  const out = new Map<string, GeoResult>();
  const todo = list.filter((a) => {
    if (geoCache.has(a.key)) { out.set(a.key, geoCache.get(a.key)!); return false; }
    return true;
  });
  const unique = [...new Map(todo.map((a) => [a.key, a])).values()];

  if (unique.length) {
    const csvCell = (s: string) => `"${s.replace(/"/g, "'")}"`;
    const csv = unique.map((a, i) => [i, a.line1, a.city, a.state, a.zip5].map((x) => csvCell(String(x))).join(",")).join("\n");
    try {
      const form = new FormData();
      form.append("addressFile", new Blob([csv], { type: "text/csv" }), "addresses.csv");
      form.append("benchmark", "Public_AR_Current");
      const res = await fetch(`${CENSUS}/addressbatch`, { method: "POST", body: form, signal: AbortSignal.timeout(25_000) });
      if (res.ok) {
        for (const row of parseCsv(await res.text())) {
          const a = unique[Number(row[0])];
          if (!a || row[2] !== "Match" || !row[5]) continue;
          const [lon, lat] = row[5].split(",").map(Number);
          if (Number.isFinite(lat) && Number.isFinite(lon)) out.set(a.key, { coords: { lat, lon }, precision: "address" });
        }
      }
    } catch (err) {
      console.warn("[npi-geo] census batch failed:", (err as Error).message);
    }
    const missing = unique.filter((a) => !out.has(a.key));
    await Promise.all(missing.map(async (a) => {
      const z = await zipCentroid(a.zip5);
      out.set(a.key, z ? { coords: { lat: z.lat, lon: z.lon }, precision: "zip" } : null);
    }));
    for (const a of unique) geoCache.set(a.key, out.get(a.key) ?? null);
  }
  return out;
}

export async function geocodeOne(a: GeoAddress): Promise<GeoResult> {
  if (geoCache.has(a.key)) return geoCache.get(a.key)!;
  const c = await censusOneLine(`${a.line1}, ${a.city}, ${a.state} ${a.zip5}`).catch(() => null);
  let r: GeoResult = c ? { coords: c.coords, precision: "address" } : null;
  if (!r && a.zip5) {
    const z = await zipCentroid(a.zip5);
    r = z ? { coords: { lat: z.lat, lon: z.lon }, precision: "zip" } : null;
  }
  geoCache.set(a.key, r);
  return r;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}
