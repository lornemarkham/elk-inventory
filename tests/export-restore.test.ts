// Full export → restore drill, against a real Postgres (PGlite) loaded with the
// real SQL files. The "export" is read the way PostgREST would return rows
// (to_jsonb), put through buildBundle/parseBundle, turned into the restore
// script, and run on a fresh database. Every row must come back identical.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness.ts";
import {
  TABLES, buildBundle, buildRestoreSql, parseBundle, fetchAllPages, csvCell, stockCsv, historyCsv, shoppingCsv,
  ExportFileError, type DbRow, type ExportTables,
} from "../src/lib/exportBundle.ts";

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB   = "00000000-0000-0000-0000-00000000000b";
const NASTY = `Bob's "Best" tomatoes'; DROP TABLE inventory_items; --`;

async function freshDb(withUsers = true): Promise<PGlite> {
  const db = await supabaseLikeDb();
  await runFile(db, "supabase-schema.sql");
  await runFile(db, "supabase-family-access.sql");
  await runFile(db, "supabase-pantry.sql");
  if (withUsers) {
    await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${ALICE}', 'a@example.com'), ('${BOB}', 'b@example.com');`);
  }
  return db;
}

async function readTables(db: PGlite): Promise<ExportTables> {
  const out = {} as ExportTables;
  for (const t of TABLES) {
    out[t] = (await db.query<{ j: DbRow }>(`SELECT to_jsonb(t) AS j FROM public.${t} t ORDER BY t.id::text`)).rows.map(r => r.j);
  }
  return out;
}

let source: PGlite;
let exported: ExportTables;
let restoreSql: string;

before(async () => {
  source = await freshDb();
  await addMember(source, ALICE, "Alice");
  await addMember(source, BOB, "Bob");
  await source.exec(`
    INSERT INTO inventory_items (id, name, domain, current_zone, recommended_zone, location_detail, quantity, attributes) VALUES
      ('pantry-tom', 'Diced Tomatoes', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'White Pantry Shelf', 10, '{"unit":"cans","barcode":"0123456789012"}'),
      ('pantry-nasty', $$${NASTY}$$, 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Top shelf', 3, '{"unit":"jars"}'),
      ('tool-drill', 'Cordless drill', NULL, 'mechanic-bay', 'mechanic-bay', 'Red Toolbox', 1, '{}');
  `);
  const alice = asUser(source);
  await alice(ALICE, "SELECT pantry_receive('pantry-tom', 12, 'Basement shelf', '2028-03-01', '2026-10-10')");
  const lots = await source.query<{ id: string }>("SELECT id FROM stock_lots WHERE item_id='pantry-tom' AND source='purchase'");
  await alice(ALICE, "SELECT pantry_use('pantry-tom', 2, NULL, gen_random_uuid())");
  await alice(ALICE, "SELECT pantry_use('pantry-tom', 1, NULL, gen_random_uuid(), 'wasted')");
  await alice(BOB, "SELECT pantry_move($1, 4, 'Garage fridge', gen_random_uuid())", [lots.rows[0].id]);
  const used = await alice(ALICE, "SELECT pantry_use('pantry-nasty', 1, NULL, gen_random_uuid()) AS b");
  await alice(ALICE, "SELECT pantry_undo($1)", [used[0].b]);
  await alice(ALICE, "SELECT pantry_shopping_add(ARRAY['Eggs','Milk'], 'for pancakes', 'manual')");

  exported = await readTables(source);
  const bundle = parseBundle(JSON.stringify(buildBundle(exported, [])));
  restoreSql = buildRestoreSql(bundle);
});

test("the test data really has batches, a full history and a shopping list", () => {
  assert.equal(exported.inventory_items.length, 3);
  assert.ok(exported.stock_lots.length >= 4);
  const kinds = new Set(exported.stock_movements.map(m => m.kind));
  for (const k of ["received", "used", "wasted", "moved", "undo", "count-correction"]) assert.ok(kinds.has(k), k);
  assert.equal(exported.pantry_shopping_items.length, 2);
});

