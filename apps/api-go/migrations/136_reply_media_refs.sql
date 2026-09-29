-- REPLY-IMAGE-001: 评论图片。engagement.replies 加 media_refs，
-- 与 localnet.posts.media_refs 同口径（JSONB 数组，元素 {mediaAssetId, sortOrder}，
-- 上限 6 由 ReplyToPost 命令层校验，这里只管形状）。
-- 老评论默认空数组：读出来就是纯文字评论，行为不变，不回填、不迁移数据。
ALTER TABLE engagement.replies ADD COLUMN IF NOT EXISTS media_refs JSONB NOT NULL DEFAULT '[]';
