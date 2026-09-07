-- FRIEND-UPsert-001: unique pair constraint for relationship.friendships.
--
-- Migration 040 created the table without a UNIQUE constraint on
-- (user_a, user_b), but the PostgreSQL repository's UpsertFriendship
-- targets ON CONFLICT (user_a, user_b) DO UPDATE. PostgreSQL requires
-- an arbiter index for that clause (SQLSTATE 42P10 when absent), so
-- EVERY friendship write (SendFriendRequest / AcceptFriendRequest /
-- BlockFriend) failed in PG mode while the 8 in-memory service tests
-- stayed green. Caught by TestRelationshipPostgresLifecycle.
--
-- The pair is already canonicalised by CHECK (user_a < user_b), so a
-- plain UNIQUE pair index is correct: (A,B) and (B,A) cannot both exist.

CREATE UNIQUE INDEX IF NOT EXISTS uq_friendships_user_pair
    ON relationship.friendships (user_a, user_b);
