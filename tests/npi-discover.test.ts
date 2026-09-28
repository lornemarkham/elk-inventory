// Cheap public-web pass (api/_npi-discover.ts) — deterministic, every network call mocked.
// The rule under test: SEARCH DISCOVERS URLs; ONLY FETCHED PAGE TEXT IS EVIDENCE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../api/_npi-lib.ts";
import { resolveSpecialty } from "../api/_npi-geo.ts";
import { buildView, specialtyReallyDiffers } from "../api/_npi-referral.ts";
import { braveSearch, corroboratePage, discoverProvider, discoveryQuery, familyForPage, parseBraveHits, rankHits, researchFromPages, type SearchOutcome } from "../api/_npi-discover.ts";
import { normalizeLocation } from "../src/npi/api.ts";
import type { ProviderDetail } from "../src/npi/types.ts";

const RAW = {
  number: "1234567893",
  enumeration_type: "NPI-1",
  basic: { first_name: "JANE", middle_name: "Q", last_name: "HOLLOWAY", credential: "M.D.", status: "A", last_updated: "2024-01-10" },
  addresses: [
    { address_purpose: "LOCATION", address_1: "1560 N 115TH ST", address_2: "SUITE 201", city: "SEATTLE", state: "WA", postal_code: "981335000", telephone_number: "206-555-0100", fax_number: "206-555-0199" },
    { address_purpose: "MAILING", address_1: "PO BOX 9", city: "SEATTLE", state: "WA", postal_code: "98133" },
  ],
  practiceLocations: [],
  taxonomies: [{ code: "2084N0400X", desc: "Psychiatry & Neurology, Neurology", primary: true, state: "WA", license: "MD1" }],
  identifiers: [], other_names: [], endpoints: [],
};
const provider = (): ProviderDetail => normalize(structuredClone(RAW), "CMS NPPES API");
const neuro = resolveSpecialty("neurology");
const ORGS = ["Northgate Neurology Associates"];

const page = (url: string, body: string, title = "Profile") => ({ url, finalUrl: url, title, html: `<html><head><title>${title}</title></head><body>${body}</body></html>` });

// ── Search contract ──────────────────────────────────────────────────────────

test("Brave hits keep only url + title: descriptions and snippets never leave the parser", () => {
  const hits = parseBraveHits({ web: { results: [
    { url: "https://a.example/x", title: "<strong>Dr</strong> Jane", description: "Fax 206-555-0199 referral", extra_snippets: ["x"] },
    { url: "https://a.example/x#frag", title: "dupe" },
    { url: "ftp://nope", title: "no" },
    ...Array.from({ length: 12 }, (_, i) => ({ url: `https://b${i}.example/`, title: `t${i}` })),
  ] } });
  assert.equal(hits.length, 8, "max 8 hits");
  assert.deepEqual(Object.keys(hits[0]).sort(), ["title", "url"]);
  assert.equal(hits[0].title, "Dr Jane");
  assert.ok(!JSON.stringify(hits).includes("206-555-0199"), "snippet text must not survive");
  assert.equal(hits.filter((h) => h.url.startsWith("https://a.example")).length, 1, "deduped");
});

test("search failures are failures, not zero results", async () => {
  const saved = process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  assert.equal((await braveSearch("q")).status, "not_configured");
  process.env.BRAVE_SEARCH_API_KEY = "k";
  try {
    const http = await braveSearch("q", { fetcher: (async () => new Response("x", { status: 500 })) as typeof fetch });
    assert.equal(http.status, "http_error");
    const timeout = await braveSearch("q", { fetcher: (async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; }) as typeof fetch });
    assert.equal(timeout.status, "timeout");
    let seen: Request | null = null;
    const ok = await braveSearch("\"Jane Holloway\" neurology", { country: "US", fetcher: (async (u: string, init: RequestInit) => { seen = new Request(u, init); return Response.json({ web: { results: [] } }); }) as typeof fetch });
    assert.deepEqual(ok, { status: "ok", hits: [] });
    const u = new URL(seen!.url);
    assert.equal(u.origin + u.pathname, "https://api.search.brave.com/res/v1/web/search");
    assert.equal(u.searchParams.get("count"), "8");
    assert.equal(u.searchParams.get("result_filter"), "web");
    assert.equal(u.searchParams.get("country"), "US");
    assert.equal(seen!.headers.get("x-subscription-token"), "k");
    assert.equal(seen!.headers.get("accept"), "application/json");
  } finally {
    if (saved === undefined) delete process.env.BRAVE_SEARCH_API_KEY; else process.env.BRAVE_SEARCH_API_KEY = saved;
  }
});

