// Starter items are seeded only into a brand-new, empty database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedPlan } from "../src/lib/seed.ts";
import { seedInventory } from "../src/data/inventory.ts";

test("empty database gets the starter items", () => {
  assert.equal(seedPlan([], seedInventory).length, seedInventory.length);
  assert.ok(seedInventory.length > 50);
});

test("a deleted starter item stays deleted on every later load", () => {
  const afterDelete = seedInventory.filter(i => i.id !== seedInventory[0].id);
  assert.deepEqual(seedPlan(afterDelete, seedInventory), []);
});

test("starter items added to the code later are not pushed into an existing database", () => {
  assert.deepEqual(seedPlan([seedInventory[0]], seedInventory), []);
});
