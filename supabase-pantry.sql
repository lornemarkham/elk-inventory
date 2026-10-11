-- ═══════════════════════════════════════════════════════════════════════════
-- ELK Inventory — Pantry stock (lots + movement ledger) — v1
-- Run AFTER supabase-schema.sql AND supabase-family-access.sql:
-- Supabase Dashboard → SQL Editor → paste → Run
--
-- Who can use it: ONLY accounts in public.elk_family_members (see
-- supabase-family-access.sql). Every read policy and every pantry_* function
-- checks that; being signed in is not enough.
--
-- Purely additive: two new tables, one tiny feedback table, the shopping
-- list, the pantry_* functions, and one guard trigger on inventory_items (only
-- affects items the pantry has started tracking). Nothing existing is
-- dropped, renamed or rewritten. Safe to re-run — and re-running it over an
-- earlier version adds what's new (waste, moving, the shopping list).
-- Re-running replaces pantry_use with a version that also takes p_reason; apps
-- that don't send it keep working (it defaults to 'used').
--
-- Model (see src/lib/pantryModel.ts for the client-side mirror):
--   inventory_items  = the product ("Diced Tomatoes", unit "cans")
--   stock_lots       = a physical batch of it: how many, where, best before,
--                      when it was bought
--   stock_movements  = append-only history of every change to a lot
--   pantry_shopping_items = the family shopping list (Pantry owns it; ELK
--                      Kitchen adds a recipe's missing ingredients to it
--                      through pantry_shopping_add)
--
-- inventory_items.quantity stays meaningful for the rest of the app: for a
-- pantry-tracked item it is kept equal to the sum of its lots' remaining
-- quantity, by these functions, in the same transaction.
--
-- Writes happen ONLY through the pantry_* functions below (SECURITY DEFINER,
-- no INSERT/UPDATE/DELETE policies on the tables), so the history can't be
-- edited or skipped, and each function locks the product row first so two
-- phones using the same product at once are serialized — never last-write-wins.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Preconditions ────────────────────────────────────────────────────────────
-- Stop (changing nothing) unless the family-access migration ran first, or if
-- a table with one of our names exists but belongs to something else (this
-- project is shared with another app).
DO $$
DECLARE
  t TEXT;
