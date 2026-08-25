-- M7 Inbox / Notification / Deep Link

CREATE SCHEMA IF NOT EXISTS notification;

CREATE TABLE IF NOT EXISTS notification.device_tokens (
    id TEXT PRIMARY KEY,
    user_account_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
    UNIQUE (user_account_id, device_id)
);

CREATE TABLE IF NOT EXISTS notification.inbox_items (
    id TEXT PRIMARY KEY,
    recipient_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    deep_link TEXT,
    read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inbox_recipient ON notification.inbox_items (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_read ON notification.inbox_items (recipient_id, read, created_at DESC);
