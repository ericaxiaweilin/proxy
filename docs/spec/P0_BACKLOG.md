# P0 待办条目（合并自 6 个单条目文件）

2026-09-22 合并：原本散成 6 个 200 字节上下的小文件
（`Attribution_KillSwitch_P0.md` / `Invite_Materializer_P0.md` /
`P1_Notification_Creator_P0.md` / `P1_Relationship_Scene_P0.md` /
`P2_Scale_P0.md` / `Reality_Economic_Gate_P0.md`），内容逐条保留在下面，
只是不再一个条目一个文件。

条目里的 `Master §xx` 指的是 `docs/prd/` 下的 PRD v1.1 Canonical Registry。

---

## P1 REL-01/SCENE-02/03 — 关系与场景补齐
- relationship/crm.go: Friendship vs CRM 私有 metadata 分离，CanCRMModifyFriendship=false
- scene/moderation.go: 50m 去重、90天 reverify、A→AI weight 0 已在 reality 层保障

## P1 MSG-01/CREATOR-02/BIZ-02/AI-04 — 通知/创作者/业务剩余
- notification/orchestrator.go: event idempotency 去重
- Creator Score 解释/申诉、Business drill-down、AI review 队列为 P1 运营容量，待联调

## Invite Materializer P0 — ORDER-01/02 AC-04/05
> Master §11-12：Invite 唯一 materialize + TermsVersion + reconfirm

- SourceContextType → MaterializedType 表已在 `apps/api-go/internal/invite/materializer.go`
- Material Change 字段：price/time/exactLocation/scope → TermsVersion+1 → 旧确认失效
- 关联 Order State Machine：DRAFT→TERMS_CONFIRMED→COMMITTED→EN_ROUTE→ARRIVED→IN_PROGRESS→COMPLETION_REVIEW→SETTLED

## Attribution + KillSwitch P0 — BIZ-01/DATA-01/TECH-01 AC-11/15
- Attribution 口径：sale/order/voucher/activity/creator evidence + window + dedupe，dashboard 需 drill-down
- KillSwitch：policy/killswitch.go 全局无发版开关 AI Twin/AI Native

## Reality/Economic Gate P0 — SCENE-01/PAY-01/AC-06/09
- `reality/evidence.go`: EvidenceType 5级 + confidence 0-3，AI_GENERATED=0 永远不能建立 visit
- `reality/economic_gate.go`: Economic Authority 仅 HUMAN/BUSINESS/SYSTEM 可写，AI Native/Twin 拒绝 AC-06
- 已接入 AC-09/06 门禁

## P2 Scale & Growth — Master §26.3
- scale/growth.go: Mission 类型 + 多城市轮转
- 推荐/场景飞轮/活动战役/AI video Twin 为 P2 实验，需联调
