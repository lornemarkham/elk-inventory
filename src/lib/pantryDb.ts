// ── Pantry database calls ──────────────────────────────────────────────────────
// Reads the lots/movements tables; every write goes through a pantry_* SQL
// function (supabase-pantry.sql) so counts are changed atomically and every
// change lands in stock_movements. Never writes the tables directly.

import { supabase } from "./supabase";
import type { StockLot, StockMovement } from "./pantryModel";

type Row = Record<string, unknown>;

export type PantryResult<T = void> = { ok: true; value: T } | { ok: false; error: string };

export type PantryLoad =
  | { status: "ready"; lots: StockLot[]; movements: StockMovement[]; people: Record<string, string> }
  | { status: "not-set-up" }
  | { status: "error"; error: string };

function rowToLot(r: Row): StockLot {
  return {
    id:                r.id as string,
    itemId:            r.item_id as string,
    quantityReceived:  r.quantity_received as number,
    quantityRemaining: r.quantity_remaining as number,
    location:          (r.location as string) ?? "",
    bestBefore:        (r.best_before as string | null) ?? null,
    purchasedOn:       (r.purchased_on as string | null) ?? null,
    source:            r.source as StockLot["source"],
    createdAt:         r.created_at as string,
    createdBy:         (r.created_by as string | null) ?? null,
  };
}

function rowToMovement(r: Row): StockMovement {
  return {
    id:            r.id as string,
    itemId:        r.item_id as string,
    lotId:         r.lot_id as string,
    kind:          r.kind as StockMovement["kind"],
    quantityDelta: r.quantity_delta as number,
    batchId:       r.batch_id as string,
    undoesBatchId: (r.undoes_batch_id as string | null) ?? null,
    note:          (r.note as string | null) ?? null,
    createdAt:     r.created_at as string,
    createdBy:     (r.created_by as string | null) ?? null,
  };
}

// PostgREST: 42P01 = table missing (old), PGRST205 = not in schema cache.
function isMissingTable(err: { code?: string; message?: string }): boolean {
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? "");
}

export async function loadPantry(): Promise<PantryLoad> {
  const [lots, moves, people] = await Promise.all([
    supabase.from("stock_lots").select("*"),
    supabase.from("stock_movements").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.from("profiles").select("id, name, email"),
  ]);
  for (const r of [lots, moves]) {
    if (r.error) {
      if (isMissingTable(r.error)) return { status: "not-set-up" };
      console.error("[ELK] loadPantry error:", r.error.message);
      return { status: "error", error: r.error.message };
    }
  }
  const names: Record<string, string> = {};
  for (const p of (people.data ?? []) as Row[]) {
    const name = (p.name as string | null)?.trim() || ((p.email as string | null) ?? "").split("@")[0];
    if (name) names[p.id as string] = name;
  }
  return {
    status: "ready",
    lots: (lots.data as Row[]).map(rowToLot),
    movements: (moves.data as Row[]).map(rowToMovement),
    people: names,
  };
}

async function rpc<T>(fn: string, args: Row): Promise<PantryResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[ELK] ${fn} error:`, error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, value: data as T };
}

export function receive(args: {
  itemId: string;
  quantity: number;
  location: string;
  bestBefore: string | null;
  purchasedOn: string;
  newProduct?: { name: string; unit: string };
  /** Reuse the same id when retrying the same save — the database ignores repeats. */
  requestId?: string;
}): Promise<PantryResult<string>> {
  return rpc<string>("pantry_receive", {
    p_item_id:      args.itemId,
    p_quantity:     args.quantity,
    p_location:     args.location,
    p_best_before:  args.bestBefore,
    p_purchased_on: args.purchasedOn,
    p_new_name:     args.newProduct?.name ?? null,
    p_unit:         args.newProduct?.unit ?? null,
    p_request_id:   args.requestId ?? null,
  });
}

export function use(itemId: string, quantity: number, lotId: string | null, requestId: string): Promise<PantryResult<string>> {
  return rpc<string>("pantry_use", { p_item_id: itemId, p_quantity: quantity, p_lot_id: lotId, p_request_id: requestId });
}

export function undo(batchId: string): Promise<PantryResult<string>> {
  return rpc<string>("pantry_undo", { p_batch_id: batchId });
}

export function setLowStock(itemId: string, level: number | null): Promise<PantryResult<null>> {
  return rpc<null>("pantry_set_low_stock", { p_item_id: itemId, p_level: level });
}

export async function sendFeedback(message: string, page: string): Promise<PantryResult> {
  const { error } = await supabase.from("feedback").insert({
    message,
    page,
    user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) {
    console.error("[ELK] sendFeedback error:", error.message);
    return { ok: false, error: isMissingTable(error) ? "Feedback isn't switched on yet." : error.message };
  }
  return { ok: true, value: undefined };
}
