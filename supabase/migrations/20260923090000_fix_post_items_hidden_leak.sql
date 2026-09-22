-- Fix: "Post items are visible with their post" allowed reading post_items for
-- hidden/moderated posts (it only checked the post existed, not its hidden flag
-- or ownership), unlike the sibling posts SELECT policy. Align the two.
DROP POLICY IF EXISTS "Post items are visible with their post" ON public.post_items;

CREATE POLICY "Post items are visible with their post" ON public.post_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_id
        AND (p.hidden = false OR p.user_id = (select auth.uid()))
    )
  );
