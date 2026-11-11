// ELK Inventory MCP server: protocol, tools, permissions, confirmation.
// Runs against an in-memory PostgREST stand-in that, like the real database,
// answers only for tokens it knows and only for family members.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRpc, checkMember, toolList, type Ctx } from "../api/_mcp-core";
import handler from "../api/mcp";

const mkJwt = (sub: string) => `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.s`;
const LORNE = mkJwt("u-lorne"), STRANGER = mkJwt("u-stranger"), FORGED = mkJwt("u-ghost");
const NOW = Date.parse("2026-11-10T12:00:00Z");

function world(opts: { shopping?: boolean; lots?: boolean; familyFn?: boolean } = {}) {
  const { shopping = true, lots = true, familyFn = true } = opts;
  const t: Record<string, any[]> = {
    inventory_items: [
      { id: "t-drill", name: "Ryobi Drill", item_class: "tool", lifecycle_state: "available", domain: "workshop", current_zone: "mechanic-bay", location_detail: "Shelf 2", container_id: null, quantity: 1, notes: "", tags: [], attributes: {}, category: "power-tools" },
      { id: "t-bench", name: "Bench Press", item_class: "equipment", lifecycle_state: "available", domain: "fitness", current_zone: "strength-zone", location_detail: "", container_id: null, quantity: 1, notes: "", tags: [], attributes: {} },
      { id: "t-pi", name: "Raspberry Pi 4", item_class: "equipment", lifecycle_state: "available", domain: "electronics", current_zone: "elk-labs", location_detail: "", container_id: "black-electronics-tote", quantity: 3, notes: "", tags: [], attributes: {} },
      { id: "t-saw", name: "Table Saw", item_class: "tool", lifecycle_state: "available", domain: "workshop", current_zone: "pool-shed", location_detail: "", container_id: null, quantity: 1, notes: "Keep out of prime garage space", tags: [], attributes: {} },
      { id: "f-beans", name: "Black Beans", item_class: "material", lifecycle_state: "available", domain: "food-storage", current_zone: "storage-room-pantry", location_detail: "Shelf A", container_id: null, quantity: 12, notes: "", tags: [], attributes: { pantryTracked: true } },
      { id: "m-screws", name: "Wood Screws", item_class: "material", lifecycle_state: "available", domain: "workshop", current_zone: "mechanic-bay", location_detail: "", container_id: null, quantity: 100, notes: "", tags: [], attributes: {} },
    ],
    stock_lots: [
      { id: "l1", item_id: "f-beans", quantity_remaining: 4, location: "Shelf A", best_before: "2026-11-05", purchased_on: "2026-01-01", source: "purchase" },
      { id: "l2", item_id: "f-beans", quantity_remaining: 8, location: "Shelf A", best_before: "2026-11-20", purchased_on: "2026-02-01", source: "purchase" },
      { id: "l3", item_id: "f-beans", quantity_remaining: 5, location: "Shelf A", best_before: "2027-06-01", purchased_on: "2026-03-01", source: "purchase" },
    ],
    stock_movements: [{ item_id: "f-beans", kind: "used", quantity_delta: -2, note: null, created_at: "2026-11-09T10:00:00Z", created_by: "u-lorne" }],
    pantry_shopping_items: [{ id: "s1", name: "Milk", note: null, source: "manual", item_id: null, created_at: "2026-11-09T10:00:00Z", done_at: null }],
    elk_family_members: [{ user_id: "u-lorne", display_name: "Lorne" }],
  };
  const calls: Array<{ method: string; path: string; auth: string; apikey: string; body: any }> = [];
  const rpcs: Array<{ fn: string; args: any }> = [];
  const fetchImpl = (async (url: string, init: any) => {
    const u = new URL(url), path = u.pathname.replace("/rest/v1/", "");
    const auth = init.headers.Authorization as string, body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: path + u.search, auth, apikey: init.headers.apikey, body });
    const R = (status: number, b: unknown) => new Response(status === 204 ? null : JSON.stringify(b), { status });
    const tok = auth.replace("Bearer ", "");
    const uid = tok === LORNE ? "u-lorne" : tok === STRANGER ? "u-stranger" : null;
    if (!uid) return R(401, { code: "PGRST301", message: "JWT invalid" });
    const member = t.elk_family_members.some((m) => m.user_id === uid);
    if (path === "rpc/elk_is_family_member") return familyFn ? R(200, member) : R(404, { code: "PGRST202" });
    if (!member) return path.startsWith("rpc/") ? R(403, { code: "42501", message: "This account isn't on the family list yet." }) : R(200, []);
    if (path.startsWith("rpc/")) {
      const fn = path.slice(4); rpcs.push({ fn, args: body });
      if (fn === "pantry_shopping_add") {
        if (!shopping) return R(404, { code: "PGRST202" });
        let n = 0;
        for (const name of body.p_names) if (!t.pantry_shopping_items.some((s) => !s.done_at && s.name.toLowerCase() === name.toLowerCase())) { t.pantry_shopping_items.push({ id: `s${t.pantry_shopping_items.length + 1}`, name, note: body.p_note, source: "manual", created_at: "x", done_at: null }); n++; }
        return R(200, n);
      }
      if (fn === "pantry_receive") {
        if (!lots) return R(404, { code: "PGRST202" });
        const it = t.inventory_items.find((i) => i.id === body.p_item_id);
        if (it) it.quantity += body.p_quantity;
        else t.inventory_items.push({ id: body.p_item_id, name: body.p_new_name, item_class: "material", lifecycle_state: "available", domain: "food-storage", current_zone: "storage-room-pantry", location_detail: body.p_location, container_id: null, quantity: body.p_quantity, notes: "", tags: [], attributes: { pantryTracked: true } });
        return R(200, "batch");
      }
      if (fn === "pantry_use") { if (!lots) return R(404, { code: "PGRST202" }); t.inventory_items.find((i) => i.id === body.p_item_id)!.quantity -= body.p_quantity; return R(200, "batch"); }
      return R(404, { code: "PGRST202" });
    }
    const table = t[path];
    if (!table || (path === "stock_lots" || path === "stock_movements") && !lots || path === "pantry_shopping_items" && !shopping) return R(404, { code: "PGRST205" });
    let rows = table.filter((r) => [...u.searchParams].every(([k, v]) => {
      if (["select", "order", "limit"].includes(k)) return true;
      const [op, ...rest] = v.split("."), val = rest.join(".");
      if (op === "eq") return String(r[k]) === val;
      if (op === "gt") return r[k] > Number(val);
      if (op === "gte") return r[k] >= val;
      if (op === "lte") return r[k] <= val;
      if (op === "is") return r[k] == null;
      return true;
    }));
    if (init.method === "GET") return R(200, rows);
    if (init.method === "POST") { table.push(body); return R(201, [body]); }
    if (init.method === "PATCH") { rows.forEach((r) => Object.assign(r, body)); return R(200, rows); }
    if (init.method === "DELETE") { t[path] = table.filter((r) => !rows.includes(r)); return R(204, null); }
    return R(400, {});
  }) as unknown as typeof fetch;
  const ctx = (token = LORNE, extra: Partial<Ctx> = {}): Ctx => ({ supabaseUrl: "https://x.supabase.co", anonKey: "sb_publishable_anon", token, fetchImpl, confirmSecret: "test-secret", now: () => NOW, ...extra });
  return { t, calls, rpcs, ctx };
}

