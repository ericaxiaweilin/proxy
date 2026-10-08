-- TAG-SYSTEM-004（2026-10-08，用户：帖子没有「场景类型」这种分类，帖文就是帖文，有主题但不跟随场景）
-- 兴趣只按内容主题（INTEREST_TOPIC），回避也按主题（AVERSION_TOPIC）。原来按帖子 scene_type 的两个轴作废：
-- 行不删（user_tags 外键指着它，历史可查），标记 DEPRECATED；下一轮重算会把用户身上这两个轴的标签清掉。
UPDATE tag.axes SET status = 'DEPRECATED' WHERE axis IN ('INTEREST_SCENE', 'AVERSION_SCENE');
INSERT INTO tag.axes(axis, label, polarity, description, ttl_days, required_purpose, allowed_use, rule_version) VALUES
 ('AVERSION_TOPIC', '主题回避', 'NEGATIVE', '近 14 天某个主题的帖子至少看过 5 次且 70% 以上一眼划走', 14, 'RECOMMENDATION', '{recommendation,matching,analytics}', '2026-10-08')
ON CONFLICT (axis) DO NOTHING;
