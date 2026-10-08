# 用户浏览行为收集 —— 工程核查与待法务确认清单（2026-10-08）

工程事实，不是法律意见。依据：代码与开发库，核查日期 2026-10-08。

## 1. 收了什么
`localnet.interaction_events`（append-only）：POST_IMPRESSION、MEDIA_IMPRESSION、MEDIA_ZOOM、VIEW_END、PROFILE_OPEN、CANDIDATE_VIEWED、AGENT_SHORTLISTED。
字段：actor、目标类型/id、停留毫秒、时间。代码里把它归为敏感个人数据（Nghị định 356/2025 Art. 4.1(l)）。

## 2. 同意怎么拿（按目的分开，统一管线）
- 代码 `internal/consent` 是唯一登记处：每个目的有代码、政策版本、是否可授予。同意有效 = 事件发生时最近一次动作为 GRANT，且现在最近一次仍为 GRANT（`ValidAtSQL`）。
- 目的：`RECOMMENDATION`（推荐）、`TWIN_INSIGHT`（AI 分身好友洞察）、`OPERATOR_AUDIENCE_DETAIL`（运营/帖主逐人明细），政策版本 2026-10-08，均可授予；
  `AD_TARGETING` 已登记但**不提供**授予；`BEHAVIOR_ANALYTICS`（旧单开关）已退役，只能撤回，不再开启采集。
- App「设置与隐私」三个独立开关，**默认关**；服务端先写同意，成功才打开本地开关；读失败 = 不同意。至少一个采集目的开启才产生事件。
- 每个读取方只认自己的目的：引力/推荐、分身洞察、运营明细各自过滤，一个目的的同意不能代替另一个。
- `privacy.purpose_consents` 记录目的、政策版本、动作、时间、来源、ip、user agent；可撤回。

## 3. 实测（开发库）
`go run ./cmd/consent-audit`（只读）：
- 有有效同意：144 条（1 个用户）。
- 事件发生时没有同意记录：1309 条（约 10 个用户，2026-08-16 → 2026-09-27，即默认开 / 闸门之前）。
- 事后撤回：0。
- 2026-10-01 之后的事件全部有先于它的同意记录。

## 4. 已做的收口
- 引力计算（RECOMMENDATION）、分身洞察（TWIN_INSIGHT）、帖子/媒体逐人明细（OPERATOR_AUDIENCE_DETAIL）各自只读「事件时同意有效、现在也没撤回」的事件（COMP-GRAVITY-CONSENT-001、COMP-CONSENT-PIPELINE-001）。\n- 回归闸门核对服务端登记与 App 的目的集合一致。
- 老数据没有删、没有改：怎么处理是产品与法务的决定。

## 5. 待法务确认
1. 无同意证据的 1309 条历史事件：删除 / 匿名化 / 保留（保留的话依据是什么）？
2. 已按用途分开同意（见 §2）：三个目的的告知文案与政策版本是否足够具体？
3. 「精准投流」(`AD_TARGETING`) 已登记但不提供授予：要上线必须单独告知与同意，不能沿用现有三个。
4. 同意的形式是否满足 Art. 6.1 可验证、Art. 6.3 无默认同意（App 默认关，服务端 fail-closed）。
5. 隐私政策里的收集告知、保存期限、删除机制（worker 有 24h / 30 天删除执行器，完整流程未核对）。
6. 运营侧逐人明细的访问范围（ANALYTICS scope，有审计）是否与告知一致。
7. 未收口：`ListProfileViewers`（向主页主人披露逐个访客）未按目的过滤——披露给被访问者本人是否需要单独目的？
8. 未收口：运营 DAU 由事件统计，未按目的过滤——聚合统计是否可免同意，还是应按目的过滤？
