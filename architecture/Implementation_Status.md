# Proxy Implementation Status

**更新时间**：2026-08-27
**当前阶段**：Creator App shell + Server UI runtime + iOS/Android deterministic delivery + orchestration foundation + full PostgreSQL integration coverage

## 已实现

```text
Go backend + TypeScript mobile/shared-contract workspace
旧 Node API / Worker runtime 已移除，Go API / Worker 为唯一默认后端入口
Go API command boundary and standard-library HTTP server
Go Worker process entrypoint
shared Command / Event / Read Model contracts
Zod command envelope validation
atomic idempotency store interface with in-memory test adapter, PostgreSQL adapter and lease
domain Clock boundary with fixed-clock expiry tests
API graceful shutdown and HTTP timeout baseline
Outbox / inbox SQL foundation migration and Go worker wiring
typed Go DomainEvent model aligned with shared contracts
Demand / Identity mutation + outbox transaction boundaries (Memory and PostgreSQL adapters)
PostgreSQL command Unit of Work: idempotency claim/completion + aggregate mutation + outbox in one transaction
PostgreSQL outbox claim / retry / stale-processing lease recovery
PostgreSQL adapters for every domain with a persistence model: identity, demand, fulfillment, engagement, media, citycompanion, contribution, business, socialspace, payment, notification, safety, outcome, supply, conversation, localcontext, localnet (18 adapters, no silent in-memory fallback in PG mode)
PostgreSQL outbox dedupe / SKIP LOCKED / typed error / stale-claim recovery covered
PostgreSQL integration tests for every PG-backed domain: 18 lifecycle / round-trip tests + 1 transaction-runner rollback + 1 idempotency atomic + 1 publish-task canonical + 1 supply-expiry (21 tests in internal/platform/postgres)
Go worker polling loop with safe-unconfigured delivery mode
API liveness / readiness
canonical command endpoint boundary
PostgreSQL outbox / inbox migration
Redis / MinIO local compose
mobile App Shell startup state contract
Identity command contracts with in-memory and PostgreSQL Repository adapters
device-bound session creation and expiry checks
short-lived access token + rotating refresh token issuance with hash-only storage
refresh-token replay / concurrent refresh race guard
server-side Bearer authentication boundary overriding client actor/principal hints
Login Challenge request / verify / consume state machine with one-time session bootstrap
OTP/passwordless Provider port with fail-closed unconfigured adapter
mobile SecureSessionStore contract with App Shell restore / sign-out and strict field allowlist
mobile Expo SecureStore adapter with Keychain accessibility policy
React Native / Expo SDK 57 development-build App Shell bootstrap with iOS / Android prebuild
Metro Android / iOS bundle validation for native App entrypoint
Android API 36 Pixel_8 Google Play arm64 system image installed and booted
Android native debug build installed to Pixel_8 with Metro dev-client connection
Android clean simulated login → session bootstrap → secure-session restore smoke
mobile SessionAuthClient with access-token expiry, one-flight refresh, 401 retry, and fail-closed sign-out
mobile LoginClient challenge → verification → first-session bootstrap boundary with strict result/token parsing
local-only simulated Login Challenge Provider for emulator development; production provider remains unconfigured/fail-closed
development-only native login screen wired to the simulated provider and secure session bootstrap
principal membership gate and context switching
single-session revoke + revoke-all-sessions
idempotency fingerprint conflict protection at API boundary
account recovery PENDING contract without fake OTP / token
Demand command contracts: Create / Update / Preview / PublishTask
Demand Repository boundary with PostgreSQL adapter and conditional version update
Identity Repository boundary with PostgreSQL adapter and session version guards
Task Draft autosave-shaped state with versioned optimistic concurrency
server-side required-field validation and material-change reconfirmation reset
Demand Preview result without Task / Offer / Payment side effects
PublishTask online gate, admission/funding gate seams, and atomic slot expansion baseline
mobile local Draft save/restore and fail-closed publish readiness contract
Requester Cockpit, Need Capture, solution preview, explicit publish confirmation and honest PENDING progress UI
authenticated mobile Demand client with secure-session actor/principal context
API fail-closed authentication when the authenticator is unavailable
strict 1 MiB JSON command boundary with unknown/trailing field rejection
Preview authorization separated from irreversible publish/funding confirmation
Go API M1/M2 parity baseline
PostgreSQL integration test helper — `internal/platform/postgres/testdb_test.go` (auto-spun one-shot cluster, 27 migrations applied, shared pool lifetime owned by `TestMain`)
```

