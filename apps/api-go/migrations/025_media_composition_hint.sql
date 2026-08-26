-- Social Media Pipeline v2: Media Composition Hint
-- Plan §5.2.2: 服务端在派生阶段给出"主体在哪儿/哪里不能裁"，前端消费此合同。
-- 见 docs/media-pipeline/COMPOSITION_WORKER_SPEC.md

ALTER TABLE media.media_assets
    ADD COLUMN IF NOT EXISTS composition_hint JSONB,
    ADD COLUMN IF NOT EXISTS composition_recipe_version TEXT,
    ADD COLUMN IF NOT EXISTS composition_computed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS composition_confidence REAL;

-- composition_hint JSONB 形状:
-- {
--   "subjectType": "PERSON" | "PRODUCT" | "TEXT_HEAVY" | "SCENE"
--                | "MIXED_PERSON_PRODUCT" | "MIXED_PERSON_TEXT" | "UNKNOWN",
--   "subjectCount": 2,
--   "faceBoxes": [{"x":0.1,"y":0.2,"width":0.3,"height":0.2}],
--   "bodyBoxes": [{"x":0.1,"y":0.1,"width":0.4,"height":0.6}],
--   "textSafeArea": {"x":0.05,"y":0.7,"width":0.9,"height":0.2},
--   "focalPoint":   {"x":0.5,"y":0.4,"width":0.2,"height":0.2},
--   "safeCropRect": {"x":0.0,"y":0.1,"width":1.0,"height":0.8},
--   "confidence": 0.87,
--   "recipeVersion": "composition_recipe_v1"
-- }
-- 坐标全部归一化到 [0,1]，相对于原图宽高。

CREATE INDEX IF NOT EXISTS idx_media_assets_composition
    ON media.media_assets (composition_recipe_version)
    WHERE composition_hint IS NOT NULL;

COMMENT ON COLUMN media.media_assets.composition_hint IS
  '主体类型 + 关键区域（人脸/身体/文字/商品/焦点/安全裁切）。前端只消费此合同，不复制检测逻辑。';
COMMENT ON COLUMN media.media_assets.composition_recipe_version IS
  'composition_recipe_v1 永远带 version，升级不覆盖旧值。';
COMMENT ON COLUMN media.media_assets.composition_confidence IS
  '0~1。低置信度（<0.4）前端必须回落 contain，不能中心裁切。';
