-- 029 Invite: Funding/Benefit/Check-in + Price Corridor + Aesthetic
ALTER TABLE scene.scenes ADD COLUMN IF NOT EXISTS funding_mode TEXT NOT NULL DEFAULT 'HOST';
ALTER TABLE scene.scenes ADD COLUMN IF NOT EXISTS budget_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE scene.scenes ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'VND';
ALTER TABLE scene.scenes ADD COLUMN IF NOT EXISTS aesthetic_score DOUBLE PRECISION;
ALTER TABLE scene.scenes ADD COLUMN IF NOT EXISTS price_corridor JSONB NOT NULL DEFAULT '{"low":0,"target":0,"high":0}';

CREATE TABLE IF NOT EXISTS scene.benefits (
  benefit_id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scene.scenes(scene_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'LOCKED',
  unlock_rule TEXT NOT NULL DEFAULT 'BOTH_CHECKED_IN',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_benefit_scene ON scene.benefits(scene_id);

CREATE TABLE IF NOT EXISTS scene.checkins (
  scene_id TEXT NOT NULL REFERENCES scene.scenes(scene_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scene_id, user_id)
);

CREATE TABLE IF NOT EXISTS scene.price_corridors (
  city TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  scene_type TEXT NOT NULL,
  p25 BIGINT NOT NULL,
  p50 BIGINT NOT NULL,
  p75 BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (city, merchant_id, scene_type)
);
INSERT INTO scene.price_corridors (city, merchant_id, scene_type, p25, p50, p75, updated_at) VALUES
  ('HN', 'aster_rooftop', 'ROOFTOP_PHOTO', 40000, 55000, 80000, NOW()),
  ('HN', 'bac_ninh', 'PHOTO_CAFE', 40000, 55000, 80000, NOW())
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS scene.memories (
  scene_id TEXT PRIMARY KEY REFERENCES scene.scenes(scene_id) ON DELETE CASCADE,
  host_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  merchant_id TEXT,
  scene_type TEXT NOT NULL,
  funding_mode TEXT NOT NULL,
  planned_budget BIGINT NOT NULL,
  actual_spend BIGINT,
  duration_min INT,
  aesthetic_assets JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL
);