async function call(c: Ctx, name: string, args: Record<string, unknown> = {}, user = "u-lorne") {
  const r: any = await handleRpc(c, user, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  return { isError: r.result.isError === true, out: r.result.structuredContent ?? r.result.content[0].text };
}

// ── protocol ──
test("tools/list exposes the eight required tools, with honest hints", async () => {
  const names = toolList().map((t) => t.name);
  for (const n of ["inventory_search", "inventory_get_item", "inventory_list_locations", "inventory_get_expiring", "inventory_get_shopping_list", "inventory_add_item", "inventory_adjust_quantity", "inventory_add_to_shopping_list"]) assert.ok(names.includes(n), n);
  for (const tool of toolList()) {
    const ro = (tool.annotations as any).readOnlyHint;
    assert.equal(ro, /_(search|get_|list_)/.test(tool.name), `${tool.name} readOnlyHint`);
  }
  assert.equal((toolList().find((t) => t.name === "inventory_adjust_quantity")!.annotations as any).destructiveHint, true);
});

test("initialize negotiates version; notifications get no reply; unknown things are refused", async () => {
  const w = world();
  const init: any = await handleRpc(w.ctx(), "u", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.equal(await handleRpc(w.ctx(), "u", { jsonrpc: "2.0", method: "notifications/initialized" }), null);
  const bad: any = await handleRpc(w.ctx(), "u", { jsonrpc: "2.0", id: 2, method: "nope" });
  assert.equal(bad.error.code, -32601);
  const unk: any = await handleRpc(w.ctx(), "u", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "inventory_delete_everything" } });
  assert.equal(unk.error.code, -32602);
});

