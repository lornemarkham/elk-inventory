-- ═══════════════════════════════════════════════════════════════════════════
-- ELK Inventory — Family access (explicit membership) — v1
-- Run in: Supabase Dashboard → SQL Editor → paste → Run
-- Run this BEFORE supabase-pantry.sql. Safe to re-run.
--
-- Why: this Supabase project is shared with another app, and email sign-up is
-- open. Until now every signed-in account (including the other app's users,
-- and anyone who signs themselves up) could read and change ELK inventory.
--
-- After this runs, ELK's tables are readable and writable ONLY by accounts
-- listed in public.elk_family_members. Nobody can add themselves: the API
-- roles have no write access to that table at all. The owner adds people
-- from the SQL Editor (see "Adding a family member" at the bottom).
--
-- Touches ONLY ELK's own tables: inventory_items, purchase_drafts, and (when
-- they exist) the pantry tables. It does not drop, rename or rewrite any
-- data, and it does not touch public.profiles, auth.users, its triggers, or
-- any other app's tables.
--
-- Effect the moment it runs: the inventory looks empty to everyone until at
-- least one person is added to elk_family_members. No data is lost.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Name-collision guard ─────────────────────────────────────────────────────
-- If a table with this name already exists and wasn't created by this file,
-- stop rather than adopt (and re-permission) someone else's table.
DO $$
BEGIN
  IF to_regclass('public.elk_family_members') IS NOT NULL
     AND COALESCE(obj_description(to_regclass('public.elk_family_members'), 'pg_class'), '')
         NOT LIKE 'elk-inventory:%' THEN
    RAISE EXCEPTION 'public.elk_family_members exists but was not created by ELK Inventory — stopping, nothing changed.';
  END IF;
END $$;

-- ── Members ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.elk_family_members (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Shown in Pantry history ("Kathy used 2"). Optional.
  display_name  TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 60),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.elk_family_members IS
  'elk-inventory: accounts allowed to use ELK Inventory. Add/remove from the SQL Editor only.';

ALTER TABLE public.elk_family_members ENABLE ROW LEVEL SECURITY;

-- Belt and braces: even if a write policy were added by mistake later, the
-- API roles hold no write privilege on this table.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.elk_family_members FROM PUBLIC, anon, authenticated;

-- ── The one check everything uses ────────────────────────────────────────────
-- SECURITY DEFINER so policies can consult the member list without granting
-- anyone read access to it; empty search_path + qualified names so it can't
-- be redirected. Only says whether the CALLER is a member.
CREATE OR REPLACE FUNCTION public.elk_is_family_member()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.elk_family_members WHERE user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.elk_is_family_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.elk_is_family_member() TO authenticated;

-- Members can see who else is in the family (for names in history). Others see nothing.
DROP POLICY IF EXISTS "Family members can see the family" ON public.elk_family_members;
CREATE POLICY "Family members can see the family"
  ON public.elk_family_members FOR SELECT TO authenticated
  USING ((SELECT public.elk_is_family_member()));

-- ── Lock ELK's tables to members ─────────────────────────────────────────────
-- Policies are OR'ed, so ONE leftover "USING (true)" policy would keep the
-- door open. Remove every policy on ELK's own tables, then add member-only
-- ones. Only these named tables are touched, and the pantry ones only if
-- they carry ELK's "elk-inventory:" marker (set by supabase-pantry.sql).
CREATE OR REPLACE FUNCTION pg_temp.elk_owns_(t TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN t IN ('inventory_items', 'purchase_drafts') THEN to_regclass('public.' || t) IS NOT NULL
    ELSE COALESCE(obj_description(to_regclass('public.' || t), 'pg_class'), '') LIKE 'elk-inventory:%'
  END
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('inventory_items', 'purchase_drafts',
                         'stock_lots', 'stock_movements', 'inventory_feedback')
       AND pg_temp.elk_owns_(tablename)
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_drafts ENABLE ROW LEVEL SECURITY;
-- TRUNCATE ignores RLS; the app never needs it.
REVOKE TRUNCATE ON public.inventory_items, public.purchase_drafts FROM PUBLIC, anon, authenticated;

-- Family members collaborate on one shared inventory: full read/write for
-- members, nothing for anyone else.
CREATE POLICY "Family members can view items"   ON public.inventory_items FOR SELECT TO authenticated
  USING ((SELECT public.elk_is_family_member()));
CREATE POLICY "Family members can add items"    ON public.inventory_items FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.elk_is_family_member()));
CREATE POLICY "Family members can update items" ON public.inventory_items FOR UPDATE TO authenticated
  USING ((SELECT public.elk_is_family_member())) WITH CHECK ((SELECT public.elk_is_family_member()));
