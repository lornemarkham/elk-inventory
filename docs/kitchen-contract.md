# Inventory ⇄ Kitchen contract

Inventory owns stock (`inventory_items`, `stock_lots`, `stock_movements`) and the family shopping list (`pantry_shopping_items`). Kitchen owns recipes, cooking and meal history. Kitchen never writes Inventory's tables; it reads them and calls Inventory's functions, always with the **signed-in person's own token** (RLS applies; no service key).

Tested by `tests/kitchen-contract.test.ts`, which sends Kitchen's exact named arguments (elk-kitchen `b6e583f`) to the current SQL, starting from production's pre-v2 SQL (`b1e3f3f`).

## Access
Everything requires `elk_family_members` membership (`elk_is_family_member()`). Signed-out and non-members read nothing and every function refuses them. `anon` has no execute rights.

## Reads (direct, RLS)
| What | Query |
|---|---|
| Products | `inventory_items` where `domain = 'food-storage'` → `id,name,quantity,attributes` (`attributes.unit`, `lowStockAt`, `opened`) |
| Batches | `stock_lots` → `item_id,quantity_remaining,location,best_before,purchased_on,created_at` (open = `quantity_remaining > 0`) |
| Shopping | `pantry_shopping_items` where `done_at is null` → `name` |

`inventory_items.quantity` is the sum of open lots; do not recompute or write it.

## Writes (functions only; each returns a batch id usable with `pantry_undo`)
| Function | Notes |
|---|---|
| `pantry_use(p_item_id, p_quantity, p_lot_id, p_request_id, p_reason='used')` | whole units; oldest best-before first when `p_lot_id` is null; refuses over-use and changes nothing |
| `pantry_receive(p_item_id, p_quantity, p_location, p_best_before, p_purchased_on, p_new_name, p_unit, p_request_id)` | new product when `p_new_name` given |
| `pantry_move(p_lot_id, p_quantity, p_to_location, p_request_id)` | new batch at the new place keeps dates; product total unchanged |
| `pantry_undo(p_batch_id)` | reverses one action once; refuses a receive/move whose items were already used |
| `pantry_shopping_add(p_names text[], p_note, p_source)` | `p_source` ∈ `manual`,`recipe`,`low-stock`; de-duplicates against the open list; links to a product by name; returns number added |

`p_request_id` makes a retry safe (same id ⇒ counted once).

## Degrade rules (Kitchen already does these)
Missing function/table (PGRST202/PGRST205) ⇒ Kitchen says the feature isn't switched on and changes nothing. Kitchen must not invent quantities: unknown product ⇒ "Pantry has no record of it".

## Not allowed
Kitchen writing `stock_*` / `inventory_items` / `pantry_shopping_items` directly (grants are revoked and the test asserts it); service-role access from Kitchen; Kitchen storing its own stock counts.
