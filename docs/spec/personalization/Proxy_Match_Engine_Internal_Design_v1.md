# 撮合引擎内部设计 v1（对照 Ch.05 / Ch.06 / 检索匹配与治理规则 v0.4）

代码：`apps/api-go/internal/matchengine`；账：`matching.decisions`（迁移 200，只追加）。

## 一次撮合 = 一个 snapshot
检索（附近 30km）→ 资格门链（逐人给结论）→ 排名（`matching.Rank`，旋钮可调）→ 有限候选集（含新人探索位）→ 落账。

| 环节 | 实现 | 状态 |
|---|---|---|
| 资格门 | Exclusion / Account / Safety / Permission / UserBlock / Location；任一读不出来 = fail-closed（`GATE_UNAVAILABLE`） | 已做 |
| 每个候选一条结论 + 原因码 | `matching.decisions`（gate / reason / organic_rank / in_set / exploration / rank_version） | 已做 |
| 口径版本 | `RankVersion` = 旋钮指纹，改系数即变 | 已做 |
| 有限候选集 + 探索位 | `SetSize`，最后一位给确定性新人探索 | 已做 |
| 供给健康 | `Health{Retrieved,Qualified,CandidateN,ByReason,Thin,Empty}` | 已做 |
| 运营可查 | 预览带 snapshot/版本/未过门名单；`GET /v1/operator/matching/explain` | 后端已做；控制台页未做 |
| 接入点 | 市场邀请（FAST）、撮合预览 | 已接；任务路径 `supply.evaluateEligibility` 未迁 |

## 未建（Ch.05 §126 之外 / 后续）
rerank API、运营人工干预 §112、赞助位、learning-to-rank、多 slot 编排、放宽条件建议（规则已定：不放宽半径/时间）。