test("a failed search produces no research and says so", async () => {
  const failing = (async () => ({ status: "timeout", error: "Brave search timed out" })) as unknown as typeof braveSearch;
  const r = await discoverProvider(provider(), neuro, { orgs: ORGS }, null, { search: failing, fetcher: fetch });
  assert.equal(r.research, null);
  assert.equal(r.log.outcome, "search_failed");
  assert.equal(r.log.search.status, "timeout");
});

test("query uses the registry name, org, city and specialty; only the name/org are quoted", () => {
  const q = discoveryQuery(provider(), neuro, { orgs: ORGS }, { city: "Seattle", state: "WA" });
  assert.equal(q, "\"Jane Holloway\" MD \"Northgate Neurology Associates\" Seattle WA neurology");
});

// ── Which URLs get fetched ───────────────────────────────────────────────────

test("aggregators, PDFs and non-https are never fetched; org-domain pages rank first", () => {
  const ranked = rankHits([
    { url: "https://www.healthgrades.com/physician/dr-jane-holloway" },
    { url: "https://example.org/files/holloway.pdf" },
    { url: "http://insecure.example/holloway" },
    { url: "https://randomblog.example/post" },
    { url: "https://www.northgateneurology.com/providers/jane-holloway", title: "Jane Holloway" },
  ], provider(), ORGS);
  assert.match(ranked[0].skip!, /aggregator/);
  assert.match(ranked[1].skip!, /document/);
  assert.equal(ranked[2].skip, "not https");
  const best = ranked.filter((h) => !h.skip).sort((a, b) => b.priority - a.priority)[0];
  assert.equal(best.url, "https://www.northgateneurology.com/providers/jane-holloway");
  assert.equal(familyForPage(best.url, ORGS).family, "first_party");
  assert.equal(familyForPage("https://randomblog.example/post", ORGS).family, "independent");
});

// ── Page corroboration ───────────────────────────────────────────────────────

test("name alone on a fetched page is NOT identity", () => {
  const e = corroboratePage(provider(), neuro, ORGS, page("https://randomblog.example/p", "<p>Dr. Jane Holloway is a neurologist in Seattle.</p>"));
  assert.equal(e.nameOnPage, true);
  assert.equal(e.accepted, false);
  assert.match(e.reason, /name match alone/);
  assert.equal(researchFromPages(provider(), neuro, [e], ["q"], Date.now()), null);
});

test("last name without first name is not a name match", () => {
  const e = corroboratePage(provider(), neuro, ORGS, page("https://x.example/p", "<p>Dr. Holloway, 206-555-0100, 1560 N 115th St</p>"));
  assert.equal(e.nameOnPage, false);
  assert.equal(e.accepted, false);
});

test("name + registry address + phone + labelled fax on the page is accepted with exact evidence", () => {
  const html = "<h1>Jane Q. Holloway, MD</h1><p>Neurology</p><p>Northgate Neurology Associates, 1560 North 115th Street, Suite 201, Seattle WA 98133</p><p>Phone: (206) 555-0100 · Fax: (206) 555-0199</p>";
  const e = corroboratePage(provider(), neuro, ORGS, page("https://www.northgateneurology.com/providers/jane-holloway", html));
  assert.equal(e.accepted, true);
  assert.equal(e.specialtyOnPage, true);
  assert.equal(e.family, "first_party");
  assert.deepEqual(e.locations[0], { index: 0, address: true, phone: "2065550100", fax: "2065550199", referralFax: false, extraFax: null });
});

test("a page number is only a fax when labelled fax; referral wording must be next to it", () => {
  const plain = corroboratePage(provider(), neuro, ORGS, page("https://x.example/p", "<p>Jane Holloway MD, 1560 N 115th St. Call 206-555-0199 for appointments.</p>"));
  assert.equal(plain.locations[0].fax, null, "unlabelled number is not a fax");
  const ref = corroboratePage(provider(), neuro, ORGS, page("https://x.example/p", "<p>Jane Holloway MD, 1560 N 115th St.</p><p>Referral fax: 206-555-0199</p>"));
  assert.equal(ref.locations[0].fax, "2065550199");
  assert.equal(ref.locations[0].referralFax, true);
});

