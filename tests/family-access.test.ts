// Family access boundary (supabase-family-access.sql + supabase-pantry.sql),
// against a real Postgres (PGlite) shaped like the shared production project:
// ELK's tables with the old "any signed-in user" policies and real rows, plus
// another app's table that must come through untouched.
//
//   OWNER, KATHY  family members (added the way the owner would, as postgres)
//   STRANGER      can sign in (e.g. the other app's user) — not family
//   null          not signed in (anon)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness";

const OWNER    = "00000000-0000-0000-0000-0000000000a1";
const KATHY    = "00000000-0000-0000-0000-0000000000a2";
const STRANGER = "00000000-0000-0000-0000-0000000000f1";

const ELK_TABLES = ["inventory_items", "purchase_drafts", "stock_lots", "stock_movements", "inventory_feedback", "elk_family_members"];

let db: PGlite;
let as: ReturnType<typeof asUser>;
const admin = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

// Everything about the other app's table that a migration could disturb.
const otherAppState = async () => ({
  rows: await admin("SELECT * FROM public.stamp_sets ORDER BY id"),
  policies: await admin("SELECT policyname, cmd, roles::text, qual, with_check FROM pg_policies WHERE tablename IN ('stamp_sets', 'profiles') ORDER BY 1"),
  acl: await admin("SELECT relname, relacl::text, relrowsecurity FROM pg_class WHERE relname IN ('stamp_sets', 'profiles') ORDER BY 1"),
});
let otherAppBefore: Awaited<ReturnType<typeof otherAppState>>;
let itemsBefore: Record<string, unknown>[];