test("restoring into an empty database brings back every row exactly", async () => {
  const target = await freshDb();
  await target.exec(restoreSql);
  assert.deepEqual(await readTables(target), exported);
});

test("the check query at the end reports nothing missing and no count mismatch", async () => {
  const target = await freshDb();
  const results = await target.exec(restoreSql);
  const checks = results.filter(r => r.rows.length > 0 || r.fields.length > 0).slice(-2);
  const missing = checks[0].rows as { tbl: string; in_file: number; missing_after: number }[];
  assert.equal(missing.length, 4);
  for (const r of missing) assert.equal(Number(r.missing_after), 0, r.tbl);
  assert.equal(checks[1].rows.length, 0, "pantry counts agree with batches");
});

test("the movement history is still append-only after a restore", async () => {
  const target = await freshDb();
  await addMember(target, ALICE, "Alice");
  await target.exec(restoreSql);
  const before = (await target.query("SELECT count(*)::int AS n FROM stock_movements")).rows[0] as { n: number };
  assert.equal(before.n, exported.stock_movements.length);
  const as = asUser(target);
  await assert.rejects(as(ALICE, "DELETE FROM stock_movements"), /permission denied/);
  await assert.rejects(as(ALICE, "INSERT INTO stock_movements (item_id, lot_id, kind, quantity_delta, batch_id) SELECT item_id, lot_id, 'used', -1, gen_random_uuid() FROM stock_movements LIMIT 1"), /permission denied/);
});

test("running the restore twice changes nothing", async () => {
  const target = await freshDb();
  await target.exec(restoreSql);
  await target.exec(restoreSql);
  assert.deepEqual(await readTables(target), exported);
});

test("restore only adds what is missing: it never overwrites or deletes existing rows", async () => {
  const target = await freshDb();
  await target.exec(restoreSql);
  await target.exec(`
    UPDATE inventory_items SET notes = 'edited after the backup' WHERE id = 'tool-drill';
    DELETE FROM pantry_shopping_items WHERE name = 'Milk';
    INSERT INTO inventory_items (id, name) VALUES ('made-after-backup', 'New thing');
  `);
  await target.exec(restoreSql);
  const rows = (await target.query<{ id: string; notes: string }>("SELECT id, notes FROM inventory_items ORDER BY id")).rows;
  assert.equal(rows.find(r => r.id === "tool-drill")?.notes, "edited after the backup");
  assert.ok(rows.some(r => r.id === "made-after-backup"));
  const shop = (await target.query<{ name: string }>("SELECT name FROM pantry_shopping_items ORDER BY name")).rows.map(r => r.name);
  assert.deepEqual(shop, ["Eggs", "Milk"]);
});

test("restoring to a project whose users differ blanks created_by instead of failing", async () => {
  const target = await freshDb(false);
  await target.exec(restoreSql);
  const r = await target.query<{ n: number }>("SELECT count(*)::int AS n FROM stock_movements WHERE created_by IS NOT NULL");
  assert.equal(r.rows[0].n, 0);
  assert.equal((await target.query("SELECT 1 FROM stock_lots")).rows.length, exported.stock_lots.length);
});

test("the script contains only inserts for data, and survives quotes and SQL in item names", async () => {
  assert.ok(!/^\s*(UPDATE|DELETE|TRUNCATE|DROP)\b/im.test(restoreSql.replace(/DO \$\$[\s\S]*?END \$\$;/, "")));
  const target = await freshDb();
  await target.exec(restoreSql);
  const r = await target.query<{ name: string }>("SELECT name FROM inventory_items WHERE id = 'pantry-nasty'");
  assert.equal(r.rows[0].name, NASTY);
  assert.equal((await target.query("SELECT to_regclass('public.inventory_items') AS t")).rows[0].t, "inventory_items");
});

test("the restore refuses to run when Pantry tables are missing", async () => {
  const bare = await supabaseLikeDb();
  await runFile(bare, "supabase-schema.sql");
  await assert.rejects(bare.exec(restoreSql), /Run supabase-schema\.sql/);
});

