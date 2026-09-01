-- 044_inbox_dedupe.sql — Outbox→Inbox 去重表，消费者幂等
-- 每个 domain event (event_id) 仅处理一次，防止 outbox 重试导致重复副作用

CREATE SCHEMA IF NOT EXISTS inbox;

CREATE TABLE IF NOT EXISTS inbox.processed_events (
    event_id     TEXT PRIMARY KEY,
    event_type   TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbox_event_type ON inbox.processed_events(event_type);
