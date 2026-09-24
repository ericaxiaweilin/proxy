-- AI-MANAGE-016: 「亚洲人特征锁定」→「本人特征锁定」。锁的是 AI 从本人照片里读出的长相（新增 face_features），
-- 不是一个预设的人种模板 —— 用户：「核心是模型读取小美的照片得出什么人 而不是硬编码 以后说不定去哈萨克斯坦 蒙古运营呢」。
ALTER TABLE ai.user_models RENAME COLUMN asian_lock TO likeness_lock;
ALTER TABLE ai.user_models ADD COLUMN IF NOT EXISTS face_features TEXT NOT NULL DEFAULT '';
