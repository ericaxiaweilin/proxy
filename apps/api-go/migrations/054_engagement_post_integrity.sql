-- Engagement rows have no meaning without their parent post. Remove only
-- proven orphans, then enforce referential integrity for all future writes.

-- Legacy orphan cleanup fires projection triggers. A deleted parent must never
-- cause the projection helper to recreate a stats row for a nonexistent post.
CREATE OR REPLACE FUNCTION localnet.adjust_post_stat(p_post_id TEXT, p_field TEXT, p_delta INT) RETURNS void AS $$
DECLARE
  current_value BIGINT;
  new_value BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM localnet.posts WHERE id=p_post_id) THEN
    RETURN;
  END IF;
  INSERT INTO localnet.post_stats (post_id) VALUES (p_post_id) ON CONFLICT DO NOTHING;
  IF p_delta > 0 THEN
    EXECUTE format('UPDATE localnet.post_stats SET %I = %I + $1, updated_at = NOW() WHERE post_id = $2', p_field, p_field)
      USING p_delta, p_post_id;
  ELSE
    EXECUTE format('SELECT %I FROM localnet.post_stats WHERE post_id = $1', p_field)
      INTO current_value USING p_post_id;
    new_value := GREATEST(COALESCE(current_value, 0) + p_delta, 0);
    EXECUTE format('UPDATE localnet.post_stats SET %I = $1, updated_at = NOW() WHERE post_id = $2', p_field)
      USING new_value, p_post_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

DELETE FROM engagement.reactions e
WHERE NOT EXISTS (SELECT 1 FROM localnet.posts p WHERE p.id=e.post_id);
DELETE FROM engagement.replies e
WHERE NOT EXISTS (SELECT 1 FROM localnet.posts p WHERE p.id=e.post_id);
DELETE FROM engagement.reposts e
WHERE NOT EXISTS (SELECT 1 FROM localnet.posts p WHERE p.id=e.post_id);
DELETE FROM engagement.bookmarks e
WHERE NOT EXISTS (SELECT 1 FROM localnet.posts p WHERE p.id=e.post_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='engagement_reactions_post_fk') THEN
    ALTER TABLE engagement.reactions ADD CONSTRAINT engagement_reactions_post_fk
      FOREIGN KEY (post_id) REFERENCES localnet.posts(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='engagement_replies_post_fk') THEN
    ALTER TABLE engagement.replies ADD CONSTRAINT engagement_replies_post_fk
      FOREIGN KEY (post_id) REFERENCES localnet.posts(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='engagement_reposts_post_fk') THEN
    ALTER TABLE engagement.reposts ADD CONSTRAINT engagement_reposts_post_fk
      FOREIGN KEY (post_id) REFERENCES localnet.posts(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='engagement_bookmarks_post_fk') THEN
    ALTER TABLE engagement.bookmarks ADD CONSTRAINT engagement_bookmarks_post_fk
      FOREIGN KEY (post_id) REFERENCES localnet.posts(id) ON DELETE CASCADE;
  END IF;
END
$$;
