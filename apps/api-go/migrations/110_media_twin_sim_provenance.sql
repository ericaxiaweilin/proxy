-- 110_media_twin_sim_provenance.sql — 分身仿真出图溯源列（TWIN-PHOTO-SIM-001）
-- 本地仿真通道产出的照片必须诚实标记：来源仍是 USER_UPLOADED（确定性本地
-- 合成，无模型参与，不配 AI 生成徽），分身归属与来源图另记三列，UI 据此
-- 显示「分身仿真 · 非AI生成」而不是「AI 生成」。真模型供应商接入后走
-- AI_PERSONA / MODEL_API，那是另一个迁移的事。

ALTER TABLE media.media_assets
    ADD COLUMN IF NOT EXISTS twin_persona_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS twin_source_asset_ids TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS twin_simulated BOOLEAN NOT NULL DEFAULT false;