BEGIN
  IF to_regprocedure('public.elk_is_family_member()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase-family-access.sql first — nothing changed.';
  END IF;
  FOREACH t IN ARRAY ARRAY['stock_lots', 'stock_movements', 'inventory_feedback', 'pantry_shopping_items'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND COALESCE(obj_description(to_regclass('public.' || t), 'pg_class'), '') NOT LIKE 'elk-inventory:%' THEN
      RAISE EXCEPTION 'public.% exists but was not created by ELK Inventory — stopping, nothing changed.', t;
    END IF;
  END LOOP;
END $$;

-- ── Lots ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_lots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: a product with pantry history can't be deleted out from under it.
  item_id             TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity_received   INTEGER NOT NULL CHECK (quantity_received >= 0),
  quantity_remaining  INTEGER NOT NULL CHECK (quantity_remaining >= 0),
  location            TEXT NOT NULL DEFAULT '',
  best_before         DATE,
  -- NULL = was already on hand before pantry tracking started (date unknown).
  purchased_on        DATE,
  source              TEXT NOT NULL DEFAULT 'purchase',   -- 'purchase' | 'already-on-hand'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT stock_lots_remaining_le_received CHECK (quantity_remaining <= quantity_received)
);

CREATE INDEX IF NOT EXISTS stock_lots_item_idx ON public.stock_lots (item_id);
COMMENT ON TABLE public.stock_lots IS 'elk-inventory: pantry batches';

-- ── Movements (append-only) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  lot_id          UUID NOT NULL REFERENCES public.stock_lots(id) ON DELETE RESTRICT,
  -- 'received'         bought / put away
  -- 'used'             taken out (cooking, eating, gave away…)
  -- 'wasted'           thrown out (went off, spoiled) — taken out like 'used',
  --                    kept apart so the family can see what gets wasted
  -- 'moved'            some of a lot moved somewhere else: −n on the old lot,
  --                    +n on a new lot at the new place (same dates); the
  --                    product's total doesn't change
  -- 'undo'             a 'used' / 'wasted' / 'moved' batch put back
  -- 'count-correction' the product's count changed somewhere outside the
  --                    pantry screen (or existed before tracking); recorded
  --                    here instead of being silently overwritten
  kind            TEXT NOT NULL CONSTRAINT stock_movements_kind_check
                  CHECK (kind IN ('received', 'used', 'wasted', 'moved', 'undo', 'count-correction')),
  quantity_delta  INTEGER NOT NULL CHECK (quantity_delta <> 0),
  -- Groups the per-lot rows of one action (one "use 2" can span two lots).
  batch_id        UUID NOT NULL,
  -- For 'undo' rows: the batch they reverse.
  undoes_batch_id UUID,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS stock_movements_item_idx  ON public.stock_movements (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_batch_idx ON public.stock_movements (batch_id);
COMMENT ON TABLE public.stock_movements IS 'elk-inventory: pantry movement history (append-only)';

-- Tables made by an earlier version of this file only allowed the first four
-- kinds. Widening the check keeps every existing row valid.
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_kind_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_kind_check
  CHECK (kind IN ('received', 'used', 'wasted', 'moved', 'undo', 'count-correction'));

-- ── RLS: family members can read (shared household); nobody writes directly
ALTER TABLE public.stock_lots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- (Earlier draft names — never reached production, removed if present.)
DROP POLICY IF EXISTS "Authenticated users can view lots" ON public.stock_lots;
DROP POLICY IF EXISTS "Authenticated users can view movements" ON public.stock_movements;

DROP POLICY IF EXISTS "Family members can view lots" ON public.stock_lots;
CREATE POLICY "Family members can view lots"
  ON public.stock_lots FOR SELECT TO authenticated USING ((SELECT public.elk_is_family_member()));

DROP POLICY IF EXISTS "Family members can view movements" ON public.stock_movements;
CREATE POLICY "Family members can view movements"
  ON public.stock_movements FOR SELECT TO authenticated USING ((SELECT public.elk_is_family_member()));

-- No write privilege at all for the API roles — writes go through pantry_*.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stock_lots, public.stock_movements FROM PUBLIC, anon, authenticated;

-- ── Tester feedback ("this confused me" / "this is wrong") ───────────────────
-- Write-only from the app (family members). Read it in Supabase → Table
-- Editor → inventory_feedback. Prefixed so it can't collide with the other
-- app's tables.
CREATE TABLE IF NOT EXISTS public.inventory_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message     TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  page        TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.inventory_feedback IS 'elk-inventory: tester feedback';

ALTER TABLE public.inventory_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Family members can send feedback" ON public.inventory_feedback;
CREATE POLICY "Family members can send feedback"
  ON public.inventory_feedback FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.elk_is_family_member()) AND created_by = (SELECT auth.uid()));

REVOKE UPDATE, DELETE, TRUNCATE ON public.inventory_feedback FROM PUBLIC, anon, authenticated;

