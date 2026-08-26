# Proxy Architecture

**Current baseline**：App-first Modular Monolith · v1.5.2 Prototype · Chapter 21D R3 FINAL · P0 Addendum R3 FINAL ALIGNED

最新实现基线与品牌/PRD Handoff：

- `Proxy_Brand_Final_Handoff_v1.0(1).zip`
- `Proxy_Free_Prototype_v1.5.2_Outcome_Finalization_FINAL.html`
- `Proxy_PRD_v1.1_Chapter21D_Outcome_Data_Learning_Contract_R3_FINAL.md`
- `Proxy_PRD_v1.1_P0_Engineering_Acceptance_Addendum_R3_FINAL_ALIGNED.md`

Proxy 是 iOS / Android App-first 产品。Requester、Agent、Business 共用同一个 App；Operator Console 仅供内部人员使用。

阅读顺序：

1. [System Architecture](./Proxy_System_Architecture_v1.md)
2. [Architecture Decisions](./Proxy_Architecture_Decisions_v1.md)
3. [Outcome Intelligence Architecture R3](./Proxy_Outcome_Intelligence_Architecture_R3.md)
4. [Context-Driven Experience Runtime v1](./Proxy_Context_Driven_Experience_Runtime_Enhanced_UI_Architecture_v1.md) — 前端不再拥有页面，页面由后台根据 Context 实时编译
5. [Luna Implementation Handoff](./Luna_Implementation_Handoff.md)
6. [Implementation Status](./Implementation_Status.md)

内部后台（与 App/API 物理隔离）：

- Market Intelligence Console v9 — `apps/market-intelligence-console/`（`index.html` 原型 + 独立 `package.json`，不与 `apps/mobile` 复用组件/store）

架构依据：Canonical Registry、Chapter 20/21/21A/21B/21C/21D/25/26，以及 P0 Engineering Acceptance Addendum R3。

## 当前落地顺序

```text
Foundation Slice
→ Identity / Session / Principal
→ Demand Draft / Preview / Commit
→ Matching / Offer / Order
→ Payment / Ledger
→ Execution / Evidence
→ Outcome Intelligence / Satisfaction / Memory
→ Inbox / Safety / Business / Operator
```

Outcome Intelligence 不作为前端页面孤立实现；它必须由 Domain Gate、Outbox Event 和 Read Model 共同落地。
