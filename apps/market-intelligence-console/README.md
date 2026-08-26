# Proxy Market Intelligence Console — v9 Market Execution

**定位**：独立内部后台（Internal Only），与 Creator App（`apps/mobile`）、Backend API（`apps/api-go`）物理隔离。只通过受控 BFF / Canonical Command 读写数据，不直连数据库。

> 原型来源：`proxy_market_intelligence_console_v9_market_execution.html`（170KB 单文件原型，含 Intelligence / Decision Engine / Context & Experience / Market Execution / Market / Data 六大区）

## 文件夹隔离

```
apps/market-intelligence-console/   ← 本控制台（独立）
  index.html                        ← v9 原型静态入口（可直接 open）
  prototype/v9_market_execution.html← 归档原型（只读，不作为生产依据）
  src/                              ← 未来 React/Next 实现（待建）
  package.json                      ← 独立依赖，不与 mobile/api-go 共享
apps/mobile/                        ← Creator App（React Native）
apps/api-go/                        ← Backend API + Worker（Go）
packages/contracts/                 ← 共享契约（Zod/OpenAPI）
```

**隔离原则**：
- 控制台不复用 `apps/mobile` 的组件或 store；如需共享设计系统，抽到 `packages/ui` 而非直接 import。
- 控制台所有写入走 `POST /v1/commands/*` 或 `POST /v1/operator/*`，需 `OperatorAccessGrant` + SSO/MFA + JIT。
- 控制台读取使用 `GET /v1/operator/*` 或 `GET /v1/market-intelligence/*`，字段级脱敏（D4/D5 不落地浏览器日志）。
- 单独部署单元：`market-intelligence-console` 可独立发版，不阻塞 App/Api。

## 原型预览

```bash
open apps/market-intelligence-console/index.html
# 或
npx serve apps/market-intelligence-console
```

原型侧边栏已按 v9 定版：
- Intelligence：总览 / 用户构成 / 行为与兴趣 / 标签中心 / 意图与撮合 / 编排与调度
- Decision Engine：引擎总览 / API Runtime / State / Policy Resolver / Feature DSL / Tag Utility / 策略阈值 / Decision Trace
- Context & Experience：Context/Gravity Field / Surface Composition / Geometry Research
- Market Execution：Clarification Gate / Supply Activation / Execution Runtime / Fulfillment Attribution（本次 v9 新增）
- Market：商家与投放 / 留存与复购 / 信任与风险
- Data：数据治理 / 交叉分析工作台

## 与新架构的关系

- 本控制台是 `architecture/Proxy_Context_Driven_Experience_Runtime_Enhanced_UI_Architecture_v1.md` 的 **运营侧观测面**：可查看 `ExperienceIntent / SurfacePlan / Delta / PatternRegistry / Metrics`，但不绕过 `PolicyRuntime` 直接改 UI。
- v9 新增的 Market Execution 页（clarification / supply / execution / attribution）对应 `apps/api-go/internal/experience/runtime` 的 `Compiler / Throttler / Budget / Privacy`，后续由 `GET /v1/experience/surface /delta /metrics` 驱动真实数据替换原型 mock。

## 下一步（不阻塞 App）

- [ ] `src/` React 接线：替换原型 mock 为真实 Operator API
- [ ] Operator 鉴权：SSO + MFA + `OperatorAccessGrant` 中间件
- [ ] 接入 `experience/metrics` 与 `decision/trace` 真实数据源
