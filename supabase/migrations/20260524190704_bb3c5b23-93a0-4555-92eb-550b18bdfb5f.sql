-- Shared timestamp trigger fn (idempotent)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Brands
CREATE TABLE public.brands (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  website_url TEXT,
  affiliate_network TEXT,
  commission_rate NUMERIC(5,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view active brands"
  ON public.brands FOR SELECT TO authenticated USING (status = 'active');

-- Products
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  affiliate_link TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  seasonal_palettes TEXT[] NOT NULL DEFAULT '{}',
  body_shapes TEXT[] NOT NULL DEFAULT '{}',
  category TEXT NOT NULL,
  date_added TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_brand ON public.products(brand_id);
CREATE INDEX idx_products_category ON public.products(category);
CREATE INDEX idx_products_palettes ON public.products USING GIN(seasonal_palettes);
CREATE INDEX idx_products_shapes ON public.products USING GIN(body_shapes);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view products"
  ON public.products FOR SELECT TO authenticated USING (true);

-- User favorites
CREATE TABLE public.user_favorites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);
CREATE INDEX idx_favorites_user ON public.user_favorites(user_id);
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own favorites"
  ON public.user_favorites FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own favorites"
  ON public.user_favorites FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own favorites"
  ON public.user_favorites FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed
WITH b AS (
  INSERT INTO public.brands (name, website_url, affiliate_network, commission_rate, status) VALUES
    ('Aritzia', 'https://www.aritzia.com', 'Rakuten', 5.00, 'active'),
    ('COS', 'https://www.cos.com', 'AWIN', 4.00, 'active'),
    ('Reformation', 'https://www.thereformation.com', 'Impact', 6.00, 'active'),
    ('Everlane', 'https://www.everlane.com', 'Impact', 5.00, 'active'),
    ('Ganni', 'https://www.ganni.com', 'AWIN', 6.00, 'active'),
    ('Net-a-Porter', 'https://www.net-a-porter.com', 'Rakuten', 8.00, 'active')
  RETURNING id, name
)
INSERT INTO public.products (brand_id, title, image_url, affiliate_link, price, currency, seasonal_palettes, body_shapes, category)
SELECT b.id, p.title, p.image_url, p.affiliate_link, p.price, 'USD', p.palettes, p.shapes, p.category
FROM b JOIN (VALUES
  ('Aritzia','Effortless Wool Coat','https://images.unsplash.com/photo-1539533113208-f6df8cc8b543?w=800','https://www.aritzia.com',248.00,ARRAY['Deep Winter','Deep Autumn'],ARRAY['Hourglass','Rectangle'],'Outerwear'),
  ('Aritzia','Contour Knit Tank','https://images.unsplash.com/photo-1554568218-0f1715e72254?w=800','https://www.aritzia.com',48.00,ARRAY['Clear Winter','Cool Summer'],ARRAY['Hourglass','Pear'],'Tops'),
  ('COS','Architectural Trouser','https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=800','https://www.cos.com',135.00,ARRAY['Soft Summer','Cool Winter'],ARRAY['Rectangle','Inverted Triangle'],'Bottoms'),
  ('COS','Minimal Oversized Shirt','https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=800','https://www.cos.com',95.00,ARRAY['Light Summer','Soft Autumn'],ARRAY['Inverted Triangle','Apple'],'Tops'),
  ('Reformation','Bias Slip Midi Dress','https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=800','https://www.thereformation.com',248.00,ARRAY['Light Spring','Warm Spring'],ARRAY['Hourglass','Pear'],'Dresses'),
  ('Reformation','Linen High-Rise Short','https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800','https://www.thereformation.com',98.00,ARRAY['Warm Spring','Light Spring'],ARRAY['Pear','Hourglass'],'Bottoms'),
  ('Everlane','The Way-High Jean','https://images.unsplash.com/photo-1542272604-787c3835535d?w=800','https://www.everlane.com',98.00,ARRAY['Cool Winter','Soft Summer'],ARRAY['Rectangle','Pear'],'Bottoms'),
  ('Everlane','Organic Cotton Tee','https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800','https://www.everlane.com',30.00,ARRAY['Light Summer','Light Spring'],ARRAY['Hourglass','Rectangle','Pear','Inverted Triangle','Apple'],'Tops'),
  ('Ganni','Printed Mesh Top','https://images.unsplash.com/photo-1485518882345-15568b007407?w=800','https://www.ganni.com',175.00,ARRAY['Clear Spring','Clear Winter'],ARRAY['Hourglass','Inverted Triangle'],'Tops'),
  ('Ganni','Recycled Leather Skirt','https://images.unsplash.com/photo-1583496661160-fb5886a13d44?w=800','https://www.ganni.com',395.00,ARRAY['Deep Autumn','Deep Winter'],ARRAY['Hourglass','Pear'],'Bottoms'),
  ('Net-a-Porter','Cashmere Crewneck','https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=800','https://www.net-a-porter.com',520.00,ARRAY['Soft Autumn','Soft Summer'],ARRAY['Rectangle','Hourglass'],'Tops'),
  ('Net-a-Porter','Silk Tailored Blazer','https://images.unsplash.com/photo-1591047139756-eb1a3a1a3a5b?w=800','https://www.net-a-porter.com',890.00,ARRAY['Deep Winter','Cool Winter'],ARRAY['Inverted Triangle','Hourglass'],'Outerwear')
) AS p(brand_name, title, image_url, affiliate_link, price, palettes, shapes, category)
ON b.name = p.brand_name;