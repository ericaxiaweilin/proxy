-- TAG-SYSTEM-002（2026-10-08，用户：「一个用户帖 n 个标签拿到画像，越细标签越好」）
-- 细粒度亲和轴：同一条显式场所行为同时贡献「这家店 / 类型 / 风格 / 区」四个轴；创作者偏好；
-- 她自己声明的服务能力与语种。轴定义在 Go 侧 internal/tagging（Scale / MinSignals / Declared 在那里），
-- 这里只是受控词表的存档行（user_tags.axis 外键指向它）。已应用迁移不改，所以是向前的新迁移。
INSERT INTO tag.axes(axis, label, polarity, description, ttl_days, required_purpose, allowed_use, rule_version) VALUES
 ('VENUE_FAVORITE',   '常去 / 收藏的店',   'POSITIVE', '收藏 / 计划去 / 去过 / 打卡过的具体场所',              60,  '',               '{recommendation,matching,analytics}', '2026-10-08'),
 ('VENUE_KIND',       '场所类型',          'POSITIVE', '上面那些场所的类型（咖啡 / 餐厅 / 公共景点…），至少 2 条独立行为', 60,  '',               '{recommendation,matching,analytics}', '2026-10-08'),
 ('VENUE_STYLE',      '场所风格',          'POSITIVE', '场所类型后面的细分（店招 / 湖边 / 米其林…），至少 2 条独立行为',    60,  '',               '{recommendation,matching,analytics}', '2026-10-08'),
 ('DISTRICT',         '常活动的区',        'NEUTRAL',  '上面那些场所所在的区',                                  60,  '',               '{recommendation,matching,analytics}', '2026-10-08'),
 ('CREATOR_AFFINITY', '偏爱的创作者',      'POSITIVE', '近 28 天看谁的内容停得久（被动，要浏览同意）',            28,  'RECOMMENDATION', '{recommendation,matching,analytics}', '2026-10-08'),
 ('SKILL',            '声明的服务能力',    'POSITIVE', '她自己在接单资料里写的服务类型 / 垂类，是当前状态',        365, '',               '{recommendation,matching,analytics}', '2026-10-08'),
 ('LANGUAGE',         '声明的语种',        'POSITIVE', '她自己在接单资料里写的语种，是当前状态',                  365, '',               '{recommendation,matching,analytics}', '2026-10-08')
ON CONFLICT (axis) DO NOTHING;
