// The database side of the − / + buttons, for items that are NOT in the food
// domain (consumable supplies such as ESP32 boards): the same pantry_* functions
// give them locking, a floor at zero, and history. Real SQL via PGlite.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness.ts";

const MOM = "00000000-0000-0000-0000-0000000000a1";
const LORNE = "00000000-0000-0000-0000-0000000000a2";
let db: PGlite;
const as = (uid: string, sql: string, p: unknown[] = []) => asUser(db)(uid, sql, p);
const qty = async (id = "esp32") => ((await db.query<{ quantity: number }>("SELECT quantity FROM inventory_items WHERE id=$1", [id])).rows[0].quantity);
const addSupply = (id: string, n: number) => db.query(
  "INSERT INTO inventory_items (id, name, item_class, current_zone, recommended_zone, quantity, attributes) VALUES ($1, $1, 'material', 'elk-labs', 'elk-labs', $2, '{}')", [id, n]);

before(async () => {
  db = await supabaseLikeDb();
  await runFile(db, "supabase-schema.sql");
  await runFile(db, "supabase-family-access.sql");
  await runFile(db, "supabase-pantry.sql");
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${MOM}', 'mom@example.com'), ('${LORNE}', 'lorne@example.com');
    INSERT INTO inventory_items (id, name, item_class, domain, current_zone, recommended_zone, quantity, attributes)
    VALUES ('esp32', 'ESP32 Dev Boards', 'material', NULL, 'elk-labs', 'elk-labs', 5, '{"unit":"boards"}');
  `);
  await addMember(db, MOM, "Mom");
  await addMember(db, LORNE, "Lorne");
});

test("supplies: minus is recorded as 'used', plus as 'received', and Undo reverses the last", async () => {
  const used = (await as(MOM, "SELECT pantry_use('esp32', 1, NULL, gen_random_uuid()) AS b"))[0] as { b: string };
  assert.equal(await qty(), 4);
  await as(LORNE, "SELECT pantry_receive('esp32', 1, '', NULL, CURRENT_DATE, NULL, NULL, gen_random_uuid())");
  assert.equal(await qty(), 5);
  await as(MOM, "SELECT pantry_undo($1)", [used.b]);
  assert.equal(await qty(), 6 - 0 /* undo of a use puts it back */);
  const kinds = (await db.query<{ kind: string; created_by: string }>("SELECT kind, created_by::text FROM stock_movements WHERE item_id='esp32' AND kind <> 'count-correction' ORDER BY created_at, kind")).rows;
  assert.deepEqual(kinds.map(k => k.kind).sort(), ["received", "undo", "used"]);
  assert.deepEqual(new Set(kinds.map(k => k.created_by)), new Set([MOM, LORNE]), "history records who did it");
});

// PGlite is one connection, so true parallel transactions can't be staged here;
// this covers the back-to-back case (the row lock that serializes real parallel
// taps is the same FOR UPDATE the existing pantry tests rely on).
test("five minus taps from two people on 3 supplies: three land, two are refused, never below zero", async () => {
  await addSupply("screws", 3);
  const who = [MOM, LORNE, MOM, LORNE, MOM];
  const results: PromiseSettledResult<unknown>[] = [];
  for (const u of who) {
    results.push(...await Promise.allSettled([as(u, "SELECT pantry_use('screws', 1, NULL, gen_random_uuid())")]));
  }
  assert.equal(results.filter(r => r.status === "fulfilled").length, 3);
  const refused = results.filter(r => r.status === "rejected") as PromiseRejectedResult[];
  assert.equal(refused.length, 2);
  for (const r of refused) assert.match(String(r.reason?.message ?? r.reason), /Only 0 left/);
  assert.equal(await qty("screws"), 0);
});

test("retrying one tap (same request id) only counts once", async () => {
  await addSupply("washers", 4);
  const id = "11111111-1111-1111-1111-111111111111";
  await as(MOM, "SELECT pantry_use('washers', 1, NULL, $1)", [id]);
  await as(MOM, "SELECT pantry_use('washers', 1, NULL, $1)", [id]);
  assert.equal(await qty("washers"), 3);
});
