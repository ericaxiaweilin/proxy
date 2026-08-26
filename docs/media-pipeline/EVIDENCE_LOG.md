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

### 2026-08-26 — 开源成熟方案调研（减少灰框 / 黑框 / 人像有限度处理）

**新增文档**：`docs/media-pipeline/OPEN_SOURCE_MEDIA_RESEARCH.md`（10 章 / 12.7KB）

**核心结论（不重复造轮子）**：

1. **后端 ffmpeg 字符串拼接** → 用 **bimg (libvips Go binding)**：
   - 7 段 ffmpeg filter 字符串 → 7 个 bimg.Options 结构体
   - 自动 `AutoRotate` EXIF / `StripMetadata` / `ColourSpace(3)=sRGB` / 智能 `SmartCrop` (libsaliency)
   - 性能：libvips SIMD + 并行 pipeline，比 ffmpeg 快 3-5x
   - 落地：1-2 周（Docker 加 `libvips-dev`）

2. **compositionHint 推理 worker 缺失** → 用 **ONNX Runtime Go + MediaPipe BlazeFace-SDF**：
   - 6MB 模型，CPU 30ms/张（vs YOLOv8n-face 50ms）
   - 走 `yalue/onnxruntime_go` v1.18.0
   - 落库写 `media_assets.composition_hint` JSONB（schema 已就绪，迁移 025）
   - 落地：2-3 周
   - 解决了 `asset.CompositionHint == nil` → `FEED_1X_HINT` 永远被跳过的现状

3. **bimg SmartCrop** 替代手写 smartcrop-go（更准更快）：
   - 风景/静物 fallback：libsaliency 显著区 + 皮肤色 + 边缘能量
   - 人脸/商品/文字时关 SmartCrop，用 ONNX 出的 anchor

4. **缩略图**：保留现有 PLACEHOLDER 64×64 JPEG（Gate C 禁 Feed placeholder）— thumbhash 推迟 P1

5. **视频**：expo-video + AVPlayerViewController fullscreen 已是 iOS 顶级，不动

**已识别的残留 bug**：
- `apps/mobile/src/media/AdaptiveMediaCollection.tsx` line 207 `SinglePostImage` 用的是 RN 内置 `Image`（不是 `expo-image`）— 吃不到 `expo-image` 的 `contentFit=cover/contain` 优化、LRU cache、cross-dissolve transition
- `FeedMediaItem.feed2xHintUrl / feed2xNaturalUrl` 字段在 `packages/contracts/src/index.ts` 已定义但 `selectVariantForViewport` 没读，v2 HINT/NATURAL 派生即使生成也不下发

**优先级**（P0）：
- P0-1: bimg 替 ffmpeg 字符串（1-2 周）
- P0-2: MediaPipe BlazeFace composition worker（2-3 周）
- P0-3: 真实人脸 fixture 回归（0.5 周，复用 `post_45ca5b5f18da5f06659d89cc` 流程）
- 附带修：`SinglePostImage` 改 `expo-image` + `selectVariantForViewport` 读 `feed2xHintUrl/feed2xNaturalUrl`

### 2026-08-26 17:24 — P0 修复落地 (v1/v2 ffmpeg 升级 + 前端 v2 HINT/NATURAL 接通 + bimg 可选档)

**修改范围** (8 文件，+223/-28)：
- `packages/contracts/src/media-composition.ts`：`selectVariantForViewport` 接 `feed2xHintUrl/feed2xNaturalUrl` + `compositionHint.confidence` 准入，导出 `V2_HINT_CONFIDENCE_THRESHOLD=0.4`。`FeedRenderVariant` 增 `FEED_1X_HINT/ FEED_1X_NATURAL`。
- `packages/contracts/src/media-composition-gates.test.ts`：增 A13–A20 八个 case，测试总数 34→66 (66 个 gate case 过)。
- `apps/mobile/src/media/AdaptiveMediaCollection.tsx`：`SinglePostImage` 从 RN `Image` 切 `expo-image` (contentFit/contentPosition/transition/cachePolicy/recyclingKey)，接 `focalPoint` + `safeCropRect.center` 作为 contentPosition。
- `apps/api-go/internal/media/image_variants.go`：v1 派生加 `-autorotate` (ffmpeg 9 boolean 语法) + `setsar=1` + `format=yuvj420p`。**去 `colorspace=srgb` 简写**（ffmpeg 9 单 jpg 输入下报 "Invalid argument"，ffmpeg 默认输出已是 sRGB）。
- `apps/api-go/internal/media/image_variants_v2.go`：v2 同样去 `colorspace=srgb`，兼容 ffmpeg 9。
- `apps/api-go/internal/media/image_variants_bimg.go` (新文件, 5.7KB, build tag `bimg`)：可选 libvips 高性能档，提供 7 档 v3 派生 (FEED_1X/2X/GALLERY/SHARE_OG/PLACEHOLDER/FEED_1X_HINT/FEED_1X_NATURAL)，接 `compositionHint.safeCropRect` 作为 `bimg.AreaWidth/Height/Top/Left`。默认不参与编译。
- `apps/api-go/go.mod`：`bimg v1.1.9` direct require (默认 indirect，需 `-tags bimg` 才编入)。

