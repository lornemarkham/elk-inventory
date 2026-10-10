-- ═══════════════════════════════════════════════════════════════════════════
-- ELK Inventory — Pantry stock (lots + movement ledger) — v1
-- Run AFTER supabase-schema.sql: Supabase Dashboard → SQL Editor → paste → Run
--
-- Purely additive: two new tables, one tiny feedback table, the pantry_*
-- functions, and one guard trigger on inventory_items (only affects items the
-- pantry has started tracking). Nothing existing is dropped, renamed or
-- rewritten. Safe to re-run.
--
-- Model (see src/lib/pantryModel.ts for the client-side mirror):
--   inventory_items  = the product ("Diced Tomatoes", unit "cans")
--   stock_lots       = a physical batch of it: how many, where, best before,
--                      when it was bought
--   stock_movements  = append-only history of every change to a lot
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

-- ── Movements (append-only) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  lot_id          UUID NOT NULL REFERENCES public.stock_lots(id) ON DELETE RESTRICT,
  -- 'received'         bought / put away
  -- 'used'             taken out (cooking, eating, gave away…)
  -- 'undo'             a 'used' batch put back
  -- 'count-correction' the product's count changed somewhere outside the
  --                    pantry screen (or existed before tracking); recorded
  --                    here instead of being silently overwritten
  kind            TEXT NOT NULL CHECK (kind IN ('received', 'used', 'undo', 'count-correction')),
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

-- ── RLS: everyone signed in can read (shared household); nobody writes directly
ALTER TABLE public.stock_lots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view lots" ON public.stock_lots;
CREATE POLICY "Authenticated users can view lots"
  ON public.stock_lots FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view movements" ON public.stock_movements;
CREATE POLICY "Authenticated users can view movements"
  ON public.stock_movements FOR SELECT TO authenticated USING (true);

-- ── Tester feedback ("this confused me" / "this is wrong") ───────────────────
-- Write-only from the app. Read it in Supabase → Table Editor → feedback.
CREATE TABLE IF NOT EXISTS public.feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message     TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  page        TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can send feedback" ON public.feedback;
CREATE POLICY "Authenticated users can send feedback"
  ON public.feedback FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

-- ── Guard: other screens can't overwrite a pantry-tracked count ──────────────
-- The rest of the app writes whole item rows from whatever copy the phone has
-- in memory (edit form, Capture merge, seed top-up). For a pantry-tracked
-- item that copy may be stale, so its quantity and the pantry's own
-- attribute keys are kept unless the write comes from a pantry_* function
-- (which sets elk.pantry for its own transaction only). Every other field
-- (name, notes, location, …) still updates normally.
CREATE OR REPLACE FUNCTION public.pantry_guard_item_()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_qty    INTEGER;
  v_lot_id UUID;
  v_batch  UUID := COALESCE(p_request_id, gen_random_uuid());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
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
CREATE OR REPLACE FUNCTION public.pantry_use(
  p_item_id  TEXT,
  p_quantity INTEGER,
  p_lot_id   UUID DEFAULT NULL,
  p_request_id UUID DEFAULT NULL   -- retry-safe, as in pantry_receive
)
RETURNS UUID   -- the batch id (pass to pantry_undo)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_qty       INTEGER;
  v_available INTEGER;
  v_left      INTEGER := p_quantity;
  v_take      INTEGER;
  v_lot       RECORD;
  v_batch     UUID := COALESCE(p_request_id, gen_random_uuid());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF p_quantity IS NULL OR p_quantity < 1 THEN RAISE EXCEPTION 'How many? It has to be at least 1.'; END IF;

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
    VALUES (p_item_id, v_lot.id, 'used', -v_take, v_batch, auth.uid());
    v_left := v_left - v_take;
  END LOOP;

  UPDATE public.inventory_items
     SET quantity = v_qty - p_quantity, updated_at = NOW()
   WHERE id = p_item_id;

  RETURN v_batch;
END;
$$;

-- Reverse one action, once:
--   'used'     → put the same cans back in the same batches
--   'received' → take the batch back out (a mistaken "I bought something"),
--                only while none of that batch has been used yet
CREATE OR REPLACE FUNCTION public.pantry_undo(p_batch_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item_id TEXT;
  v_kind    TEXT;
  v_qty     INTEGER;
  v_total   INTEGER := 0;
  v_mv      RECORD;
  v_batch   UUID := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;

  SELECT item_id, kind INTO v_item_id, v_kind FROM public.stock_movements
   WHERE batch_id = p_batch_id AND kind IN ('used', 'received') LIMIT 1;
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

  FOR v_mv IN
    SELECT * FROM public.stock_movements WHERE batch_id = p_batch_id AND kind = v_kind
  LOOP
    UPDATE public.stock_lots
       SET quantity_remaining = quantity_remaining - v_mv.quantity_delta
     WHERE id = v_mv.lot_id;
    INSERT INTO public.stock_movements
      (item_id, lot_id, kind, quantity_delta, batch_id, undoes_batch_id, created_by)
    VALUES (v_item_id, v_mv.lot_id, 'undo', -v_mv.quantity_delta, v_batch, p_batch_id, auth.uid());
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
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

-- Earlier draft signatures (before request ids) — remove if present so only
-- one version of each function exists.
DROP FUNCTION IF EXISTS public.pantry_receive(TEXT, INTEGER, TEXT, DATE, DATE, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.pantry_use(TEXT, INTEGER, UUID);

-- Only signed-in users may call these; the internal helpers are never exposed.
REVOKE ALL ON FUNCTION public.pantry_guard_item_() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pantry_reconcile_(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pantry_receive(TEXT, INTEGER, TEXT, DATE, DATE, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pantry_use(TEXT, INTEGER, UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pantry_undo(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pantry_set_low_stock(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pantry_receive(TEXT, INTEGER, TEXT, DATE, DATE, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pantry_use(TEXT, INTEGER, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pantry_undo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pantry_set_low_stock(TEXT, INTEGER) TO authenticated;

-- Tell PostgREST to pick up the new tables/functions immediately.
NOTIFY pgrst, 'reload schema';
