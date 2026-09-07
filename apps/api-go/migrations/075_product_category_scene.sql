ALTER TABLE business.store_products ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';
ALTER TABLE business.store_products ADD COLUMN IF NOT EXISTS scene TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS business_products_category_idx ON business.store_products(store_id, category, sort_order);
