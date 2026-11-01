// ── Starter-item seeding ───────────────────────────────────────────────────────
// The built-in starter list is only for a brand-new, empty database. Once the
// table has rows, the database is the truth: deleting a starter item has to
// stick, and starter items added to the code later must not appear unasked.

import type { InventoryItem } from "../types/inventory";

/** Which starter items to insert, given what the database returned. */
export function seedPlan(fetched: InventoryItem[], seed: InventoryItem[]): InventoryItem[] {
  return fetched.length === 0 ? seed : [];
}
