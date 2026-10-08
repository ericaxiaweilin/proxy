-- TAG-SYSTEM-005：行为模式轴（应用使用强度 / 重心、聊天风格）。规则推导，不靠关键词；聊天只用元数据，不读正文。
INSERT INTO tag.axes(axis, label, polarity, description, ttl_days, required_purpose, allowed_use, rule_version) VALUES
 ('PATTERN', '行为模式', 'NEUTRAL', '应用使用强度与重心、聊天风格（条数 / 谁先开口 / 回复多快），规则推导', 28, 'RECOMMENDATION', '{recommendation,matching,analytics}', '2026-10-08')
ON CONFLICT (axis) DO NOTHING;
