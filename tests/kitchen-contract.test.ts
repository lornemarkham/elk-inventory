// The contract ELK Kitchen depends on (docs/kitchen-contract.md), exercised with
// the exact named arguments Kitchen's client sends (elk-kitchen b6e583f:
// src/lib/pantryStock.ts, pantry.ts, companion/shopping.ts) against the current
// SQL, starting from production's pantry SQL (b1e3f3f) like the upgrade will.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness";

const KIT      = "00000000-0000-0000-0000-0000000000a1";
const STRANGER = "00000000-0000-0000-0000-0000000000c1";
let db: PGlite;
const as = <T = Record<string, unknown>>(uid: string | null, sql: string, p: unknown[] = []) => asUser(db)<T>(uid, sql, p);
const admin = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const one = async (uid: string | null, sql: string, p: unknown[] = []) => Object.values((await as(uid, sql, p))[0])[0];
const onHand = async (id: string) => (await admin<{ quantity: number }>("SELECT quantity FROM inventory_items WHERE id=$1", [id]))[0].quantity;

before(async () => {
  db = await supabaseLikeDb();
  await runFile(db, "supabase-schema.sql");
  await runFile(db, "supabase-family-access.sql");
  await db.exec(execFileSync("git", ["show", "b1e3f3f:supabase-pantry.sql"], { encoding: "utf8" }));
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${KIT}', 'k@example.com'), ('${STRANGER}', 's@example.com');
    INSERT INTO inventory_items (id, name, domain, current_zone, recommended_zone, location_detail, quantity, attributes)
    VALUES ('flour', 'Flour', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Basement', 0, '{"unit":"bags"}'),
           ('tools', 'Hammer', 'tools', 'garage', 'garage', 'Garage', 1, '{}');
  `);
  await addMember(db, KIT, "Kitchen user");
  await runFile(db, "supabase-pantry.sql");
});

test("Kitchen reads stock directly (own token); a non-member sees nothing, and non-food is filtered by domain", async () => {
  await as(KIT, "SELECT pantry_receive(p_item_id => 'flour', p_quantity => 4, p_location => 'Basement', p_best_before => '2027-03-01', p_purchased_on => '2026-11-01', p_new_name => NULL, p_unit => NULL, p_request_id => gen_random_uuid())");
  const items = await as<{ id: string }>(KIT, "SELECT id,name,quantity,attributes FROM inventory_items WHERE domain = 'food-storage'");
  assert.deepEqual(items.map(i => i.id), ["flour"]);
  const lots = await as<{ quantity_remaining: number }>(KIT, "SELECT item_id,quantity_remaining,location,best_before,purchased_on,created_at FROM stock_lots");
  assert.equal(lots[0].quantity_remaining, 4);
  assert.equal((await as(STRANGER, "SELECT id FROM inventory_items")).length, 0);
  assert.equal((await as(STRANGER, "SELECT id FROM stock_lots")).length, 0);
  assert.equal((await as(null, "SELECT id FROM stock_lots")).length, 0);
});

test("Kitchen can only change stock through the functions, and only as a family member", async () => {
  await assert.rejects(as(KIT, "UPDATE stock_lots SET quantity_remaining = 99"));
  await assert.rejects(as(KIT, "INSERT INTO stock_movements (item_id, kind, quantity_delta) VALUES ('flour','used',-1)"));
  await assert.rejects(as(STRANGER, "SELECT pantry_use(p_item_id => 'flour', p_quantity => 1, p_lot_id => NULL, p_request_id => gen_random_uuid())"));
  await assert.rejects(as(STRANGER, "SELECT pantry_shopping_add(p_names => ARRAY['Eggs'], p_note => NULL, p_source => 'manual')"));
  await assert.rejects(as(null, "SELECT pantry_move(p_lot_id => gen_random_uuid(), p_quantity => 1, p_to_location => 'x', p_request_id => NULL)"));
  assert.equal(await onHand("flour"), 4);
});

test("use oldest-first, move, then Undo each, with Kitchen's argument names; totals and dates stay exact", async () => {
  const used = await one(KIT, "SELECT pantry_use(p_item_id => 'flour', p_quantity => 1, p_lot_id => NULL, p_request_id => gen_random_uuid()::uuid)") as string;
  assert.equal(await onHand("flour"), 3);
  const [lot] = await admin<{ id: string }>("SELECT id FROM stock_lots WHERE item_id='flour' AND quantity_remaining > 0");
  const moved = await one(KIT, "SELECT pantry_move(p_lot_id => $1, p_quantity => 2, p_to_location => 'Kitchen cupboard', p_request_id => gen_random_uuid())", [lot.id]) as string;
  assert.equal(await onHand("flour"), 3, "moving never changes the product total");
  const places = await admin<{ location: string; q: number; bb: string }>(
    "SELECT location, quantity_remaining AS q, best_before::text AS bb FROM stock_lots WHERE item_id='flour' AND quantity_remaining > 0 ORDER BY location");
  assert.deepEqual(places.map(p => [p.location, p.q, p.bb]), [["Basement", 1, "2027-03-01"], ["Kitchen cupboard", 2, "2027-03-01"]]);
  await as(KIT, "SELECT pantry_undo(p_batch_id => $1)", [moved]);
  await as(KIT, "SELECT pantry_undo(p_batch_id => $1)", [used]);
  assert.equal(await onHand("flour"), 4);
  assert.equal((await admin<{ q: number }>("SELECT quantity_remaining AS q FROM stock_lots WHERE item_id='flour' AND quantity_remaining > 0")).reduce((a, r) => a + r.q, 0), 4);
  await assert.rejects(as(KIT, "SELECT pantry_use(p_item_id => 'flour', p_quantity => 5, p_lot_id => NULL, p_request_id => gen_random_uuid())"), /Only|enough|left/i);
  assert.equal(await onHand("flour"), 4, "a refused use changes nothing");
});

test("Kitchen's shopping list: recipe adds de-duplicate against the open list, links to the product, and read back with its own token", async () => {
  const added = await one(KIT, "SELECT pantry_shopping_add(p_names => ARRAY['flour','Eggs','eggs'], p_note => 'for Pancakes', p_source => 'recipe')");
  assert.equal(added, 2);
  assert.equal(await one(KIT, "SELECT pantry_shopping_add(p_names => ARRAY['Eggs'], p_note => NULL, p_source => 'manual')"), 0);
  const open = await as<{ name: string }>(KIT, "SELECT name FROM pantry_shopping_items WHERE done_at IS NULL ORDER BY created_at");
  assert.deepEqual(open.map(o => o.name).sort(), ["Eggs", "flour"]);
  const [{ item_id }] = await admin<{ item_id: string }>("SELECT item_id FROM pantry_shopping_items WHERE name='flour'");
  assert.equal(item_id, "flour");
  assert.equal((await as(STRANGER, "SELECT 1 FROM pantry_shopping_items")).length, 0);
  await assert.rejects(as(KIT, "INSERT INTO pantry_shopping_items (name) VALUES ('sneaky')"));
});
