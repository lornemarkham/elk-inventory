# ELK Inventory: one inventory, many applications

Inventory is the single record of the household's physical things: tools, equipment, parts, fluids,
supplies, food, water, seeds. Other ELK apps **read and change that record**. None of them keeps its own copy.
This is the contract they build against. Status is as of 2026-11-10 (M743).

## The rule

1. **One database.** Supabase project `xjmhojlmkodrsvocoqlv`, tables `inventory_items`, `stock_lots`,
   `stock_movements`, `pantry_shopping_items` (M652), `purchase_drafts`. No app creates its own item, part,
   tool or stock table. If something is missing, Inventory adds it here.
2. **As the person, never as a service.** Every call carries the signed-in family member's own Supabase access
   token with the public (publishable) key. Row-level security plus `elk_is_family_member()` decides access.
   No app, Inventory included, holds a service-role key or DB password.
3. **Changes go through Inventory's paths.** Pantry-tracked stock changes only through the `pantry_*`
   functions, which keep history and undo. Untracked items change through count-guarded or
   `updated_at`-guarded updates, so a concurrent edit is never overwritten. Nothing is consumed because a
   job, recipe or plan was *opened*: only an explicit, confirmed person action changes stock.
4. **Stable ids.** `inventory_items.id` (text) is permanent. Other apps store that id, never a copied name
   or count. Names, places and quantities are always re-read.

## Shared item model (what exists today, no migration needed)

| Need | Where it lives |
|---|---|
| Stable id | `id` |
| Kind / category | `item_class` (tool, material = supplies/consumables, equipment, project-asset, installed-asset, surplus), `category`, `subcategory`, `domain`, `tags` |
| Place | `current_zone` (zones in `src/data/zones.ts`), `container_id` (`src/data/containers.ts`), `location_detail` (shelf/bin text) |
| Quantity, unit | `quantity` (whole units; for tracked food it is the sum of open lots, so never write it), `attributes.unit` |
| Condition | `lifecycle_state` (available, in-use, needs-repair, retired, consumed, lost …) |
| Product codes | `attributes.barcode`, `attributes.model`, `attributes.serialNumber`, `brand` |
| Dates | `attributes.purchasedOn`, `attributes.bestBefore` (untracked items); `stock_lots.best_before` / `purchased_on` (tracked food, per batch) |
| Specifications | `attributes.spec_<name>` (e.g. `spec_voltage: "18V"`) |
| Maintenance consumables | `item_class = material` + `attributes.usedFor` (e.g. "oil changes on the F-150") |
| Photo | `photo_path` |
| Movement history | `stock_movements` (tracked food only; tools and equipment have no history yet) |
| Household ownership | membership in `elk_family_members`; every row belongs to the one household |

Gaps that need SQL (owner-applied, see `docs/family-access.md`): movement history for untracked items,
per-person ownership inside the household, and a real units model. None of them blocks the apps below.

## Ways in

| Door | Who | Auth |
|---|---|---|
| Supabase PostgREST (tables + `pantry_*` RPCs) | web apps: Inventory, Wrench, Kitchen | the person's own Supabase session |
| MCP `https://elk-inventory.vercel.app/api/mcp` (`docs/chatgpt-mcp.md`) | ChatGPT ("Charlie"), and later ELL or any agent | OAuth 2.1 via Supabase's OAuth server, which issues the person's own token |
| `/api/extract` (family-only) | Kitchen recipe/photo capture | the person's Supabase token |

## Per application

### ELK Wrench: tools, equipment, parts, fluids, consumables
- **Reads** `inventory_items` (id, name, item_class, lifecycle_state, current_zone, location_detail, quantity,
  tags, notes, brand, category, subcategory). It treats retired, deprecated, consumed, lost, needs-repair,
  incorrect-part and ordered as *not usable for a job*.
- **Writes** shopping needs as `purchase_drafts` (status `pending`; a person approves them in Inventory).
  Consumption goes through `pantry_use` after an explicit confirm.
- **Session:** `/connect-wrench` hands over the access token only (about an hour; see `src/lib/connectWrench.ts`
  for why it never shares the refresh token). Long-lived target: Wrench becomes its own OAuth client of
  Supabase's OAuth server (the same switch ChatGPT needs), with its own revocable grant.
- Status: Wrench side BUILT and DEPLOYED (elk-wrench M739). Inventory side ships with M743. Not yet
  exercised with a real family session.

### ELK Kitchen / Recipes: ingredients, quantities, best-before, meal planning, shopping
- Contract in detail: `docs/kitchen-contract.md` (branch `inventory-release-m652`).
- Reads `inventory_items` (food-storage), `stock_lots`, `pantry_shopping_items`. Writes only through
  `pantry_use`, `pantry_receive`, `pantry_move`, `pantry_undo` and `pantry_shopping_add`, each with a request id.
- Status: Kitchen is BUILT. `pantry_move`, `pantry_shopping_add`, `pantry_shopping_items` and `p_reason` need
  M652's `supabase-pantry.sql`, which is **not applied** to production (verified 2026-11-10: PGRST202/205).
  Until then Kitchen reports "not switched on" for those features.

### ELK Prepared: food reserves, water, power, emergency equipment
- Prepared is part of Inventory itself (branch `prepared-m700`), not a separate store. It reads the same rows,
  using `attributes.prepKind` and `domain`. It needs `supabase-prepared.sql` (unapplied).

### ELK Garden: seeds, supplies, equipment, harvests
- Proposed: seeds and supplies are `inventory_items` with `domain = 'garden'` (`item_class` material or
  equipment, `attributes.bestBefore` for seed viability). A harvest is a `pantry_receive` into a food item.
  Garden reads through PostgREST or MCP. Nothing is built yet, and Garden must not start its own seed table.

### ELL: context about equipment and possessions
- Proposed: ELL uses the MCP read tools under the person's own OAuth grant (same authorization as Charlie).
  No bulk export, no copy. Nothing is built yet.

## Not allowed
- A second inventory table, cache or export that another app treats as truth. A JSON export is a backup, not
  an integration.
- Service-role or other privileged keys in any client, function or agent.
- Writing `stock_*` or `pantry_shopping_items` directly, or `inventory_items.quantity` for tracked food.
- Deleting items through any integration (there is no delete tool or path; use `lifecycle_state`).
