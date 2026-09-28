// TEMPORARY NPI demo tests — `npm test` (node:test, Node's built-in TS type stripping).
// Deterministic only: every network call is mocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, planSearch } from "../api/_npi-lib.ts";
import { haversineMiles, matchesSpecialty, parseCsv, resolveSpecialty, withinRadius } from "../api/_npi-geo.ts";
import { credentialCandidates, parseWaLicense, sameLastName } from "../api/_npi-wa.ts";
import { countingFamilies, fieldConfidence, scoreProvider } from "../api/_npi-score.ts";
import { buildView, classifyFamily, classifyFax, finalizeResearch, numbersInText, researchProvider, streetKey } from "../api/_npi-referral.ts";
import { takeResearchSlot } from "../api/_npi-guard.ts";
import type { LicenseCheck, ProviderDetail, ReferralResearch } from "../src/npi/types.ts";

// ── Fetch mock ──────────────────────────────────────────────────────────────
// Census one-line geocoder → fixed coordinates per street; everything else 404.
const COORDS: Record<string, [number, number]> = {
  "1959 NE PACIFIC": [47.6507, -122.308],
  "1560 N 115TH": [47.7115, -122.3406],
  "1701 NW MARKET": [47.6687, -122.3806],
  "5344 BALLARD": [47.6676, -122.3843],
  "133 BROOKLINE": [42.3444, -71.1027],
  "1 CRANCH": [42.2507, -71.0027],
};
// Source pages the referral-fax check can "fetch".
const PAGES: Record<string, string> = {
  "https://www.uwmedicine.org/a": "<html><body><h2>ENT clinic</h2><p>Appointments 206-598-4022</p><p><b>Referral Fax:</b> (206) 598-7777</p></body></html>",
  "https://www.seattlechildrens.org/x": "<html><body>Fax 206-985-3392. Providers: fax the New Appointment Request Form to 206-985-3121, Attn: Clinical Intake.</body></html>",
  "https://optum.example/tonn": "<html><body>Optum - Edmonds 21401 72nd Ave W Phone: 1-425-259-0966 Fax: 1-425-259-1155</body></html>",
};
async function withFetch<T>(extra: (url: string, init?: RequestInit) => Response | null, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    const url = String(u);
    const r = extra(url, init);
    if (r) return r;
    if (PAGES[url]) return new Response(PAGES[url], { headers: { "content-type": "text/html" } });
    if (url.includes("geocoding.geo.census.gov") && url.includes("onelineaddress")) {
      const addr = decodeURIComponent(new URL(url).searchParams.get("address") ?? "").toUpperCase();
      const hit = Object.entries(COORDS).find(([k]) => addr.includes(k));
      return Response.json({ result: { addressMatches: hit ? [{ coordinates: { x: hit[1][1], y: hit[1][0] }, matchedAddress: addr, addressComponents: { state: "WA" } }] : [] } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

// ── Fixtures ────────────────────────────────────────────────────────────────
const RAW = {
  number: "1831725753",
  enumeration_type: "NPI-1",
  basic: { first_name: "SHAUNAK", middle_name: "NISHITH", last_name: "AMIN", credential: "M.D.", status: "A", last_updated: "2023-07-14", enumeration_date: "2020-03-23", sole_proprietor: "NO", sex: "M" },
  addresses: [
    { address_purpose: "LOCATION", address_1: "1959 NE PACIFIC ST", city: "SEATTLE", state: "WA", postal_code: "981950011", telephone_number: "206-598-3300", fax_number: "206-598-9999" },
    { address_purpose: "MAILING", address_1: "PO BOX 1", city: "SEATTLE", state: "WA", postal_code: "981950001" },
  ],
  practiceLocations: [],
  taxonomies: [{ code: "207Y00000X", desc: "Otolaryngology", primary: true, state: "WA", license: "MD60441019" }],
  identifiers: [],
  other_names: [],
  endpoints: [],
};
const provider = (): ProviderDetail => normalize(structuredClone(RAW), "CMS NPPES API");

const S = (id: string, url: string) => ({ id, url, title: "", domain: new URL(url).hostname.replace(/^www\./, "") });
const meta = (id: string, family: string, extra: Record<string, unknown> = {}) => ({ id, name: id, family, aboutDifferentProvider: false, currentness: "current", summary: "", ...extra });
const USAGE = { researchModel: "m", extractModel: "m", searchCalls: 1, inputTokens: 0, outputTokens: 0, durationMs: 0 };
const emptyParsed = () => ({
  summary: "s",
  relationship: { kind: "npi_current", explanation: "e", sourceIds: ["S1"] },
  identity: { confirmed: true, conflict: false, note: "", sourceIds: ["S1"] },
  specialty: { value: "Otolaryngology", status: "same", sourceIds: ["S1"] },
  affiliations: [{ name: "UW Medicine", current: "current", sourceIds: ["S1"] }],
  sources: [] as unknown[],
  locations: [] as unknown[],
  conflicts: [] as unknown[],
  licenses: [] as unknown[],
});
const loc = (o: Record<string, unknown>) => ({ name: "Clinic", organization: "UW Medicine", line2: null, city: "Seattle", state: "WA", postalCode: "98195", currentness: "current", phones: [], faxes: [], referralInstructions: null, acceptingNewPatients: null, ...o });

const WA_ACTIVE: LicenseCheck = { state: "WA", source: "WA DOH", sourceUrl: "", checkedAt: "", match: "exact", matchNote: "", records: [{ credentialNumber: "MD.MD.60441019", credentialType: "Physician And Surgeon License", status: "Active", name: "x", firstIssued: null, lastIssued: null, expires: "01/01/2028", actionTaken: "No" }] };

// ── Name search (unchanged behaviour) ───────────────────────────────────────
test("planSearch: NPI and specialty + city + state", () => {
  assert.equal(planSearch("1831725753").npi, "1831725753");
  assert.deepEqual(planSearch("ENT Seattle WA").plans[0].params, { state: "WA", taxonomy_description: "Otolaryngology", city: "Seattle", address_purpose: "LOCATION" });
});

test("normalize: names, phone, zip, credential; mailing kept separate", () => {
  const d = provider();
  assert.equal(d.name, "Shaunak Nishith Amin");
  assert.equal(d.credential, "MD");
  assert.equal(d.addresses[0].postalCode, "98195-0011");
  assert.equal(d.addresses.at(-1)!.purpose, "Mailing");
});

// ── Geography ───────────────────────────────────────────────────────────────
test("distance: Haversine against known city pairs", () => {
  const seattle = { lat: 47.6062, lon: -122.3321 }, portland = { lat: 45.5152, lon: -122.6784 };
  const d = haversineMiles(seattle, portland);
  assert.ok(d > 144 && d < 147, `Seattle→Portland ≈145 mi, got ${d}`);
  assert.equal(haversineMiles(seattle, seattle), 0);
  // 98115 centroid → UW Medical Center ≈ 2.7 mi
  const uw = haversineMiles({ lat: 47.6849, lon: -122.2968 }, { lat: 47.6507, lon: -122.308 });
  assert.ok(uw > 2.3 && uw < 2.6, `got ${uw}`);
});

test("radius filtering: inclusive, and no coordinates is never in radius", () => {
  const o = { lat: 47.6849, lon: -122.2968 };
  assert.equal(withinRadius(o, { lat: 47.6507, lon: -122.308 }, 5), true);
  assert.equal(withinRadius(o, { lat: 47.6507, lon: -122.308 }, 2), false);
  assert.equal(withinRadius(o, null, 50), false);
});

test("census batch CSV parsing handles quoted commas", () => {
  const rows = parseCsv('"3","1 MAIN ST, SEATTLE, WA, 98115","Match","Exact","1 MAIN ST, SEATTLE, WA, 98115","-122.3,47.6","1","L"\n"4","x","No_Match"');
  assert.equal(rows[0][5], "-122.3,47.6");
  assert.equal(rows[1][2], "No_Match");
});

// ── Specialty aliasing ─────────────────────────────────────────────────────
test("specialty aliases map to exact taxonomy codes and never broaden", () => {
  for (const s of ["ENT", "ent", "Otolaryngology", "ENT / Otolaryngology", "ear nose and throat", "otolaryngologist"]) assert.equal(resolveSpecialty(s)?.key, "ent", s);
  assert.equal(resolveSpecialty("otologist")?.key, "otology");
  assert.equal(resolveSpecialty("audiologist")?.key, "audiology");
  assert.equal(resolveSpecialty("cardiology"), null, "unknown specialties are refused, not guessed");
  const ent = resolveSpecialty("ENT")!;
  assert.equal(matchesSpecialty(ent, ["207YX0901X"]), true, "subspecialties of otolaryngology count as ENT");
  assert.equal(matchesSpecialty(ent, ["231H00000X"]), false, "audiologist is not ENT");
  assert.equal(matchesSpecialty(ent, ["2082S0099X"]), false, "plastic surgery (head & neck) is not ENT");
  assert.equal(matchesSpecialty(resolveSpecialty("otologist")!, ["207Y00000X"]), false, "general ENT is not otology");
});

// ── Washington licensing ───────────────────────────────────────────────────
test("WA licence numbers: NPPES formats → DOH credential numbers", () => {
  assert.deepEqual(parseWaLicense("MD60441019"), { prof: "MD", num: "60441019" });
  assert.deepEqual(parseWaLicense("ML.61165617"), { prof: "ML", num: "61165617" });
  assert.deepEqual(parseWaLicense("ML 60571866"), { prof: "ML", num: "60571866" });
  assert.deepEqual(credentialCandidates({ prof: "MD", num: "00028450" }), ["MD.MD.00028450", "IMLC.MD.00028450", "IMLC.MD.00028450-IMLC"]);
  assert.equal(sameLastName("Thomas Jr", "THOMAS"), true);
  assert.equal(sameLastName("Thomson", "THOMAS"), false);
});

// ── Source families ────────────────────────────────────────────────────────
test("source families: domain rules override the model; mirrors never count; NPPES counts once", () => {
  assert.equal(classifyFamily("https://npiprofile.com/npi/1", "npiprofile.com", "first_party").family, "aggregator");
  assert.equal(classifyFamily("https://www.healthgrades.com/x", "healthgrades.com", "independent").family, "aggregator");
  assert.equal(classifyFamily("https://www.premera.com/find-a-doctor", "premera.com", "independent").family, "payer");
  assert.equal(classifyFamily("https://doh.wa.gov/x", "doh.wa.gov", "independent").family, "state");
  assert.equal(classifyFamily("https://npiregistry.cms.hhs.gov/x", "npiregistry.cms.hhs.gov", "independent").family, "federal");
  assert.equal(classifyFamily("https://example.com", "example.com", "state").family, "independent", "only .gov can be state");
  assert.equal(classifyFamily("https://www.uwmedicine.org/bios/x", "uwmedicine.org", "first_party").family, "first_party");
  assert.deepEqual(countingFamilies(["federal", "federal", "aggregator", "first_party"]).sort(), ["federal", "first_party"]);
  // Two APIs over NPPES + a mirror are still one federal family: no corroboration bonus.
  assert.equal(fieldConfidence(["federal", "federal", "aggregator"]).confidence, fieldConfidence(["federal"]).confidence);
  assert.ok(fieldConfidence(["first_party", "payer"]).confidence > fieldConfidence(["first_party"]).confidence);
});

// ── Fax classification ─────────────────────────────────────────────────────
test("referral fax only when the label says referral", () => {
  assert.deepEqual(classifyFax("referral", "Referral Fax"), { kind: "referral", downgraded: false });
  assert.deepEqual(classifyFax("general", "Fax for referrals:"), { kind: "referral", downgraded: false });
  assert.deepEqual(classifyFax("referral", "Fax"), { kind: "general", downgraded: true });
  assert.deepEqual(classifyFax("referral", null), { kind: "unknown", downgraded: true });
  assert.equal(classifyFax("general", "Scheduling fax").kind, "scheduling");
});

test("phone numbers are found in text regardless of formatting", () => {
  const n = numbersInText("Call (206) 598-4022 or 206.520.5000; fax: +1 206-555-1212.");
  assert.deepEqual([...n].sort(), ["2065204022".replace("4022", "5000"), "2065551212", "2065984022"].sort());
});

test("streetKey ignores suite, directionals and ordinal formatting", () => {
  assert.equal(streetKey("1560 N 115th St, Suite 201", "98133"), streetKey("1560 N. 115TH STREET STE 210", "98133-1234"));
  assert.notEqual(streetKey("1560 N 115th St", "98133"), streetKey("1550 N 115th St", "98133"));
});

// ── Scoring ────────────────────────────────────────────────────────────────
test("provider confidence: registry + licence baseline, then research", () => {
  const base = { active: true, specialtyMatch: { matched: true, label: "ENT", requested: true }, licenseStateSupported: true, practiceState: "WA", isOrg: false, npiUpdatedYearsAgo: 1 };
  assert.equal(scoreProvider({ ...base, license: WA_ACTIVE, research: null }).score, 65);
  const researched = { identity: { value: "x", confidence: 80, basis: "", sourceIds: ["S1"], confirmed: true, conflict: false }, specialty: { value: "ENT", status: "same" as const, confidence: 80, basis: "", sourceIds: ["S1"] }, affiliations: [{ value: "UW", sourceIds: ["S1"], current: "current" as const, families: ["first_party" as const] }], webLicense: [], sources: [{ id: "S1", family: "first_party" as const }] as ReferralResearch["sources"] };
  assert.equal(scoreProvider({ ...base, license: WA_ACTIVE, research: researched }).score, 100);
  const conflict = { ...researched, identity: { ...researched.identity, confirmed: false, conflict: true } };
  assert.ok(scoreProvider({ ...base, license: WA_ACTIVE, research: conflict }).score < 70);
  const expired: LicenseCheck = { ...WA_ACTIVE, records: [{ ...WA_ACTIVE.records[0], status: "Expired" }] };
  assert.equal(scoreProvider({ ...base, license: expired, research: null }).score, 25);
  assert.ok(scoreProvider({ ...base, active: false, license: WA_ACTIVE, research: null }).score <= 10, "deactivated NPI is capped");
});

// ── Research → destinations (deterministic merge + filters) ────────────────
async function finalize(parsed: ReturnType<typeof emptyParsed>, sources: ReturnType<typeof S>[], report: string, p = provider()) {
  return withFetch(() => null, () => finalizeResearch(p, parsed, sources, report, USAGE, []));
}

test("location-specific faxes, referral vs generic fax, multiple locations kept separate", async () => {
  const parsed = emptyParsed();
  parsed.sources = [meta("S1", "first_party"), meta("S2", "payer")];
  parsed.locations = [
    loc({ name: "UW Medical Center — ENT", line1: "1959 NE Pacific St", sourceIds: ["S1"], phones: [{ number: "206-598-4022", label: "Appointments", sourceIds: ["S1"] }], faxes: [{ number: "206-598-7777", label: "Referral Fax", faxKind: "referral", sourceIds: ["S1", "S2"] }] }),
    loc({ name: "Northwest ENT", line1: "1560 N 115th St", postalCode: "98133", sourceIds: ["S1"], phones: [{ number: "206-668-1234", label: null, sourceIds: ["S1"] }], faxes: [{ number: "206-668-5678", label: "Fax", faxKind: "referral", sourceIds: ["S1"] }] }),
  ];
  const report = "UW: 206-598-4022, Referral Fax 206-598-7777. Northwest: 206-668-1234 fax 206-668-5678";
  const r = await finalize(parsed, [S("S1", "https://www.uwmedicine.org/a"), S("S2", "https://www.premera.com/b")], report);
  assert.equal(r.locations.length, 2, "NPI address merged into the matching researched location, second location kept");
  const uw = r.locations.find((l) => l.line1.startsWith("1959"))!;
  const nw = r.locations.find((l) => l.line1.startsWith("1560"))!;
  assert.equal(uw.origin, "both");
  assert.equal(uw.bestFax?.number, "(206) 598-7777");
  assert.equal(uw.bestFax?.faxKind, "referral");
  assert.ok(uw.faxes.some((f) => f.digits === "2065989999" && f.inNpi), "NPI fax preserved alongside");
  assert.equal(nw.bestFax?.faxKind, "general", "label 'Fax' cannot be a referral fax");
  assert.ok(!nw.faxes.some((f) => f.digits === "2065987777"), "UW's fax is not copied onto Northwest");
  assert.ok(r.dropped.some((d) => d.reason.includes("Referral fax")));

  const view = await withFetch(() => null, () => buildView(provider(), r, { origin: { lat: 47.6849, lon: -122.2968 }, radiusMi: 10, specialty: resolveSpecialty("ENT"), license: WA_ACTIVE }));
  const vuw = view.locations.find((l) => l.line1.startsWith("1959"))!;
  const vnw = view.locations.find((l) => l.line1.startsWith("1560"))!;
  assert.ok(vuw.distanceMi! > 2 && vuw.distanceMi! < 3);
  assert.equal(vuw.inRadius, true);
  assert.ok(vuw.referral.score > vnw.referral.score, "explicit referral fax on an official page scores higher");
  assert.ok(vuw.referral.items.some((i) => i.label.startsWith("Official source page labels it a referral fax")));
  assert.equal(vuw.bestFax?.labelCheck, "page");
  assert.ok(vnw.referral.items.some((i) => i.label.startsWith("Referral-specific fax not established")));
  assert.equal(vuw.fields.referralFax.value, "(206) 598-7777");
  assert.equal(vnw.fields.referralFax.value, null);
});

test("unsupported claims are filtered out", async () => {
  const parsed = emptyParsed();
  parsed.sources = [meta("S1", "first_party"), meta("S2", "first_party", { aboutDifferentProvider: true }), meta("S7", "first_party")];
  parsed.locations = [
    loc({ line1: "1959 NE Pacific St", sourceIds: ["S1"], phones: [{ number: "206-111-2222", label: null, sourceIds: ["S1"] }], faxes: [{ number: "206-333-4444", label: "Fax", faxKind: "general", sourceIds: ["S9"] }] }),
    loc({ name: "Other person's clinic", line1: "9 Elsewhere Rd", sourceIds: ["S2"], phones: [], faxes: [] }),
  ];
  const r = await finalize(parsed, [S("S1", "https://www.uwmedicine.org/a"), S("S2", "https://other.org/b")], "fax 206-333-4444 (no phone in text)");
  const reasons = r.dropped.map((d) => d.reason);
  assert.ok(reasons.includes("Number does not appear in the cited research text"), "hallucinated phone dropped");
  assert.ok(reasons.includes("Number has no valid source"), "fax citing an unknown source dropped");
  assert.ok(reasons.includes("Source is about a different provider"));
  assert.ok(reasons.includes("Model cited a source id web search never returned"));
  assert.equal(r.locations.filter((l) => l.origin !== "npi").length, 1, "location backed only by an off-provider source dropped");
  assert.ok(!r.locations.some((l) => l.phones.some((n) => n.digits === "2061112222")));
});

test("aggregator-only evidence does not corroborate", async () => {
  const parsed = emptyParsed();
  parsed.sources = [meta("S1", "independent")];
  parsed.identity.sourceIds = ["S1"];
  parsed.locations = [loc({ line1: "1959 NE Pacific St", sourceIds: ["S1"], phones: [{ number: "206-598-3300", label: null, sourceIds: ["S1"] }], faxes: [] })];
  const r = await finalize(parsed, [S("S1", "https://npiprofile.com/npi/1831725753")], "206-598-3300");
  assert.equal(r.sources[0].family, "aggregator");
  assert.equal(r.identity.confirmed, false, "a mirror cannot confirm identity");
  const view = await withFetch(() => null, () => buildView(provider(), r, { origin: null, radiusMi: null, specialty: null, license: null }));
  assert.ok(view.locations[0].referral.items.some((i) => i.label.startsWith("Only the NPI record lists this location")));
});

test("stale NPI / successor practice: same numbers at a new name and address", async () => {
  // Modelled on the 310 Vision case: NPI says 310 Vision at 1701 NW Market St;
  // the web shows a differently named practice elsewhere with the same phone + fax.
  const raw = structuredClone(RAW);
  raw.basic = { ...raw.basic };
  raw.addresses[0] = { address_purpose: "LOCATION", address_1: "1701 NW MARKET ST", city: "SEATTLE", state: "WA", postal_code: "98107", telephone_number: "206-784-0700", fax_number: "206-706-8822" };
  const p = normalize(raw, "CMS NPPES API");
  const parsed = emptyParsed();
  parsed.relationship = { kind: "successor_practice", explanation: "Same numbers now used by Vision Plus Ballard.", sourceIds: ["S1"] };
  parsed.sources = [meta("S1", "first_party")];
  parsed.locations = [loc({ name: "Vision Plus Ballard", organization: "Vision Plus", line1: "5344 Ballard Ave NW", postalCode: "98107", sourceIds: ["S1"], phones: [{ number: "206-784-0700", label: "Phone", sourceIds: ["S1"] }], faxes: [{ number: "206-706-8822", label: "Fax", faxKind: "general", sourceIds: ["S1"] }] })];
  const r = await finalize(parsed, [S("S1", "https://visionplusballard.com")], "Phone 206-784-0700 Fax 206-706-8822", p);
  const npiLoc = r.locations.find((l) => l.origin === "npi")!;
  const webLoc = r.locations.find((l) => l.origin === "research")!;
  assert.equal(npiLoc.status, "possibly_stale");
  assert.match(npiLoc.statusNote!, /moved or been renamed/);
  assert.equal(webLoc.phones[0].inNpi, true, "digit-level agreement with the NPI record is preserved");
  assert.equal(r.relationship.kind, "successor_practice");
  const view = await withFetch(() => null, () => buildView(p, r, { origin: null, radiusMi: null, specialty: null, license: null }));
  assert.equal(view.locations[0].origin, "research", "the current practice ranks above the stale NPI address");
});

test("conflicting faxes for one location are penalised, not silently resolved", async () => {
  const parsed = emptyParsed();
  parsed.sources = [meta("S1", "first_party"), meta("S2", "payer")];
  parsed.locations = [loc({ line1: "1959 NE Pacific St", sourceIds: ["S1", "S2"], phones: [], faxes: [{ number: "206-111-0000", label: "Fax", faxKind: "general", sourceIds: ["S1"] }, { number: "206-222-0000", label: "Fax", faxKind: "general", sourceIds: ["S2"] }] })];
  const r = await finalize(parsed, [S("S1", "https://www.uwmedicine.org/a"), S("S2", "https://www.premera.com/b")], "206-111-0000 and 206-222-0000");
  const view = await withFetch(() => null, () => buildView(provider(), r, { origin: null, radiusMi: null, specialty: null, license: null }));
  const l = view.locations[0];
  assert.ok(l.referral.items.some((i) => i.label.startsWith("Sources list different general fax numbers") && i.points < 0));
  assert.ok(l.faxes.length >= 3, "both web faxes and the NPI fax are all kept");
});

test("multiple Atrius-style locations each keep their own fax (Maansi Aghera shape)", async () => {
  const raw = structuredClone(RAW);
  raw.taxonomies = [{ code: "231H00000X", desc: "Audiologist", primary: true, state: "MA", license: "" }];
  raw.addresses[0] = { address_purpose: "LOCATION", address_1: "133 BROOKLINE AVE", city: "BOSTON", state: "MA", postal_code: "02215", telephone_number: "617-421-5984", fax_number: "" };
  const p = normalize(raw, "CMS NPPES API");
  const parsed = emptyParsed();
  parsed.relationship = { kind: "additional_locations", explanation: "Atrius lists Kenmore and Quincy.", sourceIds: ["S1"] };
  parsed.sources = [meta("S1", "first_party")];
  parsed.locations = [
    loc({ name: "Kenmore", organization: "Atrius Health", line1: "133 Brookline Ave", city: "Boston", state: "MA", postalCode: "02215", sourceIds: ["S1"], phones: [{ number: "617-421-1000", label: null, sourceIds: ["S1"] }], faxes: [{ number: "617-421-2000", label: "Fax", faxKind: "general", sourceIds: ["S1"] }] }),
    loc({ name: "Quincy Hancock", organization: "Atrius Health", line1: "1 Cranch St", city: "Quincy", state: "MA", postalCode: "02169", sourceIds: ["S1"], phones: [{ number: "617-773-1000", label: null, sourceIds: ["S1"] }], faxes: [{ number: "617-773-2000", label: "Fax", faxKind: "general", sourceIds: ["S1"] }] }),
  ];
  const r = await finalize(parsed, [S("S1", "https://www.atriushealth.org/x")], "617-421-1000 617-421-2000 617-773-1000 617-773-2000", p);
  assert.equal(r.locations.length, 2);
  const faxes = r.locations.map((l) => l.bestFax?.digits).sort();
  assert.deepEqual(faxes, ["6174212000", "6177732000"], "no provider-level fax: each location keeps its own");
  assert.equal(r.locations.find((l) => l.city === "Boston")!.origin, "both");
});

// ── End to end with mocked MCP + OpenAI ────────────────────────────────────
test("researchProvider: two OpenAI calls, provenance enforced, cache and rate limit", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  let openaiCalls = 0;
  try {
    const run = () => withFetch((url, init) => {
      if (url.includes("mcp")) return Response.json({ jsonrpc: "2.0", id: 1, result: { structuredContent: { found: true, record: { raw: RAW } } } });
      if (!url.includes("openai")) return null;
      openaiCalls++;
      const body = JSON.parse(String(init?.body));
      if (body.tools) {
        return Response.json({
          output: [
            { type: "web_search_call", action: { query: "Shaunak Amin ENT", sources: [{ url: "https://www.uwmedicine.org/bios/shaunak-amin" }] } },
            { type: "message", content: [{ type: "output_text", text: "UW Medicine ENT at 1959 NE Pacific St. Phone 206-598-4022. Referral Fax: 206-598-7777 https://www.uwmedicine.org/bios/shaunak-amin", annotations: [] }] },
          ],
          usage: { input_tokens: 1000, output_tokens: 200 },
        });
      }
      assert.equal(body.text.format.type, "json_schema");
      const parsed = emptyParsed();
      parsed.sources = [meta("S1", "first_party")];
      parsed.locations = [loc({ line1: "1959 NE Pacific St", sourceIds: ["S1"], phones: [{ number: "206-598-4022", label: null, sourceIds: ["S1"] }], faxes: [{ number: "206-598-7777", label: "Referral Fax", faxKind: "referral", sourceIds: ["S1"] }] })];
      return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(parsed) }] }], usage: { input_tokens: 500, output_tokens: 300 } });
    }, () => researchProvider("1831725753", true, () => {}));
    const out = await run();
    assert.ok(out);
    assert.equal(openaiCalls, 2);
    assert.equal(out.research.usage.inputTokens, 1500);
    assert.equal(out.research.locations[0].bestFax?.faxKind, "referral");
    assert.equal(out.research.identity.confirmed, true);
    const again = await withFetch((url) => (url.includes("mcp") ? Response.json({ jsonrpc: "2.0", id: 1, result: { structuredContent: { found: true, record: { raw: RAW } } } }) : null), () => researchProvider("1831725753", false, () => {}, () => { throw new Error("cache hit must not take a rate-limit slot"); }));
    assert.equal(again?.research.cached, true);
    assert.equal(openaiCalls, 2, "served from cache");
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test("demo guard: per-IP rate limit on fresh research", () => {
  const t = 1_000_000;
  for (let i = 0; i < 25; i++) assert.equal(takeResearchSlot("9.9.9.9", t), true);
  assert.equal(takeResearchSlot("9.9.9.9", t), false);
  assert.equal(takeResearchSlot("8.8.8.8", t), true, "other clients unaffected");
  assert.equal(takeResearchSlot("9.9.9.9", t + 3600_001), true, "window slides");
});

