// ── Complete export + restore script (pure) ────────────────────────────────────
// One JSON file holds every ELK inventory table as raw database rows:
//
//   inventory_items · stock_lots (pantry batches) · stock_movements (history)
//   · pantry_shopping_items · storage locations (derived)
//
// buildRestoreSql() turns such a file into a reviewed SQL script the owner runs
// in the Supabase SQL Editor. Restore is deliberately SQL, not an app button:
// batches and history are unwritable from the API so the history stays
// append-only. The script only ever INSERTs rows that are missing
// (ON CONFLICT DO NOTHING) — it never updates, deletes or truncates.

import { ZONES } from "../data/zones";
import { CONTAINERS } from "../data/containers";

export const EXPORT_FORMAT = "elk-inventory-export";
export const EXPORT_VERSION = 1;

export type DbRow = Record<string, unknown>;

export interface ExportTables {
  inventory_items: DbRow[];
  stock_lots: DbRow[];
  stock_movements: DbRow[];
  pantry_shopping_items: DbRow[];
}

export type TableName = keyof ExportTables;
export const TABLES: TableName[] = ["inventory_items", "stock_lots", "stock_movements", "pantry_shopping_items"];

export interface StorageLocation {
  name: string;
  kind: "zone" | "container" | "pantry-place" | "item-spot";
  /** Pantry batches (with something left) stored here. */
  batches: number;
  /** Items whose own location/zone is this. */
  items: number;
}

export interface ExportBundle {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  /** Row count per table, so a truncated or edited file is noticed on restore. */
  counts: Record<TableName, number>;
  /** Tables the database doesn't have yet (Pantry not switched on) — exported empty. */
  missingTables: TableName[];
  tables: ExportTables;
  storageLocations: StorageLocation[];
}

export function buildBundle(tables: ExportTables, missingTables: TableName[], now = new Date()): ExportBundle {
  const counts = Object.fromEntries(TABLES.map(t => [t, tables[t].length])) as Record<TableName, number>;
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    counts,
    missingTables,
    tables,
    storageLocations: deriveLocations(tables),
  };
}

