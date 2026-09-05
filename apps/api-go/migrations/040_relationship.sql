-- R18.x FRIEND-001: friendship persistence.
--
-- Closes the gap where the mobile '好友与关系' surface
-- (FriendCrmSurface) was entirely hardcoded mock data.
-- The (UserA, UserB) pair is canonicalised so (A,B) and
-- (B,A) collapse to a single row, mirroring the
-- in-memory repo's orderPair() helper.

CREATE SCHEMA IF NOT EXISTS relationship;

CREATE TABLE IF NOT EXISTS relationship.friendships (
    id            TEXT PRIMARY KEY,
    user_a        TEXT NOT NULL,
    user_b        TEXT NOT NULL,
    state         TEXT NOT NULL, -- PENDING | FRIEND | BLOCKED | IGNORED_TOMBSTONE
    requester_id  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL,
    CHECK (user_a < user_b),
    CHECK (state IN ('PENDING', 'FRIEND', 'BLOCKED', 'IGNORED_TOMBSTONE')),
    CHECK (length(requester_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_friendships_user_a ON relationship.friendships (user_a);
CREATE INDEX IF NOT EXISTS idx_friendships_user_b ON relationship.friendships (user_b);
CREATE INDEX IF NOT EXISTS idx_friendships_state ON relationship.friendships (state);