// ── Fixes from the live Seattle acceptance run ─────────────────────────────
test("clinic pages are evidence; only a different person is dropped; VA is first-party", async () => {
  assert.equal(classifyFamily("https://www.va.gov/puget-sound-health-care/", "va.gov", "federal").family, "first_party");
  const parsed = emptyParsed();
  parsed.sources = [meta("S1", "first_party"), meta("S2", "first_party")]; // S2: clinic page not naming the provider
  parsed.locations = [loc({ line1: "1959 NE Pacific St", sourceIds: ["S1", "S2"], phones: [], faxes: [{ number: "206-598-6611", label: "fax", faxKind: "general", sourceIds: ["S2"] }] })];
  const r = await finalize(parsed, [S("S1", "https://www.uwmedicine.org/bios/x"), S("S2", "https://www.uwmedicine.org/locations/ent")], "fax 206-598-6611");
  assert.ok(r.locations[0].faxes.some((f) => f.digits === "2065986611"));
});

test("specialty that differs from the NPI taxonomy lowers provider and referral confidence", async () => {
  const parsed = emptyParsed();
  parsed.specialty = { value: "Aesthetic medicine", status: "different", sourceIds: ["S1"] };
  parsed.sources = [meta("S1", "first_party")];
  parsed.locations = [loc({ line1: "1959 NE Pacific St", sourceIds: ["S1"] })];
  const r = await finalize(parsed, [S("S1", "https://skin.example.com")], "");
  assert.equal(r.specialty.status, "different");
  const view = await withFetch(() => null, () => buildView(provider(), r, { origin: null, radiusMi: null, specialty: resolveSpecialty("ENT"), license: WA_ACTIVE }));
  assert.ok(view.providerScore.items.some((i) => i.kind === "fail" && i.label.startsWith("Sources show a different current specialty")));
  assert.ok(view.locations[0].referral.items.some((i) => i.points === -25));
});

