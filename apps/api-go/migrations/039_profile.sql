-- R18.x: Profile persistence
-- closes the gap where '编辑主页' in me.tsx wrote only to local
-- SecureStore (Keychain / Keystore) and never reached the server.
-- A row per user_account; upsert key is user_account_id.

CREATE TABLE IF NOT EXISTS identity.profiles (
    user_account_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    handle TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL,
    avatar_path TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL,
    -- avatar_path must look like a Proxy-internal asset path; mirrors
    -- business.store_photos.asset_path CHECK so users can't smuggle in
    -- an external URL or free-form text.
    CHECK (avatar_path = '' OR avatar_path ~ '^ai-personas/|^assets/|^store/|^photo_'),
    CHECK (length(name) BETWEEN 1 AND 60),
    CHECK (length(handle) BETWEEN 1 AND 60),
    CHECK (length(bio) <= 280),
    CHECK (length(city) BETWEEN 1 AND 60)
);

CREATE INDEX IF NOT EXISTS idx_profiles_handle ON identity.profiles (handle);