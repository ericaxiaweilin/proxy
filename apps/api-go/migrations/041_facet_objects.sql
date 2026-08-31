CREATE SCHEMA IF NOT EXISTS facet;

CREATE TABLE IF NOT EXISTS facet.objects (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    relation TEXT NOT NULL CHECK (relation IN ('BUILDING_TRUST','SHARED_INTEREST','CREATOR_COLLAB')),
    goal TEXT NOT NULL,
    current_state TEXT NOT NULL,
    pill_label TEXT NOT NULL,
    gap_summary TEXT NOT NULL,
    gap_next_show_at TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT ''
);