test("NPI address without a street merges with the same-ZIP site that shares its phone", async () => {
  const raw = structuredClone(RAW);
  raw.addresses[0] = { ...raw.addresses[0], address_1: "UNIVERSITY OF WASHINGTON MEDICAL CTR", postal_code: "981956161", telephone_number: "206-598-4022", fax_number: "" };
  const parsed = emptyParsed();
  parsed.sources = [meta("S1", "first_party")];
  parsed.locations = [loc({ line1: "1959 NE Pacific St", sourceIds: ["S1"], phones: [{ number: "206-598-4022", label: null, sourceIds: ["S1"] }] })];
  const r = await finalize(parsed, [S("S1", "https://www.uwmedicine.org/x")], "206-598-4022", normalize(raw, "CMS NPPES API"));
  assert.equal(r.locations.length, 1);
  assert.equal(r.locations[0].origin, "both");
});

test("destinations inside the search radius rank before stronger ones outside it", async () => {
  const parsed = emptyParsed();
  parsed.sources = [meta("S1", "first_party")];
  parsed.locations = [
    loc({ name: "Far", line1: "1 Cranch St", city: "Quincy", state: "MA", postalCode: "02169", sourceIds: ["S1"], phones: [{ number: "617-773-1000", label: null, sourceIds: ["S1"] }], faxes: [{ number: "617-773-2000", label: "Referral fax", faxKind: "referral", sourceIds: ["S1"] }] }),
    loc({ name: "Near", line1: "1560 N 115th St", postalCode: "98133", sourceIds: ["S1"] }),
  ];
  const r = await finalize(parsed, [S("S1", "https://x.org")], "617-773-1000 617-773-2000");
  const view = await withFetch(() => null, () => buildView(provider(), r, { origin: { lat: 47.6849, lon: -122.2968 }, radiusMi: 10, specialty: null, license: null }));
  assert.equal(view.locations[0].inRadius, true);
  assert.equal(view.locations.find((l) => l.name === "Far")!.inRadius, false);
});

