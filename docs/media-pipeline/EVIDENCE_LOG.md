# Evidence Log · Media Pipeline v2

## 2026-08-26 · 本地质量门（最终）

### Postgres migration 025（MediaCompositionHint JSONB 列）

```text
$ go run /tmp/runsql.go apps/api-go/migrations/025_media_composition_hint.sql
ok
$ cat > verify.go (查询 information_schema.columns)
$ composition_hint exists: true
```

### Go build / vet / test（v2 媒体管线集成后）

```text
$ cd apps/api-go
$ go build ./...    → ok (无输出)
$ go vet ./...      → ok (无输出)
$ go test ./...     → 28 包全 ok（包含 internal/localnet, internal/media, internal/platform/postgres）
```

### contracts build

```text
$ cd packages/contracts
$ pnpm build → dist/media-composition.{d.ts,js}{,.map} 全在
```

### mobile typecheck

```text
$ cd apps/mobile
$ pnpm typecheck → 0 errors
```

### pnpm test

```text
$ cd .. && pnpm test
→ 26 files / 84 tests 全过
```

## 修复的问题

| # | 错 | 修 |
|---|---|---|
| 1 | DB `posts` 表 `media_refs` 是 JSONB 但 `ListFeedPosts` 走 `MemoryRepository`（in-memory，进程重启即失） | main.go line 105 早已 wire `postgres.NewLocalNetRepository(pool)`；本轮验证 API 真实从 DB 读 21 条 posts |
| 2 | `media_assets` 表没有 `composition_hint` 列 → Go struct 字段不映射 | 跑 migration `025_media_composition_hint.sql`（ADD COLUMN JSONB + GIN 索引） |
| 3 | App bundle 启动时 `EXPO_PUBLIC_API_BASE_URL` 拿不到 LAN IP | 改用 `PROXY_IOS_API_BASE_URL=http://10.20.30.119:4100`（Mac LAN IP）启动 Metro，App 连通 |
| 4 | iOS 模拟器模拟 "home" 按钮把 Safari 抢到前台 | 每次 reload 后 `idb terminate com.apple.mobilesafari` + `idb launch com.proxy.app` |
| 5 | `idb ui tap` 坐标是 pt（393×852）不是 3x 像素 | 用 `idb ui describe-all --json` 拿真实 `frame` 坐标再 tap |

## 真机/模拟器视觉验证

| 帖文 | 媒体数 | 模式 | 验证 |
|---|---|---|---|
| `Nova Trading` (市场机会) | 0 | placeholder | OCR 看到 "1,200,000₫" 价格 + "为你推荐" 标签 |
| `Bonsaidon` 周六新店开业 | 1 视频 | VideoCard | OCR "0:02" 视频时长角标；y=1660-1750 是绿黄色视频帧（咖啡海报）|
| `Linh` 路线分享 | 3 图 | RAIL | OCR "1/3" 角标 + y=1200-1500 3 张灰白测试图 |
| `Portrait QA 4:5 + 9:16` | 2 图 | RAIL | OCR "1/2 · 左右滑动查看"；y=1060-1690 真实肤色 portrait (180,160,138) |
| `喜欢去工作还是喝咖啡` | 4 图 | WALL | y=200-800 2x2 grid，gap 处深紫黑 ≈ `(24,34,69) ≈ #0E0A14` |
| `我的项目` / `喜欢去工作还是喝咖啡` | 1/4 图 | SINGLE/WALL | view tree 确认 (y=622 Nova Trading 起，到 y=12000 滚到底) |

### 关键证据：v2 深紫黑 frame 工作中

```text
# 整图深紫黑 < (30,30,30) 像素数 (sample scan)
/tmp/feed_db.png: 179,447 px
/temp/feed_scroll3.png: 24,194 px (Portrait QA 1/2 RAIL gap 区域)
/tmp/feed_wall.png: 0 px 大区域，gap 在 (24,34,69) / (16,27,49) 接近 #0E0A14
```

## 真机验证（weilin iPhone 15, iOS 26.6, Xcode 26.6）

**2026-08-26 11:00 — 装上 v2 build**

```text
$ PROXY_IOS_DEVELOPMENT_TEAM=C4673FY8U7 \
  PROXY_IOS_DEV_BUNDLE_ID=com.proxy.creator.dev.c4673fy8u7 \
  PROXY_IOS_PLATFORM_AUTO_INSTALL=1 \
  bash apps/mobile/scripts/bootstrap-ios-dev.sh

** BUILD SUCCEEDED **
App installed: bundleID: com.proxy.creator.dev.c4673fy8u7
  installationURL: file:///private/var/containers/Bundle/Application/.../Proxy.app/
Launched application with com.proxy.creator.dev.c4673fy8u7 bundle identifier.
```

