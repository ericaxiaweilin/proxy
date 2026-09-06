CREATE TABLE IF NOT EXISTS business.store_products (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES business.stores(id),
  business_id TEXT NOT NULL REFERENCES business.accounts(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_minor BIGINT NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'VND',
  photo_asset_path TEXT NOT NULL DEFAULT '',
  available BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS business_products_store_idx ON business.store_products(store_id, sort_order, created_at);