// ── permissions ──
test("only family members get in; a missing family list fails closed", async () => {
  const w = world();
  assert.deepEqual(await checkMember(w.ctx(LORNE)), { ok: true, userId: "u-lorne" });
  assert.equal((await checkMember(w.ctx(STRANGER)) as any).status, 403);
  assert.equal((await checkMember(w.ctx(FORGED)) as any).status, 401);
  assert.equal((await checkMember(world({ familyFn: false }).ctx(LORNE)) as any).status, 503);
});

test("HTTP: no token → 401 with OAuth discovery; wrong verb → 405; stranger → 403", async () => {
  process.env.SUPABASE_URL = "https://x.supabase.co"; process.env.SUPABASE_ANON_KEY = "k";
  const r = await handler(new Request("https://elk-inventory.vercel.app/api/mcp", { method: "POST", body: "{}" }));
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate")!, /resource_metadata="https:\/\/elk-inventory\.vercel\.app\/\.well-known\/oauth-protected-resource"/);
  assert.equal((await handler(new Request("https://elk-inventory.vercel.app/api/mcp"))).status, 405);
});

test("every database call uses the member's own token + the public key — no other credential", async () => {
  const w = world();
  await call(w.ctx(), "inventory_search", { query: "drill" });
  await call(w.ctx(), "inventory_add_to_shopping_list", { names: ["Eggs"] });
  assert.ok(w.calls.length >= 2);
  for (const c of w.calls) { assert.equal(c.auth, `Bearer ${LORNE}`); assert.equal(c.apikey, "sb_publishable_anon"); }
});

// ── reads ──
test("\"what do I have in my garage?\" resolves the place and says what it matched", async () => {
  const { out } = await call(world().ctx(), "inventory_search", { location: "garage" });
  const names = out.items.map((i: any) => i.name).sort();
  assert.deepEqual(names, ["Bench Press", "Raspberry Pi 4", "Ryobi Drill", "Wood Screws"]);
  assert.ok(!names.includes("Table Saw"), "pool shed note mentioning garage must not match");
  assert.ok(out.matched_locations.zones.includes("Mechanic Bay"));
});

test("search by words, class (supplies), category, quantity totals", async () => {
  const w = world();
  assert.equal((await call(w.ctx(), "inventory_search", { query: "ryobi drill" })).out.items[0].id, "t-drill");
  assert.deepEqual((await call(w.ctx(), "inventory_search", { item_class: "material" })).out.items.map((i: any) => i.id).sort(), ["f-beans", "m-screws"]);
  assert.equal((await call(w.ctx(), "inventory_search", { category: "power" })).out.total_matches, 1);
  assert.equal((await call(w.ctx(), "inventory_search", { query: "pi", location: "mechanic bay" })).out.total_matches, 0);
});

