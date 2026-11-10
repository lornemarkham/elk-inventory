// Prepared model (src/lib/preparedModel.ts) — food/water/pet duration, expiry,
// backup-power runtime, shortfall list, plan cache. Every expected number is
// worked out by hand in the comment next to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allCover, buildPlan, cover, DEFAULT_HOUSEHOLD, parseCachedPlan, powerEstimate, prepOf, replenishment,
  stockLines, unclassifiedFood, expiringEquipment, whFromAh, type Equipment, type Household,
} from "../src/lib/preparedModel.ts";
import type { StockLot } from "../src/lib/pantryModel.ts";
import type { InventoryItem } from "../src/types/inventory.ts";

const TODAY = "2026-11-10";
// 2 people, 1 pet, 10 days; 2000 kcal/person/day; 3 L/person/day; 1 L/pet/day.
const H: Household = { people: 2, pets: 1, days: 10, kcalPerPersonDay: 2000, waterLPerPersonDay: 3, waterLPerPetDay: 1 };

const item = (id: string, attributes: InventoryItem["attributes"], over: Partial<InventoryItem> = {}): InventoryItem => ({
  id, name: id, itemClass: "material", lifecycleState: "available", currentZone: "storage-room-pantry",
  recommendedZone: "storage-room-pantry", locationDetail: "", collectionId: null, containerId: null, project: null,
  tags: [], quantity: 0, photoPath: "", notes: "", domain: "food-storage", attributes, ...over,
});
let n = 0;
const lot = (itemId: string, qty: number, bestBefore: string | null = null): StockLot => ({
  id: `lot-${++n}`, itemId, quantityReceived: qty, quantityRemaining: qty, location: "Shelf", bestBefore,
  purchasedOn: "2026-10-01", source: "purchase", createdAt: `2026-10-01T00:00:${String(n).padStart(2, "0")}Z`, createdBy: null,
});
const gear = (over: Partial<Equipment>): Equipment => ({
  id: `e${++n}`, name: "Thing", category: "other", quantity: 1, capacityWh: null, loadWatts: null, hoursPerDay: null,
  essential: false, bestBefore: null, barcode: "", location: "", notes: "", ...over,
});

const rice = item("Rice", { prepKind: "food", kcalPerUnit: 3600 });
const beans = item("Beans", { prepKind: "food", kcalPerUnit: 400 });
const water = item("Water jug", { prepKind: "water", litresPerUnit: 4 });
const kibble = item("Kibble", { prepKind: "pet-food", petDaysPerUnit: 14 });
const items = [rice, beans, water, kibble];

test("prepOf: only classified items with a positive per-unit value count", () => {
  assert.deepEqual(prepOf(rice), { kind: "food", perUnit: 3600 });
  assert.equal(prepOf(item("x", { prepKind: "food" })), null);                       // no kcal given
  assert.equal(prepOf(item("x", { prepKind: "food", kcalPerUnit: 0 })), null);
  assert.equal(prepOf(item("x", { prepKind: "soup", kcalPerUnit: 5 })), null);
  assert.equal(prepOf(item("x", { prepKind: "water", litresPerUnit: "4" }))?.perUnit, 4); // numeric string is tolerated
});

test("food days: 10 bags rice = 36,000 kcal ÷ 4,000 kcal/day = 9.0 days; short 4,000 kcal = 1.0 day of 10", () => {
  const lines = stockLines(items, [lot("Rice", 10)], H, TODAY);
  const c = cover("food", H, lines);
  assert.equal(c.perDay, 4000);
  assert.equal(c.required, 40000);
  assert.equal(c.have, 36000);
  assert.equal(c.days, 9);
  assert.equal(c.meetsTarget, false);
  assert.equal(c.shortfall, 4000);
  assert.equal(c.shortfallDays, 1);
});

test("food days add across products and stay exact: + 20 cans beans (8,000) = 44,000 → 11.0 days, meets 10", () => {
  const c = cover("food", H, stockLines(items, [lot("Rice", 10), lot("Beans", 20)], H, TODAY));
  assert.equal(c.days, 11);
  assert.equal(c.meetsTarget, true);
  assert.equal(c.shortfall, 0);
});

test("water: 2 people × 3 L + 1 pet × 1 L = 7 L/day; 10 jugs × 4 L = 40 L → 5.7 days (rounded down); short 30 L", () => {
  const c = cover("water", H, stockLines(items, [lot("Water jug", 10)], H, TODAY));
  assert.equal(c.perDay, 7);
  assert.equal(c.days, 5.7);
  assert.equal(c.required, 70);
  assert.equal(c.shortfall, 30);
  assert.equal(c.shortfallDays, 4.2);   // 30 ÷ 7 = 4.28… rounds down, never up
});

