-- FOR-YOU-SLOT-001（2026-10-04，用户：「for you 是 4 个自由资源槽，核心服务于小美真人……
-- 20 个真人 × 3 个时间段 = 最大 60 个可以用，现在只有 9 个，设计逻辑有缺陷」）。
--
-- 资源单位是「小美 × 时段」，不是「活动」：
--   - 一单 = 我 + 小美 + 时段 + 场景/地点。同一个人约不同的小美是不同的单，
--     所以报名主键加上 companion_id（直接报名、不带同行人的单 companion_id = ''）。
--   - 小美的一个时段只接一单（跨所有下单人独占）：部分唯一索引
--     (companion_id, slot_key) WHERE 有同行人 且 未取消。并发下单由索引兜底。
--   - 下单人自己同一时段可以约多个小美（用户裁决：只锁小美的时间）。
--   - 活动 / 咖啡店只是场景载体；店的承载上限（暂定 4 小时 100 单）后期再做，
--     现在默认不限（For You 单不扣活动名额，见 activity.go Join）。
--
-- slot_key = 活动时间文本去首尾空白、压缩空白（活动时间目前就是展示文本，
-- 如「周五 19:00–20:30」；两场活动同一时段文本相同才算撞）。
BEGIN;

ALTER TABLE activity.participants
    ADD COLUMN IF NOT EXISTS companion_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS slot_key     TEXT NOT NULL DEFAULT '';

-- 已有的 For You 单：同行人在票面快照里，回填出来。
UPDATE activity.participants
   SET companion_id = COALESCE(NULLIF(btrim(order_snapshot->'companion'->>'id'), ''), '')
 WHERE companion_id = '' AND order_snapshot ? 'companion';

UPDATE activity.participants p
   SET slot_key = regexp_replace(btrim(COALESCE(a.payload->>'time', '')), '\s+', ' ', 'g')
  FROM activity.activities a
 WHERE a.id = p.activity_id AND p.slot_key = '';

ALTER TABLE activity.participants DROP CONSTRAINT IF EXISTS participants_pkey;
ALTER TABLE activity.participants ADD CONSTRAINT participants_pkey PRIMARY KEY (activity_id, actor_id, companion_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_participants_companion_slot
    ON activity.participants (companion_id, slot_key)
 WHERE companion_id <> '' AND state <> 'CANCELLED';

COMMIT;
