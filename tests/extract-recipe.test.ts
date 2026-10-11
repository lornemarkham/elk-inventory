// /api/extract recipe mode (ELK Kitchen): same family-only gate, own prompt/schema.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RECIPE_IMAGES, buildRecipeOpenAIBody, heartbeatJson, isRecipeRequest, parseRecipeRequest } from "../api/_extract-recipe.ts";
import handler from "../api/extract.ts";

const PNG = "iVBORw0KGgo=";
const req = (auth: string | undefined, body: unknown) =>
  new Request("https://elk/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  });

test("only kind: recipe opts in; Inventory requests are unchanged", () => {
  assert.equal(isRecipeRequest({ kind: "recipe" }), true);
  assert.equal(isRecipeRequest({ text: "1x Hammer" }), false);
  assert.equal(isRecipeRequest({ kind: "products" }), false);
  assert.equal(isRecipeRequest(null), false);
});

test("validation", () => {
  assert.equal(parseRecipeRequest({ kind: "recipe" }).ok, false);
  assert.equal(parseRecipeRequest({ images: [{ base64: "not base64!" }] }).ok, false);
  assert.equal(parseRecipeRequest({ images: Array(MAX_RECIPE_IMAGES + 1).fill({ base64: PNG }) }).ok, false);
  assert.equal(parseRecipeRequest({ images: [{ base64: "A".repeat(4_000_001) }] }).ok, false);
  const ok = parseRecipeRequest({ images: [{ base64: PNG, mediaType: "image/png" }, { base64: PNG, mediaType: "text/html" }] });
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.images.map((i) => i.mediaType), ["image/png", "image/jpeg"]);
});

test("every page goes to the model, in order, with a strict schema", () => {
  const body = JSON.parse(buildRecipeOpenAIBody({ text: "", images: [{ base64: "AA", mediaType: "image/jpeg" }, { base64: "BB", mediaType: "image/png" }] }, "m"));
  const parts = body.messages[1].content;
  assert.match(parts[0].text, /2 pages/);
  assert.deepEqual(parts.slice(1).map((p: { image_url: { url: string } }) => p.image_url.url), ["data:image/jpeg;base64,AA", "data:image/png;base64,BB"]);
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.max_tokens, 4000);
});

test("slow reads stay alive: whitespace first, then the JSON; failures arrive as { error }", async () => {
  const slow = heartbeatJson(() => new Promise((r) => setTimeout(() => r({ title: "Soup" }), 40)), 10);
  assert.equal(slow.status, 200);
  const text = await slow.text();
  assert.match(text, /^ {2,}\{/);
  assert.deepEqual(JSON.parse(text), { title: "Soup" });
  const failed = heartbeatJson(async () => { throw new Error("timeout"); });
  assert.deepEqual(await failed.json(), { error: "Extraction failed: timeout" });
});

test("handler: recipe mode is family-only and returns the model's recipe", async () => {
  const realFetch = globalThis.fetch;
  const env = { ...process.env };
  const calls: string[] = [];
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.VITE_SUPABASE_URL = "https://proj.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = "anon";
  let member = false;
  const recipe = { title: "Scones", servings: null, prepTime: null, cookTime: null, source: "Gran", ingredients: ["2 cups flour"], instructions: ["Mix."], notes: "", tags: [], unclear: [] };
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("/rpc/elk_is_family_member")) return new Response(JSON.stringify(member));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(recipe) } }] }));
  }) as typeof fetch;
  const body = { kind: "recipe", images: [{ base64: PNG, mediaType: "image/png" }] };
  try {
    assert.equal((await handler(req(undefined, body))).status, 401);
    assert.equal((await handler(req("Bearer outsider", body))).status, 403);
    assert.ok(!calls.some((u) => u.includes("openai.com")));
    member = true;
    assert.equal((await handler(req("Bearer family", { kind: "recipe" }))).status, 400);
    const res = await handler(req("Bearer family", body));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), recipe);
  } finally {
    globalThis.fetch = realFetch;
    process.env = env;
  }
});
