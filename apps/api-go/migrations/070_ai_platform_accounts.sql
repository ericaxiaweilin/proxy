-- R18.x AI-ACCOUNT-001 / 070: ai.platform_accounts base table.
--
-- Migration 071 (platform_ai_account_personality.sql) ALTERs
-- ai.platform_accounts, but the table itself was never created
-- in any prior migration. The go-level aipersona
-- platform_accounts.go file uses a memory repo so the
-- table only exists when the g2 integration tests stand
-- up a fresh DB. This migration makes the table real so
-- 071 + the integration tests can run.
--
-- This is a fix for an unreleased branch; if the AI-account
-- work moves to a different schema, this migration should
-- be dropped along with 071.

CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE IF NOT EXISTS ai.platform_accounts (
    account_id TEXT PRIMARY KEY,
    avatar_path TEXT NOT NULL DEFAULT '',
    handle TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