before(async () => {
  db = await supabaseLikeDb();
  as = asUser(db);
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${OWNER}', 'owner@example.com'), ('${KATHY}', 'kathy@example.com'), ('${STRANGER}', 'stranger@example.com');
    -- The other app in the same project.
    CREATE TABLE public.stamp_sets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL);
    ALTER TABLE public.stamp_sets ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Anyone can read stamp sets" ON public.stamp_sets FOR SELECT USING (true);
    INSERT INTO public.stamp_sets (name) VALUES ('Royal Wedding'), ('Penny Black');
  `);
  // Production as it is today: base schema + the old open policies + data.
  await runFile(db, "supabase-schema.sql");
  await runFile(db, "tests/fixtures/legacy-open-policies.sql");
  await db.exec(`
    INSERT INTO inventory_items (id, name, quantity, location_detail) VALUES
      ('t-drill-1', 'Cordless Drill', 1, 'Garage wall'),
      ('pantry-tom-01', 'Diced Tomatoes', 4, 'White Pantry Shelf');
    INSERT INTO purchase_drafts (raw_text) VALUES ('2x Rust-Oleum primer');
  `);
  itemsBefore = await admin("SELECT * FROM inventory_items ORDER BY id");
  otherAppBefore = await otherAppState();
});

test("today (before the migration) any signed-in stranger can read and change ELK's inventory", async () => {
  assert.equal((await as(STRANGER, "SELECT * FROM inventory_items")).length, 2);
  assert.equal((await as(STRANGER, "UPDATE inventory_items SET notes = notes WHERE id = 't-drill-1' RETURNING id")).length, 1);
});

test("the Pantry migration refuses to run before the access migration, changing nothing", async () => {
  await assert.rejects(runFile(db, "supabase-pantry.sql"), /Run supabase-family-access.sql first/);
  assert.equal((await admin("SELECT to_regclass('public.stock_lots') AS t"))[0].t, null);
});

test("applying both migrations to the existing database keeps every existing row", async () => {
  await runFile(db, "supabase-family-access.sql");
  await addMember(db, OWNER, "Owner");
  await addMember(db, KATHY, "Kathy");
  await runFile(db, "supabase-pantry.sql");
  assert.deepEqual(await admin("SELECT * FROM inventory_items ORDER BY id"), itemsBefore);
  assert.equal((await admin("SELECT count(*)::int AS n FROM purchase_drafts"))[0].n, 1);
});

test("no 'any signed-in user' policy survives on ELK's tables; every policy checks membership", async () => {
  const pols = await admin<{ tablename: string; policyname: string; roles: string; qual: string | null; with_check: string | null }>(
    "SELECT tablename, policyname, roles::text, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1)", [ELK_TABLES]);
  assert.equal(pols.length, 12);
  for (const p of pols) {
    assert.equal(p.roles, "{authenticated}", `${p.tablename}/${p.policyname}`);
    assert.match(`${p.qual ?? ""} ${p.with_check ?? ""}`, /elk_is_family_member\(\)/, `${p.tablename}/${p.policyname}`);
  }
  const rls = await admin<{ relname: string; relrowsecurity: boolean }>(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)", [ELK_TABLES]);
  assert.equal(rls.length, ELK_TABLES.length);
  assert.ok(rls.every(r => r.relrowsecurity));
});

// ── The family test, as Kathy, with the owner seeing the same pantry ──────────
test("family member: add 12 cans, use 2 (10 left), undo, set a warning, send feedback", async () => {
  const kathy = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => as<T>(KATHY, sql, p);
  assert.deepEqual(await kathy("SELECT public.elk_is_family_member() AS ok"), [{ ok: true }]);

  await kathy("SELECT pantry_receive('pantry-tomatoes-test', 12, 'Basement shelf', '2028-03-01', '2026-10-10', 'Tomatoes (test)', 'cans')");
  const [lot] = await kathy<{ quantity_remaining: number; location: string; best_before: string }>(
    "SELECT quantity_remaining, location, best_before::text FROM stock_lots WHERE item_id = 'pantry-tomatoes-test'");
  assert.deepEqual(lot, { quantity_remaining: 12, location: "Basement shelf", best_before: "2028-03-01" });

  const [{ b }] = await kathy<{ b: string }>("SELECT pantry_use('pantry-tomatoes-test', 2) AS b");
  const onHand = async (uid: string) =>
    (await as<{ quantity: number }>(uid, "SELECT quantity FROM inventory_items WHERE id = 'pantry-tomatoes-test'"))[0].quantity;
  assert.equal(await onHand(KATHY), 10);
  assert.equal(await onHand(OWNER), 10);            // shared household: the owner sees the same count

  await kathy("SELECT pantry_undo($1)", [b]);
  assert.equal(await onHand(KATHY), 12);

  await kathy("SELECT pantry_set_low_stock('pantry-tomatoes-test', 3)");
  const [{ attributes }] = await kathy<{ attributes: Record<string, unknown> }>(
    "SELECT attributes FROM inventory_items WHERE id = 'pantry-tomatoes-test'");
  assert.equal(attributes.lowStockAt, 3);

  await kathy("INSERT INTO inventory_feedback (message, page) VALUES ('Undo was easy to find', '/pantry')");
  const [fb] = await admin<{ created_by: string }>("SELECT created_by::text FROM inventory_feedback");
  assert.equal(fb.created_by, KATHY);

  // History shows who did it — names come from the member list, readable to members.
  const names = await as<{ display_name: string }>(OWNER, "SELECT display_name FROM elk_family_members ORDER BY 1");
  assert.deepEqual(names.map(n => n.display_name), ["Kathy", "Owner"]);
  assert.ok((await as(OWNER, "SELECT * FROM stock_movements WHERE item_id = 'pantry-tomatoes-test'")).length >= 3);
});

// ── Everyone else ─────────────────────────────────────────────────────────────
for (const [who, uid] of [["a signed-in stranger", STRANGER], ["someone not signed in", null]] as const) {
  test(`${who} sees nothing in any ELK table`, async () => {
    for (const t of ELK_TABLES) {
      const rows = await as(uid, `SELECT * FROM public.${t}`).catch((e: Error) => e);
      if (rows instanceof Error) assert.match(rows.message, /permission denied/, t);
      else assert.equal(rows.length, 0, t);
    }
  });

  test(`${who} can't add, change or delete inventory`, async () => {
    await assert.rejects(as(uid, "INSERT INTO inventory_items (id, name) VALUES ('evil', 'x')"), /row-level security|permission denied/);
    await assert.rejects(as(uid, "INSERT INTO purchase_drafts (raw_text) VALUES ('x')"), /row-level security|permission denied/);
    await as(uid, "UPDATE inventory_items SET name = 'pwned'").catch(() => {});
    await as(uid, "DELETE FROM inventory_items").catch(() => {});
    await as(uid, "DELETE FROM purchase_drafts").catch(() => {});
    assert.equal((await admin("SELECT count(*)::int AS n FROM inventory_items WHERE name = 'pwned'"))[0].n, 0);
    assert.equal((await admin("SELECT count(*)::int AS n FROM inventory_items"))[0].n, 3);
    assert.equal((await admin("SELECT count(*)::int AS n FROM purchase_drafts"))[0].n, 1);
  });

  test(`${who} can't use any pantry function`, async () => {
    const before = await admin("SELECT * FROM stock_lots ORDER BY id");
    const [{ b }] = await admin<{ b: string }>("SELECT batch_id::text AS b FROM stock_movements WHERE kind = 'received' LIMIT 1");
    const calls = [
      "SELECT pantry_receive('pantry-tomatoes-test', 5, 'x')",
      "SELECT pantry_receive('stranger-item', 5, 'x', NULL, CURRENT_DATE, 'Stranger thing', 'cans')",
      "SELECT pantry_use('pantry-tomatoes-test', 1)",
      `SELECT pantry_undo('${b}')`,
      "SELECT pantry_set_low_stock('pantry-tomatoes-test', 0)",
    ];
    for (const sql of calls) {
      await assert.rejects(as(uid, sql), uid ? /isn't on the family list/ : /permission denied/, sql);
    }
    assert.deepEqual(await admin("SELECT * FROM stock_lots ORDER BY id"), before);
    assert.equal((await admin("SELECT count(*)::int AS n FROM inventory_items WHERE id = 'stranger-item'"))[0].n, 0);
  });

  test(`${who} can't send feedback`, async () => {
    await assert.rejects(as(uid, "INSERT INTO inventory_feedback (message) VALUES ('hi')"), /row-level security|permission denied/);
    await assert.rejects(as(uid, `INSERT INTO inventory_feedback (message, created_by) VALUES ('hi', '${KATHY}')`), /row-level security|permission denied/);
  });
}