test("export bundle: counts, storage locations, and tamper detection", () => {
  const b = buildBundle(exported, ["pantry_shopping_items"], new Date("2026-11-01T10:00:00Z"));
  assert.equal(b.exportedAt, "2026-11-01T10:00:00.000Z");
  assert.deepEqual(b.counts, { inventory_items: 3, stock_lots: exported.stock_lots.length, stock_movements: exported.stock_movements.length, pantry_shopping_items: 2 });
  const names = b.storageLocations.map(l => l.name);
  for (const n of ["Basement shelf", "Garage fridge", "Red Toolbox", "Mechanic Bay"]) assert.ok(names.includes(n), n);
  assert.equal(b.storageLocations.find(l => l.name === "Garage fridge")?.batches, 1);

  const text = JSON.stringify(b);
  assert.doesNotThrow(() => parseBundle(text));
  const bad = (mutate: (x: any) => void, re: RegExp) => {
    const x = JSON.parse(text); mutate(x);
    assert.throws(() => parseBundle(JSON.stringify(x)), (e: unknown) => e instanceof ExportFileError && re.test(e.message));
  };
  bad(x => { x.format = "other"; }, /isn't an ELK full export/);
  bad(x => { x.tables.stock_movements.pop(); }, /cut short or edited/);
  bad(x => { x.tables.inventory_items = x.tables.inventory_items.filter((i: DbRow) => i.id !== "pantry-tom"); x.counts.inventory_items = 2; }, /isn't in the file/);
  assert.throws(() => parseBundle("[1,2]"), ExportFileError);
  assert.throws(() => parseBundle("nope"), /valid JSON/);
  assert.throws(() => parseBundle(JSON.stringify(exported.inventory_items)), /older item-only export/);
});

test("fetchAllPages reads past the 1000-row cap (history is not truncated)", async () => {
  const all = Array.from({ length: 2500 }, (_, i) => i);
  const calls: [number, number][] = [];
  const got = await fetchAllPages(async (from, to) => { calls.push([from, to]); return all.slice(from, to + 1); });
  assert.equal(got.length, 2500);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
  const exact = await fetchAllPages(async (from, to) => all.slice(0, 2000).slice(from, to + 1));
  assert.equal(exact.length, 2000);   // a page that is exactly full is followed by one empty read
});

test("CSV: quoting, and spreadsheet formulas are defused", () => {
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell(-3), "-3");
  assert.equal(csvCell(null), "");
  const stock = stockCsv(exported).split("\r\n");
  assert.equal(stock[0], "Location,Item,Unit,Quantity now,Quantity received,Best before,Bought on,Kind");
  assert.ok(stock.some(l => l.startsWith("Garage fridge,Diced Tomatoes,cans,4,4,2028-03-01")));
  assert.ok(stock.some(l => l.startsWith("Red Toolbox,Cordless drill")));
  assert.equal(historyCsv(exported).trim().split("\r\n").length, exported.stock_movements.length + 1);
  assert.equal(shoppingCsv(exported).trim().split("\r\n").length, 3);
});

test("the command-line tool writes the same script from an export file, and rejects bad files", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "elk-restore-"));
  const good = join(dir, "export.json");
  const text = JSON.stringify(buildBundle(exported, []));
  writeFileSync(good, text);
  const run = (f: string) => spawnSync("node", ["--import", "./tests/resolve-ts.mjs", "scripts/restore-sql.ts", f], { encoding: "utf8" });
  const ok = run(good);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, buildRestoreSql(parseBundle(text)));

  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify([{ id: "old-style-item-only-export" }]));
  const r = run(bad);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Can't use that file/);
  assert.equal(r.stdout, "");
});

test("a hand-edited export date can't inject SQL into the restore script", () => {
  const x = JSON.parse(JSON.stringify(buildBundle(exported, [])));
  x.exportedAt = "x\nDROP TABLE public.inventory_items; --";
  assert.throws(() => parseBundle(JSON.stringify(x)), /export date/);
});
