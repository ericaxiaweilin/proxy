-- 007 安全加固：候选批次归属（supply.candidate_batches.owner_principal_id）。
-- 归属校验 fail-closed：历史批次 owner 为 NULL 时读取会被服务层拒绝。
ALTER TABLE supply.candidate_batches
    ADD COLUMN IF NOT EXISTS owner_principal_id TEXT;

CREATE INDEX IF NOT EXISTS idx_candidate_batches_owner
    ON supply.candidate_batches (owner_principal_id);
