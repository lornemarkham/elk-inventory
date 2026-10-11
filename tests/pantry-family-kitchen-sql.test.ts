// Waste, moving and the shopping list (supabase-pantry.sql) against a real
// Postgres (PGlite). Starts from the pantry SQL as it was before these were
// added (git b1e3f3f — what production runs today), records stock with it, then
// re-runs the current file over the top: the upgrade the owner will do.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness";

const ALICE    = "00000000-0000-0000-0000-00000000000a";
const BOB      = "00000000-0000-0000-0000-00000000000b";
const STRANGER = "00000000-0000-0000-0000-00000000000c";

let db: PGlite;
const as = <T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []) =>
  asUser(db)<T>(uid, sql, params);
const asAlice = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => as<T>(ALICE, sql, p);
const asBob   = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => as<T>(BOB, sql, p);
const admin = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

const qty = async (id: string) =>
  (await admin<{ quantity: number }>("SELECT quantity FROM inventory_items WHERE id = $1", [id]))[0].quantity;
const openLots = (id: string) =>
  admin<{ id: string; quantity_remaining: number; location: string; best_before: string | null; purchased_on: string | null }>(
    `SELECT id, quantity_remaining, location, best_before::text, purchased_on::text FROM stock_lots
      WHERE item_id = $1 AND quantity_remaining > 0 ORDER BY purchased_on NULLS FIRST, created_at, id`, [id]);
const batchOf = async (sql: string, uid = ALICE) => Object.values((await as(uid, sql))[0])[0] as string;

