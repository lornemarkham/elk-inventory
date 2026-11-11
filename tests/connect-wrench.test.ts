// Connect Wrench handoff: return-origin allow-list and fragment encoding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHandoffUrl, encodeSessionFragment, parseReturnUrl } from "../src/lib/connectWrench.ts";

const S = { access_token: "a.b.c", refresh_token: "r-1", expires_at: 1790000000 };

test("allows the Wrench origin, any path", () => {
  assert.equal(parseReturnUrl("https://elk-wrench.vercel.app/")?.href, "https://elk-wrench.vercel.app/");
  assert.equal(parseReturnUrl("https://elk-wrench.vercel.app/a?b=1")?.pathname, "/a");
});

test("localhost only in dev", () => {
  assert.equal(parseReturnUrl("http://localhost:5173/"), null);
  assert.ok(parseReturnUrl("http://localhost:5173/", true));
});

test("refuses everything else", () => {
  for (const bad of [
    null, "", "not a url", "https://evil.example/", "http://elk-wrench.vercel.app/",
    "https://elk-wrench.vercel.app.evil.example/", "https://evil.example/https://elk-wrench.vercel.app/",
    "https://elk-wrench.vercel.app@evil.example/", "https://user:pw@elk-wrench.vercel.app/",
    "//evil.example/", "javascript:alert(1)", "https://elk-wrench.vercel.app:444/",
  ]) assert.equal(parseReturnUrl(bad as string), null, String(bad));
});

test("fragment is base64url JSON of exactly the three fields", () => {
  const f = encodeSessionFragment({ ...S, extra: "x" } as typeof S);
  assert.match(f, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(JSON.parse(Buffer.from(f, "base64url").toString()), S);
});

test("handoff URL uses the fragment only and replaces any incoming hash", () => {
  const r = parseReturnUrl("https://elk-wrench.vercel.app/x?q=1#old")!;
  const u = new URL(buildHandoffUrl(r, S));
  assert.equal(u.search, "?q=1");
  assert.ok(u.hash.startsWith("#elk-inventory-session="));
  assert.ok(!u.search.includes("a.b.c"));
});
