// Pantry SQL (supabase-pantry.sql) against a real Postgres (PGlite, in-process).
// Supabase's auth schema and roles are stubbed (tests/supabase-harness.ts);
// supabase-schema.sql, the family-access migration and the pantry migration
// are loaded exactly as written, then the human scenario is run through the
// same pantry_* functions the app calls. Alice and Bob are family members;
// who is NOT allowed in is covered by tests/family-access.test.ts.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness";

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB   = "00000000-0000-0000-0000-00000000000b";

let db: PGlite;

// Run as a signed-in user: role `authenticated` (RLS applies) + auth.uid().
const as = <T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []) =>
  asUser(db)<T>(uid, sql, params);
const asAlice = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => as<T>(ALICE, sql, p);

async function admin<T = Record<string, unknown>>(sql: string, p: unknown[] = []) {
  return (await db.query<T>(sql, p)).rows;
}

const qty = async (id: string) =>
  (await admin<{ quantity: number }>("SELECT quantity FROM inventory_items WHERE id = $1", [id]))[0].quantity;
const lots = (id: string) =>
  admin<{ id: string; quantity_remaining: number; quantity_received: number; best_before: string | null; source: string; location: string }>(
    "SELECT id, quantity_remaining, quantity_received, best_before::text, source, location FROM stock_lots WHERE item_id = $1 ORDER BY purchased_on NULLS FIRST, created_at", [id]);
const moves = (id: string) =>
  admin<{ kind: string; quantity_delta: number; created_by: string }>(
    "SELECT kind, quantity_delta, created_by::text FROM stock_movements WHERE item_id = $1 ORDER BY created_at, kind", [id]);

