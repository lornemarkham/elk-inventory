// The contract ELK Recipes (Kitchen) depends on (docs/recipes-contract.md), exercised with the exact
// named arguments Recipes' client sends (elk-kitchen 230ea74: src/lib/pantry.ts, pantryStock.ts) against
// THIS branch's SQL. Covers only what is live on this branch; M652's pantry_move / p_reason are separate.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness.ts";

const COOK = "00000000-0000-0000-0000-0000000000a1";
const STRANGER = "00000000-0000-0000-0000-0000000000c1";
let db: PGlite;
const as = <T = Record<string, unknown>>(uid: string | null, sql: string, p: unknown[] = []) => asUser(db)<T>(uid, sql, p);
const admin = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const one = async (uid: string | null, sql: string, p: unknown[] = []) => Object.values((await as(uid, sql, p))[0])[0];
const onHand = async (id: string) => (await admin<{ quantity: number }>("SELECT quantity FROM inventory_items WHERE id=$1", [id]))[0].quantity;
const USE = (id: string, n: number, req = "gen_random_uuid()") => `SELECT pantry_use(p_item_id => '${id}', p_quantity => ${n}, p_lot_id => NULL, p_request_id => ${req})`;

before(async () => {
  db = await supabaseLikeDb();
  await runFile(db, "supabase-schema.sql");
  await runFile(db, "supabase-family-access.sql");
  await runFile(db, "supabase-pantry.sql");
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${COOK}', 'c@example.com'), ('${STRANGER}', 's@example.com');
    INSERT INTO inventory_items (id, name, domain, current_zone, recommended_zone, location_detail, quantity, attributes)
    VALUES ('flour', 'Flour', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Basement', 0, '{"unit":"bags"}'),
           ('hammer', 'Hammer', 'tools', 'garage', 'garage', 'Garage', 1, '{}');
  `);
  await addMember(db, COOK, "Cook");
  await as(COOK, "SELECT pantry_receive(p_item_id => 'flour', p_quantity => 2, p_location => 'Basement', p_best_before => '2027-01-01', p_purchased_on => '2026-10-01', p_new_name => NULL, p_unit => NULL, p_request_id => gen_random_uuid())");
  await as(COOK, "SELECT pantry_receive(p_item_id => 'flour', p_quantity => 3, p_location => 'Cupboard', p_best_before => '2027-06-01', p_purchased_on => '2026-11-01', p_new_name => NULL, p_unit => NULL, p_request_id => gen_random_uuid())");
});

test("reads: food products with unit, batches with best-before; non-food filtered; strangers and signed-out see nothing", async () => {
  const items = await as<{ id: string; quantity: number; attributes: { unit: string } }>(COOK, "SELECT id,name,quantity,attributes FROM inventory_items WHERE domain = 'food-storage'");
  assert.deepEqual(items.map(i => [i.id, i.quantity, i.attributes.unit]), [["flour", 5, "bags"]]);
  const lots = await as<{ best_before: string }>(COOK, "SELECT item_id,quantity_remaining,location,best_before,purchased_on,created_at FROM stock_lots ORDER BY best_before");
  assert.equal(lots.length, 2);
  for (const who of [STRANGER, null]) {
    assert.equal((await as(who, "SELECT id FROM inventory_items")).length, 0);
    assert.equal((await as(who, "SELECT id FROM stock_lots")).length, 0);
  }
});

test("writes only via functions, only as a family member", async () => {
  await assert.rejects(as(COOK, "UPDATE stock_lots SET quantity_remaining = 99"));
  await assert.rejects(as(COOK, "INSERT INTO stock_movements (item_id, kind, quantity_delta) VALUES ('flour','used',-1)"));
  await assert.rejects(as(STRANGER, USE("flour", 1)));
  await assert.rejects(as(null, USE("flour", 1)));
  assert.equal(await onHand("flour"), 5);
});

test("a direct write to inventory_items.quantity is a convention breach, not a way to mint stock: lots stay truth and the next pantry call reconciles", async () => {
  await as(COOK, "UPDATE inventory_items SET quantity = 99 WHERE id='flour'");   // not blocked by RLS today (Inventory's editor needs item updates)
  await assert.rejects(as(COOK, USE("flour", 6)), /Only 5 left/, "availability comes from the lots, not the item row");
  await as(COOK, USE("flour", 1)); await as(COOK, "SELECT pantry_undo(p_batch_id => (SELECT batch_id FROM stock_movements WHERE kind='used' ORDER BY created_at DESC LIMIT 1))");
  assert.equal(await onHand("flour"), 5, "healed to the sum of the open lots");
});

test("deduct a confirmed ingredient: recorded, a retried request counts once, Undo restores exactly once", async () => {
  const req = "'11111111-1111-1111-1111-111111111111'::uuid";
  const batch = await one(COOK, USE("flour", 2, req)) as string;
  assert.equal(await onHand("flour"), 3);
  assert.equal(await one(COOK, USE("flour", 2, req)), batch, "same request id returns the same batch");
  assert.equal(await onHand("flour"), 3, "retry did not deduct again");
  const mv = await admin<{ kind: string; quantity_delta: number; created_by: string }>("SELECT kind,quantity_delta,created_by::text FROM stock_movements WHERE batch_id=$1", [batch]);
  assert.ok(mv.length >= 1 && mv.every(m => m.kind === "used" && m.created_by === COOK), "history names the person");
  assert.equal(mv.reduce((a, m) => a + m.quantity_delta, 0), -2);
  await as(COOK, "SELECT pantry_undo(p_batch_id => $1)", [batch]);
  assert.equal(await onHand("flour"), 5);
  await assert.rejects(as(COOK, "SELECT pantry_undo(p_batch_id => $1)", [batch]), /already undone/);
  assert.equal(await onHand("flour"), 5);
});

test("never negative: over-use is refused and changes nothing; quantity 0 / negative is refused", async () => {
  await assert.rejects(as(COOK, USE("flour", 6)), /Only 5 left/);
  await assert.rejects(as(COOK, USE("flour", 0)));
  await assert.rejects(as(COOK, USE("flour", -1)));
  assert.equal(await onHand("flour"), 5);
  await as(COOK, USE("flour", 5));
  await assert.rejects(as(COOK, USE("flour", 1)), /Only 0 left/);
  assert.equal(await onHand("flour"), 0);
  assert.equal((await admin<{ n: number }>("SELECT COALESCE(MIN(quantity_remaining),0)::int n FROM stock_lots"))[0].n, 0);
});