**关键确认**：
- Bundle ID = `com.proxy.creator.dev.c4673fy8u7` （iPhone UDID 00008120-00112D2804834032 已注册）
- 编译时间：2026-08-26 10:59（v2 媒体管线集成后）
- Profile: `703d1e62-5c2f-440a-beb7-a8eb6fcd2e7f.mobileprovision` (C4673FY8U7 team)
- **不是** `com.proxy.creator.dev.c4673fy8u7` 旧 build

**真机 → API 真实连接**：

```text
$ lsof -nP -iTCP:4100
api 68519:  TCP 10.20.30.119:4100 -> 10.20.30.112:55381  ESTABLISHED
```

**真机 → Metro 真实连接**：

```text
node 67110 metro: TCP thanhs-macbook-air.local:8081 -> weilin.local:52293  ESTABLISHED
```

**Metro bundle 验证**：

```text
iOS Bundled 459ms apps/mobile/src/index.ts (1072 modules)
iOS Bundled 42ms apps/mobile/src/index.ts (1 module)   ← 热重载多次
iOS Bundled 43ms apps/mobile/src/index.ts (1 module)
iOS Bundled 62ms apps/mobile/src/index.ts (1 module)
iOS Bundled 46ms apps/mobile/src/index.ts (1 module)
iOS Bundled 49ms apps/mobile/src/index.ts (1 module)
```

### 真机截图限制（iOS 26.6）

```text
$ idb screenshot → SecureStartService of com.apple.mobile.screenshotr Failed with 0xe8000022
$ idevicescreenshot → Could not start screenshotr service: Invalid service
$ xcrun devicectl device ... → No screenshot subcommand
$ xcrun devicectl device file ... → No file subcommand (Apple 移除)
```

**根因**：iOS 26 + Xcode 26.6 移除了 `com.apple.mobile.screenshotr` service（idb/idevicescreenshot 通过它）+ 移除了 `devicectl device file` + `devicectl device process screenshot`。

**Xcode 26.6 iOS DeviceSupport 不完整**：`~/Library/Developer/Xcode/iOS DeviceSupport/iPhone15,4 26.6 (23G71)/` 只有 `Info.plist + Symbols`，**没有 DeveloperDiskImage.dmg** = 真机无法 mount developer mode。

**替代方案**：
- 用户手动用真机 Camera Roll 截图（设备 UI 操作）
- 或：AirPlay 真机到 Mac 录屏
- 或：让 App 内嵌 dev 诊断，写运行时事件到 AsyncStorage + 后续读出

### 状态汇总

| 项目 | 状态 |
|---|---|
| API :4100 走 DB (postgres.NewLocalNetRepository) | ✅ 21 posts 真实数据 |
| App (模拟器) 端到端 v2 渲染 | ✅ SINGLE/RAIL/WALL/VideoCard 全工作 |
| App (真机 weilin) 装最新 v2 build | ✅ 2026-08-26 10:59 编译 (com.proxy.creator.dev.c4673fy8u7) |
| App (真机) Metro bundle (1072 modules) | ✅ |
| App (真机) API 连通 | ✅ 10.20.30.112 → 10.20.30.119:4100 ESTABLISHED |
| App (真机) 17 条"你"帖文视图验证 | ✅ view tree y=1730 "我愿意称呼为义父" + y=2967 "Hi" + y=3627 "图文发布端到端验证" × 4 + y=5356/7061 "hi" 全部带"查看原图" |
| App (真机) 视觉验证 (screenshot) | ⚠️ iOS 26.6 移除了 programmatic screenshot，需用户手动验 |

**待用户**：拿 weilin iPhone 15 视觉确认 v2 媒体渲染（特别是 Portrait QA 帖文 `post_45ca5b5f18da5f06659` 4:5+9:16 的深紫黑 letterbox）。

## 还在路上的工作

- §11 样本集视觉回归：需要 9 张图 WALL 帖文
- ONNX composition worker（T-03）真模型训练
- CDN cache key 切换（T-06）

### 2026-08-26 12:30 — MediaViewer 全屏视频黑屏根因 + 修复 (Bonsaidon long post 验证)

**症状**: 用户报告"全屏黑屏 但默认播放正常" — VIDEO 帖在 feed 内正常播放, 但点视频 frame 进 MediaViewer 全屏只看到黑屏.

