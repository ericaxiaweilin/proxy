-- FOR-YOU-SLOT-002（2026-10-10）：「小美时段」冲突键改为优先用活动的结构化开始时间（@<分钟,UTC>），
-- 没有结构化时间的退回原来的自由文本规整。这样同一真实时刻不同文本不会漏判成双订，文本相同但不同日期不会误判没空。
--
-- 回填已有报名：其活动 payload 里有 startsAt 的，把 slot_key 改成规范键（与 Go 的 SlotKeyForActivity 同一口径：
-- '@' + to_char(startsAt AT TIME ZONE 'UTC', RFC3339 分钟)）。没有 startsAt 的行一律不动，保持自由文本——
-- 所以今天（活动基本都没 startsAt）这条迁移几乎是空操作，只对将来带了开始时间的活动生效。
UPDATE activity.participants p
   SET slot_key = '@' || to_char(date_trunc('minute', (a.payload->>'startsAt')::timestamptz AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  FROM activity.activities a
 WHERE a.id = p.activity_id
   AND p.companion_id <> ''
   AND p.state <> 'CANCELLED'
   AND NULLIF(btrim(COALESCE(a.payload->>'startsAt','')), '') IS NOT NULL
   AND p.slot_key NOT LIKE '@%';
