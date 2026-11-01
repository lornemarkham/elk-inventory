# Backup and restore

Everything here is for the owner. Nothing in the app can restore data, on purpose:
pantry batches and the movement history are unwritable from the API, so the
history stays append-only. A restore is a reviewed SQL script you run in the
Supabase SQL Editor.

## 1. Take a backup (any family member, 10 seconds)

Open **Backup & print** (header button, or `/backup`) → **Export everything**.
You get `elk-inventory-full-export-YYYY-MM-DD.json` containing, as raw database rows:

| In the file | Source table |
|---|---|
| Items | `inventory_items` |
| Pantry batches (quantity left, place, best-before, bought on) | `stock_lots` |
| Movement history — all of it, not just the latest 500 | `stock_movements` |
| Shopping list | `pantry_shopping_items` |
| Storage locations (zones, containers, every place typed on a batch or item, with counts) | derived |

The export refuses to finish if any table can't be read in full, so a partial file
never looks complete. The three spreadsheet buttons (stock by batch, history,
shopping list) give `.csv` files for reading only; they can't be restored.

**Pilot routine:** export every Sunday, keep the last 4 files somewhere that is
not this computer (cloud drive + a USB stick). Also print a count sheet
(**Print a count sheet**) — it is a paper backup of what's where.

Not in the file: purchase drafts, tester feedback and the family list
(`elk_family_members`). The family list can only be changed from SQL, so keep
your own copy of the INSERT you ran in `docs/family-access.md` step 3.

## 2. Practise a restore (safe, touches no real database)

Do this once before the pilot, with a real export. It runs the restore against a
throwaway in-memory Postgres built from the real SQL files:

```sh
npm run restore-drill -- ~/Downloads/elk-inventory-full-export-2026-11-01.json
```

Expected:

```
inventory_items          in file     5   restored     5   missing 0   OK
stock_lots               in file     4   restored     4   missing 0   OK
stock_movements          in file     1   restored     1   missing 0   OK
pantry_shopping_items    in file     2   restored     2   missing 0   OK
pantry counts disagreeing with batches: 0

DRILL PASSED — the export restores completely.
```

A non-zero exit means the file is damaged; use an older export.

## 3. Restore for real (owner only)

When: rows were deleted by mistake, or the database was rebuilt. If the app just
shows wrong numbers, don't restore — use **Undo** in Pantry or a count correction.

1. **Rebuilt (empty) database: restore BEFORE anyone opens the app.** The app seeds 95 starter
   items into an empty database the first time it loads, and the restore never overwrites
   existing rows, so starter versions would win over your real ones. If someone already opened it,
   see "Starter items got in first" below. If the database still has your data, make a fresh
   export first (so you can go back).
2. Make sure `supabase-schema.sql`, `supabase-family-access.sql` and
   `supabase-pantry.sql` have been applied (`docs/home-pilot/activation-check.sql`
   shows this). The restore script stops with a clear message if the tables are missing.
3. Generate the script from the export file:

   ```sh
   npm run -s restore-sql -- ~/Downloads/elk-inventory-full-export-2026-11-01.json > restore.sql
   ```

4. **Read `restore.sql`.** It is plain text: a header with row counts, one
   `INSERT … ON CONFLICT (id) DO NOTHING` per table in dependency order
   (items → batches → history → shopping), and a check query at the end.
5. Paste it into the Supabase **SQL Editor** and run it.
6. The last two result sets are the check. Required:
   - the first: `missing_after` is `0` on all four rows;
   - the second: **no rows** (no pantry product whose count disagrees with its batches).

What the script does and does not do:

- It only **adds rows that are missing**, matched by id. It never updates, deletes
  or truncates anything, so it cannot overwrite newer work. It is safe to run twice.
- Rows you deleted on purpose since the export **come back** (and, for items, anything
  edited since the export keeps its newer edit). Delete them again afterwards.
- `created_by` / `done_by` that point at accounts that don't exist in the target
  project become empty instead of failing the whole restore. History itself is unchanged.
- The app no longer tops up starter items into a database that has data, so a normal
  restore doesn't bring starter items back. The exception is an empty rebuilt database
  that the app opened first (below).

**Starter items got in first** (rebuilt database, app opened before the restore): don't try to
clean up by hand. Re-create the empty tables, check `SELECT count(*) FROM public.inventory_items;`
returns 0, then run the restore.

## 4. What was verified

Automated (`npm test`, `tests/export-restore.test.ts`, against a real Postgres
(PGlite) loaded with the real SQL files): a database with batches, uses, a throw-out,
a move, an undo, a count correction and a shopping list is exported, restored to an
empty database, and every row in every table compares **identical**. Also: running the
restore twice changes nothing; existing rows are never overwritten; a different set of
user accounts doesn't break it; quotes and SQL in item names survive; tampered or
truncated files are refused; history still can't be written or deleted by family
members after a restore; the 1000-row API cap is paged past; spreadsheet formula
injection in CSV cells is defused.

Manual rehearsal on 2026-11-01: a file exported by the running app (browser, mocked
database) → `restore-sql` → `restore-drill` passed with 0 missing.

**Not verified:** a restore against the real Supabase project — nothing in this
work has touched production. The first real export + `restore-drill` is part of the
activation steps in `README.md` §8.

## 5. Limits found in review

- The restore only handles the columns the schema files define; a column added by hand in production is not in the file.
- The export reads four tables one after another. If someone saves mid-export the app now refuses the file and asks you to retry.
- The edit form saves a whole item. An editor opened *before* a barcode was linked and saved afterwards erases that barcode (re-scan to relink). Counts and pantry settings are protected by the database.