test("licence type must fit the specialty (audiologist registered under an ENT taxonomy)", () => {
  const ent = resolveSpecialty("ENT")!;
  const aud: LicenseCheck = { ...WA_ACTIVE, records: [{ ...WA_ACTIVE.records[0], credentialNumber: "AUD.LD.70120088", credentialType: "Audiologist License" }] };
  const base = { active: true, specialtyMatch: { matched: true, label: ent.label, requested: true, licenseTypes: ent.licenseTypes }, licenseStateSupported: true, practiceState: "WA", isOrg: false, npiUpdatedYearsAgo: 1, research: null };
  const s = scoreProvider({ ...base, license: aud });
  assert.ok(s.items.some((i) => i.kind === "fail" && i.label.includes("doesn't fit")));
  assert.equal(scoreProvider({ ...base, license: WA_ACTIVE }).items.some((i) => i.label.includes("doesn't fit")), false);
});

test("fax number inside referral instructions becomes a referral fax (and only then)", async () => {
  const { referralFaxesIn } = await import("../api/_npi-referral.ts");
  assert.deepEqual(referralFaxesIn("New Appointment Request Form; Fax referral to 206-985-3121 Attn: Clinical Intake").map((x) => x.digits), ["2069853121"]);
  assert.deepEqual(referralFaxesIn("Call to schedule. Fax: 206-555-0000."), []);
  assert.deepEqual(referralFaxesIn("Use EpicCare Link or fax New Appointment Request Form (NARF) to 206-985-3121 or toll-free 866-985-3121, Attn: Clinical Intake nurse line at 206-987-2000").map((x) => x.digits), ["2069853121", "8669853121"]);
  const parsed = emptyParsed();
  parsed.sources = [meta("S1", "first_party")];
  parsed.locations = [loc({ line1: "1959 NE Pacific St", sourceIds: ["S1"], faxes: [{ number: "206-985-3392", label: "Fax", faxKind: "general", sourceIds: ["S1"] }], referralInstructions: { text: "Fax referrals to 206-985-3121, Attn: Clinical Intake", sourceIds: ["S1"] } })];
  const r = await finalize(parsed, [S("S1", "https://www.seattlechildrens.org/x")], "Fax 206-985-3392. Fax referrals to 206-985-3121");
  assert.equal(r.locations[0].bestFax?.digits, "2069853121");
  assert.equal(r.locations[0].bestFax?.faxKind, "referral");
  const hallucinated = emptyParsed();
  hallucinated.sources = [meta("S1", "first_party")];
  hallucinated.locations = [loc({ line1: "1959 NE Pacific St", sourceIds: ["S1"], referralInstructions: { text: "Fax referrals to 206-000-1111", sourceIds: ["S1"] } })];
  const r2 = await finalize(hallucinated, [S("S1", "https://x.org")], "no numbers here");
  assert.equal(r2.locations[0].faxes.filter((f) => f.faxKind === "referral").length, 0, "still must appear in the research text");
});

