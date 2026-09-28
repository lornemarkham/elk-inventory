// TEMPORARY NPI demo tests — `npm test` (node:test, Node's built-in TS type stripping).
// Network is mocked: MCP lookup + OpenAI Responses shapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSearch, scoreProvider, normalize, validateProvider } from "../api/_npi-lib.ts";

test("planSearch: NPI", () => {
  const p = planSearch("1831725753");
  assert.equal(p.npi, "1831725753");
});

test("planSearch: specialty + city + state", () => {
  const p = planSearch("ENT Seattle WA");
  assert.equal(p.npi, null);
  assert.deepEqual(p.plans[0].params, { state: "WA", taxonomy_description: "Otolaryngology", city: "Seattle", address_purpose: "LOCATION" });
});

test("planSearch: name + full state name", () => {
  const p = planSearch("Sarah Johnson California");
  assert.deepEqual(p.plans[0].params, { state: "CA", first_name: "Sarah", last_name: "Johnson", address_purpose: "LOCATION" });
});

test("planSearch: audiologist Boston MA", () => {
  const p = planSearch("audiologist Boston MA");
  assert.equal(p.plans[0].params.taxonomy_description, "Audiologist");
  assert.equal(p.plans[0].params.city, "Boston");
  assert.equal(p.plans[0].params.state, "MA");
});

test("planSearch: state alone yields no plan", () => {
  assert.equal(planSearch("MA").plans.length, 0);
  assert.equal(planSearch("California").plans.length, 0);
});

const RAW = {
  number: "1831725753",
  enumeration_type: "NPI-1",
  basic: { first_name: "SHAUNAK", middle_name: "NISHITH", last_name: "AMIN", credential: "M.D.", status: "A", last_updated: "2023-07-14", enumeration_date: "2020-03-23", sole_proprietor: "NO", sex: "M" },
  addresses: [
    { address_purpose: "LOCATION", address_1: "1959 NE PACIFIC ST", city: "SEATTLE", state: "WA", postal_code: "981950011", telephone_number: "206-598-3300" },
    { address_purpose: "MAILING", address_1: "1959 NE PACIFIC ST", city: "SEATTLE", state: "WA", postal_code: "981950001" },
  ],
  practiceLocations: [],
  taxonomies: [{ code: "207Y00000X", desc: "Otolaryngology", primary: true, state: "WA", license: "ML1" }],
  identifiers: [],
  other_names: [],
  endpoints: [],
};

test("normalize: names, phone, zip, credential", () => {
  const d = normalize(RAW, "CMS NPPES API");
  assert.equal(d.name, "Shaunak Nishith Amin");
  assert.equal(d.credential, "MD");
  assert.equal(d.phone, "(206) 598-3300");
  assert.equal(d.addresses[0].postalCode, "98195-0011");
  assert.equal(d.addresses[0].line1, "1959 NE Pacific St");
  assert.equal(d.practiceLocationCount, 1);
});

test("scoreProvider: baseline is registry-only", () => {
  const s = scoreProvider(normalize(RAW, "CMS NPPES API"), null);
  assert.ok(s.score <= 30);
  assert.ok(s.items.some((i) => i.kind === "unknown"));
});

test("validateProvider: end-to-end with mocked MCP + OpenAI; drops unsourced and mirror claims", async () => {
  const realFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  const calls: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (String(url).includes("mcp")) {
      return Response.json({ jsonrpc: "2.0", id: 1, result: { structuredContent: { found: true, record: { raw: RAW } } } });
    }
    if (body.tools) {
      assert.equal(body.tools[0].type, "web_search");
      return Response.json({
        output: [
          { type: "web_search_call", status: "completed", action: { type: "search", query: "Shaunak Amin MD Seattle", sources: [{ url: "https://www.uwmedicine.org/bios/shaunak-amin" }, { url: "https://npiprofile.com/npi/1831725753" }] } },
          { type: "message", content: [{ type: "output_text", text: "UW Medicine lists Dr. Amin at 1959 NE Pacific St, phone 206-598-4022 https://www.uwmedicine.org/bios/shaunak-amin", annotations: [{ type: "url_citation", url: "https://www.uwmedicine.org/bios/shaunak-amin", title: "Shaunak Amin, MD | UW Medicine" }] }] },
        ],
        usage: { input_tokens: 1000, output_tokens: 200 },
      });
    }
    assert.equal(body.text.format.type, "json_schema");
    const fields = ["identity", "organization", "address", "phone", "fax", "specialty", "website"].map((field) => ({
      field, npiValue: null, assessment: "not_found", likelyCurrent: null, confidence: 0, reason: "", findings: [] as unknown[],
    }));
    fields[0] = { ...fields[0], assessment: "agrees", confidence: 90, findings: [{ value: "Shaunak Amin, MD — otolaryngologist", sourceIds: ["S1"] }] };
    fields[1] = { ...fields[1], assessment: "new_information", confidence: 85, likelyCurrent: "UW Medicine", findings: [{ value: "UW Medicine", sourceIds: ["S1"] }] };
    fields[3] = { ...fields[3], npiValue: "(206) 598-3300", assessment: "agrees", confidence: 80, findings: [{ value: "(206) 598-4022", sourceIds: ["S1"] }] };
    fields[4] = { ...fields[4], assessment: "new_information", findings: [{ value: "(206) 555-0000", sourceIds: ["S9"] }] }; // unknown source id
    fields[5] = { ...fields[5], assessment: "agrees", findings: [{ value: "Otolaryngology", sourceIds: ["S2"] }] }; // mirror site only
    return Response.json({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ summary: "ok", identityConfirmed: true, sources: [{ id: "S1", name: "UW Medicine profile", sourceType: "health_system", confirms: ["identity"], summary: "Profile page." }], fields }) }] }],
      usage: { input_tokens: 500, output_tokens: 300 },
    });
  }) as typeof fetch;

  try {
    const events: { type: string; result?: import("../src/npi/types.ts").ValidationResult }[] = [];
    await validateProvider("1831725753", true, (e) => events.push(e as never));
    const result = events.find((e) => e.type === "result")?.result;
    assert.ok(result, "got a result");
    const f = (k: string) => result.fields.find((x) => x.field === k)!;
    assert.equal(f("identity").assessment, "agrees");
    assert.equal(f("phone").assessment, "conflict", "phone checked by digits, not model");
    assert.equal(f("fax").findings.length, 0, "unknown source id dropped");
    assert.equal(f("specialty").assessment, "not_found", "mirror-only evidence dropped");
    assert.deepEqual(result.sources.map((s) => s.domain), ["uwmedicine.org"]);
    assert.ok(result.score.items.some((i) => i.label.startsWith("Phone differs")));
    assert.equal(result.usage.inputTokens, 1500);
    assert.ok(events.some((e) => e.type === "sources"));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
  }
});
