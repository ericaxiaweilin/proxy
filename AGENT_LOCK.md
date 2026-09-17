# AGENT_LOCK — kake-geo-precision

- owner: WorkBuddy AI (屿), 2026-09-16
- branch: feat/geo-precision-source-of-truth
- starting commit: 7fea8c99fa0af56e066664fa11fd27404aa8a209
- task: GEO-PRECISION-001 —— 定位精度成为类型化唯一真源。
  仓库里曾同时存在四套互不兼容的精度枚举（Ch17 `L0_AGGREGATE..L4_EXECUTION_PRECISE`、
  Ch17 `precision_level`、R15 `GeoPrecision`、R8 `CITY|COARSE_AREA`）且**没有映射表**，
  导致每个调用点各自猜。所有隐私门（R8 Gate E、INV-SEC-06、AC-MAP-32/33）都依赖精度判断。
  本任务新建 `apps/api-go/internal/geo` 作为唯一真源，并把映射表**刻意钉住**防静默漂移。
- owned files:
  - apps/api-go/internal/geo/precision.go（新建）
  - apps/api-go/internal/geo/precision_test.go（新建）
  - apps/api-go/internal/supply/service.go
  - apps/api-go/internal/supply/service_test.go
  - scripts/check-regression-contracts.sh（**仅**第 152 行起的 GEO-PRECISION-001 一段）
  - AGENT_LOCK.md（本文件）
- 已避让：`scripts/check-regression-contracts.sh` 第 276 行附近是
  `kake-home-avatar-fallback`(owner: opencode) 的 HOME-AVATAR-FALLBACK-001 条目，
  两处相隔 120+ 行，无行级重叠；`apps/mobile/src/surfaces/requester-home.tsx` 归其所有，本任务未触碰。
- expires: 2026-09-16（合入后注销）

## 交接证据

- 起点 commit：7fea8c99
- 负向注入已实测（每条都确认改动写入后才跑）：
  - L1 解锁 VENUE → `TestMappingTableIsPinned` + `TestUnlockLadderMatchesChapter17` 红
  - `AtMost` 反向升精度 → `TestAtMostNeverEscalates` 红
  - 精度表混入第六个值 → `TestPrecisionVocabularyIsClosed` 红
  - 精度声明改成 EXACT → `TestLocationPrecisionRedaction` 红（want CITY）
  - payload 塞 latitude → `TestLocationPrecisionRedaction` 红（递归 key 扫描命中）
  - 每次注入后均 `diff` 确认文件逐字还原
- 未验证（需 commander）：真机 / 模拟器上的地图渲染行为；本任务未改移动端代码。
- 注意：本会话 shell 的 `grep`/`sed` 是 brokered toybox 替身，所有命令必须走
  Step 0 的 `env -u BASH_ENV ... PATH=...` 包装，否则结果不可信。