test("referral-fax claims are checked against the live source page", async () => {
  const { pageSupportsReferralFax } = await import("../api/_npi-referral.ts");
  assert.equal(pageSupportsReferralFax("Referral Fax: (206) 598-7777", "2065987777"), true);
  assert.equal(pageSupportsReferralFax("Phone: 1-425-259-0966 Fax: 1-425-259-1155", "4252591155"), false);

  // Tonn shape: the model wrote "fax referrals to …" but the page only says "Fax:".
  const parsed = emptyParsed();
  parsed.sources = [meta("S1", "first_party")];
  parsed.locations = [loc({ line1: "21401 72nd Ave W", city: "Edmonds", postalCode: "98026", sourceIds: ["S1"], referralInstructions: { text: "Call support to confirm routing and fax referrals to 1-425-259-1155.", sourceIds: ["S1"] } })];
  const r = await finalize(parsed, [S("S1", "https://optum.example/tonn")], "fax referrals to 1-425-259-1155");
  const f = r.locations.find((l) => l.city === "Edmonds")!.faxes[0];
  assert.equal(f.faxKind, "general", "page contradicts the model's wording → plain fax");
  assert.ok(r.dropped.some((d) => d.reason.includes("not found next to this number on the source page")));

  // Page unavailable (404/PDF): kept, flagged unverifiable, reduced credit.
  const p2 = emptyParsed();
  p2.sources = [meta("S1", "first_party")];
  p2.locations = [loc({ line1: "1959 NE Pacific St", sourceIds: ["S1"], faxes: [{ number: "206-111-9999", label: "Referral fax", faxKind: "referral", sourceIds: ["S1"] }] })];
  const r2 = await finalize(p2, [S("S1", "https://blocked.example/page")], "Referral fax 206-111-9999");
  const f2 = r2.locations[0].faxes.find((x) => x.digits === "2061119999")!;
  assert.equal(f2.faxKind, "referral");
  assert.equal(f2.labelCheck, "unverifiable");
  const view = await withFetch(() => null, () => buildView(provider(), r2, { origin: null, radiusMi: null, specialty: null, license: null }));
  assert.ok(view.locations[0].referral.items.some((i) => i.points === 5 && i.label.includes("couldn't be machine-checked")));
});
