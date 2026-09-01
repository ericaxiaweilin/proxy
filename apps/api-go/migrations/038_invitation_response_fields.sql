-- R15.13 P3 follow-up: 给 scene.invitations 加 responded_at + note
-- (guest ASK 时携带, host 列表能看「Linh 问: 周六可以吗 · 2h ago」)。
ALTER TABLE scene.invitations
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
