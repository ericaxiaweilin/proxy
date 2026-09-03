CREATE SCHEMA IF NOT EXISTS reality;

CREATE TABLE IF NOT EXISTS reality.user_scene_states (
  actor_id text NOT NULL,
  scene_id text NOT NULL,
  saved boolean NOT NULL DEFAULT false,
  planned boolean NOT NULL DEFAULT false,
  private_visited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, scene_id)
);

CREATE INDEX IF NOT EXISTS reality_user_scene_states_actor_updated_idx
  ON reality.user_scene_states (actor_id, updated_at DESC);

COMMENT ON COLUMN reality.user_scene_states.private_visited IS
  'Self-reported private history. Never project this field as a public footprint.';
