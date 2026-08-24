CREATE TABLE IF NOT EXISTS engagement.feed_preferences (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    author_id TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (action IN ('NOT_INTERESTED','REDUCE_TOPIC','REDUCE_AUTHOR'))
);

CREATE INDEX IF NOT EXISTS idx_engagement_feed_preferences_actor
    ON engagement.feed_preferences (actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS engagement.post_reports (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'SUBMITTED',
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (reason IN ('SPAM','HARASSMENT','UNSAFE','OTHER')),
    CHECK (state IN ('SUBMITTED','REVIEWING','RESOLVED','DISMISSED'))
);

CREATE INDEX IF NOT EXISTS idx_engagement_post_reports_state
    ON engagement.post_reports (state, created_at);
