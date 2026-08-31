-- 038_display_identity.sql
-- Lotus RFC §1: DisplayIdentity PG persistence.
-- One UserAccount → up to 3 active DisplayIdentities (PUBLIC/PRIVATE/BURNER).
-- BURNER auto-expires 7d via ExpiresAt; worker sweeps ExpiresAt <= NOW() → BurnedAt.

CREATE TABLE IF NOT EXISTS identity.display_identities (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES identity.user_accounts(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('PUBLIC','PRIVATE','BURNER')),
    alias TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_ref TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    burned_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1
);

-- alias uniqueness per owner (case-insensitive, matches ValidateAlias + aliasIndexKey)
CREATE UNIQUE INDEX IF NOT EXISTS idx_display_identities_owner_alias
    ON identity.display_identities (owner_id, lower(alias));

CREATE INDEX IF NOT EXISTS idx_display_identities_owner
    ON identity.display_identities (owner_id);

-- burner sweep index
CREATE INDEX IF NOT EXISTS idx_display_identities_expires
    ON identity.display_identities (expires_at)
    WHERE type = 'BURNER' AND burned_at IS NULL AND expires_at IS NOT NULL;

COMMENT ON TABLE identity.display_identities IS 'Lotus RFC §1: per-UserAccount personas (PUBLIC/PRIVATE/BURNER), max 3 active, BURNER auto-burns after 7d.';
