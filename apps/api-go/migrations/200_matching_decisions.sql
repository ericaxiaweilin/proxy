-- MATCH-ENGINE-001（2026-10-08）：撮合引擎的审计账本（PRD 第 5 章 §117 Matching Audit）。
-- 每次撮合运行（snapshot）里，每个候选人——合格的和不合格的——一行：过没过、卡在哪道门、什么原因、名次、进没进候选集、
-- 用的是哪一版排名口径。append-only：这是「为什么邀请了她 / 为什么没邀请她」的举证材料，也是运营回放的依据。
CREATE SCHEMA IF NOT EXISTS matching;

CREATE TABLE IF NOT EXISTS matching.decisions (
    id           BIGSERIAL PRIMARY KEY,
    snapshot_id  TEXT NOT NULL,
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('OPPORTUNITY', 'SLOT')),
    subject_id   TEXT NOT NULL,
    agent_id     TEXT NOT NULL,
    eligible     BOOLEAN NOT NULL,
    gate         TEXT NOT NULL DEFAULT '',
    reason       TEXT NOT NULL DEFAULT '',
    organic_rank INTEGER NOT NULL DEFAULT 0,
    in_set       BOOLEAN NOT NULL DEFAULT false,
    exploration  BOOLEAN NOT NULL DEFAULT false,
    rank_version TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    CHECK ((eligible AND gate = '' AND organic_rank > 0) OR (NOT eligible AND gate <> '' AND reason <> '' AND organic_rank = 0))
);
CREATE INDEX IF NOT EXISTS idx_matching_decisions_subject ON matching.decisions (subject_kind, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matching_decisions_agent ON matching.decisions (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matching_decisions_snapshot ON matching.decisions (snapshot_id);

CREATE OR REPLACE FUNCTION matching.decisions_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'matching.decisions is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_matching_decisions_append_only ON matching.decisions;
CREATE TRIGGER trg_matching_decisions_append_only BEFORE UPDATE ON matching.decisions
    FOR EACH ROW EXECUTE FUNCTION matching.decisions_append_only();
-- 允许按保留期清理（DELETE），不允许改写（UPDATE）。
