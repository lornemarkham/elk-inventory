// ── Export everything (browser side) ───────────────────────────────────────────
// Reads every ELK table with the signed-in family member's own access (RLS
// applies) and hands the rows to exportBundle.ts. Never writes to the database.

import { supabase } from "./supabase";
import {
  TABLES, buildBundle, fetchAllPages, parseBundle, historyCsv, shoppingCsv, stockCsv,
  type DbRow, type ExportBundle, type ExportTables, type TableName,
} from "./exportBundle";

// Tables the Pantry migration adds. If they aren't there yet that is fine: export them empty.
const PANTRY_TABLES: TableName[] = ["stock_lots", "stock_movements", "pantry_shopping_items"];

function isMissingTable(err: { code?: string; message?: string }): boolean {
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? "");
}

/** Throws if any table that exists can't be read in full — a partial backup must never look complete. */
export async function loadExportBundle(now = new Date()): Promise<ExportBundle> {
  const tables = {} as ExportTables;
  const missing: TableName[] = [];
  for (const t of TABLES) {
    try {
      let total: number | null = null;
      tables[t] = await fetchAllPages<DbRow>(async (from, to) => {
        const { data, error, count } = await supabase.from(t).select("*", { count: "exact" })
          .order("id", { ascending: true }).range(from, to);
        if (error) throw Object.assign(new Error(error.message), { code: error.code });
        if (total === null) total = count;
        return (data ?? []) as DbRow[];
      });
      // The server's own row count must match what we collected (catches a lower server row cap).
      if (total !== null && total !== tables[t].length) {
        throw new Error(`got ${tables[t].length} of ${total} rows`);
      }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (PANTRY_TABLES.includes(t) && isMissingTable(err)) { tables[t] = []; missing.push(t); continue; }
      throw new Error(`Couldn't read ${t}: ${err.message ?? "unknown error"}. Nothing was exported.`);
    }
  }
  // The tables are read one after another; if someone saved in between, the
  // pieces may not fit together. Say so now, not when a restore is needed.
  try {
    return parseBundle(JSON.stringify(buildBundle(tables, missing, now)));
  } catch (e) {
    throw new Error(`The export didn't hold together (${e instanceof Error ? e.message : "unknown"}) — someone may have saved while it ran. Try again. Nothing was exported.`);
  }
}

export type ExportKind = "everything" | "stock" | "history" | "shopping";

const stamp = (d: Date) => d.toISOString().slice(0, 10);

export function fileFor(kind: ExportKind, b: ExportBundle): { name: string; type: string; text: string } {
  const day = stamp(new Date(b.exportedAt));
  switch (kind) {
    case "everything": return { name: `elk-inventory-full-export-${day}.json`, type: "application/json", text: JSON.stringify(b, null, 2) };
    case "stock":      return { name: `elk-stock-${day}.csv`, type: "text/csv", text: stockCsv(b.tables) };
    case "history":    return { name: `elk-history-${day}.csv`, type: "text/csv", text: historyCsv(b.tables) };
    case "shopping":   return { name: `elk-shopping-${day}.csv`, type: "text/csv", text: shoppingCsv(b.tables) };
  }
}

export function download(file: { name: string; type: string; text: string }) {
  const url = URL.createObjectURL(new Blob([file.text], { type: `${file.type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}