/** Every place stock or things are kept: zones, containers, and the places typed on batches/items. */
export function deriveLocations(t: ExportTables): StorageLocation[] {
  const map = new Map<string, StorageLocation>();
  const bump = (name: string, kind: StorageLocation["kind"], field: "batches" | "items") => {
    const key = `${kind}:${name.trim().toLowerCase()}`;
    const e = map.get(key) ?? { name: name.trim(), kind, batches: 0, items: 0 };
    e[field] += 1;
    map.set(key, e);
  };
  for (const z of ZONES) map.set(`zone:${z.name.toLowerCase()}`, { name: z.name, kind: "zone", batches: 0, items: 0 });
  for (const c of CONTAINERS) map.set(`container:${c.name.toLowerCase()}`, { name: c.name, kind: "container", batches: 0, items: 0 });

  for (const lot of t.stock_lots) {
    const place = String(lot.location ?? "").trim();
    if (place && Number(lot.quantity_remaining) > 0) bump(place, "pantry-place", "batches");
  }
  const zoneName = new Map<string, string>(ZONES.map(z => [z.id, z.name]));
  const containerName = new Map<string, string>(CONTAINERS.map(c => [c.id, c.name]));
  for (const it of t.inventory_items) {
    const z = zoneName.get(String(it.current_zone));
    if (z) bump(z, "zone", "items");
    const c = containerName.get(String(it.container_id));
    if (c) bump(c, "container", "items");
    const spot = String(it.location_detail ?? "").trim();
    if (spot) bump(spot, "item-spot", "items");
  }
  return [...map.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/** Read every page of a query. `fetchPage(from, to)` returns up to to-from+1 rows, [] when done. */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>, pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}

// ── CSV (opens in a spreadsheet) ──────────────────────────────────────────────

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // A cell that starts with = + - @ would be run as a formula by Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** One row per pantry batch, plus one per product that has no batches yet. */
export function stockCsv(t: ExportTables): string {
  const items = new Map(t.inventory_items.map(i => [String(i.id), i]));
  const unit = (id: string) => String((items.get(id)?.attributes as DbRow | undefined)?.unit ?? "");
  const rows: unknown[][] = [];
  const withLots = new Set<string>();
  for (const l of t.stock_lots) {
    const id = String(l.item_id);
    withLots.add(id);
    rows.push([l.location, items.get(id)?.name ?? id, unit(id), l.quantity_remaining, l.quantity_received,
      l.best_before, l.purchased_on, l.source]);
  }
  for (const i of t.inventory_items) {
    if (withLots.has(String(i.id))) continue;
    rows.push([i.location_detail, i.name, unit(String(i.id)), i.quantity, i.quantity, "", "", "item"]);
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
  return toCsv(["Location", "Item", "Unit", "Quantity now", "Quantity received", "Best before", "Bought on", "Kind"], rows);
}

export function historyCsv(t: ExportTables): string {
  const items = new Map(t.inventory_items.map(i => [String(i.id), String(i.name)]));
  const rows = [...t.stock_movements]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map(m => [m.created_at, items.get(String(m.item_id)) ?? m.item_id, m.kind, m.quantity_delta, m.note, m.batch_id]);
  return toCsv(["When", "Item", "What happened", "Change", "Note", "Action id"], rows);
}

export function shoppingCsv(t: ExportTables): string {
  const rows = t.pantry_shopping_items.map(s => [s.name, s.note, s.source, s.created_at, s.done_at]);
  return toCsv(["Item", "Note", "Source", "Added", "Got on"], rows);
}

// ── Validation ────────────────────────────────────────────────────────────────

export class ExportFileError extends Error {}

/** Parse + sanity-check an export file. Throws ExportFileError with a plain-language reason. */
export function parseBundle(text: string): ExportBundle {
  let b: ExportBundle;
  try { b = JSON.parse(text) as ExportBundle; } catch { throw new ExportFileError("That file isn't valid JSON."); }
  if (!b || b.format !== EXPORT_FORMAT) {
    throw new ExportFileError(
      "That isn't an ELK full export (the older item-only export can't be restored this way — use Export everything).");
  }
  if (b.version !== EXPORT_VERSION) throw new ExportFileError(`Unsupported export version ${b.version}.`);
  // Printed into the restore script's header comment, so it must be a plain timestamp.
  if (typeof b.exportedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(b.exportedAt)) {
    throw new ExportFileError("The export date is missing or not a date — the file was edited.");
  }
  for (const t of TABLES) {
    if (!Array.isArray(b.tables?.[t])) throw new ExportFileError(`The file has no "${t}" list.`);
    if (b.counts?.[t] !== b.tables[t].length) {
      throw new ExportFileError(`"${t}" has ${b.tables[t].length} rows but the file says ${b.counts?.[t]} — it was cut short or edited.`);
    }
  }
  const itemIds = new Set(b.tables.inventory_items.map(i => String(i.id)));
  const lotIds = new Set(b.tables.stock_lots.map(l => String(l.id)));
  for (const l of b.tables.stock_lots) {
    if (!itemIds.has(String(l.item_id))) throw new ExportFileError(`Batch ${l.id} belongs to an item that isn't in the file.`);
    if (Number(l.quantity_remaining) > Number(l.quantity_received)) throw new ExportFileError(`Batch ${l.id} has more left than was received.`);
  }
  for (const m of b.tables.stock_movements) {
    if (!lotIds.has(String(m.lot_id))) throw new ExportFileError(`History row ${m.id} points at a batch that isn't in the file.`);
    if (!itemIds.has(String(m.item_id))) throw new ExportFileError(`History row ${m.id} points at an item that isn't in the file.`);
  }
  return b;
}

// ── Restore script ────────────────────────────────────────────────────────────

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

// Column lists are fixed here (not taken from the file) so a hand-edited export
// can't smuggle in anything but data. `fk` columns point at rows that may not
// exist in the target (a user, a draft): they become NULL instead of failing.
interface TableSpec {
  cols: string[];
  conflict: string;
  fk?: Record<string, string>;   // column → "schema.table(id)" it must exist in, else NULL
}

const SPECS: Record<TableName, TableSpec> = {
  inventory_items: {
    cols: ["id", "name", "item_class", "lifecycle_state", "domain", "current_zone", "recommended_zone", "location_detail",
      "collection_id", "container_id", "project", "tags", "quantity", "photo_path", "photo_type", "notes", "power_type",
      "battery_platform", "brand", "category", "subcategory", "attributes", "created_at", "updated_at", "source_draft_id"],
    conflict: "id",
    fk: { source_draft_id: "public.purchase_drafts" },
  },
  stock_lots: {
    cols: ["id", "item_id", "quantity_received", "quantity_remaining", "location", "best_before", "purchased_on", "source", "created_at", "created_by"],
    conflict: "id",
    fk: { created_by: "auth.users" },
  },
  stock_movements: {
    cols: ["id", "item_id", "lot_id", "kind", "quantity_delta", "batch_id", "undoes_batch_id", "note", "created_at", "created_by"],
    conflict: "id",
    fk: { created_by: "auth.users" },
  },
  pantry_shopping_items: {
    cols: ["id", "name", "item_id", "note", "source", "created_at", "created_by", "done_at", "done_by"],
    conflict: "id",
    fk: { created_by: "auth.users", done_by: "auth.users", item_id: "public.inventory_items" },
  },
};

function insertFor(table: TableName, rows: DbRow[]): string {
  const spec = SPECS[table];
  const json = sqlText(JSON.stringify(rows.map(r => Object.fromEntries(spec.cols.map(c => [c, r[c] ?? null])))));
  const select = spec.cols.map(c => {
    const target = spec.fk?.[c];
    return target ? `CASE WHEN EXISTS (SELECT 1 FROM ${target} x WHERE x.id = r.${c}) THEN r.${c} END` : `r.${c}`;
  });
  return `INSERT INTO public.${table} (${spec.cols.join(", ")})
SELECT ${select.join(", ")}
FROM jsonb_populate_recordset(NULL::public.${table}, ${json}::jsonb) r
ON CONFLICT (${spec.conflict}) DO NOTHING;`;
}

/**
 * The restore script. Safe to run twice and safe to run against a database that
 * already has data: existing rows are left exactly as they are. Ends with a
 * check that returns one row per table; `missing_after` must be 0 everywhere.
 */
export function buildRestoreSql(b: ExportBundle): string {
  const t = b.tables;
  const parts = [
    `-- ELK Inventory restore — generated from the export taken ${b.exportedAt}`,
    `-- Rows in the file: ${TABLES.map(n => `${n} ${b.counts[n]}`).join(", ")}`,
    `-- Inserts only what is MISSING. Never updates, deletes or truncates. Safe to run twice.`,
    `-- Prerequisites: supabase-schema.sql, supabase-family-access.sql and supabase-pantry.sql already applied.`,
    ``,
    `BEGIN;`,
    ``,
    `-- Refuse to run if the tables aren't there (a restore must not silently do nothing).`,
    `DO $$ BEGIN`,
    `  IF to_regclass('public.inventory_items') IS NULL OR to_regclass('public.stock_lots') IS NULL`,
    `     OR to_regclass('public.stock_movements') IS NULL OR to_regclass('public.pantry_shopping_items') IS NULL THEN`,
    `    RAISE EXCEPTION 'Run supabase-schema.sql, supabase-family-access.sql and supabase-pantry.sql first.';`,
    `  END IF;`,
    `END $$;`,
    ``,
  ];
  for (const table of TABLES) {
    parts.push(`-- ${table}: ${t[table].length} rows`);
    if (t[table].length > 0) parts.push(insertFor(table, t[table]));
    parts.push(``);
  }
  parts.push(`COMMIT;`, ``, `-- Check: missing_after must be 0 on every row, and count_mismatch must be 0.`);
  const checks = TABLES.map(table => {
    const ids = sqlText(JSON.stringify(t[table].map(r => String(r.id))));
    return `SELECT '${table}' AS tbl, ${t[table].length} AS in_file,
  (SELECT count(*) FROM jsonb_array_elements_text(${ids}::jsonb) f(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.${table} x WHERE x.id::text = f.id)) AS missing_after`;
  });
  parts.push(checks.join("\nUNION ALL\n") + ";", ``,
    `-- Pantry-tracked products whose count disagrees with their batches (should return no rows):`,
    `SELECT i.id, i.name, i.quantity, COALESCE(SUM(l.quantity_remaining), 0) AS in_batches`,
    `FROM public.inventory_items i LEFT JOIN public.stock_lots l ON l.item_id = i.id`,
    `WHERE COALESCE((i.attributes->>'pantryTracked')::boolean, false)`,
    `GROUP BY i.id, i.name, i.quantity HAVING i.quantity <> COALESCE(SUM(l.quantity_remaining), 0);`, ``);
  return parts.join("\n");
}