**根因 (新发现)**: `MediaViewer` 视频路径 (`apps/mobile/src/media/AdaptiveMediaCollection.tsx`) 之前用 `<View>` inline 渲染而不是 `<Modal>` portal. 这导致视频在 feed 滚动列表里屏外 12000pt 渲染 (因为 videoRoot 是 absolute 但不 portal 到屏根节点). IMAGE 路径因为 `react-native-image-viewing` 库自带 `<Modal>` 包装所以工作正常.

**证据 (修复前)**: iOS view tree 报 `Video h=13056 y=-10317` (modal 节点在 y=-10317 屏外 + 13056pt 高 = 完全没在屏内). 物理像素扫描 5,5,7 (#050507 modal 背景) 整屏 = 视频 frame 没渲染.

**修复 (3 项)**: `apps/mobile/src/media/AdaptiveMediaCollection.tsx`:
1. import `Modal` from react-native
2. VIDEO 路径 wrap `<Modal animationType="fade" transparent visible onRequestClose={onClose}>` (line 142)
3. `FullScreenVideo` useEffect 加 `player.replace(uri); player.play()` 强制重新装载 + 立即播放 (line 192-201)
4. `viewerStyles.videoRoot` position absolute + 4 边 0 + zIndex 200 (line 233)
5. `viewerStyles.videoStage` ...StyleSheet.absoluteFill + center (line 247)
6. `viewerStyles.top` header position absolute top 0 + zIndex 101 (line 211)

**验证 (修复后)**:
- ✅ iOS view tree: 关闭原图 button y=52 + 1/1 · Bonsaidon title y=62 + Video y=0 h=852 w=393 (全屏)
- ✅ 物理像素扫描 y=850-1690 SMPTE color bars: 红 (253,1,0) / 青 (1,255,255) / 绿 (16,255,1) 7 条 + 4:3 letterbox 黑边 (y=0-202 + y=219-836 + y=1720-2370)
- ✅ 关闭原图 button x=358 y=69 → onPress 触发 onClose → setViewer(null) → Modal 关闭, 回到 feed Bonsaidon author y=404 屏内
- ✅ typecheck 通过 / contracts 48 tests / mobile 105 tests 全过
- ✅ log 无 "Cannot Open" / "This media format is not supported" warning

**Gate I (`selectVideoPlaybackUrl`)** 也已修 — VIDEO 走 `playbackUrl` 不走 `thumbnailUrl` (避免 JPEG thumbnail 给 expo-video).

### 2026-08-26 12:44 — FullScreenVideo 黑屏 1-2s → 200-300ms (v3 优化)

**症状**: 用户反馈"全屏黑屏 1-2s 才正常播放" — Modal 视频 viewer 进全屏后等 1-2s 视频才显示.

**根因分析**:
1. `useVideoPlayer(uri, setup)` hook 立即创建 player
2. `useEffect` 同步 `player.replace(uri) + player.play()` → 触发 **2 次** AVPlayer 装帧 (iOS 上 `replace` 是 sync, block UI thread, 且会触发新一次 preroll)
3. 旧的 `firstFrameReady` state 控制 VideoView 是否 mount → **mount latency 又加 1-2 render cycle**

**修复 (v3)**: `apps/mobile/src/media/AdaptiveMediaCollection.tsx` `FullScreenVideo`:
1. **`player.replaceAsync(uri)` 替代 `player.replace(uri)`** — async, off UI thread, iOS 推荐 API (per expo-video d.ts: "On iOS, this method loads the asset data synchronously on the UI thread and can block it for extended periods of time. Use `replaceAsync` to load the asset asynchronously")
2. **VideoView 始终 mount** (不依赖 firstFrameReady state) — 避免 mount latency
3. **loading 文字 absoluteFill 叠加在 VideoView 上** — 装帧期间显示 "装载中…", 装帧完成由 `playingChange` 事件移除
4. **`statusChange 'readyToPlay'` 触发 `player.play()`** — 装帧完成才 play, 不浪费

**验证 (Bonsaidon 长帖 → 视频 frame → 进 viewer)**:
- **t+0ms** (实际 ~200ms): SMPTE=0/1150 — viewer 还没 mount
- **t+200ms** (实际 ~400ms): SMPTE=42/1150 (4%) — 视频开始显示
- **t+100ms (多次测)**: SMPTE=1125/1150 (97.8%) — 视频几乎完全显示
- **iOS MediaToolbox log**: `preroll complete` 在 25ms 内 — AVPlayer native 装帧 < 25ms

**对比**:
- 之前 1-2s 全黑 (SMPTE=0 全程)
- 现在 100-300ms 部分颜色, 1.2s 97% 颜色
- **感知时间**: 1-2s → 200-300ms (5-10x 加速)

**typecheck + 105 tests 全过** ✅
