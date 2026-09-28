// ── NPI demo — geographic referral search (TEMPORARY DEMO) ────────────────────
// specialty + location + radius → nearby referral destinations.
//   1. Resolve the specialty through the explicit alias table (api/_npi-geo.ts).
//   2. Resolve the origin to real coordinates (Census / ZIP centroid).
//   3. Pull every NPPES record with that taxonomy practising in the origin's
//      state (paged, ≤1,200), keep only exact taxonomy-code matches.
//   4. Batch-geocode every in-state practice address (Census batch geocoder).
//   5. Haversine distance → keep providers with ≥1 practice location in radius.
//   6. Batch Washington licence check, then baseline scores (no web research).
// No paid API is called here, so this endpoint needs no demo key.

import type { LicenseCheck, NearbyResponse, NearbyResult, ProviderDetail } from "../src/npi/types";
import { cmsQueryAll, normalize } from "./_npi-lib";
import { addressKey, geocodeAddresses, matchesSpecialty, resolveOrigin, resolveSpecialty, SPECIALTY_DEFS } from "./_npi-geo";
import { checkWaLicenses } from "./_npi-wa";
import { buildView, streetKey } from "./_npi-referral";

export class NearbyError extends Error {}

export const RADII = [5, 10, 25, 50];

export async function searchNearby(specialtyInput: string, locationInput: string, radiusMi: number): Promise<NearbyResponse> {
  const def = resolveSpecialty(specialtyInput);
  if (!def) throw new NearbyError(`“${specialtyInput}” isn't in this demo's specialty list. Try: ${SPECIALTY_DEFS.map((d) => d.label).join(", ")}.`);
  const origin = await resolveOrigin(locationInput);
  if (!origin) throw new NearbyError(`Couldn't locate “${locationInput}”. Use a ZIP code, “City, ST”, or a street address with city, state and ZIP.`);

  const notes: string[] = [];
  const { records, truncated } = await cmsQueryAll({ taxonomy_description: def.nppesQuery, state: origin.state, address_purpose: "LOCATION" });
  if (truncated) notes.push(`NPPES returned its maximum of 1,200 ${def.label} records for ${origin.state}; some providers may be missing.`);
  notes.push(`Searched NPPES practice locations in ${origin.state} only; providers across a state line are not included.`);

  const providers: ProviderDetail[] = records
    .map((r) => normalize(r, "CMS NPPES API"))
    .filter((p) => p.status === "Active" && matchesSpecialty(def, p.taxonomies.map((t) => t.code)));

  const addrs = providers.flatMap((p) => p.addresses.filter((a) => a.purpose !== "Mailing" && a.state === origin.state))
    .map((a) => ({ key: addressKey(a.line1, a.postalCode || a.city), line1: a.line1, city: a.city, state: a.state, zip5: a.postalCode.slice(0, 5) }));
  const geo = await geocodeAddresses(addrs);
  const geoVals = [...new Set(addrs.map((a) => a.key))].map((k) => geo.get(k));

  // Cheap pre-filter on geocoded addresses before building full views.
  const inRange = providers.filter((p) => p.addresses.some((a) => {
    if (a.purpose === "Mailing") return false;
    const g = geo.get(addressKey(a.line1, a.postalCode || a.city));
    if (!g) return false;
    const dLat = Math.abs(g.coords.lat - origin.coords.lat) * 69;
    return dLat <= radiusMi + 1;
  }));

  // In parallel: licence batch, and one more geocode batch for in-range providers'
  // out-of-state locations so every location gets a real distance and buildView
  // never geocodes one by one.
  if (origin.state !== "WA") notes.push(`Automated licence verification is implemented for Washington only; ${origin.state} licences are not checked.`);
  const [licenses] = await Promise.all([
    origin.state === "WA"
      ? checkWaLicenses(inRange.filter((p) => p.enumerationType === "Individual").map((p) => ({ npi: p.npi, firstName: p.firstName, lastName: p.lastName, isOrg: false, licenses: p.taxonomies })))
        .catch((err) => { notes.push(`Washington licence lookup failed: ${(err as Error).message}`); return new Map<string, LicenseCheck>(); })
      : Promise.resolve(new Map<string, LicenseCheck>()),
    geocodeAddresses(inRange.flatMap((p) => p.addresses.filter((a) => a.purpose !== "Mailing" && a.state !== origin.state))
      .map((a) => ({ key: addressKey(a.line1, a.postalCode || a.city), line1: a.line1, city: a.city, state: a.state, zip5: a.postalCode.slice(0, 5) }))),
  ]);

  // Organizations (NPI-2) of this specialty registered at each street address.
  const orgsAt = new Map<string, Set<string>>();
  for (const p of providers) if (p.enumerationType === "Organization") {
    for (const a of p.addresses) if (a.purpose !== "Mailing") {
      const k = streetKey(a.line1, a.postalCode || a.city);
      orgsAt.set(k, (orgsAt.get(k) ?? new Set()).add(p.name));
    }
  }

  const results: NearbyResult[] = [];
  for (const p of inRange) {
    const view = await buildView(p, null, { origin: origin.coords, radiusMi, specialty: def, license: licenses.get(p.npi) ?? null });
    const inside = view.locations.filter((l) => l.inRadius).sort((a, b) => (a.distanceMi ?? 1e9) - (b.distanceMi ?? 1e9));
    if (!inside.length) continue;
    const nearest = inside[0];
    const tax = p.taxonomies.find((t) => matchesSpecialty(def, [t.code]))!;
    // Shown as "registered at this address", never asserted as the provider's employer.
    const shared = [...(orgsAt.get(streetKey(nearest.line1, nearest.postalCode || nearest.city)) ?? [])].filter((n) => n !== p.name);
    results.push({
      npi: p.npi, name: p.name, credential: p.credential, enumerationType: p.enumerationType, status: p.status,
      specialty: tax.desc, specialtyCode: tax.code, specialtyIsPrimary: tax.primary, lastUpdated: p.lastUpdated,
      nearest, otherLocationCount: view.locations.length - 1, sharedAddressOrgs: shared.slice(0, 3),
      license: licenses.get(p.npi) ?? null, provider: view.providerScore,
    });
  }
  results.sort((a, b) => (a.nearest.distanceMi ?? 1e9) - (b.nearest.distanceMi ?? 1e9) || a.name.localeCompare(b.name));

  return {
    origin,
    specialty: { key: def.key, label: def.label, codes: def.codes, nppesQuery: def.nppesQuery },
    radiusMi,
    results,
    scanned: {
      records: providers.length,
      addresses: geoVals.length,
      geocodedExact: geoVals.filter((g) => g?.precision === "address").length,
      geocodedZip: geoVals.filter((g) => g?.precision === "zip").length,
      truncated,
    },
    source: "CMS NPPES API (federal NPI Registry)",
    notes,
  };
}
