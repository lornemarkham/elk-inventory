// ── Printable inventory (pure) ─────────────────────────────────────────────────
// Sheets grouped by storage place. Food shows one line per batch (so each
// best-before date is visible); other things show one line per item under
// their zone. The paper copy has blank columns for pencil updates and doubles
// as an offline backup.

import type { InventoryItem, Zone } from "../types/inventory";
import { isPantryItem, unitOf, countLabel, type StockLot } from "./pantryModel";

export interface PrintRow {
  name: string;
  /** "12 cans", "2" … what the database says is here. */
  quantity: string;
  /** YYYY-MM-DD or "". */
  bestBefore: string;
  /** Where inside the place ("Red Toolbox", "top shelf"); may be "". */
  detail: string;
}

export interface PrintSection {
  place: string;
  rows: PrintRow[];
}

export type PrintScope = "food" | "all";

const NO_PLACE = "No place recorded";

export function buildPrintSections(
  items: InventoryItem[], lots: StockLot[], zones: Zone[], scope: PrintScope,
): PrintSection[] {
  const zoneName = new Map(zones.map(z => [z.id as string, z.name]));
  const byPlace = new Map<string, PrintRow[]>();
  const add = (place: string, row: PrintRow) => {
    const key = place.trim() || NO_PLACE;
    byPlace.set(key, [...(byPlace.get(key) ?? []), row]);
  };

  for (const item of items) {
    const food = isPantryItem(item);
    if (scope === "food" && !food) continue;
    const itemLots = lots.filter(l => l.itemId === item.id);

    if (food && itemLots.length > 0) {
      // Tracked food: the batches are the truth. Used-up batches are left off.
      for (const lot of itemLots.filter(l => l.quantityRemaining > 0)) {
        add(lot.location || item.locationDetail || "", {
          name: item.name,
          quantity: countLabel(lot.quantityRemaining, unitOf(item)),
          bestBefore: lot.bestBefore ?? "",
          detail: "",
        });
      }
    } else if (food) {
      if (item.quantity <= 0) continue;
      add(item.locationDetail || "", { name: item.name, quantity: countLabel(item.quantity, unitOf(item)), bestBefore: "", detail: "" });
    } else {
      add(zoneName.get(item.currentZone) ?? item.currentZone, {
        name: item.name,
        quantity: String(item.quantity ?? 1),
        bestBefore: "",
        detail: item.locationDetail ?? "",
      });
    }
  }

  return [...byPlace.entries()]
    .map(([place, rows]) => ({
      place,
      rows: rows.sort((a, b) => a.detail.localeCompare(b.detail) || a.name.localeCompare(b.name) || a.bestBefore.localeCompare(b.bestBefore)),
    }))
    // Unknown place last, the rest alphabetical.
    .sort((a, b) => (a.place === NO_PLACE ? 1 : b.place === NO_PLACE ? -1 : a.place.localeCompare(b.place)));
}
