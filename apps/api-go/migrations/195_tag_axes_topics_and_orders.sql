-- TAG-SYSTEM-003（2026-10-08）：内容话题 + 交易侧细粒度轴。轴参数（Scale / MinSignals）在 Go 侧 internal/tagging。
INSERT INTO tag.axes(axis, label, polarity, description, ttl_days, required_purpose, allowed_use, rule_version) VALUES
 ('INTEREST_TOPIC',    '内容话题',     'POSITIVE', '看过（被动，要同意）+ 自己发过的帖子里的话题，受控词表，至少 2 条独立信号', 28,  'RECOMMENDATION', '{recommendation,matching,analytics}', '2026-10-08'),
 ('ORDER_SERVICE',     '买过的服务',   'POSITIVE', '自己下过的单的服务类型（交易事实）',                          90,  '',               '{recommendation,matching,analytics}', '2026-10-08'),
 ('PRICE_BAND',        '消费价位',     'NEUTRAL',  '约定报酬所在档位：<100K / 100–300K / 300–800K / ≥800K',      90,  '',               '{recommendation,matching,analytics}', '2026-10-08'),
 ('ORDER_SCENARIO',    '消费场景',     'NEUTRAL',  '订单快照里的消费场景（ordinary / assistance）',               90,  '',               '{recommendation,matching,analytics}', '2026-10-08'),
 ('TIME_SLOT',         '下单时段偏好', 'NEUTRAL',  '订单开始时间所在时段（越南时间）',                            90,  '',               '{recommendation,matching,analytics}', '2026-10-08'),
 ('EXPERTISE_SERVICE', '完成过的服务', 'POSITIVE', '作为服务方实际完成过的服务类型，比声明更可信',                 180, '',               '{recommendation,matching,analytics}', '2026-10-08')
ON CONFLICT (axis) DO NOTHING;
