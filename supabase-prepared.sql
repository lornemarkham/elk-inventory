-- ═══════════════════════════════════════════════════════════════════════════
-- ELK Inventory — PREPARED (household preparedness) — v1
-- Run AFTER supabase-schema.sql AND supabase-family-access.sql
-- (it does not need supabase-pantry.sql to run, but food/water cover is
-- calculated from Pantry stock, so run that too to get a useful answer).
-- Supabase Dashboard → SQL Editor → paste → Run
--
-- Purely additive and safe to re-run: three new tables, one trigger function.
-- Nothing existing is dropped, renamed or rewritten, and no existing table,
-- policy or function is touched. Food and water amounts are NOT stored here:
-- they are read from the Pantry (stock_lots) and from a few extra keys in the
-- existing inventory_items.attributes JSON (prepKind, kcalPerUnit,
-- litresPerUnit, petDaysPerUnit) — no schema change needed for those.
--
--   prepared_household  one row: people, pets, days to cover, daily needs
--   prepared_equipment  flashlights, radios, stoves, batteries, power banks…
--   prepared_plan       one row: the shared emergency-plan text (meeting
--                       place, contacts, shut-offs…) the household prints
--
-- Who can use it: ONLY accounts in public.elk_family_members. Every policy
-- checks elk_is_family_member(); being signed in is not enough.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t TEXT;
BEGIN
  IF to_regprocedure('public.elk_is_family_member()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase-family-access.sql first — nothing changed.';
  END IF;
  FOREACH t IN ARRAY ARRAY['prepared_household', 'prepared_equipment', 'prepared_plan'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND COALESCE(obj_description(to_regclass('public.' || t), 'pg_class'), '') NOT LIKE 'elk-inventory:%' THEN
      RAISE EXCEPTION 'public.% exists but was not created by ELK Inventory — stopping, nothing changed.', t;
    END IF;
  END LOOP;
END $$;

-- Stamps who changed a row and when, so the client can't claim otherwise.
CREATE OR REPLACE FUNCTION public.prepared_stamp_()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prepared_stamp_() FROM PUBLIC, anon, authenticated;

-- ── Household requirements (one row) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prepared_household (
  id                    TEXT PRIMARY KEY DEFAULT 'household' CHECK (id = 'household'),
  people                INTEGER NOT NULL DEFAULT 2    CHECK (people BETWEEN 0 AND 50),
  pets                  INTEGER NOT NULL DEFAULT 0    CHECK (pets BETWEEN 0 AND 50),
  days                  INTEGER NOT NULL DEFAULT 14   CHECK (days BETWEEN 1 AND 365),
  kcal_per_person_day   INTEGER NOT NULL DEFAULT 2000 CHECK (kcal_per_person_day BETWEEN 500 AND 6000),
  water_l_per_person_day NUMERIC NOT NULL DEFAULT 3   CHECK (water_l_per_person_day BETWEEN 0.5 AND 20),
  water_l_per_pet_day   NUMERIC NOT NULL DEFAULT 1    CHECK (water_l_per_pet_day BETWEEN 0 AND 20),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID DEFAULT auth.uid()
);
COMMENT ON TABLE public.prepared_household IS 'elk-inventory: preparedness household requirements (one row)';

-- ── Equipment ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prepared_equipment (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 200),
  category      TEXT NOT NULL DEFAULT 'other'
                CHECK (category IN ('power','light','water','heat','comms','medical','tools','other')),
  quantity      INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 0 AND 1000),
  -- Backup power: stored energy (Wh) of ONE unit.
  capacity_wh   NUMERIC CHECK (capacity_wh IS NULL OR capacity_wh > 0),
  -- Something that draws power: watts while running, and hours per day.
  load_watts    NUMERIC CHECK (load_watts IS NULL OR load_watts >= 0),
  hours_per_day NUMERIC CHECK (hours_per_day IS NULL OR (hours_per_day >= 0 AND hours_per_day <= 24)),
  essential     BOOLEAN NOT NULL DEFAULT false,   -- counts toward the runtime estimate
  best_before   DATE,                             -- batteries, filters, medicines…
  barcode       TEXT,
  location      TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID DEFAULT auth.uid(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID DEFAULT auth.uid()
);
COMMENT ON TABLE public.prepared_equipment IS 'elk-inventory: preparedness equipment';
CREATE INDEX IF NOT EXISTS prepared_equipment_barcode_idx ON public.prepared_equipment (barcode) WHERE barcode IS NOT NULL;

-- ── The shared emergency plan text (one row) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prepared_plan (
  id         TEXT PRIMARY KEY DEFAULT 'plan' CHECK (id = 'plan'),
  info       JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(info) = 'object' AND pg_column_size(info) < 20000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID DEFAULT auth.uid()
);
COMMENT ON TABLE public.prepared_plan IS 'elk-inventory: shared household emergency plan text (one row)';

DROP TRIGGER IF EXISTS prepared_household_stamp ON public.prepared_household;
CREATE TRIGGER prepared_household_stamp BEFORE INSERT OR UPDATE ON public.prepared_household
  FOR EACH ROW EXECUTE FUNCTION public.prepared_stamp_();
DROP TRIGGER IF EXISTS prepared_equipment_stamp ON public.prepared_equipment;
CREATE TRIGGER prepared_equipment_stamp BEFORE INSERT OR UPDATE ON public.prepared_equipment
  FOR EACH ROW EXECUTE FUNCTION public.prepared_stamp_();
DROP TRIGGER IF EXISTS prepared_plan_stamp ON public.prepared_plan;
CREATE TRIGGER prepared_plan_stamp BEFORE INSERT OR UPDATE ON public.prepared_plan
  FOR EACH ROW EXECUTE FUNCTION public.prepared_stamp_();

-- ── Access: family members only ──────────────────────────────────────────────
ALTER TABLE public.prepared_household ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prepared_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prepared_plan      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.prepared_household, public.prepared_equipment, public.prepared_plan FROM PUBLIC, anon;
REVOKE TRUNCATE ON public.prepared_household, public.prepared_equipment, public.prepared_plan FROM authenticated;
REVOKE DELETE ON public.prepared_household, public.prepared_plan FROM authenticated;

DO $$
DECLARE
  t TEXT;
  p TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['prepared_household', 'prepared_equipment', 'prepared_plan'] LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p, t);
    END LOOP;
    EXECUTE format('CREATE POLICY "Family members can view" ON public.%I FOR SELECT TO authenticated USING ((SELECT public.elk_is_family_member()))', t);
    EXECUTE format('CREATE POLICY "Family members can add" ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.elk_is_family_member()))', t);
    EXECUTE format('CREATE POLICY "Family members can change" ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.elk_is_family_member())) WITH CHECK ((SELECT public.elk_is_family_member()))', t);
  END LOOP;
  CREATE POLICY "Family members can remove equipment" ON public.prepared_equipment FOR DELETE TO authenticated
    USING ((SELECT public.elk_is_family_member()));
END $$;
