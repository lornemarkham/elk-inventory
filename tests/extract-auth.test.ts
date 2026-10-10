// /api/extract is family-only: no OpenAI call unless Supabase says the caller is a member.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerToken, checkFamilyMember } from "../api/_extract-auth.ts";
import handler from "../api/extract.ts";

const CFG = { supabaseUrl: "https://proj.supabase.co", anonKey: "anon" };
const req = (auth?: string, body: unknown = { text: "1x Hammer $10" }) =>
  new Request("https://elk/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
const rpc = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

test("bearer token parsing", () => {
  assert.equal(bearerToken(req("Bearer abc.def.ghi")), "abc.def.ghi");
  assert.equal(bearerToken(req()), null);
  assert.equal(bearerToken(req("Basic abc")), null);
  assert.equal(bearerToken(req("Bearer ")), null);
});

test("gate: only a 200 `true` from elk_is_family_member() lets a caller through", async () => {
  assert.deepEqual(await checkFamilyMember(req("Bearer t"), { ...CFG, fetchImpl: rpc(200, true) }), { ok: true });
  const deny = [
    [req(), rpc(200, true), 401],                        // no token: Supabase never asked
    [req("Bearer t"), rpc(200, false), 403],             // signed in, not family
    [req("Bearer t"), rpc(401, { message: "JWT expired" }), 401], // forged/expired
    [req("Bearer t"), rpc(404, { code: "PGRST202" }), 403],       // family-access SQL not applied yet
    [req("Bearer t"), rpc(200, "true"), 403],            // anything but boolean true
    [req("Bearer t"), async () => { throw new TypeError("network"); }, 503],
  ] as const;
  for (const [r, f, status] of deny) {
    const g = await checkFamilyMember(r, { ...CFG, fetchImpl: f as typeof fetch });
    assert.equal(g.ok, false);
    assert.equal(!g.ok && g.status, status);
  }
  assert.equal((await checkFamilyMember(req("Bearer t"), { fetchImpl: rpc(200, true) as typeof fetch, supabaseUrl: "", anonKey: "" })).ok, false);
});

test("gate sends the caller's token and the anon key to the RPC", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  await checkFamilyMember(req("Bearer user.jwt"), {
    ...CFG,
    fetchImpl: (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response("true"); }) as typeof fetch,
  });
  assert.equal(seen?.url, "https://proj.supabase.co/rest/v1/rpc/elk_is_family_member");
  const h = seen?.init.headers as Record<string, string>;
  assert.equal(h.Authorization, "Bearer user.jwt");
  assert.equal(h.apikey, "anon");
});

test("handler: unauthorized requests never reach OpenAI", async () => {
  const realFetch = globalThis.fetch;
  const env = { ...process.env };
  const calls: string[] = [];
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.VITE_SUPABASE_URL = CFG.supabaseUrl;
  process.env.VITE_SUPABASE_ANON_KEY = CFG.anonKey;
  let member = false;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("/rpc/elk_is_family_member")) return new Response(JSON.stringify(member));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"products":[]}' } }] }));
  }) as typeof fetch;
  try {
    assert.equal((await handler(req())).status, 401);
    assert.equal((await handler(req("Bearer outsider"))).status, 403);
    assert.ok(!calls.some((u) => u.includes("openai.com")), "no OpenAI call for outsiders");

    member = true;
    assert.equal((await handler(req("Bearer family"))).status, 200);
    assert.ok(calls.some((u) => u.includes("openai.com")), "members still get extraction");
  } finally {
    globalThis.fetch = realFetch;
    process.env = env;
  }
});
