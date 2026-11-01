# Home pilot — activation readiness and plan

Prepared 2026-11-01 against branch `pantry-family-kitchen` (8bf1753). Nothing
here has been run against production. Every database step below is for the
owner to run in the Supabase SQL Editor; there are no database credentials in
this repo or on the dev machine.

## 1. Where the code is

| What | Commit | Branch (pushed) | In production? |
|---|---|---|---|
| Inventory + family access + Pantry v1 | 823621f | `main` | Yes, elk-inventory.vercel.app |
| `/api/extract` recipe mode (for ELK Kitchen) | b1e3f3f | `kitchen-recipe-extract` | No |
| Pantry v2: throw out, move, use-soon, shopping list | 8bf1753 | `pantry-family-kitchen` | No |
| ELK Kitchen: keep tag suggestions | 4a64700 | albatross `kitchen-shopping-list` | No |
| ELK Kitchen: missing ingredients → shopping list | d60a5a7 | albatross `kitchen-shopping-list` | No |

`8bf1753` sits directly on `b1e3f3f` → `823621f`, so merging
`pantry-family-kitchen` into `main` is a fast-forward that brings both.
Vercel's production branch for `elk-inventory` and `elk-kitchen` is `main`;
for the `albatross` site it is `guest-experiences-booking`. Pushing any other
branch only makes a preview.

## 2. Is production already migrated? (read-only)

There is no migration-history table; the SQL files are run by hand, so the
database catalogs are the only record. Run
[`activation-check.sql`](activation-check.sql) in the SQL Editor. It is a
single `SELECT` over system catalogs plus row counts, and changes nothing.

| What it shows | Meaning |
|---|---|
| `elk_family_members` missing, `policies not member-gated` ≥ 1 | Family access **not** applied. Any signed-in account in the shared project can read and change ELK. |
| `elk_is_family_member()` present, `policies not member-gated` = 0, `stock_lots` missing | Family access applied, Pantry not. |
| `stock_lots` present, `pantry_move` / `pantry_shopping_add` missing | Pantry v1 (f5b7b15) applied; v2 not. Re-running `supabase-pantry.sql` upgrades it. |
| All present, `pantry_use(text,integer,uuid,uuid)` missing | Fully current (v2). |
| `rows in elk_family_members` = 0 with family access applied | Everyone, including the owner, is locked out until step 3 of the runbook. |

The check was exercised against the test database (PGlite) in all three states
(before, after family access, after Pantry) and reads correctly in each.

## 3. Activation, in order

The production app (823621f) already contains the family-access screens and
Pantry v1, and it keeps working with the newest SQL (`pantry_use` gained an
optional `p_reason` that defaults to `'used'`). So **the SQL can be run without
deploying anything**. Step 0 of `docs/family-access.md` is already satisfied by
what is live.

1. **Back up first.** See section 5. At minimum: in-app **Export**, and check
   Dashboard → Database → Backups to see what your plan actually keeps.
2. Run `activation-check.sql`; keep the output.
3. Follow `docs/family-access.md` steps 1–6 exactly (family access → add
   yourself → Pantry → check → outsider test → family).
4. Run `activation-check.sql` again. Expect: all tables present with
   `marker=true`, `policies not member-gated` = 0, your row count unchanged.
5. Pantry v2 screens (shopping list, move, throw out) appear only after
   `pantry-family-kitchen` is merged to `main`. That merge **is** a production
   deploy and is the owner's call. ELK Kitchen's photo reader also needs it
   (b1e3f3f), because elk-kitchen forwards `/api/extract` to elk-inventory's
   production URL.

All of each SQL file runs as one implicit transaction in the SQL Editor; if it
stops with an error, nothing from that file was applied.

## 4. Rollback (owner, SQL Editor; exercised in the PGlite test database, not in production)

Neither migration rewrites or deletes data, so rollback never needs a restore.

- **Locked out after family access** (the usual "rollback" case): don't
  reopen the tables; add yourself (runbook step 3). Data is untouched.
