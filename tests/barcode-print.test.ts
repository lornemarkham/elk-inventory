// Barcode input (src/lib/barcode.ts) and the printable inventory model (src/lib/printModel.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ScanDetector, findByBarcode, looksLikeBarcode, normalizeBarcode, sameBarcode } from "../src/lib/barcode.ts";
import { buildPrintSections } from "../src/lib/printModel.ts";
import { ZONES } from "../src/data/zones.ts";
import type { StockLot } from "../src/lib/pantryModel.ts";
import type { InventoryItem } from "../src/types/inventory.ts";

const item = (o: Partial<InventoryItem> & { id: string; name: string }): InventoryItem => ({
  itemClass: "consumable", lifecycleState: "available", currentZone: "storage-room-pantry", recommendedZone: "storage-room-pantry",
  locationDetail: "", quantity: 1, tags: [], attributes: {}, ...o,
} as InventoryItem);

const lot = (o: Partial<StockLot> & { id: string; itemId: string }): StockLot => ({
  quantityReceived: 5, quantityRemaining: 5, location: "", bestBefore: null, purchasedOn: null,
  source: "purchase", createdAt: "2026-10-10T00:00:00Z", createdBy: null, ...o,
});

// ── Scanner input ──────────────────────────────────────────────────────────────

function typeIn(d: ScanDetector, keys: string[], start: number, gap: number): string | null {
  let out: string | null = null;
  keys.forEach((k, i) => { const r = d.feed(k, start + i * gap); if (r) out = r; });
  return out;
}

test("a scanner burst (digits ~10 ms apart, then Enter) is recognised", () => {
  const d = new ScanDetector();
  const keys = [..."0012345678905", "Enter"];
  assert.equal(typeIn(d, keys, 1000, 10), "0012345678905");
});

test("Bluetooth scanners are slower and may send Shift: still one scan", () => {
  const d = new ScanDetector();
  assert.equal(typeIn(d, ["Shift", ..."5000159484695", "Enter"], 0, 35), "5000159484695");
});

test("a person typing digits slowly is not a scan", () => {
  assert.equal(typeIn(new ScanDetector(), [..."12345678901", "Enter"], 0, 250), null);
});

test("short bursts and letters are not scans; two scans in a row both work", () => {
  const d = new ScanDetector();
  assert.equal(typeIn(d, [..."1234", "Enter"], 0, 10), null);
  assert.equal(typeIn(d, [..."12ab34567890", "Enter"], 1000, 10), null);
  assert.equal(typeIn(d, [..."4006381333931", "Enter"], 2000, 10), "4006381333931");
  assert.equal(typeIn(d, [..."0123456789012", "Enter"], 3000, 10), "0123456789012");
});

test("codes: normalising, what counts as a barcode, UPC-A = EAN-13 with a leading zero", () => {
  assert.equal(normalizeBarcode(" 4006-3813 33931\n"), "400638133393 1".replace(" ", ""));
  assert.ok(looksLikeBarcode("4006381333931"));
  assert.ok(looksLikeBarcode("0 12345 67890 5"));
  assert.ok(!looksLikeBarcode("tomatoes"));
  assert.ok(!looksLikeBarcode("12345"));
  assert.ok(!looksLikeBarcode("12345678 tomatoes"));
  assert.ok(sameBarcode("012345678905", "0012345678905"));
  assert.ok(!sameBarcode("012345678905", "012345678906"));
  assert.ok(!sameBarcode("", ""));
});

test("lookup finds the product by stored barcode, however the scanner formatted it", () => {
  const items = [
    item({ id: "a", name: "Diced Tomatoes", attributes: { barcode: "012345678905" } }),
    item({ id: "b", name: "Rice", attributes: { barcode: 5000159484695 } }),
    item({ id: "c", name: "No code" }),
  ];
  assert.deepEqual(findByBarcode(items, "0012345678905").map(i => i.id), ["a"]);
  assert.deepEqual(findByBarcode(items, "5000159484695").map(i => i.id), ["b"]);
  assert.deepEqual(findByBarcode(items, "999999999999"), []);
  assert.deepEqual(findByBarcode(items, ""), []);
});

// ── Printable inventory ────────────────────────────────────────────────────────

test("food prints one line per batch under its storage place, with quantity and best-before", () => {
  const tom = item({ id: "t", name: "Diced Tomatoes", domain: "food-storage", quantity: 9, attributes: { unit: "cans" } });
  const lots = [
    lot({ id: "1", itemId: "t", quantityRemaining: 6, location: "Basement shelf", bestBefore: "2028-03-01" }),
    lot({ id: "2", itemId: "t", quantityRemaining: 3, location: "Garage fridge", bestBefore: "2027-01-15" }),
    lot({ id: "3", itemId: "t", quantityRemaining: 0, location: "Basement shelf" }),
  ];
  const s = buildPrintSections([tom], lots, ZONES, "food");
  assert.deepEqual(s.map(x => x.place), ["Basement shelf", "Garage fridge"]);
  assert.deepEqual(s[0].rows, [{ name: "Diced Tomatoes", quantity: "6 cans", bestBefore: "2028-03-01", detail: "" }]);
  assert.equal(s[1].rows[0].quantity, "3 cans");
});

test("untracked food uses its own count and spot; used-up and place-less food are handled", () => {
  const rice = item({ id: "r", name: "Rice", domain: "food-storage", quantity: 2, locationDetail: "White Pantry Shelf", attributes: { unit: "bags" } });
  const gone = item({ id: "g", name: "Gone", domain: "food-storage", quantity: 0, locationDetail: "White Pantry Shelf" });
  const lost = item({ id: "l", name: "Mystery tin", domain: "food-storage", quantity: 1 });
  const s = buildPrintSections([lost, rice, gone], [], ZONES, "food");
  assert.deepEqual(s.map(x => x.place), ["White Pantry Shelf", "No place recorded"]);
  assert.deepEqual(s[0].rows.map(r => [r.name, r.quantity]), [["Rice", "2 bags"]]);
});

test("scope 'food' leaves out tools; scope 'all' groups them by zone with their spot", () => {
  const drill = item({ id: "d", name: "Cordless drill", currentZone: "mechanic-bay", locationDetail: "Red Toolbox", quantity: 1 });
  const tom = item({ id: "t", name: "Tomatoes", domain: "food-storage", quantity: 1, locationDetail: "Pantry" });
  assert.deepEqual(buildPrintSections([drill, tom], [], ZONES, "food").map(x => x.place), ["Pantry"]);
  const all = buildPrintSections([drill, tom], [], ZONES, "all");
  assert.deepEqual(all.map(x => x.place), ["Mechanic Bay", "Pantry"]);
  assert.deepEqual(all[0].rows[0], { name: "Cordless drill", quantity: "1", bestBefore: "", detail: "Red Toolbox" });
});