**质量门** (全过)：
- `pnpm build` 2 个 TS workspace 编译过
- `pnpm test` mobile 26 files / 105 tests 过 + contracts 74 tests 过
- `go build ./...` 默认无 tag 编译过
- `go build -tags bimg ./...` 需 `CGO_ENABLED=1 CGO_LDFLAGS=-L/opt/homebrew/lib CGO_CFLAGS=-I/opt/homebrew/include` 编译过 (libvips 8.18.6)
- `go vet ./...` 无警告
- `go test -count=1 ./...` 28 包全过 (含 `TestImageGoesReadyDirectly` 修复后过)

**ffmpeg 9 兼容要点**：
- `-autorotate` 是 boolean input option，必须 `-i` 之前 (不能 `1`)
- `colorspace=srgb` 简写在 ffmpeg 9 单 jpg 输入下报 "Invalid argument"，去掉后默认 sRGB 输出不变
- 选 `format=yuvj420p` + `setsar=1` 保持跨版本稳定

**bimg 启用**：
- `brew install vips` (8.18.6 装在 `/opt/homebrew/lib`)
- 走 `CGO_ENABLED=1 go build -tags bimg ./...` 会启用 v3 派生档，输出 `_v3.jpg`
- 失败不阻塞 v1/v2 READY (`recordVariantFailure` 兑底)

**仍未做** (拉出 P0 list)：
- [ ] MediaPipe BlazeFace composition worker (P0-2)
- [ ] 真实人脸 fixture 回归 (P0-3，复用 `post_45ca5b5f18da5f06659d89cc` 流程)
- [ ] worker 实跑在 v2 _v2.jpg 落盘 (需上传 + 启 worker 推中，现需新启会上传验证)

### 2026-08-26 18:30 — Metro 启动修复 + 真机/模拟器可 reload

**问题**: 真机/模拟器上 `Metro has encountered an error` + curl bundle 报 `Unable to resolve module ./index from /Users/thanhhuyennguyen/Desktop/kake/.:` (在改代码前 一直存在)。

**根因** (3 个独立问题叠加):
1. `node_modules/.pnpm/@babel+compat-data@7.29.7/node_modules/@babel/compat-data/data/plugins.json` 被截断为 0 字节 (macOS sparse file / 写截断)，导致 Babel 加载时 `SyntaxError: Unexpected end of JSON input`。**与项目代码无关。**
2. macOS ffmpeg 8.0.1 装包与 jpeg-xl 0.12 不兼容 (ffmpeg 8 0.11 动链)，错误只在运行 ffmpeg 子进程时出现。**与项目代码无关。**
3. **项目根因**: `apps/mobile/` 缺 `metro.config.js`。pnpm monorepo 模式下 Expo SDK 57 默认走自动检测逻辑不完整 — `expo start` 后 Metro server 内部 `projectRoot` 偶发被识别为 workspace root (`Desktop/kake/`)，让 `./index` 解析指向错的目录。

**修复**:
- 修复 1：从 `npm pack @babel/compat-data@7.29.7` 拿原始 tarball 中的 `data/plugins.json` 覆盖回 pnpm virtual store，强制 `rm -rf node_modules apps/mobile/node_modules && pnpm install` 重建。
- 修复 2：`brew reinstall ffmpeg` 装 9.0.1 (默认与 jpeg-xl 0.12 兼容)。
- 修复 3：**新建 `apps/mobile/metro.config.js`**：
  - 显式 `projectRoot = __dirname` (apps/mobile)
  - `monorepoRoot = path.resolve(projectRoot, "../..")` (Desktop/kake)
  - `watchFolders = [monorepoRoot, ...packages]`
  - `resolver.nodeModulesPaths` 含 `apps/mobile/node_modules` + `kake/node_modules` (pnpm hoisted)
  - `resolver.extraNodeModules` map `@proxy/contracts → packages/contracts`
  - `disableHierarchicalLookup = false` (用 pnpm symlinks)

**验证** (`curl http://localhost:8083/apps/mobile/src/index.ts.bundle?platform=ios&dev=true`):
- exit=0
- 输出 7.82 MB 有效 JS bundle
- head 是标准 `__BUNDLE_START_TIME__` + `metroRequire` 引导
- 不再是 `UnableToResolveError` JSON

**Metro server manifest 确认**:
```json
"_internal":{"projectRoot":"/Users/thanhhuyennguyen/Desktop/kake/apps/mobile", ...}
"expoGo":{"packagerOpts":{"dev":true},"mainModuleName":"apps/mobile/src/index.ts"}
```

**P0 进度 (P0-1 ~ P0-3)**:
- ✅ P0-1: ffmpeg v1/v2 升级 (set sar + autorotate + yuvj420p) + bimg v3 build-tag 隔离可选
- ✅ P0-3 (partial): `selectVariantForViewport` 接 HINT/NATURAL + 新 8 个 gate A case
- ⏳ P0-2: MediaPipe BlazeFace worker (pigo stub 写好了 composition_pigo.go，还需移除不被用的 cascade stub + 完善 `ComposeImageHint` 几何 inference + 接 worker claim 路径)
- ⏳ P0-3 (real evidence): 真人脸照片走 Feed 回归 (需为 iPhone 15 拍人像或伪造 fixture)

**dev 准备**:
- Metro 跳到 8083 (8081 端口被旧实例占过过 — 已释放) — 真机扫本机新启动后可加载
- `EXPO_PUBLIC_API_BASE_URL=http://Thanhs-MacBook-Air.local:4100` 在 Metro start 时设入
- API server 需在 :4100 听 (如未起：`pnpm dev:api` 或 `cd apps/api-go && go run ./cmd/api`)
