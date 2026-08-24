CREATE SCHEMA IF NOT EXISTS socialspace;

CREATE TABLE IF NOT EXISTS socialspace.statuses (
    status_id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL,
    author_display_name TEXT NOT NULL,
    body TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK (char_length(body) BETWEEN 1 AND 140),
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_socialspace_statuses_active
    ON socialspace.statuses (expires_at, created_at DESC);

CREATE TABLE IF NOT EXISTS socialspace.communities (
    community_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    members INT NOT NULL DEFAULT 0,
    color TEXT NOT NULL,
    flair TEXT NOT NULL DEFAULT '',
    display_order INT NOT NULL DEFAULT 0,
    CHECK (members >= 0)
);

CREATE TABLE IF NOT EXISTS socialspace.community_memberships (
    actor_id TEXT NOT NULL,
    community_id TEXT NOT NULL REFERENCES socialspace.communities(community_id) ON DELETE CASCADE,
    joined BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (actor_id, community_id)
);

INSERT INTO socialspace.communities (community_id, name, description, members, color, flair, display_order) VALUES
    ('photo', '河内摄影', '西湖/老城区/咖啡店 · 作品与地点', 342, '#F0EAF5', '活跃', 10),
    ('chinese', '中文生活', '中文沟通/本地生活/互助', 218, '#FFF0F6', '互助', 20),
    ('startup', '河内创业', '产品/AI/出海 · 线下碰头', 156, '#EDF9F6', '创业', 30),
    ('coffee', '本地咖啡', '独立咖啡/烘焙/探店', 289, '#FFF8DF', '探店', 40),
    ('badminton', '羽毛球', '每周组局 · 新手友好', 94, '#F1F7FF', '组局', 50)
ON CONFLICT (community_id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    members = EXCLUDED.members,
    color = EXCLUDED.color,
    flair = EXCLUDED.flair,
    display_order = EXCLUDED.display_order;
