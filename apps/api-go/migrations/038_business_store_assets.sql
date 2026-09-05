-- R18.x: Business Store Asset Persistence
-- closes the merchant surface gap: hardcoded 'Bonsaidon', '48 张相册',
-- '8,426 关注' etc were never backed by server storage. This migration
-- gives every store: photo gallery (album), editable storefront lines,
-- and member listing projection.

CREATE TABLE IF NOT EXISTS business.store_photos (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES business.stores(id) ON DELETE CASCADE,
    business_id TEXT NOT NULL REFERENCES business.accounts(id),
    uploaded_by TEXT NOT NULL,
    asset_path TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    -- R18.x: tripwire STORE-PHOTO-001 — asset_path must look like a Proxy
    -- asset path, never a free-text or full external URL. PLATFORM_AI
    -- persona rule stays: any ai-* path means AI-rendered avatar, not real.
    CHECK (asset_path ~ '^ai-personas/|^assets/|^store/' OR asset_path LIKE 'photo_%')
);

CREATE INDEX IF NOT EXISTS idx_store_photos_store ON business.store_photos (store_id, sort_order, created_at DESC);

CREATE TABLE IF NOT EXISTS business.store_lines (
    store_id TEXT PRIMARY KEY REFERENCES business.stores(id) ON DELETE CASCADE,
    business_id TEXT NOT NULL REFERENCES business.accounts(id),
    logo_asset_path TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    hours_json TEXT NOT NULL DEFAULT '{}',
    contact_phone TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS business.member_directory (
    business_id TEXT NOT NULL REFERENCES business.accounts(id),
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_member_directory_business ON business.member_directory (business_id, status);

-- R18.x: spend projection rolled up to day for the sales center dashboard
-- (sales page used hardcoded 12.6tr / 148 订单 / 85K 客单 — these will
-- now derive from real rollups).
CREATE TABLE IF NOT EXISTS business.spend_daily (
    business_id TEXT NOT NULL REFERENCES business.accounts(id),
    bucket_date DATE NOT NULL,
    order_count INTEGER NOT NULL DEFAULT 0,
    gross_minor BIGINT NOT NULL DEFAULT 0,
    new_customer_count INTEGER NOT NULL DEFAULT 0,
    returning_customer_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (business_id, bucket_date)
);

CREATE INDEX IF NOT EXISTS idx_spend_daily_business_recent ON business.spend_daily (business_id, bucket_date DESC);