test("get_item shows batches and movements; by name; ambiguous names list candidates", async () => {
  const w = world();
  const a = (await call(w.ctx(), "inventory_get_item", { item_id: "f-beans" })).out;
  assert.equal(a.batches.length, 3); assert.equal(a.recent_movements[0].kind, "used");
  assert.equal((await call(w.ctx(), "inventory_get_item", { name: "table saw" })).out.item.id, "t-saw");
  assert.equal((await call(w.ctx(), "inventory_get_item", { item_id: "nope" })).isError, true);
});

test("list_locations counts zones and containers", async () => {
  const { out } = await call(world().ctx(), "inventory_list_locations");
  assert.equal(out.zones.find((z: any) => z.id === "mechanic-bay").items, 2);
  assert.equal(out.containers.find((c: any) => c.id === "black-electronics-tote").items, 1);
});

test("expiring: expired first, window respected, days_left computed", async () => {
  const { out } = await call(world().ctx(), "inventory_get_expiring", { within_days: 14 });
  assert.deepEqual(out.batches.map((b: any) => [b.quantity, b.days_left, b.expired]), [[4, -5, true], [8, 10, false]]);
  assert.equal((await call(world().ctx(), "inventory_get_expiring", { within_days: 14, include_expired: false })).out.count, 1);
});

test("shopping list and history; missing features say so instead of failing", async () => {
  const w = world();
  assert.equal((await call(w.ctx(), "inventory_get_shopping_list")).out.items[0].name, "Milk");
  const h = (await call(w.ctx(), "inventory_get_history", { days: 30 })).out.movements[0];
  assert.equal(h.by, "Lorne"); assert.equal(h.item, "Black Beans");
  const bare = world({ shopping: false, lots: false });
  assert.equal((await call(bare.ctx(), "inventory_get_shopping_list")).out.status, "not_enabled");
  assert.equal((await call(bare.ctx(), "inventory_get_expiring")).out.status, "not_enabled");
  assert.equal((await call(bare.ctx(), "inventory_add_to_shopping_list", { names: ["x"] })).isError, true);
});

// ── writes ──
test("add_item: adds once, refuses lookalikes, validates, food becomes a pantry batch", async () => {
  const w = world();
  const r = (await call(w.ctx(), "inventory_add_item", { name: "Torque Wrench", quantity: 1, zone: "Mechanic Bay", item_class: "tool" })).out;
  assert.equal(r.status, "added"); assert.equal(w.t.inventory_items.filter((i) => i.name === "Torque Wrench").length, 1);
  assert.equal((await call(w.ctx(), "inventory_add_item", { name: "torque wrench" })).out.status, "possible_duplicate");
  assert.equal(w.t.inventory_items.filter((i) => /torque/i.test(i.name)).length, 1);
  assert.equal((await call(w.ctx(), "inventory_add_item", { name: "Odd", zone: "Moon Base" })).isError, true);
  const food = (await call(w.ctx(), "inventory_add_item", { name: "Rice", quantity: 2, best_before: "2027-01-01" })).out;
  assert.equal(food.status, "added"); assert.equal(w.rpcs.at(-1)!.fn, "pantry_receive");
});

test("adjust_quantity: small change applies directly, tracked food goes through pantry functions", async () => {
  const w = world();
  assert.equal((await call(w.ctx(), "inventory_adjust_quantity", { item_id: "m-screws", delta: -5 })).out.after, 95);
  assert.equal(w.t.inventory_items.find((i) => i.id === "m-screws")!.quantity, 95);
  const f = (await call(w.ctx(), "inventory_adjust_quantity", { item_id: "f-beans", delta: -1 })).out;
  assert.equal(f.recorded_as, "used"); assert.equal(w.rpcs.at(-1)!.fn, "pantry_use");
  await call(w.ctx(), "inventory_adjust_quantity", { item_id: "f-beans", delta: 3 });
  assert.equal(w.rpcs.at(-1)!.fn, "pantry_receive");
  assert.equal((await call(w.ctx(), "inventory_adjust_quantity", { item_id: "m-screws", delta: -500 })).isError, true, "cannot go below zero");
  assert.equal((await call(w.ctx(), "inventory_adjust_quantity", { item_id: "m-screws" })).isError, true);
});

