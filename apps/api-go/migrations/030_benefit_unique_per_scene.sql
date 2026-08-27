-- 030 Scene Benefit: enforce one benefit per scene (mirror in-memory
-- repository contract; the in-memory repo rejected a second
-- CreateBenefit for the same scene with "benefit already exists for
-- scene").
--
-- The unique index is partial (WHERE TRUE) so it applies to all rows.
-- Existing tables that already have > 1 benefit per scene would fail
-- to create the index, so we de-duplicate first by keeping only the
-- most recent row per scene.

DELETE FROM scene.benefits a
USING scene.benefits b
WHERE a.scene_id = b.scene_id
  AND a.created_at < b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_benefit_scene
  ON scene.benefits(scene_id);
