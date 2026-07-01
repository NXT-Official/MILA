
insert into storage.buckets (id, name, public) values ('outfits', 'outfits', true)
on conflict (id) do nothing;

create policy "Outfit images are publicly viewable"
on storage.objects for select
using (bucket_id = 'outfits');

create policy "Users can upload their own outfit images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'outfits' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own outfit images"
on storage.objects for delete
to authenticated
using (bucket_id = 'outfits' and (storage.foldername(name))[1] = auth.uid()::text);