-- ── Guard: other screens can't overwrite a pantry-tracked count ──────────────
-- The rest of the app writes whole item rows from whatever copy the phone has
-- in memory (edit form, Capture merge, seed top-up). For a pantry-tracked
-- item that copy may be stale, so its quantity and the pantry's own
-- attribute keys are kept unless the write comes from a pantry_* function
-- (which sets elk.pantry for its own transaction only). Every other field
-- (name, notes, location, …) still updates normally.
CREATE OR REPLACE FUNCTION public.pantry_guard_item_()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF COALESCE((OLD.attributes->>'pantryTracked')::boolean, false)
     AND COALESCE(current_setting('elk.pantry', true), '') <> '1' THEN
    NEW.quantity   := OLD.quantity;
    NEW.attributes := (COALESCE(NEW.attributes, '{}'::jsonb) - 'pantryTracked' - 'lowStockAt')
                      || jsonb_strip_nulls(jsonb_build_object(
                           'pantryTracked', true,
                           'lowStockAt',    OLD.attributes->'lowStockAt'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pantry_guard_item ON public.inventory_items;
CREATE TRIGGER pantry_guard_item
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.pantry_guard_item_();

-- ═══════════════════════════════════════════════════════════════════════════
-- Functions
-- ═══════════════════════════════════════════════════════════════════════════

-- Every public pantry_* function starts with this. They run as SECURITY
-- DEFINER (so RLS doesn't apply inside them), which is exactly why the
-- membership check has to be here and not only in the table policies.
CREATE OR REPLACE FUNCTION public.pantry_require_member_()
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Please sign in again.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.elk_is_family_member() THEN
    RAISE EXCEPTION 'This account isn''t on the family list yet.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Oldest-first ("first in, first out"): lots already on hand before tracking
-- (purchased_on NULL) are the oldest; then by purchase date; then by when
-- they were recorded. Mirrored by fifoOrder() in src/lib/pantryModel.ts.

-- Internal: lock the product and make its lots agree with its quantity.
-- If inventory_items.quantity differs from the lots' total (first time the
-- pantry touches this product, or someone changed the count on another
-- screen), the difference is RECORDED as a 'count-correction' movement:
--   more than the lots → a new "already on hand, date unknown" lot
--   fewer than the lots → taken from the oldest lots first
-- Returns the locked row's quantity after reconciling.
CREATE OR REPLACE FUNCTION public.pantry_reconcile_(p_item_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_item      public.inventory_items%ROWTYPE;
  v_lot_total INTEGER;
  v_had_lots  BOOLEAN;
  v_diff      INTEGER;
  v_lot       RECORD;
  v_take      INTEGER;
  v_lot_id    UUID;
  v_batch     UUID := gen_random_uuid();
BEGIN
  PERFORM set_config('elk.pantry', '1', true);   -- this transaction only; see guard above
  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That item no longer exists.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(quantity_remaining), 0), COUNT(*) > 0
    INTO v_lot_total, v_had_lots
    FROM public.stock_lots WHERE item_id = p_item_id;

  v_diff := GREATEST(v_item.quantity, 0) - v_lot_total;

  IF v_diff > 0 THEN
    INSERT INTO public.stock_lots
      (item_id, quantity_received, quantity_remaining, location, best_before, purchased_on, source, created_by)
    VALUES
      (p_item_id, v_diff, v_diff, COALESCE(v_item.location_detail, ''), NULL, NULL, 'already-on-hand', auth.uid())
    RETURNING id INTO v_lot_id;

    INSERT INTO public.stock_movements (item_id, lot_id, kind, quantity_delta, batch_id, note, created_by)
    VALUES (p_item_id, v_lot_id, 'count-correction', v_diff, v_batch,
      CASE WHEN v_had_lots
        THEN 'Count was raised outside the Pantry screen'
        ELSE 'Already on hand when pantry tracking started (date unknown)' END,
      auth.uid());

  ELSIF v_diff < 0 THEN
    v_diff := -v_diff;
    FOR v_lot IN
      SELECT * FROM public.stock_lots
       WHERE item_id = p_item_id AND quantity_remaining > 0
       ORDER BY purchased_on ASC NULLS FIRST, created_at ASC, id ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_diff = 0;
      v_take := LEAST(v_diff, v_lot.quantity_remaining);
      UPDATE public.stock_lots SET quantity_remaining = quantity_remaining - v_take WHERE id = v_lot.id;
      INSERT INTO public.stock_movements (item_id, lot_id, kind, quantity_delta, batch_id, note, created_by)
      VALUES (p_item_id, v_lot.id, 'count-correction', -v_take, v_batch,
        'Count was lowered outside the Pantry screen', auth.uid());
      v_diff := v_diff - v_take;
    END LOOP;
  END IF;

  UPDATE public.inventory_items
     SET attributes = COALESCE(attributes, '{}'::jsonb) || '{"pantryTracked": true}'::jsonb
   WHERE id = p_item_id
     AND NOT COALESCE((attributes->>'pantryTracked')::boolean, false);

  RETURN GREATEST(v_item.quantity, 0);
END;
$$;

-- Bought something and put it away. Creates the product first when
-- p_new_name is given and p_item_id doesn't exist yet.
CREATE OR REPLACE FUNCTION public.pantry_receive(
  p_item_id      TEXT,
  p_quantity     INTEGER,
  p_location     TEXT,
  p_best_before  DATE    DEFAULT NULL,
  p_purchased_on DATE    DEFAULT CURRENT_DATE,
  p_new_name     TEXT    DEFAULT NULL,
  p_unit         TEXT    DEFAULT NULL,
  -- Client-generated; a retry with the same id (e.g. reply lost on a weak
  -- connection, user taps Save again) does nothing and returns it again.
  p_request_id   UUID    DEFAULT NULL
)
RETURNS UUID   -- the batch id (pass to pantry_undo)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_qty    INTEGER;
  v_lot_id UUID;
  v_batch  UUID := COALESCE(p_request_id, gen_random_uuid());
BEGIN
  PERFORM public.pantry_require_member_();
  IF p_quantity IS NULL OR p_quantity < 1 THEN RAISE EXCEPTION 'How many? It has to be at least 1.'; END IF;
  IF p_quantity > 10000 THEN RAISE EXCEPTION 'That is a lot — please check the number.'; END IF;

  IF p_new_name IS NOT NULL AND btrim(p_new_name) <> '' THEN
    INSERT INTO public.inventory_items
      (id, name, item_class, lifecycle_state, domain, current_zone, recommended_zone,
       location_detail, tags, quantity, attributes, created_at, updated_at)
    VALUES
      (p_item_id, btrim(p_new_name), 'material', 'available', 'food-storage',
       'storage-room-pantry', 'storage-room-pantry', COALESCE(btrim(p_location), ''),
       ARRAY['food-storage', 'pantry'], 0,
       jsonb_build_object('unit', COALESCE(NULLIF(btrim(p_unit), ''), 'items'), 'pantryTracked', true),
       NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  END IF;

  v_qty := public.pantry_reconcile_(p_item_id);
  IF EXISTS (SELECT 1 FROM public.stock_movements WHERE batch_id = v_batch) THEN
    RETURN v_batch;   -- already done
  END IF;

  INSERT INTO public.stock_lots
    (item_id, quantity_received, quantity_remaining, location, best_before, purchased_on, source, created_by)
  VALUES
    (p_item_id, p_quantity, p_quantity, COALESCE(btrim(p_location), ''), p_best_before,
     COALESCE(p_purchased_on, CURRENT_DATE), 'purchase', auth.uid())
  RETURNING id INTO v_lot_id;

  INSERT INTO public.stock_movements (item_id, lot_id, kind, quantity_delta, batch_id, created_by)
  VALUES (p_item_id, v_lot_id, 'received', p_quantity, v_batch, auth.uid());

  UPDATE public.inventory_items
     SET quantity = v_qty + p_quantity, updated_at = NOW()
   WHERE id = p_item_id;

  RETURN v_batch;
END;
$$;

-- Took some out. Oldest lots first, unless p_lot_id names one batch.
-- Refuses (changes nothing) if there isn't enough.
-- p_reason 'wasted' records it as thrown out instead of used.
DROP FUNCTION IF EXISTS public.pantry_use(TEXT, INTEGER, UUID, UUID);   -- before p_reason
CREATE OR REPLACE FUNCTION public.pantry_use(
  p_item_id  TEXT,
  p_quantity INTEGER,
  p_lot_id   UUID DEFAULT NULL,
  p_request_id UUID DEFAULT NULL,  -- retry-safe, as in pantry_receive
  p_reason   TEXT DEFAULT 'used'   -- 'used' | 'wasted'
)
RETURNS UUID   -- the batch id (pass to pantry_undo)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_qty       INTEGER;
  v_available INTEGER;
  v_left      INTEGER := p_quantity;
  v_take      INTEGER;
  v_lot       RECORD;
  v_batch     UUID := COALESCE(p_request_id, gen_random_uuid());
BEGIN
  PERFORM public.pantry_require_member_();
  IF p_quantity IS NULL OR p_quantity < 1 THEN RAISE EXCEPTION 'How many? It has to be at least 1.'; END IF;
  IF COALESCE(p_reason, '') NOT IN ('used', 'wasted') THEN RAISE EXCEPTION 'Unknown reason: %', p_reason; END IF;

  v_qty := public.pantry_reconcile_(p_item_id);
  IF EXISTS (SELECT 1 FROM public.stock_movements WHERE batch_id = v_batch) THEN
    RETURN v_batch;   -- already done
  END IF;

  SELECT COALESCE(SUM(quantity_remaining), 0) INTO v_available
    FROM public.stock_lots
   WHERE item_id = p_item_id AND (p_lot_id IS NULL OR id = p_lot_id);

  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Only % left%, so nothing was removed.', v_available,
      CASE WHEN p_lot_id IS NULL THEN '' ELSE ' in that batch' END;
  END IF;

  FOR v_lot IN
    SELECT * FROM public.stock_lots
     WHERE item_id = p_item_id AND quantity_remaining > 0
       AND (p_lot_id IS NULL OR id = p_lot_id)
     ORDER BY purchased_on ASC NULLS FIRST, created_at ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_left = 0;
    v_take := LEAST(v_left, v_lot.quantity_remaining);
    UPDATE public.stock_lots SET quantity_remaining = quantity_remaining - v_take WHERE id = v_lot.id;
    INSERT INTO public.stock_movements (item_id, lot_id, kind, quantity_delta, batch_id, created_by)
    VALUES (p_item_id, v_lot.id, p_reason, -v_take, v_batch, auth.uid());
    v_left := v_left - v_take;
  END LOOP;

  UPDATE public.inventory_items
     SET quantity = v_qty - p_quantity, updated_at = NOW()
   WHERE id = p_item_id;

  RETURN v_batch;
END;
$$;

-- Reverse one action, once:
--   'used' / 'wasted' → put the same cans back in the same batches
--   'moved'    → put them back where they were, while the moved ones are
--                all still at the new place
--   'received' → take the batch back out (a mistaken "I bought something"),
--                only while none of that batch has been used yet
CREATE OR REPLACE FUNCTION public.pantry_undo(p_batch_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_item_id TEXT;
  v_kind    TEXT;
  v_qty     INTEGER;
  v_total   INTEGER := 0;
  v_mv      RECORD;
  v_batch   UUID := gen_random_uuid();
BEGIN
  PERFORM public.pantry_require_member_();

  SELECT item_id, kind INTO v_item_id, v_kind FROM public.stock_movements
   WHERE batch_id = p_batch_id AND kind IN ('used', 'wasted', 'moved', 'received') LIMIT 1;
  IF v_item_id IS NULL THEN RAISE EXCEPTION 'Nothing to undo.'; END IF;

  v_qty := public.pantry_reconcile_(v_item_id);   -- also takes the product lock

  IF EXISTS (SELECT 1 FROM public.stock_movements WHERE undoes_batch_id = p_batch_id) THEN
    RAISE EXCEPTION 'That was already undone.';
  END IF;

  IF v_kind = 'received' AND EXISTS (
    SELECT 1 FROM public.stock_movements mv JOIN public.stock_lots l ON l.id = mv.lot_id
     WHERE mv.batch_id = p_batch_id AND l.quantity_remaining < l.quantity_received
  ) THEN
    RAISE EXCEPTION 'Some of these have already been used, so this can''t be undone. Use “Use some” instead.';
  END IF;

  IF v_kind = 'moved' AND EXISTS (
    SELECT 1 FROM public.stock_movements mv JOIN public.stock_lots l ON l.id = mv.lot_id
     WHERE mv.batch_id = p_batch_id AND mv.quantity_delta > 0 AND l.quantity_remaining < mv.quantity_delta
  ) THEN
    RAISE EXCEPTION 'Some of these have been used since they were moved, so this can''t be undone. Move the rest back instead.';
  END IF;

  FOR v_mv IN
    SELECT * FROM public.stock_movements WHERE batch_id = p_batch_id AND kind = v_kind
  LOOP
    UPDATE public.stock_lots
       SET quantity_remaining = quantity_remaining - v_mv.quantity_delta
     WHERE id = v_mv.lot_id;
    INSERT INTO public.stock_movements
      (item_id, lot_id, kind, quantity_delta, batch_id, undoes_batch_id, note, created_by)
    VALUES (v_item_id, v_mv.lot_id, 'undo', -v_mv.quantity_delta, v_batch, p_batch_id,
            CASE v_kind WHEN 'moved' THEN 'Move undone' WHEN 'wasted' THEN 'Thrown out undone' END, auth.uid());
    v_total := v_total - v_mv.quantity_delta;
  END LOOP;

  UPDATE public.inventory_items
     SET quantity = v_qty + v_total, updated_at = NOW()
   WHERE id = v_item_id;

  RETURN v_batch;
END;
$$;

-- "Warn me when I'm down to N" (NULL clears it). Merged into attributes so
-- nothing else on the item is touched.
CREATE OR REPLACE FUNCTION public.pantry_set_low_stock(p_item_id TEXT, p_level INTEGER)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.pantry_require_member_();
  IF p_level IS NOT NULL AND p_level < 0 THEN RAISE EXCEPTION 'The warning level can''t be negative.'; END IF;
  PERFORM set_config('elk.pantry', '1', true);

  UPDATE public.inventory_items
     SET attributes = CASE
           WHEN p_level IS NULL THEN COALESCE(attributes, '{}'::jsonb) - 'lowStockAt'
           ELSE COALESCE(attributes, '{}'::jsonb) || jsonb_build_object('lowStockAt', p_level)
         END,
         updated_at = NOW()
   WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That item no longer exists.'; END IF;
END;
$$;

-- Moved some of one batch somewhere else ("3 cans from the basement to the
-- kitchen cupboard"). The moved ones become a new batch at the new place with
-- the same dates, so oldest-first and best-before warnings still hold. The
-- product's total doesn't change.
CREATE OR REPLACE FUNCTION public.pantry_move(
  p_lot_id      UUID,
  p_quantity    INTEGER,
  p_to_location TEXT,
  p_request_id  UUID DEFAULT NULL   -- retry-safe, as in pantry_receive
)
RETURNS UUID   -- the batch id (pass to pantry_undo)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_item_id TEXT;
  v_lot     public.stock_lots%ROWTYPE;
  v_new_id  UUID;
  v_to      TEXT := btrim(COALESCE(p_to_location, ''));
  v_batch   UUID := COALESCE(p_request_id, gen_random_uuid());
BEGIN
  PERFORM public.pantry_require_member_();
  IF p_quantity IS NULL OR p_quantity < 1 THEN RAISE EXCEPTION 'How many? It has to be at least 1.'; END IF;
  IF v_to = '' THEN RAISE EXCEPTION 'Where are they going?'; END IF;

  SELECT item_id INTO v_item_id FROM public.stock_lots WHERE id = p_lot_id;
  IF v_item_id IS NULL THEN RAISE EXCEPTION 'That batch no longer exists.'; END IF;

  PERFORM public.pantry_reconcile_(v_item_id);   -- takes the product lock
  IF EXISTS (SELECT 1 FROM public.stock_movements WHERE batch_id = v_batch) THEN
    RETURN v_batch;   -- already done
  END IF;

  SELECT * INTO v_lot FROM public.stock_lots WHERE id = p_lot_id FOR UPDATE;
  IF lower(v_lot.location) = lower(v_to) THEN RAISE EXCEPTION 'They''re already there.'; END IF;
  IF v_lot.quantity_remaining < p_quantity THEN
    RAISE EXCEPTION 'Only % in that batch, so nothing was moved.', v_lot.quantity_remaining;
  END IF;

  UPDATE public.stock_lots SET quantity_remaining = quantity_remaining - p_quantity WHERE id = p_lot_id;
  INSERT INTO public.stock_lots
    (item_id, quantity_received, quantity_remaining, location, best_before, purchased_on, source, created_by)
  VALUES
    (v_item_id, p_quantity, p_quantity, v_to, v_lot.best_before, v_lot.purchased_on, v_lot.source, auth.uid())
  RETURNING id INTO v_new_id;

  INSERT INTO public.stock_movements (item_id, lot_id, kind, quantity_delta, batch_id, note, created_by) VALUES
    (v_item_id, p_lot_id, 'moved', -p_quantity, v_batch, 'Moved to ' || v_to, auth.uid()),
    (v_item_id, v_new_id, 'moved',  p_quantity, v_batch,
       'Moved from ' || COALESCE(NULLIF(v_lot.location, ''), 'no location'), auth.uid());

  RETURN v_batch;
END;
$$;

-- ── Shopping list ────────────────────────────────────────────────────────────
-- One list for the family. Things get on it by hand (Pantry), from "Running
-- low" (Pantry), or from a recipe's missing ingredients (ELK Kitchen). Adding
-- goes through pantry_shopping_add so the same thing isn't listed twice and a
-- known pantry product is linked; ticking off and removing are plain updates.
CREATE TABLE IF NOT EXISTS public.pantry_shopping_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  -- The pantry product, when the name matches one (so "Got it" can put it away).
  item_id     TEXT REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  -- e.g. "for Lasagne" — why it's on the list.
  note        TEXT CHECK (note IS NULL OR length(note) <= 500),
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'low-stock', 'recipe')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at     TIMESTAMPTZ,
  done_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS pantry_shopping_open_idx ON public.pantry_shopping_items (created_at) WHERE done_at IS NULL;
COMMENT ON TABLE public.pantry_shopping_items IS 'elk-inventory: family shopping list';

ALTER TABLE public.pantry_shopping_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Family members can view the shopping list" ON public.pantry_shopping_items;
CREATE POLICY "Family members can view the shopping list"
  ON public.pantry_shopping_items FOR SELECT TO authenticated USING ((SELECT public.elk_is_family_member()));
DROP POLICY IF EXISTS "Family members can tick off shopping" ON public.pantry_shopping_items;
CREATE POLICY "Family members can tick off shopping"
  ON public.pantry_shopping_items FOR UPDATE TO authenticated
  USING ((SELECT public.elk_is_family_member())) WITH CHECK ((SELECT public.elk_is_family_member()));
DROP POLICY IF EXISTS "Family members can remove shopping" ON public.pantry_shopping_items;
CREATE POLICY "Family members can remove shopping"
  ON public.pantry_shopping_items FOR DELETE TO authenticated USING ((SELECT public.elk_is_family_member()));

-- Adding is only through pantry_shopping_add; an update can only tick/untick.
REVOKE INSERT, UPDATE, TRUNCATE ON public.pantry_shopping_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pantry_shopping_items FROM anon;
GRANT UPDATE (done_at, done_by) ON public.pantry_shopping_items TO authenticated;

-- Adds each name not already on the open list (ignoring case and spaces).
-- Returns how many were added; the rest were already there.
CREATE OR REPLACE FUNCTION public.pantry_shopping_add(
  p_names  TEXT[],
  p_note   TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'manual'
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_name  TEXT;
  v_key   TEXT;
  v_added INTEGER := 0;
BEGIN
  PERFORM public.pantry_require_member_();
  IF COALESCE(p_source, '') NOT IN ('manual', 'low-stock', 'recipe') THEN RAISE EXCEPTION 'Unknown source: %', p_source; END IF;
  IF COALESCE(array_length(p_names, 1), 0) > 100 THEN RAISE EXCEPTION 'That''s a lot at once — add up to 100.'; END IF;
  -- One list: two phones adding the same thing at once can't both add it.
  PERFORM pg_advisory_xact_lock(hashtext('pantry_shopping_items'));

  FOREACH v_name IN ARRAY COALESCE(p_names, '{}') LOOP
    v_name := regexp_replace(btrim(COALESCE(v_name, '')), '\s+', ' ', 'g');
    CONTINUE WHEN v_name = '';
    v_key := lower(v_name);
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.pantry_shopping_items
       WHERE done_at IS NULL AND lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = v_key);
    INSERT INTO public.pantry_shopping_items (name, item_id, note, source, created_by)
    VALUES (left(v_name, 200),
            (SELECT id FROM public.inventory_items
              WHERE domain = 'food-storage' AND lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = v_key
              ORDER BY id LIMIT 1),
            NULLIF(left(btrim(COALESCE(p_note, '')), 500), ''), p_source, auth.uid());
    v_added := v_added + 1;
  END LOOP;
  RETURN v_added;
END;
$$;

-- Earlier draft signatures (before request ids) — remove if present so only
-- one version of each function exists.
DROP FUNCTION IF EXISTS public.pantry_receive(TEXT, INTEGER, TEXT, DATE, DATE, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.pantry_use(TEXT, INTEGER, UUID);

-- Only signed-in users may call these (and each one then requires family
-- membership); the internal helpers are never exposed.
REVOKE ALL ON FUNCTION public.pantry_guard_item_() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pantry_reconcile_(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pantry_require_member_() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pantry_receive(TEXT, INTEGER, TEXT, DATE, DATE, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pantry_use(TEXT, INTEGER, UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pantry_undo(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pantry_set_low_stock(TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pantry_move(UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pantry_shopping_add(TEXT[], TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pantry_receive(TEXT, INTEGER, TEXT, DATE, DATE, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pantry_use(TEXT, INTEGER, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pantry_undo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pantry_set_low_stock(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pantry_move(UUID, INTEGER, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pantry_shopping_add(TEXT[], TEXT, TEXT) TO authenticated;

-- Tell PostgREST to pick up the new tables/functions immediately.
NOTIFY pgrst, 'reload schema';
