// supabase-prepared.sql against a real Postgres (PGlite): additive, re-runnable,
// family-only, and leaves Pantry and existing data alone.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness";

const ALICE = "00000000-0000-0000-0000-00000000000a";
const STRANGER = "00000000-0000-0000-0000-0000000000f1";
let db: PGlite;
let as: ReturnType<typeof asUser>;
const admin = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const denied = (p: Promise<unknown>) => assert.rejects(p, /row-level security|permission denied/i);

before(async () => {
  db = await supabaseLikeDb();
  as = asUser(db);
  await runFile(db, "supabase-schema.sql");
  await runFile(db, "supabase-family-access.sql");
  await runFile(db, "supabase-pantry.sql");
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${ALICE}', 'a@example.com'), ('${STRANGER}', 's@example.com');
    INSERT INTO inventory_items (id, name, domain, current_zone, recommended_zone, location_detail, quantity, attributes)
    VALUES ('rice', 'Rice', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Shelf', 4, '{"unit":"bags"}');`);
  await addMember(db, ALICE, "Alice");
});

const snapshot = async () => ({
  items: await admin("SELECT * FROM inventory_items ORDER BY id"),
  policies: await admin("SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename NOT LIKE 'prepared_%' ORDER BY 1,2"),
});

test("applies cleanly, twice, without touching existing tables, policies or rows", async () => {
  const before = await snapshot();
  await runFile(db, "supabase-prepared.sql");
  await runFile(db, "supabase-prepared.sql");
  assert.deepEqual(await snapshot(), before);
});

test("refuses to run if a same-named table belongs to someone else", async () => {
  const other = await supabaseLikeDb();
  await runFile(other, "supabase-schema.sql");
  await runFile(other, "supabase-family-access.sql");
  await other.exec("CREATE TABLE public.prepared_plan (x int);");
  await assert.rejects(runFile(other, "supabase-prepared.sql"), /not created by ELK Inventory/);
});

test("a family member can save the household, equipment and plan, and the database stamps who", async () => {
  await as(ALICE, "INSERT INTO prepared_household (people, pets, days) VALUES (4, 2, 21) ON CONFLICT (id) DO UPDATE SET people = 4, pets = 2, days = 21");
  await as(ALICE, "INSERT INTO prepared_equipment (name, category, capacity_wh, quantity) VALUES ('Power station', 'power', 1000, 1)");
  await as(ALICE, "INSERT INTO prepared_plan (info) VALUES ('{\"meetingPlace\":\"The oak\"}') ON CONFLICT (id) DO UPDATE SET info = EXCLUDED.info");
  const h = await as<{ people: number; updated_by: string }>(ALICE, "SELECT people, updated_by::text FROM prepared_household");
  assert.equal(h[0].people, 4);
  assert.equal(h[0].updated_by, ALICE);
  // A client can't forge the stamp.
  await as(ALICE, "UPDATE prepared_equipment SET updated_by = $1", [STRANGER]);
  assert.equal((await as<{ u: string }>(ALICE, "SELECT updated_by::text u FROM prepared_equipment"))[0].u, ALICE);
});

test("a signed-in stranger and an anonymous caller see and change nothing", async () => {
  for (const uid of [STRANGER, null]) {
    for (const t of ["prepared_household", "prepared_equipment", "prepared_plan"]) {
      let rows: unknown[] = [];
      try { rows = await as(uid, `SELECT * FROM ${t}`); } catch { /* anon has no privilege at all: also fine */ }
      assert.equal(rows.length, 0, `${uid} read ${t}`);
    }
    await denied(as(uid, "INSERT INTO prepared_equipment (name) VALUES ('sneaky')"));
    await denied(as(uid, "INSERT INTO prepared_plan (info) VALUES ('{}') ON CONFLICT (id) DO UPDATE SET info = '{\"x\":1}'"));
  }
  const upd = await as(STRANGER, "UPDATE prepared_equipment SET name = 'hacked' RETURNING 1");
  assert.equal(upd.length, 0);
  assert.equal((await admin<{ name: string }>("SELECT name FROM prepared_equipment"))[0].name, "Power station");
});

test("equipment can be removed by family; household and plan rows can't be deleted or made twice", async () => {
  await assert.rejects(as(ALICE, "DELETE FROM prepared_plan"), /permission denied/i);
  await assert.rejects(as(ALICE, "INSERT INTO prepared_household (id) VALUES ('second')"), /check constraint|violates/i);
  await as(ALICE, "DELETE FROM prepared_equipment");
  assert.equal((await admin("SELECT 1 FROM prepared_equipment")).length, 0);
});

test("bad values are refused by the database", async () => {
  await assert.rejects(as(ALICE, "INSERT INTO prepared_equipment (name, category) VALUES ('x', 'weapons')"), /check constraint/i);
  await assert.rejects(as(ALICE, "INSERT INTO prepared_equipment (name, capacity_wh) VALUES ('x', -5)"), /check constraint/i);
  await assert.rejects(as(ALICE, "UPDATE prepared_household SET days = 0"), /check constraint/i);
});

test("Pantry still works after the migration (classification keys live in existing attributes)", async () => {
  await as(ALICE, `UPDATE inventory_items SET attributes = attributes || '{"prepKind":"food","kcalPerUnit":3600}' WHERE id = 'rice'`);
  const r = await as<{ attributes: Record<string, unknown> }>(ALICE, "SELECT attributes FROM inventory_items WHERE id = 'rice'");
  assert.equal(r[0].attributes.kcalPerUnit, 3600);
  assert.equal(r[0].attributes.unit, "bags");
  const lot = await as<{ pantry_receive: string }>(ALICE, "SELECT pantry_receive('rice', 6, 'Shelf', '2027-05-01'::date, '2026-11-10'::date, NULL, NULL, gen_random_uuid())");
  assert.ok(lot);
});