test("a stranger can't add themselves to the family, by any route", async () => {
  assert.deepEqual(await as(STRANGER, "SELECT public.elk_is_family_member() AS ok"), [{ ok: false }]);
  await assert.rejects(as(STRANGER, `INSERT INTO elk_family_members (user_id) VALUES ('${STRANGER}')`), /permission denied/);
  await assert.rejects(as(STRANGER, `UPDATE elk_family_members SET user_id = '${STRANGER}' WHERE user_id = '${KATHY}'`), /permission denied/);
  await assert.rejects(as(null, `INSERT INTO elk_family_members (user_id) VALUES ('${STRANGER}')`), /permission denied/);
  await assert.rejects(as(null, "SELECT public.elk_is_family_member()"), /permission denied/);
  // Internal helpers aren't callable at all.
  await assert.rejects(as(STRANGER, "SELECT pantry_reconcile_('pantry-tomatoes-test')"), /permission denied/);
  await assert.rejects(as(STRANGER, "SELECT pantry_require_member_()"), /permission denied/);
  assert.equal((await admin("SELECT count(*)::int AS n FROM elk_family_members"))[0].n, 2);
});

test("a family member can't change the family list either (owner-only, via SQL Editor)", async () => {
  await assert.rejects(as(KATHY, `INSERT INTO elk_family_members (user_id) VALUES ('${STRANGER}')`), /permission denied/);
  await assert.rejects(as(KATHY, `DELETE FROM elk_family_members WHERE user_id = '${OWNER}'`), /permission denied/);
  await assert.rejects(as(KATHY, "UPDATE elk_family_members SET display_name = 'Boss'"), /permission denied/);
});

