-- Shop This Look recommended items unrelated to the AI-generated outfit for
-- male users: matchLookProducts() had no way to filter by gender, and the
-- catalog was entirely womenswear-seeded. Adds a gender column, backfills
-- the existing rows, and seeds real menswear inventory (same placeholder-data
-- pattern as the rest of this seed catalog: brand homepage as affiliate_link,
-- generic Unsplash imagery, verification_status = 'unverified').

alter table public.products
  add column gender text not null default 'Unisex'
  check (gender = any (array['Male'::text, 'Female'::text, 'Unisex'::text]));

comment on column public.products.gender is 'Gender presentation the garment is styled for. Male/Female items are excluded from opposite-gender shoppable-pick matching; Unisex items match everyone.';

update public.products set gender = 'Female'
where title in ('Linen High-Rise Short', 'Recycled Leather Skirt', 'The Way-High Jean', 'Bias Slip Midi Dress', 'Contour Knit Tank', 'Printed Mesh Top');

update public.products set gender = 'Unisex'
where title in ('Architectural Trouser', 'Effortless Wool Coat', 'Silk Tailored Blazer', 'Cashmere Crewneck', 'Minimal Oversized Shirt', 'Organic Cotton Tee');

insert into public.products (brand_id, title, description, image_url, affiliate_link, price, currency, seasonal_palettes, body_shapes, category, gender, verification_status, in_stock)
values
  ((select id from public.brands where name = 'COS'), 'Merino Half-Zip Sweater', 'Fine-gauge merino half-zip with a ribbed stand collar.', 'https://images.unsplash.com/photo-1516257984-b1b4d707412e?w=800', 'https://www.cos.com', 145.00, 'USD', array['Deep Autumn','Soft Autumn'], array['Rectangle','Inverted Triangle'], 'Tops', 'Male', 'unverified', true),
  ((select id from public.brands where name = 'Everlane'), 'Garment-Dyed Oxford Shirt', 'Softly structured oxford with a relaxed, garment-dyed finish.', 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=800', 'https://www.everlane.com', 78.00, 'USD', array['Soft Summer','Cool Summer'], array['Rectangle','Apple'], 'Tops', 'Male', 'unverified', true),
  ((select id from public.brands where name = 'Everlane'), 'Heavyweight Pocket Tee', 'Substantial cotton tee with a structured chest pocket.', 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800', 'https://www.everlane.com', 38.00, 'USD', array['Light Spring','Warm Spring'], array['Rectangle','Inverted Triangle','Apple'], 'Tops', 'Male', 'unverified', true),
  ((select id from public.brands where name = 'COS'), 'Tapered Wool Trouser', 'Clean-lined tapered trouser in a fine wool blend.', 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=800', 'https://www.cos.com', 165.00, 'USD', array['Cool Winter','Deep Winter'], array['Rectangle','Inverted Triangle'], 'Bottoms', 'Male', 'unverified', true),
  ((select id from public.brands where name = 'Everlane'), 'Straight-Leg Selvedge Jean', 'Rigid selvedge denim in a straight, ankle-length cut.', 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=800', 'https://www.everlane.com', 128.00, 'USD', array['Soft Autumn','Deep Autumn'], array['Rectangle','Apple'], 'Bottoms', 'Male', 'unverified', true),
  ((select id from public.brands where name = 'COS'), 'Pleated Wide-Leg Chino', 'Single-pleat chino with a fluid wide-leg drape.', 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=800', 'https://www.cos.com', 110.00, 'USD', array['Light Summer','Soft Summer'], array['Inverted Triangle','Apple'], 'Bottoms', 'Male', 'unverified', true),
  ((select id from public.brands where name = 'COS'), 'Technical Wool Overcoat', 'Boxy, water-resistant wool overcoat with a clean collar.', 'https://images.unsplash.com/photo-1539533113208-f6df8cc8b543?w=800', 'https://www.cos.com', 350.00, 'USD', array['Deep Winter','Cool Winter'], array['Rectangle','Inverted Triangle'], 'Outerwear', 'Male', 'unverified', true),
  ((select id from public.brands where name = 'Everlane'), 'Quilted Field Jacket', 'Lightweight quilted jacket built for shoulder-season layering.', 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800', 'https://www.everlane.com', 198.00, 'USD', array['Soft Autumn','Warm Spring'], array['Rectangle','Apple'], 'Outerwear', 'Male', 'unverified', true);
