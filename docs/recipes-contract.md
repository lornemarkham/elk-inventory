# Inventory ⇄ Recipes (Kitchen) API contract

Status: 2026-11-12 (M752). Verified by `tests/recipes-contract.test.ts`, which sends the exact named arguments
Recipes sends (elk-kitchen `230ea74`, `src/lib/pantry.ts`, `pantryStock.ts`) to this branch's `supabase-pantry.sql`.
There is no Recipes-specific API and no second database: Recipes uses the doors in `docs/integration-contract.md`.

## Access
Supabase project `xjmhojlmkodrsvocoqlv`. Every call carries the signed-in person's own access token with the
publishable key. Access needs a row in `elk_family_members` (`elk_is_family_member()`): non-members and signed-out
callers read zero rows and every `pantry_*` function refuses them (production answers `42501` to anon).
Household = the one family. No service-role key anywhere.

## Reads (PostgREST, RLS applies)
| What | Query | Fields |
|---|---|---|
| Food products | `inventory_items` where `domain = 'food-storage'` | `id`, `name`, `quantity` (= sum of open batches), `attributes.unit`, `attributes.lowStockAt`, `attributes.opened` |
| Batches | `stock_lots` where `quantity_remaining > 0` | `item_id`, `quantity_remaining`, `location`, `best_before` (nullable), `purchased_on`, `created_at` |
| History | `stock_movements` | `kind` (`used`, `received`, `undo`…), `quantity_delta`, `batch_id`, `created_by`, `created_at` |

Units are the product's `attributes.unit` (free text, whole numbers only; no unit conversion). Best-before is per
batch, null when unknown. Store the product `id`, never a copy of the name or count; re-read before showing.
MCP (`inventory_search`, `inventory_get_expiring`) offers the same data to agents under OAuth.

## Writes (functions only; direct writes to `stock_*` are denied)
| Function | Rules |
|---|---|
| `pantry_use(p_item_id, p_quantity, p_lot_id, p_request_id)` | whole units ≥ 1; takes the oldest-purchased batches first unless `p_lot_id` names one; row-locked; **refuses with `Only N left…` and changes nothing** if short, so stock never goes below zero; returns a batch id |
| `pantry_receive(p_item_id, p_quantity, p_location, p_best_before, p_purchased_on, p_new_name, p_unit, p_request_id)` | adds a batch; `p_new_name` creates a product |
| `pantry_undo(p_batch_id)` | reverses one `used`/`received` batch exactly once (`That was already undone.`) |

**No duplicate deductions:** generate one UUID per confirmed deduction and send it as `p_request_id`. A retry with the same id
returns the same batch id and deducts nothing more. Keep that id: it is also the `p_batch_id` for Undo.
**Only a confirmed person action deducts.** Opening or planning a recipe changes nothing.
Every movement records `created_by` (the person) in `stock_movements`.

## Rules Recipes must follow
- Deduct per ingredient only after the person confirms the matched product and amount; never guess a product from a name.
- On a refusal, show the message, change nothing, re-read stock.
- Do not write `inventory_items.quantity`: RLS does not block it (Inventory's editor needs item updates), but the lots are
  the truth and the next `pantry_*` call overwrites the field with the lot sum (tested).
- Missing function/table (`PGRST202`/`PGRST205`) ⇒ say the feature isn't switched on; change nothing.

## Production state (probed 2026-11-12, unauthenticated, read-only)
`pantry_use`, `pantry_receive`, `pantry_undo` exist and refuse anon (`42501`). `pantry_move`, `pantry_shopping_add`
return `PGRST202`: they need M652's `supabase-pantry.sql` (owner-applied, branch `inventory-release-m652`, which also
makes `pantry_use` oldest-best-before-first and adds `p_reason`). Recipes degrades as designed until then.
A live signed-in deduct/undo has **not** been run (no family session available to the agent).
