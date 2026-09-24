-- AI-MANAGE-015: AI 分身「用户建模」—— 小美的物理锚点 + 亚洲人特征锁定，给 AI 出图 / 视频当约束。
-- 每项记来源（ai = 从本人授权的图库照片识别；manual = 本人填的，AI 不覆盖）。没有就是 NULL，不编。
CREATE TABLE IF NOT EXISTS ai.user_models (
    owner_id TEXT PRIMARY KEY,
    height_cm INTEGER,
    weight_kg INTEGER,
    age INTEGER,
    body_type TEXT NOT NULL DEFAULT '',
    skin_tone TEXT NOT NULL DEFAULT '',
    hair TEXT NOT NULL DEFAULT '',
    asian_lock BOOLEAN NOT NULL DEFAULT TRUE,
    sources JSONB NOT NULL DEFAULT '{}',
    analyzed_photo_count INTEGER NOT NULL DEFAULT 0,
    analyzed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
