# Prepared — household preparedness (M700)

Route `/prepared` (nav: Prepared), `/prepared/plan`, `/prepared/offline`.

## Activation (owner)
1. Family access and Pantry SQL already applied (see docs/family-access.md).
2. Run `supabase-prepared.sql` (additive, re-runnable; 3 new tables, 1 trigger function; refuses if a same-named table isn't ELK's).
3. On /prepared, set the household, then tell it which Pantry products are food / water / pet food and what one unit is worth.

## How the numbers work (src/lib/preparedModel.ts, tests/prepared-model.test.ts)
- Food days = in-date kcal ÷ (people × kcal/person/day). Water days = in-date litres ÷ (people × L/person + pets × L/pet). Pet food = in-date pet-days ÷ pets.
- Past-best-before batches are shown, not counted. Batches expiring inside the planning window go on the replace list.
- Backup power days = Σ(Wh × qty) × 0.85 ÷ Σ(essential watts × hours/day × qty). No recharging counted. No figure if no source/load is entered.
- Classification lives in existing `inventory_items.attributes` (prepKind, kcalPerUnit, litresPerUnit, petDaysPerUnit): no schema change.
- Shopping: "Add to shopping list" uses the existing `pantry_shopping_add` (source `manual`, amounts in the note).
- Barcode: reuses src/lib/barcode.ts (ScanDetector, findByBarcode); scan = open equipment / point at the Pantry product / add equipment with that code.
- Offline: every plan view saves the last plan to localStorage; `/prepared/offline` (outside the sign-in gate) shows it; `public/prepared-sw.js` (network-first, production only) lets that page load with no connection. A first online visit with the worker installed is required.