before(async () => {
  db = await supabaseLikeDb();
  await runFile(db, "supabase-schema.sql");
  await runFile(db, "supabase-family-access.sql");
  // Production's pantry SQL today, before waste/move/shopping.
  await db.exec(execFileSync("git", ["show", "b1e3f3f:supabase-pantry.sql"], { encoding: "utf8" }));
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${ALICE}', 'a@example.com'), ('${BOB}', 'b@example.com'), ('${STRANGER}', 's@example.com');
    INSERT INTO inventory_items (id, name, domain, current_zone, recommended_zone, location_detail, quantity, attributes)
    VALUES ('rice', 'Basmati Rice', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Basement', 0, '{"unit":"bags"}'),
           ('milk', 'Milk', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Fridge', 0, '{"unit":"cartons"}');
  `);
  await addMember(db, ALICE, "Alice");
  await addMember(db, BOB, "Bob");
  // Recorded with the old functions, then upgraded.
  await asAlice("SELECT pantry_receive('rice', 6, 'Basement', '2027-01-01', '2026-09-01')");
  await asAlice("SELECT pantry_use('rice', 1)");
  await runFile(db, "supabase-pantry.sql");
});

test("upgrading over the live version keeps stock and history, and leaves one pantry_use", async () => {
  assert.equal(await qty("rice"), 5);
  const kinds = await admin<{ kind: string }>("SELECT kind FROM stock_movements WHERE item_id = 'rice' ORDER BY created_at");
  assert.deepEqual(kinds.map(k => k.kind), ["received", "used"]);
  const [{ n }] = await admin<{ n: number }>("SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'pantry_use'");
  assert.equal(n, 1);
});

test("an app that doesn't send a reason still records 'used' (the deployed Inventory build)", async () => {
  const b = await batchOf("SELECT pantry_use(p_item_id => 'rice', p_quantity => 1, p_lot_id => NULL, p_request_id => gen_random_uuid())");
  const [{ kind }] = await admin<{ kind: string }>("SELECT kind FROM stock_movements WHERE batch_id = $1", [b]);
  assert.equal(kind, "used");
  await asAlice("SELECT pantry_undo($1)", [b]);
});

test("throwing something out takes it out like using it, but is recorded as wasted — and can be undone", async () => {
  await asAlice("SELECT pantry_receive('milk', 2, 'Fridge', '2026-10-09')");
  const b = await batchOf("SELECT pantry_use('milk', 1, NULL, gen_random_uuid(), 'wasted')");
  assert.equal(await qty("milk"), 1);
  const [{ kind, quantity_delta }] = await admin<{ kind: string; quantity_delta: number }>(
    "SELECT kind, quantity_delta FROM stock_movements WHERE batch_id = $1", [b]);
  assert.deepEqual([kind, quantity_delta], ["wasted", -1]);
  await asBob("SELECT pantry_undo($1)", [b]);
  assert.equal(await qty("milk"), 2);
  await assert.rejects(asAlice("SELECT pantry_use('milk', 1, NULL, NULL, 'eaten')"), /Unknown reason/);
});

test("moving some of a batch makes a new batch at the new place with the same dates; the total doesn't change", async () => {
  const [basement] = await openLots("rice");
  assert.equal(basement.quantity_remaining, 5);
  const b = await batchOf(`SELECT pantry_move('${basement.id}', 2, 'Kitchen cupboard')`, BOB);
  assert.equal(await qty("rice"), 5);
  const l = await openLots("rice");
  assert.deepEqual(l.map(x => [x.location, x.quantity_remaining, x.best_before, x.purchased_on]), [
    ["Basement", 3, "2027-01-01", "2026-09-01"],
    ["Kitchen cupboard", 2, "2027-01-01", "2026-09-01"],
  ]);
  const m = await admin<{ quantity_delta: number; note: string; created_by: string }>(
    "SELECT quantity_delta, note, created_by::text FROM stock_movements WHERE batch_id = $1 ORDER BY quantity_delta", [b]);
  assert.deepEqual(m.map(x => [x.quantity_delta, x.note]), [[-2, "Moved to Kitchen cupboard"], [2, "Moved from Basement"]]);
  assert.ok(m.every(x => x.created_by === BOB));
  // Oldest-first still takes from the basement first (moved ones are recorded later).
  await asAlice("SELECT pantry_use('rice', 1)");
  assert.deepEqual((await openLots("rice")).map(x => x.quantity_remaining), [2, 2]);
});

test("a move can be retried safely, refuses bad input, and can be undone while the moved ones are untouched", async () => {
  const [basement] = await openLots("rice");
  const rid = "11111111-1111-1111-1111-111111111111";
  const b1 = await batchOf(`SELECT pantry_move('${basement.id}', 1, 'Garage', '${rid}')`);
  const b2 = await batchOf(`SELECT pantry_move('${basement.id}', 1, 'Garage', '${rid}')`);
  assert.equal(b1, b2);
  assert.equal((await openLots("rice")).find(x => x.location === "Garage")?.quantity_remaining, 1);

  await assert.rejects(asAlice(`SELECT pantry_move('${basement.id}', 9, 'Garage')`), /Only 1 in that batch/);
  await assert.rejects(asAlice(`SELECT pantry_move('${basement.id}', 1, 'basement')`), /already there/);
  await assert.rejects(asAlice(`SELECT pantry_move('${basement.id}', 1, '  ')`), /Where are they going/);

  await asAlice("SELECT pantry_undo($1)", [b1]);
  assert.equal((await openLots("rice")).find(x => x.location === "Garage"), undefined);
  assert.equal((await openLots("rice")).find(x => x.location === "Basement")?.quantity_remaining, 2);
  assert.equal(await qty("rice"), 4);
  await assert.rejects(asAlice("SELECT pantry_undo($1)", [b1]), /already undone/);
});

test("undoing a move is refused once some of the moved ones were used", async () => {
  const [basement] = await openLots("rice");
  const garage = await batchOf(`SELECT pantry_move('${basement.id}', 2, 'Garage')`);
  const [garageLot] = (await openLots("rice")).filter(x => x.location === "Garage");
  await asAlice(`SELECT pantry_use('rice', 1, '${garageLot.id}')`);
  await assert.rejects(asAlice("SELECT pantry_undo($1)", [garage]), /used since they were moved/);
});

test("only family members can move", async () => {
  const [lot] = await openLots("rice");
  await assert.rejects(as(STRANGER, `SELECT pantry_move('${lot.id}', 1, 'Shed')`), /family list/);
  await assert.rejects(as(null, `SELECT pantry_move('${lot.id}', 1, 'Shed')`), /permission denied/);
});

test("shopping list: adding skips what's already on it, links known products, and keeps why", async () => {
  const [{ pantry_shopping_add: n1 }] = await asAlice<{ pantry_shopping_add: number }>(
    "SELECT pantry_shopping_add(ARRAY['basmati  rice', 'Fresh basil', ''], 'for Curry', 'recipe')");
  assert.equal(n1, 2);
  const [{ pantry_shopping_add: n2 }] = await asBob<{ pantry_shopping_add: number }>(
    "SELECT pantry_shopping_add(ARRAY['Fresh Basil', 'Eggs'])");
  assert.equal(n2, 1);
  const rows = await asBob<{ name: string; item_id: string | null; note: string | null; source: string; created_by: string }>(
    "SELECT name, item_id, note, source, created_by::text FROM pantry_shopping_items ORDER BY created_at, lower(name)");
  assert.deepEqual(rows.map(r => [r.name, r.item_id, r.note, r.source]), [
    ["basmati rice", "rice", "for Curry", "recipe"],
    ["Fresh basil", null, "for Curry", "recipe"],
    ["Eggs", null, null, "manual"],
  ]);
  assert.equal(rows[2].created_by, BOB);
});

test("shopping list: family can tick off and remove; once ticked off, the same thing can be added again", async () => {
  const [eggs] = await asAlice<{ id: string }>("SELECT id FROM pantry_shopping_items WHERE name = 'Eggs'");
  await asAlice("UPDATE pantry_shopping_items SET done_at = now(), done_by = auth.uid() WHERE id = $1", [eggs.id]);
  const [{ pantry_shopping_add: n }] = await asAlice<{ pantry_shopping_add: number }>("SELECT pantry_shopping_add(ARRAY['eggs'])");
  assert.equal(n, 1);
  // Ticking off is all an update can do.
  await assert.rejects(asAlice("UPDATE pantry_shopping_items SET name = 'Caviar' WHERE id = $1", [eggs.id]), /permission denied/);
  await asBob("DELETE FROM pantry_shopping_items WHERE id = $1", [eggs.id]);
  assert.equal((await admin("SELECT 1 FROM pantry_shopping_items WHERE id = $1", [eggs.id])).length, 0);
});

test("shopping list: outsiders can't see, add, tick or remove anything", async () => {
  assert.deepEqual(await as(STRANGER, "SELECT * FROM pantry_shopping_items"), []);
  await assert.rejects(as(STRANGER, "SELECT pantry_shopping_add(ARRAY['Caviar'])"), /family list/);
  await assert.rejects(as(null, "SELECT pantry_shopping_add(ARRAY['Caviar'])"), /permission denied/);
  await assert.rejects(as(null, "SELECT * FROM pantry_shopping_items"), /permission denied/);
  await as(STRANGER, "DELETE FROM pantry_shopping_items");
  await as(STRANGER, "UPDATE pantry_shopping_items SET done_at = now()");
  const [{ open }] = await admin<{ open: number }>("SELECT count(*)::int AS open FROM pantry_shopping_items WHERE done_at IS NULL");
  assert.ok(open >= 3);
  // Direct inserts (skipping the duplicate check) aren't allowed even for family.
  await assert.rejects(asAlice("INSERT INTO pantry_shopping_items (name) VALUES ('x')"), /permission denied/);
});

test("running the current file again changes nothing", async () => {
  const before = await admin("SELECT item_id, sum(quantity_remaining)::int AS n FROM stock_lots GROUP BY item_id ORDER BY item_id");
  const list = await admin("SELECT count(*)::int AS n FROM pantry_shopping_items");
  await runFile(db, "supabase-family-access.sql");
  await runFile(db, "supabase-pantry.sql");
  assert.deepEqual(await admin("SELECT item_id, sum(quantity_remaining)::int AS n FROM stock_lots GROUP BY item_id ORDER BY item_id"), before);
  assert.deepEqual(await admin("SELECT count(*)::int AS n FROM pantry_shopping_items"), list);
});