- **Turn Pantry off without losing history.** Run these 2 statements:

  ```sql
  DROP TRIGGER IF EXISTS pantry_guard_item ON public.inventory_items;
  REVOKE EXECUTE ON FUNCTION public.pantry_receive(TEXT, INTEGER, TEXT, DATE, DATE, TEXT, TEXT, UUID),
    public.pantry_use(TEXT, INTEGER, UUID, UUID, TEXT), public.pantry_undo(UUID),
    public.pantry_set_low_stock(TEXT, INTEGER), public.pantry_move(UUID, INTEGER, TEXT, UUID),
    public.pantry_shopping_add(TEXT[], TEXT, TEXT) FROM authenticated;
  ```

  The trigger is Pantry's only effect on an existing table. Dropping it means
  other screens can again overwrite counts. The `REVOKE` stops all Pantry writes.
  The lots, history and shopping list stay readable. Re-running
  `supabase-pantry.sql` turns Pantry back on.
- **Known lasting effect:** `stock_lots` / `stock_movements` reference
  `inventory_items` with `ON DELETE RESTRICT`, so a product with Pantry history
  can't be deleted from the app. This is by design; it stays true after
  rollback.

## 5. Data protection

### What exists today

| Data | In-app Export | Notes |
|---|---|---|
| `inventory_items` | Yes (JSON) | Exports the in-memory list, which includes seed items just merged in |
| `stock_lots` (batches, best-before, location) | **No** | |
| `stock_movements` (history) | **No** | The app only ever reads the latest 500 |
| `pantry_shopping_items` | **No** | |
| `purchase_drafts` | **No** | |
| `elk_family_members` | **No** | Only the owner can change it, from SQL |
| Supabase backups | Unknown | Depends on the plan. Check Dashboard → Database → Backups. The project is shared with another app, so any restore is project-wide. |

There is no restore path in the app. "Reset" was removed in 22ad6be.

### Seed auto-merge (fix before the pilot)

`src/App.tsx` (load effect) re-inserts every seed item from
`src/data/inventory.ts` (95 items) whose id isn't in the database, **on every
load, for every family member**. Consequences:

- Deleting a seed item doesn't stick; it comes back on the next load.
- Edits to an existing seed item in `inventory.ts` never reach the database,
  but new seed ids do, silently.
- Export taken right after a load includes those resurrected items.

The fix is to stop the auto-merge. Seed only when the table is truly empty, or
remove seeding entirely now that production has data. This is a small change
in `App.tsx`.

### Plan: complete backup and restore

1. **Owner backup now (before any SQL).** Take an in-app Export, and also take
   a database dump with the project's connection string. These commands only
   read the database:

   ```sh
   pg_dump "$SUPABASE_DB_URL" --schema-only --schema=public > elk-schema-$(date +%F).sql
   pg_dump "$SUPABASE_DB_URL" --data-only \
     -t public.inventory_items -t public.purchase_drafts -t public.elk_family_members \
     -t public.stock_lots -t public.stock_movements -t public.pantry_shopping_items \
     -t public.inventory_feedback > elk-data-$(date +%F).sql
   ```

   Tables that don't exist yet are skipped with a warning. Store the files
   offline (USB drive) as well as in the cloud.
2. **App: "Export everything"** (pilot item P2 below). Produce one JSON file
   with a version number and export date, containing every ELK table. Page
   through the movements so the export isn't capped at 500 rows. Also produce
   CSV per table so it opens in a spreadsheet.
3. **Restore stays owner-only, through SQL.** Lots and movements are
   deliberately unwritable from the API. A restore is a reviewed SQL script
   (`INSERT … ON CONFLICT DO NOTHING` per table, in dependency order: items →
   lots → movements → shopping). It is run in the SQL Editor and tested first
   against the PGlite test database with a real export.
4. **Restore drill** once before the pilot: export → restore into the test
   database → compare row counts with `activation-check.sql`.

## 6. Home pilot: smallest working release

What already exists in 8bf1753 against what the pilot needs:

