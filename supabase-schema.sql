-- ═══════════════════════════════════════════════════════════════════════════
-- ELK Inventory — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Profiles (one row per auth user) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email      TEXT,
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'viewer',  -- 'admin' | 'editor' | 'viewer'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create a profile row when a new user signs up via magic link
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read any profile"
  ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- ── Inventory items ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id               TEXT PRIMARY KEY,            -- keep existing string IDs (e.g. "t-drill-1")
  name             TEXT NOT NULL,
  item_class       TEXT NOT NULL DEFAULT 'tool',
  lifecycle_state  TEXT NOT NULL DEFAULT 'available',
  domain           TEXT,
  current_zone     TEXT NOT NULL DEFAULT 'unknown',
  recommended_zone TEXT NOT NULL DEFAULT 'unknown',
  location_detail  TEXT DEFAULT '',
  collection_id    TEXT,
  container_id     TEXT,
  project          TEXT,
  tags             TEXT[]  DEFAULT '{}',
  quantity         INTEGER NOT NULL DEFAULT 1,
  photo_path       TEXT    DEFAULT '',
  photo_type       TEXT,
  notes            TEXT    DEFAULT '',
  power_type       TEXT,
  battery_platform TEXT,
  brand            TEXT,
  category         TEXT,
  subcategory      TEXT,
  attributes       JSONB   DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Full-text search index (used for fast inventory search later)
CREATE INDEX IF NOT EXISTS inventory_items_fts
  ON public.inventory_items
  USING GIN (to_tsvector('english', name || ' ' || COALESCE(notes, '') || ' ' || COALESCE(category, '')));

-- RLS on, no policies here = nobody gets in. Access is granted ONLY to
-- family members, by supabase-family-access.sql (run it next). This project
-- is shared with another app, so "any signed-in user" is NOT a safe rule.
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

-- ── Purchase drafts (Purchase Intake V1 — see docs/purchase-intake-v1-spec.md) ─
-- Raw pasted-text captures land here first. Nothing here is real inventory
-- until a human approves it (see approveDraft() in src/lib/purchaseDrafts.ts).
CREATE TABLE IF NOT EXISTS public.purchase_drafts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source
  raw_text          TEXT NOT NULL,

  -- Extracted / suggested fields — every one is nullable. Extraction must
  -- never block capture (see spec §2/§7).
  suggested_name           TEXT,
  suggested_quantity       INTEGER,
  suggested_brand          TEXT,
  suggested_vendor         TEXT,
  suggested_price          NUMERIC(10,2),
  suggested_currency       TEXT DEFAULT 'USD',
  suggested_purchase_date  DATE,
  product_url              TEXT,
  suggested_collection_id  TEXT,
  suggested_project        TEXT,
  suggested_model          TEXT,
  suggested_category       TEXT,

  -- Review state
  status            TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'saved-for-later' | 'rejected'
  resolved_item_id  TEXT REFERENCES public.inventory_items(id) ON DELETE SET NULL,

  -- Audit
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Member-only policies: see supabase-family-access.sql.
ALTER TABLE public.purchase_drafts ENABLE ROW LEVEL SECURITY;

-- Provenance: which draft (if any) an inventory item was approved from.
-- Soft reference only — deleting a draft never deletes the item it produced.
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS source_draft_id UUID REFERENCES public.purchase_drafts(id) ON DELETE SET NULL;

-- Multi-product capture (Amazon order pages, etc. — see src/lib/captureAdapters.ts)
-- added two more best-effort suggested fields. Needed as an explicit ALTER on
-- top of the CREATE TABLE above so this file stays safe to re-run against a
-- database that already has purchase_drafts from before this addition.
ALTER TABLE public.purchase_drafts
  ADD COLUMN IF NOT EXISTS suggested_model    TEXT,
  ADD COLUMN IF NOT EXISTS suggested_category TEXT;

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this schema (new project):
--   1. Run supabase-family-access.sql, then add yourself (instructions at
--      the bottom of that file), then run supabase-pantry.sql
--   2. Copy your Supabase project URL + anon key into .env.local
--   3. npm run dev — the app will auto-seed items into the DB on first load
--
-- On the existing production project this file does NOT need re-running.
-- (The profiles policies above have no DROP IF EXISTS, so a re-run stops at
-- the first one; they are left as-is because public.profiles may also be
-- used by the other app in this project.)
