# AGENT_LOCK — kake-geo-honest

- owner: WorkBuddy AI (屿), 2026-09-16
- branch: fix/geo-honest-fixtures
- starting commit: 431c6c37
- task: Phase 0「止血」—— 地图/定位域的伪造数据、临时诊断、死通道清零。
  这是《Proxy 地图/定位管线审计与设计 R1》§6 的 Phase 0，不改架构、不建表、不换地图商。

  核心判断：问题不是"数字是假的"，而是**假数字和真数据在接口上长得一模一样**。
  所以修法是让"没有来源"在类型上可表达，而不是换个数字。

  最刺眼的一处：`capacityFor()` 用一张写死的 map 返回 61/39/74/81 当"容量"，
  `LiveState.FreshUntil` 又把它声明成"5 分钟内有效"，客户端渲染成「容量 61%」
  「数据有效至 14:32」。而仓库里**存在**真实容量来源 ——
  `business.scene_supply_snapshots`（internal/business/operating_resolver.go，
  命令 UpsertSceneSupplySnapshot，商家侧写入）。也就是说这不是"没数据"，
  是"生产方存在、读取方绕过了它"。接上它属于 GEO-SUPPLY-WIRE-001。

- owned files:
  - apps/api-go/internal/realityscene/service.go
  - apps/api-go/internal/realityscene/service_test.go
  - apps/api-go/internal/api/operator_market_execution.go
  - apps/api-go/internal/api/reality_scene_test.go
  - apps/mobile/src/surfaces/reality-scene-map.tsx
  - apps/mobile/src/surfaces/market.tsx
  - apps/market-intelligence-console/src/components/FixtureNotice.tsx（新建）
  - apps/market-intelligence-console/src/pages/{SupplyActivation,Clarification,Engine}.tsx
  - scripts/check-regression-contracts.sh（**仅**第 151 行起的 GEO-HONEST-001 /
    OPS-TELEMETRY-001 两段）
- 已避让：`scripts/check-regression-contracts.sh` 的 GEO-PRECISION-001 条目在
  `kake-geo-precision` 分支（owner: 同一 agent）的第 152 行起。两个分支各自从
  main 出发，合入时该文件会在相邻区域冲突一次 —— 预期内，手工解即可（两段互不依赖）。
  `apps/mobile/src/surfaces/requester-home.tsx` 归 `kake-home-avatar-fallback` 所有，未触碰。
- expires: 2026-09-16（合入后注销）

## 交接证据

- 起点 commit：431c6c37（main 在本会话期间被其他 agent 推进过两次：1b2632da → 431c6c37）
- 负向注入已实测 —— **14 条钉全部确认会变红**，且每条注入都先验证：
  (a) 改动确实写入（`mut.py` 断言 needle 存在 + 写入后复查）；
  (b) 注入后的代码**仍能编译**（否则编译失败会被误读成"钉生效"）；
  (c) 还原后测试回到绿。

  Go 测试钉（7 条，`TestSceneDetailDeclaresFixtureProvenance` /
  `TestOperatorFixtureEndpointsDeclareSource`）：
  - `capacityPct` 复现 → 红
  - `freshUntil` 复现 → 红
  - `human.source` 去掉 → 红
  - `human.sceneFit` 复现 → 红
  - `FitReason` 回到旧假话 → 红
  - `SourceFixture` 常量值改成 "LIVE" → 红
  - `OperatorFixtureSource` 常量值改成 "LIVE" → 红

  契约静态钉（7 条）：
  - `func capacityFor` 复现 → 红
  - `console.log` 复现（地图渲染路径）→ 红
  - 兜底坐标在 `reality-scene-map.tsx` 再次内联 → 红
  - 兜底坐标在 `market.tsx` 再次内联 → 红
  - `"热门探索点"` 复现 → 红
  - `function mapConfig` 死桩复现 → 红
  - 控制台页面不渲染 `<FixtureNotice>` → 红

- **反向注入抓到两个我自己的假守卫**（这是本任务最有价值的产出之一）：
  1. `TestOperatorFixtureEndpointsDeclareSource` 第一版写的是
     `body["dataSource"] != OperatorFixtureSource` —— 拿生产者的常量比对生产者的
     输出，恒真，把常量改成 "LIVE"（即破坏线上协议）测试照样绿。改为钉字面量
     `"FIXTURE"`，因为客户端的 `FixtureNotice` 判断的就是这个字符串。
  2. 契约里控制台那一条第一版是 `grep 'FixtureNotice'`，匹配到的是 `import` 行；
     把 `<FixtureNotice .../>` 从渲染里删掉，import 还在，契约照样绿。
     改为 `grep '<FixtureNotice'`。

- 本任务已跑（**未跑全部门禁**，按 commander 的 standing instruction
  "不要跑全部gate"）：
  - `go build ./...` ✓
  - `go test ./internal/realityscene/ ./internal/api/`（整包）✓
  - `tsc --noEmit`：apps/mobile ✓、apps/market-intelligence-console ✓
  - `vitest run` 场景相关 4 个文件 48 tests ✓
  - 新契约段单独抽出运行 ✓（未跑整个 `check-regression-contracts.sh`）
- 未验证 / 交回 commander：
  - 真机与模拟器上的实际渲染（`容量未知`、`占位候选 · 无匹配评分`、控制台横幅）。
  - **`nearby_places.go` 的路由注册** —— 它有真实的 Photon + Overpass 实现但
    `server.go` 无路由。补路由是**加功能**，不是止血，留到 Phase 2 与定位收链一起做。
  - `TEMP-DIAG-MAPDEAD-001` 当初是为排查"地图退出后手势死亡"加的。诊断已删，
    但**该 bug 本身是否已修我没有独立验证**。若仍在，需要用别的手段重查。
  - 本机 `gofmt -l` 在 main 上就报了一批未格式化文件（`aipersona_handlers.go`、
    `kill_switch.go`、`legal.go`、`privacy.go`、`experience_stream.go`、
    `operator_experience.go`、`operator_final.go`、`operator_remaining.go` 等）。
    这是**既有状态**，非本任务引入；我只格式化了自己改的 4 个 Go 文件。
  - `apps/mobile/dist/` 与 `apps/market-intelligence-console/dist/` 是 gitignore 的
    本地构建产物（未跟踪）。审计中若用 grep 扫全仓，必须排除它们，否则会把陈旧
    产物当成"生产代码里还有 X"。
- 注意：本会话 shell 的 `grep`/`sed` 是 brokered toybox 替身，所有命令必须走
  Step 0 的 `env -u BASH_ENV ... PATH=...` 包装，否则结果不可信。
