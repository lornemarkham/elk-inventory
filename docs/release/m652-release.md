# Inventory release — M652

Candidate: branch `inventory-release-m652` (= `home-pilot-complete` b65586b + Kitchen contract test + this doc). Not merged, not deployed.

## Database identity (verified 2026-11-09, public key only)
Live `elk-inventory.vercel.app` (bundle `main-DUWlJDoC.js`) talks to **`xjmhojlmkodrsvocoqlv`**. This is **not** `frllwwxesxbmmaadzfaf` (Passport), which is the only project the release runner holds credentials for. Do not point the runner's `passport-production` service at Inventory.

State seen from outside (anon key; REST):
- `inventory_items`, `stock_lots`, `stock_movements`, `elk_family_members` exist; `elk_is_family_member()` denies anon (42501) ⇒ family-access and the first Pantry SQL (`b1e3f3f`) are applied.
- `pantry_shopping_items`, `pantry_move`, `pantry_shopping_add` are **missing** (PGRST205/202) ⇒ `supabase-pantry.sql` v2 (waste, move, shopping) is NOT applied.
Confirm exactly with `docs/home-pilot/activation-check.sql` in the SQL Editor (read-only).

## Owner steps (nothing here has been run)
1. **Backup** (Dashboard → Database → Backups → take one, or with a Session-pooler string for `xjmhojlmkodrsvocoqlv`):
   `pg_dump --format=custom --schema=public --file=inventory-$(date -u +%Y%m%dT%H%M%SZ).dump "$INVENTORY_DB_URL" && pg_restore --list FILE | grep -c ' TABLE DATA '`
   Also use the app's `/backup` full export.
2. Run `docs/home-pilot/activation-check.sql`; keep the output.
3. SQL Editor: run `supabase-pantry.sql` (idempotent; additive; tested as an upgrade from `b1e3f3f` preserving stock and history). Re-run the check: `pantry_move`, `pantry_shopping_add` and `pantry_shopping_items` (rls=true) must appear.
4. Say "SHIP <sha>" for the merge of this branch (`git merge --ff-only`) so Vercel deploys the Pantry v2 UI. Order matters only loosely: the old app works with the new SQL; the new UI degrades without it.
5. Smoke on a phone as a family member: receive → use → Undo; move → Undo; add to shopping list; refresh.

Rollback: SQL is additive; to revert the UI redeploy the previous Vercel deployment. Restore from the step-1 dump only for data damage.
