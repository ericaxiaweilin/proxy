-- Proxy R14 持久化迁移
-- 对齐 Canonical Data Model R1：对象语义边界保留，JSONB 列承载复杂结构
-- 幂等：CREATE TABLE IF NOT EXISTS

-- demand schema（现有）
CREATE SCHEMA IF NOT EXISTS demand;

-- citycompanion schema
CREATE SCHEMA IF NOT EXISTS citycompanion;

CREATE TABLE IF NOT EXISTS citycompanion.needs (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    lifecycle TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    duration TEXT NOT NULL,
    language TEXT NOT NULL,
    gender_pref TEXT NOT NULL DEFAULT 'any',
    interests JSONB NOT NULL DEFAULT '[]',
    meeting TEXT NOT NULL,
    budget_vnd BIGINT NOT NULL DEFAULT 0,
    route JSONB,
    route_changes JSONB NOT NULL DEFAULT '[]',
    confirmed_agent JSONB,
    scene_visits JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL
);

-- localnet schema
CREATE SCHEMA IF NOT EXISTS localnet;

CREATE TABLE IF NOT EXISTS localnet.posts (
    id TEXT PRIMARY KEY,
    author_type TEXT NOT NULL,
    author_id TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    media_refs JSONB NOT NULL DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'PUBLIC',
    city_scope TEXT,
    status TEXT NOT NULL DEFAULT 'PUBLISHED',
    context_refs JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS localnet.need_from_posts (
    id SERIAL PRIMARY KEY,
    need_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    lineage JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

-- localcontext schema
CREATE SCHEMA IF NOT EXISTS localcontext;

CREATE TABLE IF NOT EXISTS localcontext.contexts (
    actor_id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    market_label TEXT NOT NULL,
    area_id TEXT,
    area_label TEXT,
    source TEXT NOT NULL,
    precision TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

-- conversation schema
CREATE SCHEMA IF NOT EXISTS conversation;

CREATE TABLE IF NOT EXISTS conversation.conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    origin_type TEXT NOT NULL,
    origin_id TEXT NOT NULL,
    market_id TEXT,
    state TEXT NOT NULL DEFAULT 'ACTIVE',
    participants JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL,
    last_message_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation.messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation.conversations(id),
    sender_id TEXT NOT NULL,
    message_type TEXT NOT NULL,
    body TEXT,
    media_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversation.need_drafts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation.conversations(id),
    summary TEXT NOT NULL,
    confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    need_id TEXT,
    created_at TIMESTAMPTZ NOT NULL
);

-- engagement schema
CREATE SCHEMA IF NOT EXISTS engagement;

CREATE TABLE IF NOT EXISTS engagement.follows (
    follower_id TEXT NOT NULL,
    followee_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS engagement.reactions (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'LIKE',
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS engagement.replies (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS engagement.reposts (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS engagement.bookmarks (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

-- fulfillment schema
CREATE SCHEMA IF NOT EXISTS fulfillment;

CREATE TABLE IF NOT EXISTS fulfillment.orders (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    need_id TEXT NOT NULL,
    lifecycle TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    snapshot JSONB NOT NULL,
    amendments JSONB NOT NULL DEFAULT '[]',
    settlement JSONB,
    outcome JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
