-- P0: a refresh token is not sufficient by itself. Every session token is
-- bound to a second, installation-scoped credential held in Keychain/Keystore.
ALTER TABLE identity.session_tokens
    ADD COLUMN IF NOT EXISTS device_credential_hash TEXT;

-- Existing sessions predate device proof and cannot be upgraded safely because
-- the server never stores raw credentials. Force a one-time verified login.
DELETE FROM identity.session_tokens
WHERE device_credential_hash IS NULL OR device_credential_hash = '';

ALTER TABLE identity.session_tokens
    ALTER COLUMN device_credential_hash SET NOT NULL;

ALTER TABLE identity.session_tokens
    DROP CONSTRAINT IF EXISTS identity_device_credential_hash_format_check;
ALTER TABLE identity.session_tokens
    ADD CONSTRAINT identity_device_credential_hash_format_check
    CHECK (device_credential_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE identity.device_registrations
    ADD COLUMN IF NOT EXISTS credential_hash TEXT;

ALTER TABLE identity.device_registrations
    DROP CONSTRAINT IF EXISTS identity_device_credential_hash_check;
ALTER TABLE identity.device_registrations
    ADD CONSTRAINT identity_device_credential_hash_check
    CHECK (credential_hash IS NULL OR credential_hash ~ '^[0-9a-f]{64}$');