test("pet food: 1 bag = 14 pet-days for 1 pet = 14 days; two pets halve it; no pets = does not apply", () => {
  const ls = [lot("Kibble", 1)];
  assert.equal(cover("pet-food", H, stockLines(items, ls, H, TODAY)).days, 14);
  const two = { ...H, pets: 2 };
  assert.equal(cover("pet-food", two, stockLines(items, ls, two, TODAY)).days, 7);
  const none = { ...H, pets: 0 };
  const c = cover("pet-food", none, stockLines(items, ls, none, TODAY));
  assert.equal(c.applies, false);
  assert.equal(c.days, null);
  assert.equal(c.meetsTarget, true);
});

test("pets also drink: water need rises with pets", () => {
  const noPets = { ...H, pets: 0 };
  assert.equal(cover("water", noPets, []).perDay, 6);
  assert.equal(cover("water", H, []).perDay, 7);
});

test("past-best-before batches are shown but not counted as cover", () => {
  const lines = stockLines(items, [lot("Rice", 4, "2026-11-01"), lot("Rice", 5, "2027-06-01")], H, TODAY);
  const c = cover("food", H, lines);
  assert.equal(c.have, 18000);            // only the 5 in-date bags
  assert.equal(c.expired, 14400);         // 4 bags set aside
  assert.equal(c.days, 4.5);              // 18,000 ÷ 4,000
  assert.equal(lines[0].expiredUnits, 4);
  assert.equal(lines[0].nextBestBefore, "2027-06-01");
});

test("batch expiring inside the planning window is flagged for replacement; one past the window is not", () => {
  const lines = stockLines(items, [lot("Rice", 3, "2026-11-15"), lot("Rice", 5, "2027-06-01")], H, TODAY);
  assert.equal(lines[0].usableUnits, 8);
  assert.equal(lines[0].expiringUnits, 3);   // 5 days away ≤ 10-day window
  const list = replenishment(H, allCover(H, lines), [], TODAY).filter(l => l.why === "replace");
  assert.deepEqual(list.map(l => l.name), ["Replace: Rice"]);
  assert.match(list[0].note, /3 expire/);
});

test("untracked product (no batches) uses the item count and item-level date", () => {
  const plain = item("Oats", { prepKind: "food", kcalPerUnit: 1500, expiryDate: "2027-01-01" }, { quantity: 8 });
  const c = cover("food", H, stockLines([plain], [], H, TODAY));
  assert.equal(c.have, 12000);
  assert.equal(c.days, 3);
  const old = item("Oats", { prepKind: "food", kcalPerUnit: 1500, expiryDate: "2026-01-01" }, { quantity: 8 });
  const c2 = cover("food", H, stockLines([old], [], H, TODAY));
  assert.equal(c2.have, 0);
  assert.equal(c2.expired, 12000);
});

test("non-pantry and unclassified items are ignored; unclassifiedFood lists the ones to set up", () => {
  const tool = item("Hammer", { prepKind: "food", kcalPerUnit: 1 }, { domain: "garage" as never });
  const plain = item("Jam", { unit: "jars" }, { quantity: 3 });
  assert.equal(stockLines([tool, plain], [], H, TODAY).length, 0);
  assert.deepEqual(unclassifiedFood([tool, plain, rice]).map(i => i.id), ["Jam"]);
});

test("zero people and zero pets: nothing is needed, nothing divides by zero", () => {
  const nobody: Household = { ...H, people: 0, pets: 0 };
  for (const c of allCover(nobody, stockLines(items, [lot("Rice", 1)], nobody, TODAY))) {
    assert.equal(c.applies, false);
    assert.equal(c.days, null);
    assert.equal(c.shortfall, 0);
  }
});

test("backup power: 1,000 Wh × 0.85 = 850 Wh usable; fridge 100 W × 8 h + phones 10 W × 24 h = 1,040 Wh/day → 0.8 days", () => {
  const p = powerEstimate([
    gear({ name: "Power station", category: "power", capacityWh: 1000 }),
    gear({ name: "Fridge", essential: true, loadWatts: 100, hoursPerDay: 8 }),
    gear({ name: "Phone chargers", essential: true, loadWatts: 10 }),          // hours default to 24
    gear({ name: "Space heater", loadWatts: 1500 }),                           // not essential: ignored
  ]);
  assert.equal(p.usableWh, 850);
  assert.equal(p.dailyWh, 1040);
  assert.equal(p.days, 0.8);
  assert.equal(p.perLoad.find(l => l.equipment.name === "Fridge")?.hoursAlone, 8.5);   // 850 ÷ 100
  assert.equal(p.note, null);
});

