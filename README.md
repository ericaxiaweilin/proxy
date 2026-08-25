# Proxy

Proxy 是 App-first 产品：Requester、Agent、Business 共用一个 iOS / Android App；Operator Console 仅供内部使用。

## 当前实现：Go Backend + App Foundation + M1/M2 baseline

当前代码从架构基线开始实现：

```text
Go backend + TypeScript mobile/shared-contract workspace
→ shared Command / Event / Read Model contracts
→ API health + canonical command boundary
→ Worker / Outbox skeleton
→ PostgreSQL foundation migration
→ mobile App Shell state contract
→ Identity / Session / Principal in-memory domain baseline
→ API idempotency conflict protection
→ Demand Draft / Preview / PublishTask gate baseline
→ Requester Cockpit / Need Capture / Preview / explicit publish confirmation
→ PostgreSQL command Unit of Work (idempotency + aggregate + outbox)
```

架构入口：[`architecture/README.md`](./architecture/README.md)

UI / 设计规范唯一入口：[`docs/design/README.md`](./docs/design/README.md)。当前全局基线是 R3；旧 preview 与 R1 图标母版只在归档目录中保留，不能作为生产实现依据。

常用命令：

```bash
pnpm install
pnpm check
pnpm dev:api
```

默认后端入口是 Go：API 使用 `pnpm dev:api`，Worker 使用 `pnpm dev:worker`。旧 Node 后端运行路径已移除；当前 Identity、Demand 仍支持 in-memory 开发 adapter，PostgreSQL 模式会把幂等记录、领域写入和 Outbox 放在同一事务。PublishTask 的 Admission/Funding gate 未配置时会返回 `PENDING`，不会伪造发布、支付或 Offer。

本地模拟登录可以显式启用：

```bash
PROXY_LOGIN_PROVIDER=simulated PROXY_SIMULATED_OTP_CODE=123456 pnpm dev:api
```

模拟账号固定为 `user_001` / `login_001` / `device_001`，支持 `INDIVIDUAL:user_001` 和 `BUSINESS:business_001`。该 Provider 只存在于本地开发路径，挑战在内存中保存 hash、5 分钟过期且只能使用一次；没有配置真实 Provider 时，后端仍然 fail-closed。
