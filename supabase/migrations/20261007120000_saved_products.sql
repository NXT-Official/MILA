-- Saved pieces (Wave 2, R3): a member bookmarks a product Mila recommended
-- (Shop This Look, Dupe Hunter, a feed post's Shop tab) and comes back to it
-- later on /saved.
--
-- ADDITIVE ONLY: one new table, its indexes, RLS policies, grants, one new
-- trigger function and one trigger. Nothing existing is altered or dropped.
-- The unused legacy public.user_favorites table is deliberately left as is.
--
-- The snapshot (title, image_url, product_url, price, currency, category,
-- brand) is written by a BEFORE INSERT trigger from public.products, so a
-- saved piece still renders after the catalog row is deleted (product_id goes
-- NULL, the snapshot stays). Whatever snapshot the client sends is ignored and
-- overwritten: the client never decides what a saved piece claims to be.
--
-- HOW TO APPLY (owner; production credentials are not in this repo):
--   Run this file once against the project, e.g. `supabase db push` from a
--   linked checkout, or paste it into the Supabase SQL editor and run it.
--   Until it runs, the web app hides every Save button and /saved shows a
--   calm "not available yet" state (PostgREST PGRST205 / Postgres 42P01 are
--   read as "feature unavailable", never shown as an error).
--
-- HOW TO VERIFY:
--   1. SQL editor:
--        select id, user_id, product_id, snapshot, source, outfit_id,
--               post_item_id, created_at
--        from public.saved_products limit 0;
--      succeeds once applied ("relation does not exist" = not applied).
--   2. Anon probe through the REST API with only the anon key:
--        GET /rest/v1/saved_products?select=id&limit=0
--      applied     -> 401, code 42501 (permission denied: anon has no grant)
--      not applied -> 404, code PGRST205 (table not in the schema cache)
--   3. Signed in as a member, insert {product_id, source: 'look',
--      snapshot: {}} and read it back: snapshot holds the product's title,
--      price and link, not {}. Inserting with another member's user_id is
--      refused (42501, RLS).

create table public.saved_products (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  snapshot jsonb not null,
  source text not null check (source in ('look', 'dupe', 'post_item')),
  outfit_id uuid references public.outfits(id) on delete set null,
  post_item_id uuid references public.post_items(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

comment on table public.saved_products is
  'Recommended products a member saved to revisit (R3). snapshot is trigger-filled from products; client values are ignored.';

-- The Saved pieces list: own rows, newest first.
create index saved_products_user_created_idx
  on public.saved_products (user_id, created_at desc);

-- Foreign keys with ON DELETE SET NULL scan the referencing column when the
-- parent row goes; index each so deleting a product, look or post stays cheap.
create index saved_products_product_idx
  on public.saved_products (product_id) where product_id is not null;
create index saved_products_outfit_idx
  on public.saved_products (outfit_id) where outfit_id is not null;
create index saved_products_post_item_idx
  on public.saved_products (post_item_id) where post_item_id is not null;

alter table public.saved_products enable row level security;

create policy "Users view own saved products" on public.saved_products
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- outfit_id may only point at the member's own look (outfits RLS hides every
-- other member's rows from this subquery). post_item_id may point at anyone's
-- post: saving a piece from another member's post is the feature.
create policy "Users insert own saved products" on public.saved_products
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      outfit_id is null
      or exists (
        select 1 from public.outfits o
        where o.id = outfit_id and o.user_id = (select auth.uid())
      )
    )
  );

create policy "Users delete own saved products" on public.saved_products
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- No UPDATE grant: a saved piece is saved or removed, never edited.
revoke all on public.saved_products from public, anon, authenticated;
grant select, insert, delete on public.saved_products to authenticated;
grant all on public.saved_products to service_role;

-- SECURITY DEFINER because members cannot be relied on to read every column
-- the snapshot needs: products/brands use column-level SELECT grants (see
-- 20260916110000_add_product_shop_metadata.sql) and brands RLS shows active
-- brands only. The join below mirrors that brands rule, so the snapshot never
-- carries a brand name the member could not read directly. search_path is
-- empty and every name is schema-qualified.
--
-- EXECUTE is left at the default on purpose: a function returning trigger
-- cannot be called directly (Postgres refuses it outside a trigger, and
-- PostgREST does not expose it as RPC), and the inserting member's role must
-- be able to fire it.
create or replace function public.saved_products_fill_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  select jsonb_build_object(
    'title', p.title,
    'image_url', p.image_url,
    'product_url', p.affiliate_link,
    'price', p.price,
    'currency', p.currency,
    'category', p.category,
    'brand', b.name
  )
  into v_snapshot
  from public.products p
  left join public.brands b on b.id = p.brand_id and b.status = 'active'
  where p.id = new.product_id;

  if v_snapshot is null then
    raise exception 'saved_products: product % does not exist', new.product_id
      using errcode = '23503';
  end if;

  new.snapshot := v_snapshot;
  return new;
end;
$$;

create trigger saved_products_fill_snapshot
  before insert on public.saved_products
  for each row execute function public.saved_products_fill_snapshot();