before(async () => {
  db = await supabaseLikeDb();
  await runFile(db, "supabase-schema.sql");
  await runFile(db, "supabase-family-access.sql");
  await runFile(db, "supabase-pantry.sql");
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${ALICE}', 'alice@example.com'), ('${BOB}', 'bob@example.com');
    INSERT INTO inventory_items (id, name, domain, current_zone, recommended_zone, location_detail, quantity, attributes)
    VALUES ('pantry-tom-01', 'Diced Tomatoes', 'food-storage', 'storage-room-pantry', 'storage-room-pantry',
            'White Pantry Shelf', 10, '{"unit":"cans","foodCategory":"vegetables"}');
  `);
  await addMember(db, ALICE, "Alice");
  await addMember(db, BOB, "Bob");
});

test("existing count is kept as an 'already on hand' lot, then 12 new cans are added", async () => {
  await asAlice("SELECT pantry_receive('pantry-tom-01', 12, 'Basement shelf', '2028-03-01', '2026-10-10')");
  const l = await lots("pantry-tom-01");
  assert.equal(l.length, 2);
  assert.deepEqual([l[0].source, l[0].quantity_remaining, l[0].best_before, l[0].location],
                   ["already-on-hand", 10, null, "White Pantry Shelf"]);
  assert.deepEqual([l[1].source, l[1].quantity_remaining, l[1].best_before, l[1].location],
                   ["purchase", 12, "2028-03-01", "Basement shelf"]);
  assert.equal(await qty("pantry-tom-01"), 22);
  const m = await moves("pantry-tom-01");
  assert.deepEqual(m.map(x => [x.kind, x.quantity_delta]), [["count-correction", 10], ["received", 12]]);
  assert.ok(m.every(x => x.created_by === ALICE));
  // Other attributes untouched; tracked flag added.
  const [{ attributes }] = await admin<{ attributes: Record<string, unknown> }>("SELECT attributes FROM inventory_items WHERE id = 'pantry-tom-01'");
  assert.equal(attributes.unit, "cans");
  assert.equal(attributes.foodCategory, "vegetables");
  assert.equal(attributes.pantryTracked, true);
});

test("using takes from the oldest lot first and spills into the next", async () => {
  await asAlice("SELECT pantry_use('pantry-tom-01', 2)");
  let l = await lots("pantry-tom-01");
  assert.deepEqual(l.map(x => x.quantity_remaining), [8, 12]);
  await asAlice("SELECT pantry_use('pantry-tom-01', 9)");   // 8 from old + 1 from new
  l = await lots("pantry-tom-01");
  assert.deepEqual(l.map(x => x.quantity_remaining), [0, 11]);
  assert.equal(await qty("pantry-tom-01"), 11);
});

test("asking for more than is left changes nothing", async () => {
  await assert.rejects(asAlice("SELECT pantry_use('pantry-tom-01', 50)"), /Only 11 left/);
  assert.equal(await qty("pantry-tom-01"), 11);
  assert.deepEqual((await lots("pantry-tom-01")).map(x => x.quantity_remaining), [0, 11]);
});

test("undo puts back exactly what one action took, once", async () => {
  const [{ b }] = await as<{ b: string }>(BOB, "SELECT pantry_use('pantry-tom-01', 2) AS b");
  assert.equal(await qty("pantry-tom-01"), 9);
  await asAlice("SELECT pantry_undo($1)", [b]);
  assert.equal(await qty("pantry-tom-01"), 11);
  await assert.rejects(asAlice("SELECT pantry_undo($1)", [b]), /already undone/);
  assert.equal(await qty("pantry-tom-01"), 11);
});

test("a stale whole-row save from another screen can't overwrite a tracked count or pantry settings", async () => {
  await asAlice("SELECT pantry_set_low_stock('pantry-tom-01', 3)");
  // Phone B, loaded before the pantry touched this item, saves the edit form:
  // old quantity, attributes without the pantry keys, a new note.
  await asAlice(`UPDATE inventory_items SET quantity = 99, notes = 'new note',
                   attributes = '{"unit":"cans","foodCategory":"vegetables"}' WHERE id = 'pantry-tom-01'`);
  // Same for the seed top-up / Reset path (upsert = insert … on conflict update).
  await asAlice(`INSERT INTO inventory_items (id, name, quantity) VALUES ('pantry-tom-01', 'Diced Tomatoes', 10)
                   ON CONFLICT (id) DO UPDATE SET quantity = EXCLUDED.quantity`);
  assert.equal(await qty("pantry-tom-01"), 11);
  const [row] = await admin<{ notes: string; attributes: Record<string, unknown> }>(
    "SELECT notes, attributes FROM inventory_items WHERE id = 'pantry-tom-01'");
  assert.equal(row.notes, "new note");                 // other fields still save
  assert.equal(row.attributes.pantryTracked, true);
  assert.equal(row.attributes.lowStockAt, 3);
  assert.equal(row.attributes.unit, "cans");
  // No phantom correction batch on the next action.
  await asAlice("SELECT pantry_use('pantry-tom-01', 1)");
  assert.equal(await qty("pantry-tom-01"), 10);
  assert.equal((await moves("pantry-tom-01")).filter(x => x.kind === "count-correction").length, 1);   // the opening balance only
  await asAlice("SELECT pantry_set_low_stock('pantry-tom-01', NULL)");
});

test("if the count is changed behind the pantry's back anyway (SQL editor), it's recorded, not lost", async () => {
  await db.exec("BEGIN; SELECT set_config('elk.pantry', '1', true); UPDATE inventory_items SET quantity = 13 WHERE id = 'pantry-tom-01'; COMMIT;");
  await asAlice("SELECT pantry_use('pantry-tom-01', 1)");
  assert.equal(await qty("pantry-tom-01"), 12);
  assert.ok((await moves("pantry-tom-01")).some(x => x.kind === "count-correction" && x.quantity_delta === 3));
  const total = (await lots("pantry-tom-01")).reduce((n, x) => n + x.quantity_remaining, 0);
  assert.equal(total, 12);
});

test("retrying the same save (same request id) only counts once", async () => {
  const req = "11111111-1111-1111-1111-111111111111";
  await asAlice("SELECT pantry_receive('pantry-tom-01', 2, 'Shelf', NULL, '2026-10-10', NULL, NULL, $1)", [req]);
  await asAlice("SELECT pantry_receive('pantry-tom-01', 2, 'Shelf', NULL, '2026-10-10', NULL, NULL, $1)", [req]);
  assert.equal(await qty("pantry-tom-01"), 14);
  const use = "22222222-2222-2222-2222-222222222222";
  await asAlice("SELECT pantry_use('pantry-tom-01', 2, NULL, $1)", [use]);
  await asAlice("SELECT pantry_use('pantry-tom-01', 2, NULL, $1)", [use]);
  assert.equal(await qty("pantry-tom-01"), 12);
});

test("a mistaken 'I bought something' can be undone — until some of it is used", async () => {
  const [{ b }] = await asAlice<{ b: string }>("SELECT pantry_receive('pantry-tom-01', 120, 'Shelf', NULL, '2026-10-10') AS b");
  assert.equal(await qty("pantry-tom-01"), 132);
  await asAlice("SELECT pantry_undo($1)", [b]);
  assert.equal(await qty("pantry-tom-01"), 12);
  const [{ b: b2 }] = await asAlice<{ b: string }>("SELECT pantry_receive('pantry-tom-01', 5, 'Shelf', NULL, '2026-10-10') AS b");
  const newest = (await lots("pantry-tom-01")).at(-1)!;
  await asAlice("SELECT pantry_use('pantry-tom-01', 1, $1)", [newest.id]);
  await assert.rejects(asAlice("SELECT pantry_undo($1)", [b2]), /already been used/);
  assert.equal(await qty("pantry-tom-01"), 16);
  await asAlice("SELECT pantry_use('pantry-tom-01', 4, $1)", [newest.id]);   // back to 12
});

test("using from a chosen batch only touches that batch", async () => {
  const l = (await lots("pantry-tom-01")).filter(x => x.quantity_remaining > 0);
  assert.ok(l.length >= 2);
  const newest = l[l.length - 1];
  const before = newest.quantity_remaining;
  await asAlice("SELECT pantry_use('pantry-tom-01', 1, $1)", [newest.id]);
  const after = (await lots("pantry-tom-01")).find(x => x.id === newest.id)!;
  assert.equal(after.quantity_remaining, before - 1);
});

test("a brand-new product is created with its first lot", async () => {
  await asAlice("SELECT pantry_receive('new-rice', 3, 'Top shelf', NULL, '2026-10-09', 'Basmati Rice', 'bags')");
  const [item] = await admin<{ name: string; domain: string; quantity: number; attributes: Record<string, unknown> }>(
    "SELECT name, domain, quantity, attributes FROM inventory_items WHERE id = 'new-rice'");
  assert.equal(item.name, "Basmati Rice");
  assert.equal(item.domain, "food-storage");
  assert.equal(item.quantity, 3);
  assert.equal(item.attributes.unit, "bags");
  assert.deepEqual((await moves("new-rice")).map(x => x.kind), ["received"]);
});

test("low-stock level merges into attributes and can be cleared", async () => {
  await asAlice("SELECT pantry_set_low_stock('pantry-tom-01', 4)");
  let [{ attributes }] = await admin<{ attributes: Record<string, unknown> }>("SELECT attributes FROM inventory_items WHERE id = 'pantry-tom-01'");
  assert.equal(attributes.lowStockAt, 4);
  assert.equal(attributes.unit, "cans");
  await asAlice("SELECT pantry_set_low_stock('pantry-tom-01', NULL)");
  [{ attributes }] = await admin<{ attributes: Record<string, unknown> }>("SELECT attributes FROM inventory_items WHERE id = 'pantry-tom-01'");
  assert.equal("lowStockAt" in attributes, false);
});

test("lots and history can't be written directly, deleted, or touched when signed out", async () => {
  const l = await lots("pantry-tom-01");
  // No write privilege for API roles at all (and no write policies either).
  await assert.rejects(asAlice("UPDATE stock_lots SET quantity_remaining = 99 WHERE id = $1", [l[0].id]), /permission denied/);
  await assert.rejects(asAlice("DELETE FROM stock_movements"), /permission denied/);
  assert.deepEqual(await lots("pantry-tom-01"), l);
  assert.ok((await moves("pantry-tom-01")).length > 0);
  await assert.rejects(asAlice(
    "INSERT INTO stock_lots (item_id, quantity_received, quantity_remaining) VALUES ('pantry-tom-01', 5, 5)"));
  await assert.rejects(as(null, "SELECT pantry_use('pantry-tom-01', 1)"), /permission denied/);
  await assert.rejects(asAlice("SELECT pantry_reconcile_('pantry-tom-01')"), /permission denied/);
  // Signed in users can read.
  assert.ok((await asAlice("SELECT * FROM stock_lots")).length > 0);
});

test("a product with pantry history can't be deleted", async () => {
  const before = await qty("pantry-tom-01");
  await assert.rejects(asAlice("DELETE FROM inventory_items WHERE id = 'pantry-tom-01'"), /foreign key/);
  assert.equal(await qty("pantry-tom-01"), before);
});

test("feedback: family members can send, nobody can read it back through the API", async () => {
  await asAlice("INSERT INTO inventory_feedback (message, page) VALUES ('The add button was hard to find', '/pantry')");
  assert.equal((await asAlice("SELECT * FROM inventory_feedback")).length, 0);
  const [row] = await admin<{ created_by: string }>("SELECT created_by::text FROM inventory_feedback");
  assert.equal(row.created_by, ALICE);
});

test("the migrations are safe to run twice", async () => {
  const before = await qty("pantry-tom-01");
  await runFile(db, "supabase-family-access.sql");
  await runFile(db, "supabase-pantry.sql");
  assert.equal(await qty("pantry-tom-01"), before);
  const fns = await admin<{ n: number }>("SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('pantry_receive', 'pantry_use')");
  assert.equal(fns[0].n, 2);   // one version of each
});
