-- R15.13 Scene Value Exchange — P0
CREATE SCHEMA IF NOT EXISTS scene;

CREATE TABLE IF NOT EXISTS scene.scenes (
  scene_id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  title TEXT NOT NULL,
  intent TEXT NOT NULL,
  anchor JSONB,
  participation TEXT NOT NULL,
  cost TEXT NOT NULL,
  benefits JSONB NOT NULL DEFAULT '[]',
  venue_id TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  capacity_min INT,
  capacity_max INT,
  host_user_id TEXT NOT NULL,
  city_scope TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scene_host ON scene.scenes(host_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS scene.invitations (
  invitation_id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scene.scenes(scene_id) ON DELETE CASCADE,
  host_user_id TEXT NOT NULL,
  invitee_user_id TEXT NOT NULL,
  card JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitation_invitee ON scene.invitations(invitee_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitation_scene ON scene.invitations(scene_id);

CREATE TABLE IF NOT EXISTS scene.attendances (
  scene_id TEXT NOT NULL REFERENCES scene.scenes(scene_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scene_id, user_id)
);

CREATE TABLE IF NOT EXISTS scene.outcomes (
  scene_id TEXT PRIMARY KEY REFERENCES scene.scenes(scene_id) ON DELETE CASCADE,
  invite_sent INT NOT NULL DEFAULT 0,
  invite_accepted INT NOT NULL DEFAULT 0,
  actual_attendance INT NOT NULL DEFAULT 0,
  voucher_redeemed INT NOT NULL DEFAULT 0,
  merchant_spend_minor BIGINT,
  satisfaction DOUBLE PRECISION,
  repeat_interaction BOOLEAN,
  recorded_at TIMESTAMPTZ NOT NULL
);