test("backup power: quantity multiplies both capacity and load; several sources add", () => {
  const p = powerEstimate([
    gear({ name: "Bank", category: "power", capacityWh: 100, quantity: 3 }),
    gear({ name: "Station", category: "power", capacityWh: 500 }),
    gear({ name: "Lantern", essential: true, loadWatts: 5, hoursPerDay: 10, quantity: 2 }),   // 100 Wh/day
  ]);
  assert.equal(p.usableWh, 680);       // (300 + 500) × 0.85
  assert.equal(p.dailyWh, 100);
  assert.equal(p.days, 6.8);
});

test("backup power: says why there is no figure instead of inventing one", () => {
  assert.match(powerEstimate([]).note ?? "", /No backup power/);
  const p = powerEstimate([gear({ category: "power", capacityWh: 300 })]);
  assert.equal(p.days, null);
  assert.match(p.note ?? "", /essential/);
  assert.equal(whFromAh(100, 12.8), 1280);
});

test("equipment best-before: soonest first, includes already-expired", () => {
  const e = [gear({ name: "AA batteries", bestBefore: "2026-12-01" }), gear({ name: "Tablets", bestBefore: "2026-11-01" }), gear({ name: "Radio", bestBefore: "2030-01-01" }), gear({ name: "Torch" })];
  assert.deepEqual(expiringEquipment(e, TODAY, 60).map(x => [x.equipment.name, x.days]), [["Tablets", -9], ["AA batteries", 21]]);
});

test("shopping list: shortfalls, replacements and missing essentials, with stable names", () => {
  const lines = stockLines(items, [lot("Rice", 10), lot("Water jug", 10)], H, TODAY);
  const covers = allCover(H, lines);
  const eq = [gear({ name: "Headlamp", category: "light" }), gear({ name: "AA batteries", category: "power", capacityWh: 10, bestBefore: "2026-11-05" })];
  const list = replenishment(H, covers, eq, TODAY);
  const by = (name: string) => list.find(l => l.name === name);
  assert.match(by("Food for the emergency supply")!.note, /4,000 kcal more \(1 days\)/);
  assert.match(by("Water for the emergency supply")!.note, /30 L more/);
  assert.match(by("Pet food for the emergency supply")!.note, /10 pet-days more/);   // no kibble at all
  assert.match(by("Replace: AA batteries")!.note, /past its date/);
  assert.ok(by("First-aid kit"));
  assert.ok(by("Battery or crank radio"));
  assert.equal(by("Flashlights or lanterns"), undefined);        // headlamp is listed
  assert.equal(by("Backup power (battery bank / power station)"), undefined);
  assert.equal(new Set(list.map(l => l.name.toLowerCase())).size, list.length);
});

test("nothing short: an on-target household with a full kit gets an empty list", () => {
  const h: Household = { ...H, pets: 0 };
  const lines = stockLines(items, [lot("Rice", 12), lot("Water jug", 20)], h, TODAY);
  const kit = (["power", "light", "comms", "medical", "water"] as const).map(c => gear({ category: c }));
  assert.deepEqual(replenishment(h, allCover(h, lines), kit, TODAY), []);
});

test("plan snapshot round-trips through the offline cache and rejects junk", () => {
  const lines = stockLines(items, [lot("Rice", 10)], H, TODAY);
  const plan = buildPlan(H, allCover(H, lines), powerEstimate([]), [gear({ name: "Torch" })], { meetingPlace: "The oak" }, TODAY);
  assert.equal(plan.covers.find(c => c.kind === "food")?.days, 9);
  const back = parseCachedPlan(JSON.stringify({ savedAt: "2026-11-10T10:00:00Z", plan }));
  assert.equal(back?.plan.info.meetingPlace, "The oak");
  assert.equal(parseCachedPlan("not json"), null);
  assert.equal(parseCachedPlan(null), null);
  assert.equal(parseCachedPlan(JSON.stringify({ savedAt: "x", plan: {} })), null);
  assert.deepEqual(DEFAULT_HOUSEHOLD.days, 14);
});
