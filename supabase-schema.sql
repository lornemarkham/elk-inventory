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

-- RLS: all authenticated users can read + write
-- (For friends & family launch — everyone sees the shared inventory)
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view items"
  ON public.inventory_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert items"
  ON public.inventory_items FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update items"
  ON public.inventory_items FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete items"
  ON public.inventory_items FOR DELETE TO authenticated USING (true);

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this schema:
--   1. Copy your Supabase project URL + anon key into .env.local
--   2. npm run dev — the app will auto-seed items into the DB on first load
