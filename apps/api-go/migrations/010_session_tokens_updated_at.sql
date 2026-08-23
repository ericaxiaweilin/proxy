-- 修复：RotateSessionTokens 的 UPDATE 需要 updated_at 列（008 建表时遗漏）
ALTER TABLE identity.session_tokens ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