CREATE POLICY "Family members can delete items" ON public.inventory_items FOR DELETE TO authenticated
  USING ((SELECT public.elk_is_family_member()));

CREATE POLICY "Family members can view drafts"   ON public.purchase_drafts FOR SELECT TO authenticated
  USING ((SELECT public.elk_is_family_member()));
CREATE POLICY "Family members can add drafts"    ON public.purchase_drafts FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.elk_is_family_member()));
CREATE POLICY "Family members can update drafts" ON public.purchase_drafts FOR UPDATE TO authenticated
  USING ((SELECT public.elk_is_family_member())) WITH CHECK ((SELECT public.elk_is_family_member()));
CREATE POLICY "Family members can delete drafts" ON public.purchase_drafts FOR DELETE TO authenticated
  USING ((SELECT public.elk_is_family_member()));

-- Pantry tables, if supabase-pantry.sql already ran (re-running it also
-- recreates these exact policies).
DO $$
BEGIN
  IF pg_temp.elk_owns_('stock_lots') THEN
    EXECUTE 'CREATE POLICY "Family members can view lots" ON public.stock_lots FOR SELECT TO authenticated USING ((SELECT public.elk_is_family_member()))';
  END IF;
  IF pg_temp.elk_owns_('stock_movements') THEN
    EXECUTE 'CREATE POLICY "Family members can view movements" ON public.stock_movements FOR SELECT TO authenticated USING ((SELECT public.elk_is_family_member()))';
  END IF;
  IF pg_temp.elk_owns_('inventory_feedback') THEN
    EXECUTE 'CREATE POLICY "Family members can send feedback" ON public.inventory_feedback FOR INSERT TO authenticated WITH CHECK ((SELECT public.elk_is_family_member()) AND created_by = (SELECT auth.uid()))';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- Adding a family member (owner only — run in the SQL Editor, never in the app)
--
-- 1. The person signs in once at https://elk-inventory.vercel.app with their
--    email link. (They'll see "not on the family list yet" — that's expected.)
-- 2. Run, with their real email and the name to show:
--
--      INSERT INTO public.elk_family_members (user_id, display_name)
--      SELECT id, 'Their name' FROM auth.users
--       WHERE lower(email) = lower('their@email')
--         AND COALESCE(encrypted_password, '') = ''   -- see warning below
--         AND last_sign_in_at IS NOT NULL
--      ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name
--      RETURNING user_id, display_name;
--
--    Exactly one row should come back. Zero rows = they haven't signed in yet,
--    the email is different, OR the account has a password set.
--
--    WARNING: sign-up in this project is open and auto-confirmed, so anyone
--    can create a password account under someone else's email before that
--    person first signs in, and keep that password. ELK only uses email
--    links, so a family member's account should have no password. If the
--    row is missing because a password is set, don't add it — investigate
--    (Authentication → Users), delete that account, and have them sign in again.
-- 3. They reload the page.
--
-- Removing someone:
--      DELETE FROM public.elk_family_members
--       WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('their@email'));
--
-- Who's in:
--      SELECT u.email, m.display_name, m.added_at
--        FROM public.elk_family_members m JOIN auth.users u ON u.id = m.user_id;
-- ═══════════════════════════════════════════════════════════════════════════