test("a new fax is only taken when it sits next to this location's street address", () => {
  const near = corroboratePage(provider(), neuro, ORGS, page("https://x.example/p", "<p>Jane Holloway MD</p><p>1560 N 115th St, Seattle · Fax 206-555-0777</p>"));
  assert.equal(near.locations[0].extraFax, "2065550777");
  const far = corroboratePage(provider(), neuro, ORGS, page("https://x.example/p", `<p>Jane Holloway MD</p><p>1560 N 115th St, Seattle</p>${" other clinic text".repeat(60)}<p>Bellevue site fax 425-555-0777</p>`));
  assert.equal(far.locations[0].extraFax, null);
});

test("specialty wording must be near the provider's name, not anywhere on a hospital page", () => {
  const far = corroboratePage(provider(), neuro, ORGS, page("https://x.example/p", `<p>Jane Holloway MD, 1560 N 115th St</p>${" lorem ipsum".repeat(80)}<p>Our departments: Neurology, Cardiology</p>`));
  assert.equal(far.specialtyOnPage, false);
});

// ── Evidence → existing confidence model ─────────────────────────────────────

const noNet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response("no", { status: 404 })) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const opts = { origin: { lat: 47.71, lon: -122.34 }, radiusMi: 10, specialty: neuro, license: null };

test("strong fetched evidence raises the existing dimensions; weak evidence leaves them alone", async () => {
  await noNet(async () => {
    const p = provider();
    const before = await buildView(p, null, opts);
    const strong = corroboratePage(p, neuro, ORGS, page("https://www.northgateneurology.com/providers/jane-holloway", "<h1>Jane Holloway, MD — Neurology</h1><p>1560 N 115th St, Seattle WA 98133</p><p>Phone 206-555-0100 Fax 206-555-0199</p>"));
    const research = researchFromPages(p, neuro, [strong], ["q"], Date.now())!;
    assert.equal(research.method, "public_web");
    assert.equal(research.usage.inputTokens, 0);
    const after = await buildView(p, research, opts);
    assert.ok(after.providerScore.score > before.providerScore.score, `provider ${before.providerScore.score} → ${after.providerScore.score}`);
    assert.ok(after.locations[0].referral.score > before.locations[0].referral.score, `destination ${before.locations[0].referral.score} → ${after.locations[0].referral.score}`);
    assert.ok(after.providerScore.items.some((i) => /official practice/.test(i.label)));

    // Independent page that only matches the phone: identity yes, but the address / fax stay NPI-only.
    const weak = corroboratePage(p, neuro, [], page("https://somedirectory.example/jane", "<p>Jane Holloway</p><p>206-555-0100</p>"));
    assert.equal(weak.accepted, true);
    const w = await buildView(p, researchFromPages(p, neuro, [weak], ["q"], Date.now()), opts);
    assert.ok(w.locations[0].referral.score < after.locations[0].referral.score);
    assert.ok(w.locations[0].referral.score < 50, `weak evidence stays weak (${w.locations[0].referral.score})`);
  });
});

// ── Demo defects fixed on this path ──────────────────────────────────────────

test("psychiatry / psychotherapy is not a Neurology specialty match", () => {
  assert.equal(specialtyReallyDiffers("psychiatry/psychotherapy", ["Psychiatry & Neurology, Neurology"]), true);
  assert.equal(specialtyReallyDiffers("Neurology", ["Psychiatry & Neurology, Neurology"]), false);
  assert.equal(specialtyReallyDiffers("Psychiatry", ["Psychiatry & Neurology, Psychiatry"]), false);
  assert.equal(specialtyReallyDiffers("Immunology", ["Allergy & Immunology, Allergy"]), false);
});

test("location input casing is normalised", () => {
  assert.equal(normalizeLocation("Seattle, Wa"), "Seattle, WA");
  assert.equal(normalizeLocation("seattle wa"), "Seattle, WA");
  assert.equal(normalizeLocation("Seattle, WA 98115"), "Seattle, WA 98115");
  assert.equal(normalizeLocation("spokane, wa 99201"), "Spokane, WA 99201");
  assert.equal(normalizeLocation("98115"), "98115");
  assert.equal(normalizeLocation("1959 NE Pacific St, Seattle, wa 98195"), "1959 NE Pacific St, Seattle, WA 98195");
  assert.equal(normalizeLocation("Coeur d'Alene, id"), "Coeur d'Alene, ID");
});

export type { SearchOutcome };
