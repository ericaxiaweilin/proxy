# 最新开发基线梳理 — 2026-09-19

两天（09-17 下午 → 09-19）没跟，仓库已经换了一茬。这一份是为了在我继续动手之前
把"现在站在哪儿"说清楚，尤其是**我 09-17 那批工作还剩哪些**。

## 一、代码状态

| 项 | 值 |
|---|---|
| HEAD | `7cd531a` fix(ui): 个人主页搜索弹层从底部改为顶部弹出（09-18 09:04） |
| 分支 | `main`（另有 8 个 feat/fix 分支指向同一点，已合入；还有一批 `backup/*` 历史分支） |
| 设计基线 | **Rev 236**（`docs/design/CURRENT_BASELINE.json`，updatedAt 2026-09-19） |
| 未提交暂存堆 | **89 个文件，+7211 / −2440**（在飞工作，见第四节） |
| 门禁 / git | 当下**无人**在跑门禁、无 git 进程持有锁 |

## 二、Rev 227 → 236 都做了什么

| Rev | 日期 | 回归 ID | 内容 |
|---|---|---|---|
| 227 | 09-17 | MAIN-WIRING-SPLIT-001 | `cmd/api/main.go` 接线按域拆成 `wire_*.go`（审计 §一.5 那条 1387 行单点） |
| 228 | 09-17 | CONVO-ATTACH-002 | 相机图标合并为相机位 + 全量相册网格（修 001 遗留：首格跳系统相机、只查图片、硬编码 24 张上限、逐张 `getUri()` 触发 iCloud 下载、没带 mimeType 导致 HEIC 声明成 JPEG） |
| 230 | 09-17 | UNREAD-PIPELINE-001 | **未读徽标真管线**：服务端按阅读位算未读数下发、打开会话上报已读；在线圆点直接删（presence 另立项） |
| 231 | 09-17 | BADGE-WALL-001 | 个人徽章墙 + 场景进度，数据源是新增 `ListMyCheckinHistory` |
| 232/233 | 09-17 | SHEET-ICONS-001 | ＋ 面板文字行换 56px 图标块，新增 `pin` 形；删视频行 |
| 234 | 09-18 | PROFILE-SEARCH-DOCK-001 | 个人主页搜索换 Home 同款浮条 |
| 235 | 09-19 | SCENE-HUMANS-004 / SCENE-NAV-PIN-001 / SCENE-STUDIO-001 | 场景人选去重；地图图钉改快打卡（导航/看详情二选一）；场景 Studio 出图 |
| 236 | 09-19 | CREATOR-HANA-NAM-001 | 首页真人推荐里的 Hana / Nam 从 stock 占位转正为真人账户 |

另外两个不带 Rev 但重要的后端提交：`ORPHAN-SWEEP-001`（清 qb 调试脚本 + 孤儿包
ai/creator/scale + migration 撞号防重门禁）、`AUDIT-BATCH3-001`（分享链接 / 收藏空态 /
法律横幅 / 漏斗文案 / 假脸）、`GEO-HONEST-001`（地图/场景域伪造数据清零）、
`GEO-PRECISION-001`（定位精度成为类型化唯一真源）。

## 三、我 09-17 那批：只剩一条活着（诚实交代）

我 09-17 做的工作**只有 `ORPHAN-SWEEP-001` 真正落地**，其余 5 条的代码和门禁钉都
被别人的 index-only 提交扫掉了（这是多 agent 共享同一个 index 的固有风险，不是谁的错）。
逐条现状：

| 我的条目 | 现在还在吗 | 说明 |
|---|---|---|
| ORPHAN-SWEEP-001（孤儿包 + cmd/qb） | ✅ 已落地 | 同 ID 被团队提交 `dbac756` 收录，钉在门禁里 5 处 |
| SCENE-HUMANS-DEDUP-001（人选去重） | ✅ 被团队以 `SCENE-HUMANS-004` 重做 | Rev 235，同一件事 |
| SCENE-HUMANS-EMPTY-001（人选空态） | ❌ **仍开放** | 004 只做了去重，空态没人做 |
| MARKET-DEAD-MORE-001（4 处死「•••」） | ❌ **仍开放** | `market.tsx` 现在又是 4 处 |
| PUBLISH-NO-FAKE-DEFAULT-001（表单预填） | ❌ **仍开放** | `market.tsx:1235/1237/1241` 预填又回来了 |
| OPP-TYPE-OTHER-001（未分类兜底） | ❌ **仍开放** | `return "coffee_photo";` 又回来了 |
| 41 漏斗 / 36 分享链接 / 38 假脸 | ✅ 被团队以 `AUDIT-BATCH3-001` 做了 | 我工作区那份 me.tsx 编辑已被新版本覆盖，结果一致 |

顺带说一句：`UNREAD-PIPELINE-001` 是**按我 09-17 那条订正走的** —— 服务端先出
阅读位聚合、再下发未读数，而不是审计原话的"补两行映射"；在线圆点按半截接线纪律删掉。
那条订正判断是对的。

我写的 `architecture/Audit_Verification_2026-09-17.md`（27–41 核验）**文件本身也丢了**，
同样是被扫掉的。里面的两条订正结论现在只剩上面这段记录。

## 四、暂存堆里的 89 个文件在做什么（在飞，未提交）

- **后端**：`internal/api/age_assertion.go`（年龄断言）、`aipersona` 分发与 handlers 大改、
  `identity` / `mockidentity` / `business` / `localnet` / `fulfillment` / `conversation` 服务改动，
  migrations `102/103/104`（threebeans_bn 勘察、offer topic invite、store amenities），
  openapi 命令集重新生成。
- **移动端**：新增 `ai-persona-client.ts`、`post-impression.ts`、`behavior-analytics-settings.ts`、
  `components/peer-follow-prompt.tsx`、`surfaces/coffee-scenes.tsx`；
  `scene-studio.test.ts`、`threads-post-media.test.ts`、`post-impression.test.ts` 等新测试；
  **删除** `surfaces/status.tsx`、`surfaces/community.tsx`、`components/folder-manager.tsx`。
- **门禁**：`scripts/check-regression-contracts.sh` +502 行（新增的钉）。
- **审计**：新增 `architecture/Personal_Profile_Design_Parity_Audit_2026-09-18.md`。

## 五、协作约束（继续动手前必须知道的）

1. **index-only 提交会扫掉别人的 staged。** 我这次 5 条就是这么没的。所以要落地的东西
   **必须自己提交**，别指望它留在 index 里等到你回来。
2. **基线敏感文件改动必须同提交更新** `docs/design/BASELINE_CHANGELOG.md` +
   `CURRENT_BASELINE.json`（Rev +1）。现在敏感名单里有：`me.tsx`、
   `reality-scene-map.tsx`、`conversation.tsx`、`market.tsx`、`me-styles.ts`、
   `proxy-icon.tsx`、`cmd/api/main.go` 等。
3. **每个回归 ID 必须在 `scripts/check-regression-contracts.sh` 留钉，且做过反向注入。**
   没见它变红的钉不算钉。
4. `me.tsx` 现在工作区比暂存版多一行（搜索结果加"我的回复/动态"前缀），是我之外的人改的，
   跟我无关，别顺手带进我的提交。