test("significant changes need confirmation: preview first, nothing changes, then token executes exactly once", async () => {
  const w = world();
  const first = (await call(w.ctx(), "inventory_adjust_quantity", { item_id: "t-pi", set_to: 0 })).out;
  assert.equal(first.status, "confirmation_required");
  assert.equal(w.t.inventory_items.find((i) => i.id === "t-pi")!.quantity, 3, "unchanged");
  const args = { item_id: "t-pi", set_to: 0, confirmation_token: first.confirmation_token };
  assert.equal((await call(w.ctx(), "inventory_adjust_quantity", args)).out.status, "adjusted");
  assert.equal(w.t.inventory_items.find((i) => i.id === "t-pi")!.quantity, 0);
  const big = (await call(w.ctx(), "inventory_adjust_quantity", { item_id: "m-screws", delta: -80 })).out;
  assert.equal(big.status, "confirmation_required");
});

test("confirmation token cannot be forged, altered, replayed by someone else, or outlive its time", async () => {
  const w = world();
  const tok = (await call(w.ctx(), "inventory_adjust_quantity", { item_id: "t-pi", set_to: 0 })).out.confirmation_token;
  const tryIt = async (args: any, c = w.ctx(), user = "u-lorne") => (await call(c, "inventory_adjust_quantity", args, user)).out;
  assert.equal((await tryIt({ item_id: "t-pi", set_to: 0, confirmation_token: "x.y" })).status, "confirmation_required", "garbage");
  assert.equal((await tryIt({ item_id: "t-pi", delta: -3, confirmation_token: tok })).status, "confirmation_required", "different arguments (delta instead of set_to)");
  assert.equal((await tryIt({ item_id: "m-screws", set_to: 0, confirmation_token: tok })).status, "confirmation_required", "different item");
  assert.equal((await tryIt({ item_id: "t-pi", set_to: 0, confirmation_token: tok }, w.ctx(LORNE, { confirmSecret: "other" }))).status, "confirmation_required", "wrong key");
  assert.equal((await tryIt({ item_id: "t-pi", set_to: 0, confirmation_token: tok }, w.ctx(), "u-someone-else")).status, "confirmation_required", "other user");
  assert.equal((await tryIt({ item_id: "t-pi", set_to: 0, confirmation_token: tok }, w.ctx(LORNE, { now: () => NOW + 301_000 }))).status, "confirmation_required", "expired");
  assert.equal(w.t.inventory_items.find((i) => i.id === "t-pi")!.quantity, 3);
});

test("with no confirmation secret configured, significant changes are refused, not waved through", async () => {
  const w = world();
  const r = await call(w.ctx(LORNE, { confirmSecret: undefined }), "inventory_adjust_quantity", { item_id: "t-pi", set_to: 0 });
  assert.equal(r.isError, true); assert.equal(w.t.inventory_items.find((i) => i.id === "t-pi")!.quantity, 3);
});

test("a count changed elsewhere in the meantime is not overwritten", async () => {
  const w = world();
  const real = w.ctx();
  const racing: Ctx = { ...real, fetchImpl: (async (u: string, i: any) => { if (i.method === "PATCH") w.t.inventory_items.find((x) => x.id === "m-screws")!.quantity = 90; return real.fetchImpl!(u, i); }) as typeof fetch };
  const r = await call(racing, "inventory_adjust_quantity", { item_id: "m-screws", delta: -1 });
  assert.equal(r.isError, true); assert.equal(w.t.inventory_items.find((x) => x.id === "m-screws")!.quantity, 90);
});

