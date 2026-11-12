-- ═══════════════════════════════════════════════════════════════════════════
-- ELK Inventory — Family invitations — v1
-- Run in: Supabase Dashboard → SQL Editor → paste → Run. Safe to re-run.
-- Run AFTER supabase-family-access.sql.
--
-- Replaces the manual "sign in once, then the owner runs an INSERT" step with
-- an invite the owner makes from inside ELK (Family page):
--
--   owner invites an email  →  that person signs in with an emailed link
--   →  ELK matches the invite to their account and adds them to the family.
--
-- Nothing here makes inventory more public. Reading/writing inventory still
-- requires a row in elk_family_members; an invite alone grants nothing, and
-- the claim step refuses accounts that have a password (open sign-up means a
-- stranger could otherwise register a password under an invited email).
-- Touches only ELK's own tables; no data is dropped or rewritten.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.elk_family_members') IS NULL THEN
    RAISE EXCEPTION 'Run supabase-family-access.sql first — nothing changed.';
  END IF;
  IF to_regclass('public.elk_family_invites') IS NOT NULL
     AND COALESCE(obj_description(to_regclass('public.elk_family_invites'), 'pg_class'), '')
         NOT LIKE 'elk-inventory:%' THEN
    RAISE EXCEPTION 'public.elk_family_invites exists but was not created by ELK Inventory — stopping, nothing changed.';
  END IF;
END $$;

-- ── Owner flag ───────────────────────────────────────────────────────────────
ALTER TABLE public.elk_family_members ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;

-- If nobody is marked owner yet, the earliest member (the person who set the
-- family up) becomes the owner. Change it any time:
--   UPDATE public.elk_family_members SET is_owner = (user_id = '<uuid>');
UPDATE public.elk_family_members SET is_owner = TRUE
 WHERE user_id = (SELECT user_id FROM public.elk_family_members ORDER BY added_at, user_id LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM public.elk_family_members WHERE is_owner);

-- ── Invites ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.elk_family_invites (
  email         TEXT PRIMARY KEY CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name  TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 60),
  invited_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  claimed_at    TIMESTAMPTZ
);
COMMENT ON TABLE public.elk_family_invites IS
  'elk-inventory: pending family invitations. Reached only through the elk_*invite* functions.';
ALTER TABLE public.elk_family_invites ENABLE ROW LEVEL SECURITY;   -- no policies: API roles see nothing directly
REVOKE ALL ON public.elk_family_invites FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.elk_is_family_owner()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.elk_family_members WHERE user_id = auth.uid() AND is_owner); $$;

-- Owner: invite (or re-invite / refresh) an email.
CREATE OR REPLACE FUNCTION public.elk_invite_family_member(p_email TEXT, p_name TEXT DEFAULT NULL)
RETURNS TABLE (email TEXT, display_name TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE e TEXT := lower(btrim(COALESCE(p_email, '')));
        n TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
BEGIN
  IF NOT public.elk_is_family_owner() THEN
    RAISE EXCEPTION 'Only the ELK owner can invite people' USING ERRCODE = '42501';
  END IF;
  IF e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'That does not look like an email address' USING ERRCODE = '22023';
  END IF;
  IF n IS NOT NULL AND length(n) > 60 THEN
    RAISE EXCEPTION 'Name is too long (60 characters max)' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  INSERT INTO public.elk_family_invites AS i (email, display_name, invited_by)
  VALUES (e, n, auth.uid())
  ON CONFLICT ON CONSTRAINT elk_family_invites_pkey DO UPDATE
     SET display_name = COALESCE(EXCLUDED.display_name, i.display_name),
         invited_by = EXCLUDED.invited_by, invited_at = NOW(),
         expires_at = NOW() + INTERVAL '30 days', claimed_at = NULL
  RETURNING i.email, i.display_name, i.expires_at;
END $$;

-- Owner: see invites; withdraw one.
CREATE OR REPLACE FUNCTION public.elk_list_family_invites()
RETURNS TABLE (email TEXT, display_name TEXT, invited_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, claimed_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.elk_is_family_owner() THEN
    RAISE EXCEPTION 'Only the ELK owner can see invitations' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT i.email, i.display_name, i.invited_at, i.expires_at, i.claimed_at
                 FROM public.elk_family_invites i ORDER BY i.invited_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.elk_revoke_family_invite(p_email TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE n INT;
BEGIN
  IF NOT public.elk_is_family_owner() THEN
    RAISE EXCEPTION 'Only the ELK owner can withdraw invitations' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.elk_family_invites WHERE email = lower(btrim(p_email)) AND claimed_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;

-- Caller: "I just signed in — is there an invite for me?" Returns
-- 'member' (already in), 'joined' (invite accepted now) or 'none'.
-- Only the signed-in account's OWN email is ever matched, and only when the
-- account has no password and has signed in through an emailed link.
CREATE OR REPLACE FUNCTION public.elk_claim_family_invite()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE uid UUID := auth.uid();
        inv public.elk_family_invites%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RETURN 'none'; END IF;
  IF EXISTS (SELECT 1 FROM public.elk_family_members WHERE user_id = uid) THEN RETURN 'member'; END IF;

  SELECT i.* INTO inv
    FROM public.elk_family_invites i
    JOIN auth.users u ON lower(u.email) = i.email
   WHERE u.id = uid
     AND COALESCE(u.encrypted_password, '') = ''
     AND u.last_sign_in_at IS NOT NULL
     AND i.claimed_at IS NULL AND i.expires_at > NOW();
  IF NOT FOUND THEN RETURN 'none'; END IF;

  INSERT INTO public.elk_family_members (user_id, display_name)
  VALUES (uid, inv.display_name) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.elk_family_invites SET claimed_at = NOW() WHERE email = inv.email;
  RETURN 'joined';
END $$;

-- Function privileges: signed-in accounts only (each function re-checks who is calling).
REVOKE ALL ON FUNCTION public.elk_is_family_owner(), public.elk_claim_family_invite(),
  public.elk_invite_family_member(TEXT, TEXT), public.elk_list_family_invites(),
  public.elk_revoke_family_invite(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.elk_is_family_owner(), public.elk_claim_family_invite(),
  public.elk_invite_family_member(TEXT, TEXT), public.elk_list_family_invites(),
  public.elk_revoke_family_invite(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