| Need | Status | Where |
|---|---|---|
| Pantry inventory | Done | `/pantry`, `PantryPage.tsx` |
| Quantities | Done | Lots; product total kept in step, same transaction |
| Storage locations | Done | Per batch; **Move** (v2) |
| Best-before dates | Done | Per batch; use-soon list (v2) |
| Stock in | Done | `pantry_receive`; retry-safe; undo |
| Stock out | Done | `pantry_use`, oldest first; **Throw out** (v2); undo |
| Shopping list | Done (v2, not deployed) | `pantry_shopping_items`; ELK Kitchen adds to it |
| Printable inventory | **Missing** | No print view or print CSS exists |
| Barcode input | **Missing** | No barcode field, scanner or camera reading |

Smallest additions, each a separate small branch with tests, with no new
database and no new app:

- **P1. Stop seed auto-merge.** `App.tsx`. Prerequisite for trusting counts.
- **P2. Export everything** (section 5.2). `pantryDb.ts` + the existing Export
  button.
- **P3. Printable inventory.** A `/pantry/print` view with an `@media print`
  stylesheet. It lists products by location: name, unit, each batch's count
  and best-before. It adds blank "in/out" columns for pencil tallies, so the
  paper copy works as the analog backup, plus a printed open shopping list.
  It needs no new data.
- **P4. Barcode input, keyboard first.** USB/Bluetooth scanners type the code
  plus Enter, so the Pantry search box accepts a scan. Store the code in
  `inventory_items.attributes.barcode` (existing JSONB column, no schema
  change). A known code opens the product with Add/Use; an unknown one offers
  "Add new product" with the code filled in. Phone-camera scanning is a later
  step: the browser `BarcodeDetector` API isn't available in iOS Safari.

Order: activation (section 3) → P1 → P2 → restore drill → P3 → P4 → family
starts using it.

## 7. Documentation corrections

The docs predate Supabase. Keep local-first, offline, paper and barcode as
**goals**; none of them exists in code today. Corrections, by priority:

- `docs/roadmap/current-roadmap.md`
  - L4 "Milestone 2 (localStorage + CRUD)" → "Supabase-backed (Postgres + Auth + family-only access), Vercel-hosted; Purchase Intake, AI Capture, Pantry."
  - L215–216 "Local-first — no cloud dependency" / "No auth — single user" → "Cloud-backed (Supabase); local-first/offline is a goal, not current" / "Family-only access, enforced in the database."
  - L118–135 SQLite/Electron milestone → mark superseded; keep "offline mode that syncs to Supabase" as a future goal.
  - L160–166 Pantry "long-term" → Pantry v1/v2 shipped; calories and days-of-food are still open.
  - L176, L181 OCR/LLM "future" → shipped as `/api/extract`.
- `docs/README.md`
  - L139–140: same two fixes as the roadmap.
  - L79: ADR-0001 → "Superseded".
  - L80–81: ADR-0002/0003 (Electron, SQLite) → "Withdrawn — Supabase chosen".
  - L111 Pantry "Not yet started" → "Active".
  - Add `family-access.md` and `home-pilot/` to the index.
- `docs/decisions/0001-localstorage-before-sqlite.md`: add a status header,
  "Superseded: data lives in Supabase Postgres (`src/lib/db.ts`) with
  family-only access (`supabase-family-access.sql`). SQLite/Electron was not
  pursued." Leave the history as written.
- `docs/purchase-intake-v1-spec.md` L268 "no custom backend" → "browser talks
  to Supabase directly; one Vercel function, `/api/extract`, does AI
  extraction for family members."
- `docs/vision/future-market-and-tiers.md` L107–110 ("localStorage … no
  account … ELK today") and `docs/vision/life-operating-system.md` L120, L152
  → describe Supabase and family sign-in as today. A no-account local tier is
  a future idea.
- `docs/architecture/information-architecture-v2.md` L110, L1038 and
  `docs/concepts/ai-decision-support.md` L97 → replace localStorage/SQLite with
  Supabase.
- `docs/concepts/inventory-goals.md` L146 "not yet implemented" → Pantry
  tracking exists; calories and readiness don't.
- `notes.md` L22 → "on Supabase; local-first is a goal". L58–66: edits to
  existing seed items don't reach the database.

Still accurate: `docs/family-access.md`, `docs/knowledge/*`,
`docs/architecture/engineering-decisions.md`, `docs/vision/product-brain.md`.
