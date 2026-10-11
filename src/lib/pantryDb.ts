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

const NEEDS_UPDATE = "This needs a database update first — nothing was changed. (For Lorne: re-run supabase-pantry.sql.)";

// PostgREST: 42P01 = table missing (old), PGRST205 = not in schema cache.
function isMissingTable(err: { code?: string; message?: string }): boolean {
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? "");
}

export async function loadPantry(): Promise<PantryLoad> {
  const [lots, moves, people] = await Promise.all([
    supabase.from("stock_lots").select("*"),
    supabase.from("stock_movements").select("*").order("created_at", { ascending: false }).limit(500),
    // Names for the history list. Only family members can read this table.
    supabase.from("elk_family_members").select("user_id, display_name"),
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
    const name = (p.display_name as string | null)?.trim();
    if (name) names[p.user_id as string] = name;
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
    // PGRST202: the database doesn't have this function (or these arguments) yet.
    if (error.code === "PGRST202") return { ok: false, error: NEEDS_UPDATE };
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

export function use(
  itemId: string, quantity: number, lotId: string | null, requestId: string, reason: "used" | "wasted" = "used",
): Promise<PantryResult<string>> {
  // p_reason is only sent for "wasted", so using still works before the
  // database has the newer pantry_use.
  return rpc<string>("pantry_use", {
    p_item_id: itemId, p_quantity: quantity, p_lot_id: lotId, p_request_id: requestId,
    ...(reason === "wasted" ? { p_reason: reason } : {}),
  });
}

export function move(lotId: string, quantity: number, toLocation: string, requestId: string): Promise<PantryResult<string>> {
  return rpc<string>("pantry_move", { p_lot_id: lotId, p_quantity: quantity, p_to_location: toLocation, p_request_id: requestId });
}

export function undo(batchId: string): Promise<PantryResult<string>> {
  return rpc<string>("pantry_undo", { p_batch_id: batchId });
}

export function setLowStock(itemId: string, level: number | null): Promise<PantryResult<null>> {
  return rpc<null>("pantry_set_low_stock", { p_item_id: itemId, p_level: level });
}

export async function sendFeedback(message: string, page: string): Promise<PantryResult> {
  const { error } = await supabase.from("inventory_feedback").insert({
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

// ── Shopping list ────────────────────────────────────────────────────────────

export interface ShoppingItem {
  id: string;
  name: string;
  itemId: string | null;
  note: string | null;
  source: "manual" | "low-stock" | "recipe";
  createdAt: string;
  createdBy: string | null;
  doneAt: string | null;
}

export type ShoppingLoad =
  | { status: "ready"; items: ShoppingItem[] }
  | { status: "not-set-up" }
  | { status: "error"; error: string };

/** Everything still to buy, plus what was ticked off in the last two days. */
export async function loadShopping(): Promise<ShoppingLoad> {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data, error } = await supabase.from("pantry_shopping_items").select("*")
    .or(`done_at.is.null,done_at.gte."${since}"`)
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { status: "not-set-up" };
    console.error("[ELK] loadShopping error:", error.message);
    return { status: "error", error: error.message };
  }
  return {
    status: "ready",
    items: (data as Row[]).map(r => ({
      id:        r.id as string,
      name:      r.name as string,
      itemId:    (r.item_id as string | null) ?? null,
      note:      (r.note as string | null) ?? null,
      source:    r.source as ShoppingItem["source"],
      createdAt: r.created_at as string,
      createdBy: (r.created_by as string | null) ?? null,
      doneAt:    (r.done_at as string | null) ?? null,
    })),
  };
}

/** Returns how many were added (names already on the list are skipped). */
export function addShopping(names: string[], note: string | null, source: ShoppingItem["source"]): Promise<PantryResult<number>> {
  return rpc<number>("pantry_shopping_add", { p_names: names, p_note: note, p_source: source });
}

export async function setShoppingDone(id: string, done: boolean): Promise<PantryResult> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("pantry_shopping_items")
    .update(done ? { done_at: new Date().toISOString(), done_by: u.user?.id ?? null } : { done_at: null, done_by: null })
    .eq("id", id);
  if (error) { console.error("[ELK] setShoppingDone error:", error.message); return { ok: false, error: error.message }; }
  return { ok: true, value: undefined };
}

export async function removeShopping(id: string): Promise<PantryResult> {
  const { error } = await supabase.from("pantry_shopping_items").delete().eq("id", id);
  if (error) { console.error("[ELK] removeShopping error:", error.message); return { ok: false, error: error.message }; }
  return { ok: true, value: undefined };
}
