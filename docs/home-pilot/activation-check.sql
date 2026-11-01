-- ═══════════════════════════════════════════════════════════════════════════
-- ELK Inventory — activation check (READ-ONLY)
-- Run in: Supabase Dashboard → SQL Editor → paste → Run
--
-- One SELECT over the system catalogs. It creates, changes and deletes
-- nothing, and is safe to run any number of times, before or after the
-- migrations. It answers: which of supabase-family-access.sql and
-- supabase-pantry.sql (and which Pantry version) are already in production,
-- who is on the family list, and whether any ELK table is still open.
--
-- There is no migration-history table in this project (the SQL files are run
-- by hand), so the catalogs are the only record. Read the "expect" column.
-- ═══════════════════════════════════════════════════════════════════════════
WITH
elk_tables(t) AS (VALUES ('inventory_items'), ('purchase_drafts'), ('elk_family_members'),
                         ('stock_lots'), ('stock_movements'), ('inventory_feedback'),
                         ('pantry_shopping_items')),
fns(sig) AS (VALUES ('public.elk_is_family_member()'),
                    ('public.pantry_receive(text,integer,text,date,date,text,text,uuid)'),
                    ('public.pantry_use(text,integer,uuid,uuid,text)'),
                    ('public.pantry_use(text,integer,uuid,uuid)'),
                    ('public.pantry_undo(uuid)'),
                    ('public.pantry_set_low_stock(text,integer)'),
                    ('public.pantry_move(uuid,integer,text,uuid)'),
                    ('public.pantry_shopping_add(text[],text,text)')),
counted(t) AS (VALUES ('inventory_items'), ('purchase_drafts'), ('elk_family_members'),
                      ('stock_lots'), ('stock_movements'), ('pantry_shopping_items'))
SELECT * FROM (
  -- 1. Tables: exists? owner? ELK marker? RLS on?
  SELECT 1 AS n, 'table ' || e.t AS check_name,
         CASE WHEN c.oid IS NULL THEN 'missing'
              ELSE 'owner=' || pg_get_userbyid(c.relowner)
                   || ' rls=' || c.relrowsecurity
                   || ' marker=' || (COALESCE(obj_description(c.oid, 'pg_class'), '') LIKE 'elk-inventory:%')
         END AS result,
         CASE WHEN e.t IN ('inventory_items', 'purchase_drafts')
              THEN 'owner=postgres; rls=true'
              ELSE 'missing before migration; after: rls=true marker=true' END AS expect
    FROM elk_tables e
    LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || e.t)

  -- 2. Functions (pantry_move / pantry_shopping_add = Pantry v2, commit 8bf1753)
  UNION ALL
  SELECT 2, 'function ' || f.sig,
         CASE WHEN to_regprocedure(f.sig) IS NULL THEN 'missing' ELSE 'present' END,
         CASE WHEN f.sig = 'public.pantry_use(text,integer,uuid,uuid)'
              THEN 'missing once v2 has run (replaced by the 5-argument version)'
              ELSE 'present after migration' END
    FROM fns f

  -- 3. Guard trigger on inventory_items
  UNION ALL
  SELECT 3, 'trigger pantry_guard_item',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                            WHERE tgname = 'pantry_guard_item'
                              AND tgrelid = to_regclass('public.inventory_items'))
              THEN 'present' ELSE 'missing' END,
         'present after supabase-pantry.sql'

  -- 4. Movement kinds allowed (v1 had 4 kinds; v2 adds wasted and moved)
  UNION ALL
  SELECT 4, 'stock_movements kinds',
         COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                    WHERE conname = 'stock_movements_kind_check'
                      AND conrelid = to_regclass('public.stock_movements')), 'n/a'),
         'includes wasted and moved after v2'

  -- 5. Policies on ELK tables that do NOT go through elk_is_family_member().
  --    Before family access: the old "any signed-in user" policies show here.
  --    After: must be 0 rows' worth, i.e. result = 0.
  UNION ALL
  SELECT 5, 'policies not member-gated',
         (SELECT count(*)::text || COALESCE(': ' || string_agg(tablename || '.' || policyname, ', '), '')
            FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename IN (SELECT t FROM elk_tables)
             AND COALESCE(qual, '') NOT LIKE '%elk_is_family_member%'
             AND COALESCE(with_check, '') NOT LIKE '%elk_is_family_member%'),
         '0 after supabase-family-access.sql'

  -- 6. Row counts (only for tables that exist). Counts only, no row contents.
  UNION ALL
  SELECT 6, 'rows in ' || k.t,
         CASE WHEN to_regclass('public.' || k.t) IS NULL THEN 'n/a'
              ELSE (xpath('/row/c/text()',
                     query_to_xml(format('SELECT count(*) AS c FROM public.%I', k.t), false, true, '')))[1]::text
         END,
         CASE k.t WHEN 'elk_family_members' THEN '>= 1 once you have added yourself'
                  WHEN 'inventory_items'    THEN 'matches your Export file length'
                  ELSE '' END
    FROM counted k
) r
ORDER BY n, check_name;
