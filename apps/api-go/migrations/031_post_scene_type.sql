-- 031_post_scene_type.sql
-- R15.15 P1: Post.SceneType 字段 — 解锁 per-(city, sceneType) 背景缓存。
-- 之前 Post aggregate 没 SceneType 字段，Memory → Feed aesthetic
-- backdrop 只能走全局一色。本迁移加 scene_type column，跟 scene 包
-- Memory.SceneType 同语义但走顶层 9 选 1 (ROOFTOP / BRUNCH / SPA /
-- CINEMA / PHOTO / NIGHTLIFE / OUTDOOR / COFFEE / UNKNOWN)。
--
-- 同时加 6 个 Seed Posts 用的 unique seed id (post_seed_*) 给演示
-- visitor 不空流 (R15.15 P2 seed 路径)。ON CONFLICT (id) DO
-- NOTHING 让服务重启 idempotent — 不会接续追加重复。
ALTER TABLE localnet.posts
  ADD COLUMN IF NOT EXISTS scene_type text NOT NULL DEFAULT 'UNKNOWN';

-- 9 个合法 SceneType 的 CHECK 约束 (跟 Go allowedSceneTypes 同步)。
-- NULL → UNKNOWN default 兼容老 post。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_scene_type_check'
  ) THEN
    ALTER TABLE localnet.posts
      ADD CONSTRAINT posts_scene_type_check
      CHECK (scene_type IN ('UNKNOWN','ROOFTOP','BRUNCH','SPA','CINEMA','PHOTO','NIGHTLIFE','OUTDOOR','COFFEE'));
  END IF;
END$$;