test("removing someone from the family cuts off access immediately", async () => {
  await addMember(db, STRANGER, "Temp");
  assert.ok((await as(STRANGER, "SELECT * FROM inventory_items")).length > 0);
  await admin("DELETE FROM elk_family_members WHERE user_id = $1", [STRANGER]);
  assert.equal((await as(STRANGER, "SELECT * FROM inventory_items")).length, 0);
  await assert.rejects(as(STRANGER, "SELECT pantry_use('pantry-tomatoes-test', 1)"), /isn't on the family list/);
});

test("every ELK SECURITY DEFINER function pins an empty search_path", async () => {
  const fns = await admin<{ proname: string; cfg: string[] | null }>(`
    SELECT proname, proconfig AS cfg FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace AND prosecdef
       AND (proname LIKE 'pantry\\_%' OR proname LIKE 'elk\\_%')`);
  assert.ok(fns.length >= 7);
  for (const f of fns) assert.deepEqual(f.cfg, ['search_path=""'], f.proname);
});

test("re-running both migrations changes nothing and keeps the door shut", async () => {
  const snapshot = async () => ({
    items: await admin("SELECT * FROM inventory_items ORDER BY id"),
    lots: await admin("SELECT * FROM stock_lots ORDER BY id"),
    members: await admin("SELECT * FROM elk_family_members ORDER BY user_id"),
  });
  const before = await snapshot();
  await runFile(db, "supabase-family-access.sql");
  await runFile(db, "supabase-pantry.sql");
  assert.deepEqual(await snapshot(), before);
  assert.equal((await as(STRANGER, "SELECT * FROM inventory_items")).length, 0);
  assert.equal((await as(STRANGER, "SELECT * FROM stock_lots")).length, 0);
  assert.ok((await as(KATHY, "SELECT * FROM stock_lots")).length > 0);
});

test("the other app's tables, and profiles, are exactly as they were", async () => {
  assert.deepEqual(await otherAppState(), otherAppBefore);
  assert.equal((await as(STRANGER, "SELECT * FROM stamp_sets")).length, 2);   // its own rules still apply
});

test("the migrations won't adopt a same-named table that belongs to someone else", async () => {
  const other = await supabaseLikeDb();
  await runFile(other, "supabase-schema.sql");
  await other.exec(`
    CREATE TABLE public.stock_lots (id INT PRIMARY KEY, sku TEXT);
    ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "theirs" ON public.stock_lots FOR SELECT USING (true);
    INSERT INTO public.stock_lots VALUES (1, 'theirs');`);
  const theirPolicies = () => other.query("SELECT policyname, qual FROM pg_policies WHERE tablename = 'stock_lots'").then(r => r.rows);
  const policiesBefore = await theirPolicies();
  await runFile(other, "supabase-family-access.sql");          // leaves their table alone…
  assert.deepEqual(await theirPolicies(), policiesBefore);
  await assert.rejects(runFile(other, "supabase-pantry.sql"), /stock_lots exists but was not created by ELK/);   // …and pantry stops
  assert.deepEqual((await other.query("SELECT * FROM public.stock_lots")).rows, [{ id: 1, sku: "theirs" }]);
  assert.deepEqual(await theirPolicies(), policiesBefore);

  const third = await supabaseLikeDb();
  await third.exec("CREATE TABLE public.elk_family_members (user_id UUID PRIMARY KEY);");
  await runFile(third, "supabase-schema.sql");
  await assert.rejects(runFile(third, "supabase-family-access.sql"), /elk_family_members exists but was not created by ELK/);
});

test("the owner's enrolment snippet (as written in the migration) refuses password accounts and never-signed-in ones", async () => {
  const src = readFileSync("supabase-family-access.sql", "utf8");
  const start = src.indexOf("--      INSERT INTO public.elk_family_members");
  const end = src.indexOf("RETURNING user_id, display_name;", start) + "RETURNING user_id, display_name;".length;
  const snippet = src.slice(start, end).split("\n").map(l => l.replace(/^--\s{0,6}/, "")).join("\n");

  const fresh = await supabaseLikeDb();
  await fresh.exec(`
    ALTER TABLE auth.users ADD COLUMN encrypted_password TEXT, ADD COLUMN last_sign_in_at TIMESTAMPTZ;
    INSERT INTO auth.users (id, email, encrypted_password, last_sign_in_at) VALUES
      ('${KATHY}',    'kathy@example.com',  '',              NOW()),   -- signed in by email link
      ('${STRANGER}', 'victim@example.com', '$2a$10$hash',   NOW()),   -- someone registered this email with a password
      ('${OWNER}',    'new@example.com',    NULL,            NULL);    -- never signed in
  `);
  await runFile(fresh, "supabase-schema.sql");
  await runFile(fresh, "supabase-family-access.sql");
  const enrol = (email: string) => fresh.query(snippet.replace("their@email", email).replace("Their name", "X")).then(r => r.rows);
  assert.equal((await enrol("KATHY@example.com")).length, 1);
  assert.equal((await enrol("victim@example.com")).length, 0);
  assert.equal((await enrol("new@example.com")).length, 0);
});
