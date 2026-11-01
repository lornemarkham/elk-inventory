// Storing a barcode on a product (db.setBarcode writes attributes.barcode with
// an ordinary row update) against the real Pantry SQL: the code must stick,
// and the pantry's own keys and the count must survive it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness.ts";

const ALICE = "00000000-0000-0000-0000-00000000000a";

test("a barcode saved on a pantry-tracked product sticks; tracking, warning level and count are untouched", async () => {
  const db = await supabaseLikeDb();
  for (const f of ["supabase-schema.sql", "supabase-family-access.sql", "supabase-pantry.sql"]) await runFile(db, f);
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${ALICE}', 'a@example.com');`);
  await addMember(db, ALICE, "Alice");
  const as = asUser(db);

  // Created by the app's own path: a new product through pantry_receive.
  await as(ALICE, "SELECT pantry_receive('rice', 4, 'Pantry', NULL, '2026-11-01', 'Rice', 'bags')");
  await as(ALICE, "SELECT pantry_set_low_stock('rice', 1)");

  // What db.setBarcode sends: attributes with the code added, nothing else.
  const [before] = await as<{ attributes: Record<string, unknown> }>(ALICE, "SELECT attributes FROM inventory_items WHERE id = 'rice'");
  const next = { ...before.attributes, barcode: "5000159484695" };
  await as(ALICE, "UPDATE inventory_items SET attributes = $1::jsonb WHERE id = 'rice'", [JSON.stringify(next)]);

  const [after] = await as<{ attributes: Record<string, unknown>; quantity: number }>(ALICE, "SELECT attributes, quantity FROM inventory_items WHERE id = 'rice'");
  assert.equal(after.attributes.barcode, "5000159484695");
  assert.equal(after.attributes.pantryTracked, true);
  assert.equal(after.attributes.lowStockAt, 1);
  assert.equal(after.attributes.unit, "bags");
  assert.equal(after.quantity, 4);
});
