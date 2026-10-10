// ── Pantry model (pure) ─────────────────────────────────────────────────────────
// Lots + movements for pantry stock. The database is the source of truth and
// does all writes (supabase-pantry.sql); this file only orders and summarizes
// what was fetched, so the screen can say "use these first" and "running low".
//
//   InventoryItem  = the product ("Diced Tomatoes", attributes.unit "cans")
//   StockLot       = a physical batch of it (how many, where, best before)
//   StockMovement  = one change to one lot (received / used / undo / correction)

import type { InventoryItem } from "../types/inventory";

export interface StockLot {
  id: string;
  itemId: string;
  quantityReceived: number;
  quantityRemaining: number;
  location: string;
  bestBefore: string | null;    // YYYY-MM-DD
  purchasedOn: string | null;   // YYYY-MM-DD; null = already on hand before tracking
  source: "purchase" | "already-on-hand";
  createdAt: string;
  createdBy: string | null;
}

export type MovementKind = "received" | "used" | "undo" | "count-correction";

export interface StockMovement {
  id: string;
  itemId: string;
  lotId: string;
  kind: MovementKind;
  quantityDelta: number;
  batchId: string;
  undoesBatchId: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

// Oldest first — same order as the SQL functions:
// already-on-hand (no purchase date) → purchase date → when it was recorded.
export function fifoOrder(lots: StockLot[]): StockLot[] {
  return [...lots].sort((a, b) => {
    if (a.purchasedOn !== b.purchasedOn) {
      if (a.purchasedOn === null) return -1;
      if (b.purchasedOn === null) return 1;
      return a.purchasedOn < b.purchasedOn ? -1 : 1;
    }
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface PantrySummary {
  item: InventoryItem;
  unit: string;
  onHand: number;
  /** Lots that still have something in them, oldest first. */
  openLots: StockLot[];
  /** The batch to take from next (oldest), if any. */
  useFirst: StockLot | null;
  lowStockAt: number | null;
  isLow: boolean;
  /** A newer batch has an earlier best-before than the one marked "use first". */
  newerExpiresSooner: StockLot | null;
  /** Item has never been through the pantry screen — count comes from the item itself. */
  untracked: boolean;
}

export function summarize(item: InventoryItem, allLots: StockLot[]): PantrySummary {
  const lots = allLots.filter(l => l.itemId === item.id);
  const openLots = fifoOrder(lots.filter(l => l.quantityRemaining > 0));
  const untracked = lots.length === 0;

  // Untracked: the item's own count is all we know. Tracked: the lots are
  // the truth (the database keeps item.quantity equal to their total).
  const onHand = untracked
    ? Math.max(0, item.quantity)
    : openLots.reduce((n, l) => n + l.quantityRemaining, 0);

  const raw = item.attributes?.lowStockAt;
  const lowStockAt = typeof raw === "number" && raw >= 0 ? raw : null;

  const useFirst = openLots[0] ?? null;
  let newerExpiresSooner: StockLot | null = null;
  if (useFirst) {
    for (const l of openLots.slice(1)) {
      if (l.bestBefore && (!useFirst.bestBefore || l.bestBefore < useFirst.bestBefore)
        && (!newerExpiresSooner || l.bestBefore < newerExpiresSooner.bestBefore!)) {
        newerExpiresSooner = l;
      }
    }
    // An undated first batch vs a dated newer one isn't a real conflict —
    // we just don't know. Only warn when both dates are known.
    if (newerExpiresSooner && !useFirst.bestBefore) newerExpiresSooner = null;
  }

  return {
    item,
    unit: unitOf(item),
    onHand,
    openLots,
    useFirst,
    lowStockAt,
    isLow: lowStockAt !== null && onHand <= lowStockAt,
    newerExpiresSooner,
    untracked,
  };
}

export function unitOf(item: InventoryItem): string {
  const u = item.attributes?.unit;
  return typeof u === "string" && u.trim() ? u.trim() : "items";
}

const SINGULAR: Record<string, string> = {
  cans: "can", jars: "jar", bags: "bag", boxes: "box", bottles: "bottle", packs: "pack",
  packets: "packet", loaves: "loaf", cartons: "carton", tins: "tin", items: "item", servings: "serving",
};

/** "1 can" / "2 cans". Units not in the list are left as typed. */
export function countLabel(n: number, unit: string): string {
  if (n === 1 && SINGULAR[unit.toLowerCase()]) return `1 ${SINGULAR[unit.toLowerCase()]}`;
  return `${n} ${unit}`;
}

export function isPantryItem(item: InventoryItem): boolean {
  return item.domain === "food-storage";
}

/** Product matching for "What did you buy?" — case/space-insensitive name. */
export function findProductByName(items: InventoryItem[], name: string): InventoryItem | null {
  const key = name.trim().replace(/\s+/g, " ").toLowerCase();
  if (!key) return null;
  return items.find(i => isPantryItem(i) && i.name.trim().replace(/\s+/g, " ").toLowerCase() === key) ?? null;
}

/** Human date: "12 Mar 2027". Input is a plain YYYY-MM-DD (no timezone shift). */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

/** Days from `today` (YYYY-MM-DD) to `iso`; negative = past. */
export function daysUntil(iso: string, today: string): number {
  const a = Date.UTC(...ymd(today));
  const b = Date.UTC(...ymd(iso));
  return Math.round((b - a) / 86_400_000);
}

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m - 1, d];
}

/** Today's date in the user's own timezone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