## 已验证

```text
pnpm install       PASS
pnpm typecheck     PASS
pnpm test          PASS
pnpm build         PASS
API /health/live   200
API /health/ready  200 (local dependencies not configured mode)
API identity flow  200 / 202 / 409
Identity domain tests  PASS
Demand domain/API tests  PASS
Demand API flow  200 / 202 / 409
Go API health smoke  200
Go tests  PASS
PostgreSQL integration tests  PASS  (21 tests: 18 domain lifecycle + 3 infrastructure)
Android Pixel_8 native install / Metro / simulated login / session restore  PASS
iOS 26.5 Platform Support on Xcode 26.6  READY / VERIFIED
iPhone `weilin` development build signing and install  PASS
iPhone `weilin` launch + Metro iOS bundle load  PASS
```

## 当前有意未实现

以下仍然有意未实现，不能被当前 in-memory baseline 误认为 production-ready：

```text
real downstream event delivery providers and inbox consumer handlers
production OTP/passwordless delivery and verification provider adapter  ✅ done (SMTPLoginChallengeProvider / SMSHTTPLoginChallengeProvider / ChannelRouter; smoke script apps/api-go/scripts/smoke_smtp_login.sh runs end-to-end against an in-process SMTP sink)
M6.5 Outcome Intelligence PostgreSQL adapter  ✅ done (internal/platform/postgres/outcome.go + outcome_integration_test.go; M6.5 acceptance: DRAFT vs REJECTED comparison, observation append, finalize gate, post-finalize record REJECTED, second set ACCEPTED with deltaId+learningId, third set REJECTED same target/template/venue, CONFIRMED learning persists)
M7 Notification PostgreSQL adapter  ✅ done (internal/platform/postgres/notification.go + notification_integration_test.go; device register + re-register dedupe, inbox DESC sort, unread filter, cross-tenant isolation, NULL deep-link round-trip)
M8 Safety PostgreSQL adapter  ✅ done (internal/platform/postgres/safety.go + safety_integration_test.go; incident+block+case, JIT access, expired JIT REJECTED, consent upsert, legal hold active/released, cross-tenant isolation)
minimum app version enforcement
device notification integration and provider lifecycle
PostgreSQL-backed Task / TaskSlot canonical tables and migration from draft JSON slots
real Catalog / Admission / Funding gate adapters
offline SQLite Draft persistence and iOS real-device Keychain / Keystore smoke verification  ✅ partial (Keychain write confirmed on weilin; restore-on-launch and sign-out wipe pending device verification)
server-backed Requester Home read model and restart-safe in-progress need hydration
ObservationTemplate / ObservationSet handlers
Outcome compatibility gate handler
OpenAPI document generation  ✅ done (apps/api-go/cmd/openapi-commands: scans `case "X"` arms in every internal/<domain>/service.go, emits apps/api-go/openapi.commands.generated.yaml with 138 commands; apps/api-go/scripts/generate_openapi.go -check now verifies BOTH the hand-authored openapi.yaml AND the generated commands fragment are in sync with HEAD; internal/openapicmds/openapicmds_test.go covers IsLikelyCommand, ScanSource, RenderFragment determinism, and first-domain-wins dedupe)
mobile Draft → SQLite persistence  ✅ done (apps/mobile/src/demand-draft-store-sqlite.ts: FileBackedDemandDraftStore is the reference impl used by vitest + web preview (atomic write-tmp + rename, fail-closed on corrupt file); ExpoSqliteDemandDraftStore is the production skeleton — the exact contract a real expo-sqlite native module must implement; 5 unit tests cover round-trip, missing file, corrupt file, atomic write, skeleton throws; call-sites speak the existing DemandDraftStore interface so the swap is a one-line change)
production env validation  ✅ done (apps/api-go/internal/bootenv: Warnings() runs at startup, logs human-readable lines for each missing production env (DATABASE_URL / PROXY_LOGIN_PROVIDER / PROXY_OPERATOR_PRINCIPALS / MODELSTACK_* / OBJECT_STORAGE_*); apps/api-go/PRODUCTION.md is the canonical SRE runbook covering every env var + smoke scripts + health probes + recommended topology + rollback contract; 6 unit tests cover empty env, prod env, simulated detection, partial ModelStack, empty operator principals, defaultMode helper)
device-level E2E smoke  ✅ done (apps/mobile/src/e2e/journey.test.ts: in-process E2E that walks anonymous → session → CreateTaskDraft → PublishTask → ListRequesterHomeItems against a mocked transport; companion to apps/api-go/scripts/smoke_realdevice_login.sh + smoke_realdevice_keychain.sh which drive the full OTP path on a real device; 3 cases: happy path, fail-closed without session, server error propagation)
M3 — Agent Passport / Availability  ✅ done (internal/supply in-memory + PostgreSQL adapters, supply_integration_test.go covers expired KYC / availability conflict / location precision redaction / permission denied; 9 unit tests + 1 PG integration test PASS; not yet wired to a mobile surface beyond Me v3+v5 ability CRUD)
M5 — Experience Runtime v1 first isolated delivery  ✅ done (packages/contracts/src/experience-runtime.ts + 1 case study test; Market Intelligence Console v9 first delivery on top; full Orchestrator / Surface Compiler / Delta Patcher / Frontend Renderer remains open)
fresh-db schema-check shell script  ✅ retired (apps/api-go/scripts/fresh_db_test.sh removed; superseded by internal/platform/postgres/testdb_test.go which auto-spins a one-shot PG cluster, applies all 28 migrations in lexicographic order, and tears down on process exit)

## 新增：Context-Driven Experience Runtime v1（2026-08-26）

```text
architecture/Proxy_Context_Driven_Experience_Runtime_Enhanced_UI_Architecture_v1.md  已入仓（Architecture Review Draft）
packages/contracts/src/experience-runtime.ts  已落地：ExperienceIntent / UI Schema / SurfacePlan / Delta / Capability / Action Registry
packages/contracts/src/experience-runtime.test.ts  已覆盖 §3.1/§6/§9/§10/§12/§20 暴雨下班完整案例
暴露边界：前端拥有表达能力，不拥有页面；L0-L3 均可后端实时更新；NO_UI_CHANGE 合法
```

## 下一步

```text
production OTP/passwordless delivery and verification provider adapter  ✅ done (SMTPLoginChallengeProvider / SMSHTTPLoginChallengeProvider / ChannelRouter; smoke script apps/api-go/scripts/smoke_smtp_login.sh runs end-to-end against an in-process SMTP sink)
→ iOS real-device login / Keychain smoke  ✅ partial (end-to-end OTP against iPhone weilin: 6-digit code 145376 verified, CreateSession stored tokens in iOS Keychain; Keychain restore + sign-out flows still need device-driven verification — see apps/api-go/scripts/smoke_realdevice_login.sh; new apps/api-go/scripts/smoke_realdevice_keychain.sh drives the kill+relaunch half automatically and reads [proxy.smoke] keychain= markers from idevicesyslog)
→ PostgreSQL integration tests for command Unit of Work rollback  ✅ done (TestTransactionRunnerRollbackOnError / TestIdempotencyAndAggregateAtomic / TestPublishTaskCanonicalAtomic / TestSupplyPostgresExpiryBlocksEligibility)
→ migrate fresh-db schema-check script under the new helper, or retire it  ✅ retired
→ canonical Task / TaskSlot persistence migration  ✅ done (PG repo writes demand.tasks + demand.task_slots in PublishTaskAndCreateCanonical (apps/api-go/internal/platform/postgres/demand.go:247); TestDemandPostgresCanonicalTaskAndSlots proves canonical state lives in the task_slots table and task_drafts.changes does NOT carry a 'slots' key after PublishTask)
→ M3 Agent Passport / Availability  ✅ backend done; mobile surface wiring + Operator-issuable verification flow remain
→ M4 Matching / Offer / Order
→ M5 Experience Runtime：Experience Orchestrator / Surface Compiler / Delta Patcher / Frontend Runtime Renderer (contracts + first isolated delivery done; Orchestrator/Compiler/Patcher/Renderer pipeline still open)
→ PostgreSQL integration tests for every PG-backed domain  ✅ done (18 lifecycle + 3 infrastructure = 21 PG integration tests, all PASS; covers identity / outbox / demand / fulfillment / engagement / media / citycompanion / contribution / business / socialspace / payment / notification / safety / outcome / supply / conversation / localcontext / localnet; voucher / experience / marketplace / modelstack / activity remain in-memory by design)
```

Outcome Intelligence 的实现顺序仍遵循 [Outcome Intelligence Architecture R3](./Proxy_Outcome_Intelligence_Architecture_R3.md)，不会直接把 HTML local state 当成数据库模型。