test("shopping list: add skips duplicates; tick off; remove needs confirmation", async () => {
  const w = world();
  assert.deepEqual((await call(w.ctx(), "inventory_add_to_shopping_list", { names: ["milk", "Eggs"], note: "breakfast" })).out, { status: "ok", requested: 2, added: 1, already_on_list: 1 });
  assert.equal((await call(w.ctx(), "inventory_update_shopping_item", { id: "s1", action: "mark_done" })).out.status, "marked_done");
  assert.equal(w.t.pantry_shopping_items[0].done_by, "u-lorne");
  const pre = (await call(w.ctx(), "inventory_update_shopping_item", { id: "s1", action: "remove" })).out;
  assert.equal(pre.status, "confirmation_required"); assert.equal(w.t.pantry_shopping_items.length, 2);
  assert.equal((await call(w.ctx(), "inventory_update_shopping_item", { id: "s1", action: "remove", confirmation_token: pre.confirmation_token })).out.status, "removed");
  assert.equal(w.t.pantry_shopping_items.length, 1);
});

test("a non-member's tool calls change nothing (database refuses)", async () => {
  const w = world();
  const r = await call(w.ctx(STRANGER), "inventory_add_to_shopping_list", { names: ["Hack"] });
  assert.equal(r.isError, true); assert.equal(w.t.pantry_shopping_items.length, 1);
});

test("unexpected failures reveal nothing internal", async () => {
  const w = world();
  const boom: Ctx = { ...w.ctx(), fetchImpl: (async () => { throw new Error("connect ECONNREFUSED postgres://u:pw@db"); }) as typeof fetch };
  const r = await call(boom, "inventory_search", {});
  assert.equal(r.isError, true); assert.ok(!/postgres|pw@/.test(r.out));
});

// ── M743: categories, item details, moves ──
test("tools/list also has categories, update and move (the brief's full read/write set)", () => {
  const names = toolList().map((t) => t.name);
  for (const n of ["inventory_list_categories", "inventory_update_item", "inventory_move_item", "inventory_get_history", "inventory_update_shopping_item"]) assert.ok(names.includes(n), n);
});

test("categories overview for the garage counts equipment and tools from the live rows", async () => {
  const { out } = await call(world().ctx(), "inventory_list_categories", { location: "garage" });
  for (const z of ["Mechanic Bay", "ELK Labs", "Garage Gym / Strength Zone"]) assert.ok(out.matched_locations.zones.includes(z), z);
  assert.equal(out.by_kind.equipment, 2); assert.equal(out.by_kind.tool, 1); assert.equal(out.by_kind.material, 1);
  assert.ok(out.categories.some((c: any) => c.category === "power-tools" && c.items === 1));
  const eq = await call(world().ctx(), "inventory_list_categories", { location: "garage", item_class: "equipment" });
  assert.equal(eq.out.total_items, 2);
});

test("update_item sets details in attributes (barcode, specs …) and they come back on search", async () => {
  const w = world();
  const { out } = await call(w.ctx(), "inventory_update_item", { item_id: "t-drill", barcode: "0123456789012", model: "PBLDD01", specs: { Voltage: "18V", "chuck mm": 13 }, used_for: "deck build" });
  assert.equal(out.status, "updated");
  const row = w.t.inventory_items.find((i) => i.id === "t-drill")!;
  assert.equal(row.attributes.barcode, "0123456789012"); assert.equal(row.attributes.spec_voltage, "18V"); assert.equal(row.attributes.spec_chuck_mm, 13);
  assert.equal(row.quantity, 1); assert.equal(row.current_zone, "mechanic-bay"); // quantity and place untouched
  const s = await call(w.ctx(), "inventory_search", { query: "0123456789012" });
  assert.equal(s.out.items[0].id, "t-drill"); assert.equal(s.out.items[0].specs.voltage, "18V");
  const bad = await call(w.ctx(), "inventory_update_item", { item_id: "t-drill", purchased_on: "last week" });
  assert.ok(bad.isError);
});

