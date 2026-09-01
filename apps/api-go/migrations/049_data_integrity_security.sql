-- Data integrity/security hardening.
-- NOT VALID keeps deployment compatible with legacy rows while PostgreSQL
-- immediately enforces every constraint for new/updated data. Validation of
-- historical rows is a separate audited operation.

-- One active account identity per normalized email/phone. Without this,
-- concurrent first-login requests can create two users for one identifier.
CREATE UNIQUE INDEX IF NOT EXISTS uq_login_identity_active_identifier
    ON identity.login_identities (channel, lower(identifier))
    WHERE status = 'ACTIVE' AND channel IS NOT NULL AND identifier IS NOT NULL;

-- Token lookup must resolve to exactly one session.
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_tokens_access_hash
    ON identity.session_tokens (access_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_tokens_refresh_hash
    ON identity.session_tokens (refresh_token_hash);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_user_status_check') THEN
        ALTER TABLE identity.user_accounts ADD CONSTRAINT identity_user_status_check
            CHECK (status IN ('ANONYMOUS','REGISTERED','ACTIVE','VERIFIED','COMMERCIAL_VERIFIED','SUSPENDED','DELETED')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_login_channel_check') THEN
        ALTER TABLE identity.login_identities ADD CONSTRAINT identity_login_channel_check
            CHECK (channel IS NULL OR channel IN ('EMAIL','SMS')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_login_status_check') THEN
        ALTER TABLE identity.login_identities ADD CONSTRAINT identity_login_status_check
            CHECK (status IN ('ACTIVE','REVOKED','SUSPENDED')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_device_platform_check') THEN
        ALTER TABLE identity.device_registrations ADD CONSTRAINT identity_device_platform_check
            CHECK (platform IN ('IOS','ANDROID','WEB')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_device_status_check') THEN
        ALTER TABLE identity.device_registrations ADD CONSTRAINT identity_device_status_check
            CHECK (status IN ('ACTIVE','REVOKED','SUSPENDED')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_session_status_check') THEN
        ALTER TABLE identity.sessions ADD CONSTRAINT identity_session_status_check
            CHECK (status IN ('ACTIVE','REVOKED')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_session_principal_type_check') THEN
        ALTER TABLE identity.sessions ADD CONSTRAINT identity_session_principal_type_check
            CHECK (principal_type IN ('INDIVIDUAL','BUSINESS')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_session_lifetime_check') THEN
        ALTER TABLE identity.sessions ADD CONSTRAINT identity_session_lifetime_check
            CHECK (expires_at > issued_at AND version >= 1) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_token_lifetime_check') THEN
        ALTER TABLE identity.session_tokens ADD CONSTRAINT identity_token_lifetime_check
            CHECK (access_expires_at < refresh_expires_at AND rotation >= 1) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_sessions_user_fk') THEN
        ALTER TABLE identity.sessions ADD CONSTRAINT identity_sessions_user_fk
            FOREIGN KEY (user_account_id) REFERENCES identity.user_accounts(id) ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_sessions_device_fk') THEN
        ALTER TABLE identity.sessions ADD CONSTRAINT identity_sessions_device_fk
            FOREIGN KEY (device_id) REFERENCES identity.device_registrations(id) ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_asset_owner_type_check') THEN
        ALTER TABLE media.media_assets ADD CONSTRAINT media_asset_owner_type_check
            CHECK (owner_principal_type IN ('INDIVIDUAL','BUSINESS')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_asset_type_check') THEN
        ALTER TABLE media.media_assets ADD CONSTRAINT media_asset_type_check
            CHECK (media_type IN ('IMAGE','VIDEO','AUDIO')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_asset_processing_status_check') THEN
        ALTER TABLE media.media_assets ADD CONSTRAINT media_asset_processing_status_check
            CHECK (processing_status IN ('UPLOADING','PROCESSING','READY','FAILED')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_asset_moderation_status_check') THEN
        ALTER TABLE media.media_assets ADD CONSTRAINT media_asset_moderation_status_check
            CHECK (moderation_status IN ('PENDING','QUARANTINED','APPROVED','REJECTED_TECHNICAL','REJECTED_CONTENT_NUDITY','REJECTED_CONTENT_POLITICS','REJECTED_CONTENT_VIOLENCE')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_asset_visibility_check') THEN
        ALTER TABLE media.media_assets ADD CONSTRAINT media_asset_visibility_check
            CHECK (visibility_class IN ('OWNER_ONLY','PUBLIC','FOLLOWERS','AGENT_ONLY')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_asset_dimensions_check') THEN
        ALTER TABLE media.media_assets ADD CONSTRAINT media_asset_dimensions_check
            CHECK ((width IS NULL OR width >= 0) AND (height IS NULL OR height >= 0) AND (duration_ms IS NULL OR duration_ms >= 0) AND (source_bytes IS NULL OR source_bytes >= 0)) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_asset_checksum_check') THEN
        ALTER TABLE media.media_assets ADD CONSTRAINT media_asset_checksum_check
            CHECK (checksum_sha256 IS NULL OR checksum_sha256 = '' OR checksum_sha256 ~ '^[0-9a-f]{64}$') NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_owner_user_fk') THEN
        ALTER TABLE business.accounts ADD CONSTRAINT business_owner_user_fk
            FOREIGN KEY (owner_user_id) REFERENCES identity.user_accounts(id) ON DELETE RESTRICT NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_membership_user_fk') THEN
        ALTER TABLE business.memberships ADD CONSTRAINT business_membership_user_fk
            FOREIGN KEY (user_id) REFERENCES identity.user_accounts(id) ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_intent_currency_check') THEN
        ALTER TABLE payment.payment_intents ADD CONSTRAINT payment_intent_currency_check
            CHECK (currency ~ '^[A-Z]{3}$') NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_currency_check') THEN
        ALTER TABLE payment.ledger_entries ADD CONSTRAINT ledger_currency_check
            CHECK (currency ~ '^[A-Z]{3}$') NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_currency_check') THEN
        ALTER TABLE payment.payout_holds ADD CONSTRAINT payout_currency_check
            CHECK (currency ~ '^[A-Z]{3}$') NOT VALID;
    END IF;
END $$;
