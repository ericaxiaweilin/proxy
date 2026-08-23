-- One passwordless identifier owns exactly one Proxy account per channel.
-- Existing rows remain valid; duplicates must be reconciled before this index
-- can be applied in a populated production database.
CREATE UNIQUE INDEX IF NOT EXISTS login_identities_channel_identifier_unique
    ON identity.login_identities (channel, identifier)
    WHERE channel IS NOT NULL AND identifier IS NOT NULL;