test("update_item: retiring/losing an item needs confirmation; nothing changes first time", async () => {
  const w = world();
  const pre = await call(w.ctx(), "inventory_update_item", { item_id: "t-saw", lifecycle_state: "lost" });
  assert.equal(pre.out.status, "confirmation_required");
  assert.equal(w.t.inventory_items.find((i) => i.id === "t-saw")!.lifecycle_state, "available");
  const forged = await call(w.ctx(), "inventory_update_item", { item_id: "t-drill", lifecycle_state: "lost", confirmation_token: pre.out.confirmation_token });
  assert.equal(forged.out.status, "confirmation_required"); // token is for the saw, not the drill
  const ok = await call(w.ctx(), "inventory_update_item", { item_id: "t-saw", lifecycle_state: "lost", confirmation_token: pre.out.confirmation_token });
  assert.equal(ok.out.status, "updated"); assert.equal(w.t.inventory_items.find((i) => i.id === "t-saw")!.lifecycle_state, "lost");
  const fix = await call(w.ctx(), "inventory_update_item", { item_id: "t-saw", lifecycle_state: "needs-repair" });
  assert.equal(fix.out.status, "updated");
});

test("update/move never overwrite a change made elsewhere in the meantime", async () => {
  const w = world();
  w.t.inventory_items.find((i) => i.id === "t-drill")!.updated_at = "2026-11-10T11:00:00+00:00";
  const realFetch = w.ctx().fetchImpl!;
  // Someone edits the drill between our read and our write.
  const racing = (async (url: string, init: any) => {
    if (init.method === "PATCH") w.t.inventory_items.find((i) => i.id === "t-drill")!.updated_at = "2026-11-10T11:30:00+00:00";
    return realFetch(url, init);
  }) as unknown as typeof fetch;
  const r = await call(w.ctx(LORNE, { fetchImpl: racing }), "inventory_move_item", { item_id: "t-drill", zone: "Pool Shed" });
  assert.ok(r.isError); assert.match(r.out, /changed by someone else/);
  assert.equal(w.t.inventory_items.find((i) => i.id === "t-drill")!.current_zone, "mechanic-bay");
});

test("move_item: zone, shelf and container; container implies its zone; unknown places refused", async () => {
  const w = world();
  const m = await call(w.ctx(), "inventory_move_item", { item_id: "t-saw", zone: "mechanic-bay", location_detail: "Back wall" });
  assert.equal(m.out.status, "moved"); assert.equal(m.out.from.zone, "Pool Shed"); assert.equal(m.out.to.zone, "Mechanic Bay");
  const box = await call(w.ctx(), "inventory_move_item", { item_id: "t-drill", container: "red-toolbox" });
  const red = w.t.inventory_items.find((i) => i.id === "t-drill")!;
  assert.equal(box.out.status, "moved"); assert.equal(red.container_id, "red-toolbox");
  const out = await call(w.ctx(), "inventory_move_item", { item_id: "t-drill", container: "none" });
  assert.equal(out.out.status, "moved"); assert.equal(red.container_id, null);
  assert.ok((await call(w.ctx(), "inventory_move_item", { item_id: "t-drill", zone: "Narnia" })).isError);
  assert.ok((await call(w.ctx(), "inventory_move_item", { item_id: "t-drill" })).isError);
});

test("a stranger can't update or move anything (the database refuses, nothing changes)", async () => {
  const w = world();
  const u = await call(w.ctx(STRANGER), "inventory_update_item", { item_id: "t-drill", name: "Mine now" }, "u-stranger");
  const m = await call(w.ctx(STRANGER), "inventory_move_item", { item_id: "t-drill", zone: "Pool Shed" }, "u-stranger");
  assert.ok(u.isError && m.isError);
  assert.equal(w.t.inventory_items.find((i) => i.id === "t-drill")!.name, "Ryobi Drill");
});
