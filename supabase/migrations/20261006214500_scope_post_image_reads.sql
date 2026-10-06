-- Scope reads of the private `posts` bucket (QA audit F-BE-001).
--
-- The previous SELECT policy was bucket-wide: any authenticated member could
-- list EVERY post image and read hidden/orphaned ones (verified: a non-owner
-- listed all 16 objects and fetched a hidden post's image). A member may now
-- read an object when it sits in their own folder, or when the post that
-- references it is visible to the community. Moderation paths use the
-- service role and are unaffected.

drop policy if exists "Authenticated can view post images" on storage.objects;

create policy "Post images: own folder or visible post"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'posts'
    and (
      ((select auth.uid())::text = (storage.foldername(name))[1])
      or exists (
        select 1
        from public.posts p
        where p.hidden = false
          and (p.image_url_front = objects.name or p.image_url_back = objects.name)
      )
    )
  );

-- The EXISTS runs per listed object; give it covering indexes.
create index if not exists posts_image_url_front_idx on public.posts (image_url_front);
create index if not exists posts_image_url_back_idx on public.posts (image_url_back);
