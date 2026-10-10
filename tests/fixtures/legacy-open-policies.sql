-- The access rules production had before supabase-family-access.sql
-- (supabase-schema.sql as of f5b7b15): every signed-in account could read and
-- write ELK's tables. Used by tests/family-access.test.ts to prove the
-- migration closes them on an existing database.
CREATE POLICY "Authenticated users can view items"
  ON public.inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert items"
  ON public.inventory_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update items"
  ON public.inventory_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete items"
  ON public.inventory_items FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view drafts"
  ON public.purchase_drafts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert drafts"
  ON public.purchase_drafts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update drafts"
  ON public.purchase_drafts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete drafts"
  ON public.purchase_drafts FOR DELETE TO authenticated USING (true);
