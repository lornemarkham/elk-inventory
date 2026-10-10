// Pantry model (src/lib/pantryModel.ts) — pure ordering/summary logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countLabel, daysUntil, fifoOrder, findProductByName, formatDay, summarize, type StockLot } from "../src/lib/pantryModel.ts";
import type { InventoryItem } from "../src/types/inventory.ts";

const item = (over: Partial<InventoryItem> = {}): InventoryItem => ({
  id: "tom", name: "Diced Tomatoes", itemClass: "material", lifecycleState: "available",
  currentZone: "storage-room-pantry", recommendedZone: "storage-room-pantry", locationDetail: "White shelf",
  collectionId: null, containerId: null, project: null, tags: [], quantity: 10, photoPath: "", notes: "",
  domain: "food-storage", attributes: { unit: "cans" }, ...over,
});

let n = 0;
const lot = (over: Partial<StockLot>): StockLot => ({
  id: `lot-${++n}`, itemId: "tom", quantityReceived: 12, quantityRemaining: 12, location: "Shelf",
  bestBefore: null, purchasedOn: "2026-10-01", source: "purchase", createdAt: `2026-10-01T00:00:0${n}Z`, createdBy: null, ...over,
});

test("FIFO: already-on-hand first, then by purchase date, then by entry time", () => {
  const a = lot({ purchasedOn: "2026-10-05" });
  const b = lot({ purchasedOn: null, source: "already-on-hand" });
  const c = lot({ purchasedOn: "2026-09-01" });
  const d = lot({ purchasedOn: "2026-10-05" });   // same day as a, recorded later
  assert.deepEqual(fifoOrder([a, d, c, b]).map(l => l.id), [b.id, c.id, a.id, d.id]);
});

test("untracked item: count comes from the item, nothing to use first", () => {
  const s = summarize(item({ quantity: 10 }), []);
  assert.equal(s.untracked, true);
  assert.equal(s.onHand, 10);
  assert.equal(s.useFirst, null);
  assert.equal(s.unit, "cans");
});

test("tracked item: lots are the truth; empty lots hidden; oldest is 'use first'", () => {
  const old = lot({ purchasedOn: "2026-09-01", quantityRemaining: 2 });
  const empty = lot({ purchasedOn: "2026-08-01", quantityRemaining: 0 });
  const fresh = lot({ purchasedOn: "2026-10-10", quantityRemaining: 12 });
  const other = lot({ itemId: "rice", quantityRemaining: 5 });
  const s = summarize(item({ quantity: 999 }), [fresh, empty, old, other]);
  assert.equal(s.untracked, false);
  assert.equal(s.onHand, 14);
  assert.deepEqual(s.openLots.map(l => l.id), [old.id, fresh.id]);
  assert.equal(s.useFirst?.id, old.id);
});

test("running low at or below the chosen level; no level = never low", () => {
  const lots = [lot({ quantityRemaining: 3 })];
  assert.equal(summarize(item({ attributes: { unit: "cans", lowStockAt: 3 } }), lots).isLow, true);
  assert.equal(summarize(item({ attributes: { unit: "cans", lowStockAt: 2 } }), lots).isLow, false);
  assert.equal(summarize(item({ attributes: { unit: "cans" } }), lots).isLow, false);
  assert.equal(summarize(item({ attributes: { unit: "cans", lowStockAt: 0 } }), [lot({ quantityRemaining: 0 })]).isLow, true);
});

test("warns when a newer batch expires before the one marked 'use first'", () => {
  const old = lot({ purchasedOn: "2026-09-01", bestBefore: "2028-01-01" });
  const newer = lot({ purchasedOn: "2026-10-01", bestBefore: "2027-02-01" });
  assert.equal(summarize(item(), [old, newer]).newerExpiresSooner?.id, newer.id);
  // Unknown date on the oldest batch → no claim either way.
  const undated = lot({ purchasedOn: null, source: "already-on-hand" });
  assert.equal(summarize(item(), [undated, newer]).newerExpiresSooner, null);
  // Normal case: newer expires later → no warning.
  assert.equal(summarize(item(), [newer, lot({ purchasedOn: "2026-10-05", bestBefore: "2029-01-01" })]).newerExpiresSooner, null);
});

test("product matching ignores case and extra spaces, and only matches pantry items", () => {
  const items = [item(), item({ id: "drill", name: "Drill", domain: "workshop" })];
  assert.equal(findProductByName(items, "  diced   TOMATOES ")?.id, "tom");
  assert.equal(findProductByName(items, "drill"), null);
  assert.equal(findProductByName(items, ""), null);
});

test("labels and dates", () => {
  assert.equal(countLabel(1, "cans"), "1 can");
  assert.equal(countLabel(2, "cans"), "2 cans");
  assert.equal(countLabel(1, "kg"), "1 kg");
  assert.equal(countLabel(1, "boxes"), "1 box");
  assert.equal(countLabel(1, "loaves"), "1 loaf");
  assert.equal(countLabel(1, "glass"), "1 glass");
  assert.equal(formatDay("2027-03-12"), "12 Mar 2027");
  assert.equal(daysUntil("2026-10-12", "2026-10-10"), 2);
  assert.equal(daysUntil("2026-10-01", "2026-10-10"), -9);
});
