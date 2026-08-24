# Proxy Social Media Pipeline R1

状态：执行中  
Owner：Social / Media Platform  
适用端：API、Worker、iOS、Android、公开 Web 分享页  
原则：App 是内容与撮合壳；媒体资产、可见性、审核、分享解析和派生策略属于服务端平台能力。

## 1. 完成定义

“照片功能完成”不能只表示 Feed 能显示一张图片。必须同时满足：

1. 用户选中的原始文件只上传一次、不可被派生处理覆盖；
2. Feed、详情、分享预览和全屏查看使用不同用途的受控派生资源；
3. 单图默认不裁脸、不裁身体；极端比例仍能完整查看；
4. 2–6 个媒体保持作者顺序，使用稳定横向 Media Rail，不做九宫格；
5. 点击后以原比例高清查看，支持缩放、翻页、返回原位置；
6. 帖子 Link 可复制、系统分享、打开 App，并能在未安装时回落到 Web；
7. PRIVATE、FOLLOWERS、REMOVED、审核中内容不能因分享链接泄露；
8. 上传失败、处理失败、断网、低内存、超大图和格式不支持都有可恢复状态；
9. iPhone 与 Android 真机通过统一视觉和行为矩阵；
10. 所有 Gate 有自动化结果或真机证据，不能口头放行。

## 2. 目标架构

```text
Camera / Photo Library
  -> client preflight (type, size, dimensions, orientation, count)
  -> resumable upload session
  -> immutable ORIGINAL object + checksum
  -> quarantine / metadata / moderation
  -> derivative worker
       |- FEED_1X
       |- FEED_2X
       |- GALLERY
       |- SHARE_OG
       `- PLACEHOLDER
  -> MediaAsset + MediaVariant read model
  -> Post mediaRefs(sortOrder)
  -> Feed / Post Detail / Gallery / Public Share Resolver
```

硬边界：

- Post 只引用 `mediaAssetId`，不保存过期 URL。
- 客户端不拼对象存储地址，只消费服务端返回的用途 URL。
- ORIGINAL 永不作为 Feed 列表默认下载资源。
- ORIGINAL 不因生成缩略图、旋转或审核而被覆盖。
- 模型可以返回 UI/分类建议，但不能成为媒体可见性和授权真源。

## 3. Canonical 数据合同

### 3.1 MediaAsset

```text
mediaAssetId
ownerPrincipal
mediaType: IMAGE | VIDEO
sourceMimeType
sourceBytes
sourceWidth / sourceHeight
normalizedWidth / normalizedHeight
orientation
checksumSha256
colorSpace
hasAlpha
animated
processingStatus
moderationStatus
visibilityClass
createdAt / updatedAt / removedAt?
```

### 3.2 MediaVariant

```text
mediaVariantId
mediaAssetId
purpose: ORIGINAL | FEED_1X | FEED_2X | GALLERY | SHARE_OG | PLACEHOLDER
format
width / height / bytes
qualityPolicy
storageKey
contentHash
status
createdAt
```

### 3.3 FeedMediaItem

客户端必须获得：

```text
mediaAssetId
mediaType
width / height / aspectRatio
placeholderUrl?
feedUrl
feed2xUrl?
galleryUrl
originalAvailable
sortOrder
processingStatus
moderationStatus
```

URL 可以是短期签名 URL 或同源受控路由；稳定身份永远是 `mediaAssetId`。

## 4. 图片质量政策

### 4.1 原图

- 相册选择优先读取当前资产表示，不在客户端先做 0.85 JPEG 重编码。
- 原始 HEIC、JPEG、PNG、WebP 可保留；不强制把所有格式改成 JPEG。
- 保存 SHA-256、字节数和 MIME sniff 结果，扩展名不能作为格式真源。
- EXIF 方向归一化只作用于派生图；原文件不修改。
- GPS EXIF 默认从公开派生图移除；原始元数据按隐私保留策略受控。

### 4.2 派生图

- 不承诺“所有格式无损压缩”；JPEG/HEIC 的大幅减重通常是有损的。
- 正确承诺是：原图无覆盖、无重复转码；展示图采用一次性视觉无损策略。
- 派生编码必须记录版本，例如 `image_recipe_v1`，升级时生成新 Variant，不覆盖旧对象。
- 色彩统一输出 sRGB；保留正确方向；禁止明显色偏、条带和锐化光晕。
- Feed 不下载 20MB 原图；Gallery 先展示 GALLERY，用户继续放大时可按策略取 ORIGINAL。

建议首版规格：

| Purpose | 长边 | 格式 | 策略 |
|---|---:|---|---|
| FEED_1X | 1080 | JPEG/WebP | 视觉质量 88–92，禁止二次转码 |
| FEED_2X | 1600 | JPEG/WebP | 高密度屏使用 |
| GALLERY | 2560 | 原格式兼容或高质量派生 | 缩放查看 |
| SHARE_OG | 1200×630 | JPEG | 仅 Web 社交预览 |
| PLACEHOLDER | 32–64 | BlurHash/小图 | 首帧占位 |

具体编码器和质量必须通过照片样本集 SSIM/视觉验收后冻结，不能凭单一质量数字放行。

## 5. Feed 构图合同

### 5.1 单图

- 读取服务端 width/height；缺失时客户端仅可临时探测并上报，不长期依赖猜测。
- 常规比例在内容宽度内按原比例展示。
- 推荐自然展示区间：横图不宽于 1.91:1，竖图不高于 4:5 容器。
- 超出区间时使用 `contain` 或明确的服务端 focal crop；没有 focal 数据时不得中心裁掉主体。
- 人脸/人体检测不是 P0 依赖。P0 以“不裁切”保证完整性。
- 后续智能构图只能产生 `focalPoint/cropProposal`，用户原图和 Gallery 不受影响。

### 5.2 多图

- 2–6 个媒体使用稳定高度的横向 Adaptive Media Rail。
- 按 `sortOrder` 显示，下一张露出一部分。
- Rail 预览允许 `cover`，但点击后必须回到完整 Gallery。
- 图片和普通视频共用容器与 index，不拆成两套顺序。
- 删除、重试一个媒体不能改变其它媒体 ID 和顺序。

### 5.2.1 人像混合组图（P0 核心 Case）

当一条 Post 同时包含半身照和全身照时，不允许使用“每张图片高度固定、宽度按原比例无限缩窄”的旧实现。

统一规则：

| 输入 | Feed 卡片 | 填充方式 | 不变量 |
|---|---|---|---|
| 半身 4:5 | 4:5 人像画布 | 自然铺满 | 不裁头顶、下巴和主要手部 |
| 半身 3:4 | 4:5 人像画布 | 小幅 cover | 主体安全区完整 |
| 全身 9:16 | 4:5 人像画布 | contain + 同图柔化背景 | 头与脚必须同时可见 |
| 全身 2:3 | 4:5 人像画布 | contain + 同图柔化背景 | 身体轮廓完整 |
| 人像 + 横图 | 由多数媒体决定 Rail 模式 | 不匹配项 contain | Rail 高度不能随滑动跳动 |

响应式尺寸：

```text
portrait_card_width = feed_content_width * 0.84
portrait_rail_height = clamp(feed_content_width * 1.05, 280, 440)
corner_radius = 14
card_gap = 10
```

视觉要求：

- 下一张需露出约 12%–18%，表达可横滑；
- 柔化背景只能作为补边，前景原图不得加 blur；
- 背景不能使用纯白导致夜景/深色照片出现强烈边框；
- Gallery 不继承 Feed crop，必须恢复原比例；
- 未来若服务端提供 focal point，只可改善 preview，不能修改 ORIGINAL；
- 不以性别决定构图策略，同一规则适用于所有人物照片。

### 5.3 Gallery

- 黑色沉浸背景，安全区内显示关闭按钮、作者、`index/total`。
- 首屏加载 GALLERY，不放大 thumbnail。
- 双指缩放、双击缩放、平移、左右翻页、下滑关闭。
- 关闭后恢复原 Post、Media index 和 Feed scroll offset。
- 旋转、后台恢复、来电打断后不丢 index。
- 高清加载失败时保留 Feed 图并提供重试，不能白屏。

## 6. 发布与编辑流程

发布器必须覆盖：

- 相机、相册、多选、权限拒绝与设置入口；
- 0–6 个媒体，超限在选择阶段阻止；
- 预览、拖拽排序、移除、替换、替代文本；
- 上传进度、暂停/重试/取消；
- 后台切换后恢复草稿；
- 处理中的可解释状态；
- 失败媒体不能静默丢失后把帖子发布成功；
- 发布幂等，重复点击不能生成两个 Post；
- 帖子发布后编辑正文、可见性和媒体删除的规则明确；
- 删除 Post 后撤销公开解析和分享预览，按保留策略延迟物理删除。

## 7. 分享 Link 完整合同

### 7.1 用户动作

每个可分享 Post 提供：

- 复制链接；
- 系统 Share Sheet；
- 分享到消息应用；
- 举报/屏蔽等菜单与分享分开；
- 分享成功只记录动作，不假设接收者已查看。

### 7.2 Canonical URL

```text
https://proxy.example/p/{opaquePublicId}
```

禁止把数据库自增 ID、用户邮箱、手机号、权限 token 写进 URL。

### 7.3 打开行为

```text
Universal Link / Android App Link
  -> 已安装且会话允许：打开 App 对应 Post
  -> 已安装但需登录：登录后回到原 Post
  -> 未安装：公开 Web Post
  -> 内容不可见：统一不可用页面，不泄露作者/图片/存在性
```

自定义 `proxy://` 只作为开发或受控回落，不作为外部主链接。

### 7.4 Web 分享页

- 服务端渲染标题、摘要、作者公开名和 SHARE_OG；
- Open Graph / Twitter Card 标签完整；
- 不公开需要登录、FOLLOWERS、HIDDEN、REMOVED、审核隔离内容；
- 分享爬虫与普通用户使用同一 Visibility Decision；
- OG 图片失效时使用品牌回落，不直接暴露 ORIGINAL；
- canonical、robots、删除后的 404/410 策略明确。

### 7.5 分享事件

至少记录：

```text
POST_SHARE_SHEET_OPENED
POST_LINK_COPIED
POST_SHARE_TARGET_SELECTED (允许获得时)
POST_LINK_OPENED
POST_DEEP_LINK_RESOLVED
POST_SHARE_WEB_VIEWED
POST_SHARE_DENIED_BY_VISIBILITY
```

事件不记录收件人，不把分享对象通讯录上传到平台。

## 8. 可见性、安全与审核

- Upload 后先进入 quarantine；MIME sniff、大小、解码炸弹和恶意载荷检查通过后才处理。
- `READY` 不等于 `PUBLIC`；展示必须同时满足处理状态、审核状态、Post 状态和 Viewer 权限。
- ORIGINAL 路由也必须做授权，不能因为知道 asset ID 就读取。
- FOLLOWERS 内容的 Link 只做授权入口，不变成公开链接。
- 截图、私密照片和未成年人相关内容遵循单独政策；本计划不授权模型自行推断年龄。
- 删除、封禁、撤回授权要使 CDN/缓存按 SLA 失效。
- 日志不得记录签名 URL、EXIF GPS、完整文件字节或访问 token。

## 9. 性能与可靠性预算

首版预算：

- Feed 首张媒体占位 < 300ms（已有缓存时）；
- Wi-Fi 下 FEED_1X P75 可见 < 1.2s；
- Gallery 首张 P75 < 1.5s；
- 滚动过程中不得因图片解码持续掉到 45fps 以下；
- 单张上传支持至少 25MB，超限给出明确提示；
- 处理任务幂等，可安全重试；
- Variant 失败不破坏 ORIGINAL；
- CDN cache key 包含 recipe version；
- 内存压力时优先释放离屏大图，不使 App 崩溃。

这些数字必须在真实网络和真机上测量后再调整，不能用模拟器结果代替。

## 10. 可观测性

需要 Dashboard：

- upload success/failure/latency/bytes；
- processing queue age、variant failure、unsupported format；
- Feed image load failure、placeholder duration、cache hit；
- Gallery open、index view、zoom、load failure；
- share created/opened/deep-link fallback/visibility denied；
- 删除到缓存失效的时延；
- 按 appVersion、OS、device class、network type 分段。

North Star 仍是高价值关系和现实行动，照片打开率、停留时长不能单独驱动推荐。

## 11. 样本集

验收资产至少包含：

- iPhone HEIC、JPEG、PNG、WebP；
- EXIF 旋转 1/3/6/8；
- 1:1、4:5、9:16、16:9、1.91:1、全景、长截图；
- 单人近照、半身、全身、多人、人物靠边、风景、文字截图；
- 透明图、宽色域、低照度、高噪点；
- 1KB 损坏文件、扩展名伪装、超大像素图、超过大小限制；
- 1、2、3、6 个混合媒体；
- 弱网、断网、后台恢复、上传重复提交。

样本必须合法且获得测试使用授权，不使用线上用户私密照片。

## 12. Release Gates

### Gate 0 — 合同冻结

- [x] 已有 Post `mediaRefs + sortOrder + max 6` 基础合同。
- [x] 已有单图自适应、多图 Rail、Gallery 的产品基线。
- [ ] `MediaAsset + MediaVariant + visibility` 合同进入 shared contracts、Go 和数据库迁移。
- [ ] iOS、Android、Web 分享页共同引用同一 recipe/version 定义。
- [ ] Architecture review 通过，无客户端私自拼 URL。

放行证据：schema tests、migration test、架构 diff。  
当前状态：**BLOCKED**。

### Gate 1 — 原图与上传可靠性

- [x] 客户端取消 `quality: 0.85` 预压缩。
- [x] iOS 相册优先 Current representation。
- [x] 上传传递 width/height。
- [x] checksum、MIME sniff、source bytes 入库。
- [x] EXIF orientation、color space、alpha/animated metadata 入库；未知值不猜测。
- [x] 同字节 PUT 可安全重试，不同字节禁止覆盖 ORIGINAL。
- [x] iOS/Android 客户端对网络错误、408/425/429/5xx 自动退避重试；4xx 不重试。
- [ ] 分片 resumable upload 与后台恢复完成。
- [ ] 25MB、断网、后台恢复、重复提交测试。
- [x] ORIGINAL 不可变测试。

放行证据：原文件上传前后 SHA-256 一致；故障注入通过。  
当前状态：**BLOCKED**。

### Gate 2 — 派生与审核

- [ ] Worker 生成 FEED_1X、FEED_2X、GALLERY、SHARE_OG、PLACEHOLDER。
- [ ] recipe version 与幂等键完成。
- [ ] EXIF orientation、sRGB、GPS metadata 策略完成。
- [ ] quarantine、格式嗅探、解码安全限制完成。
- [ ] processing/moderation/visibility 状态组合 fail-closed。
- [ ] 失败重试不覆盖 ORIGINAL。

放行证据：样本集像素/方向/色彩快照与安全测试。  
当前状态：**BLOCKED**。

### Gate 3 — Feed 与 Gallery

- [x] 单图不再固定 156 高。
- [x] 极端比例不默认裁主体。
- [x] Gallery 使用 IMAGE playback/original 路由而非 thumbnail。
- [x] iOS/Android 缩放图库依赖已接入。
- [ ] Feed 改用用途明确的 `feedUrl`，Gallery 改用 `galleryUrl`。
- [ ] 多图 Rail 的比例、露出、滑动 index、混合媒体完成。
- [x] 半身 4:5 + 全身 9:16 使用统一人像画布，不再缩成 156px 小图。
- [x] 全身人像 contain + 柔化补边，默认不裁头脚。
- [ ] 半身/全身/多人/靠边人物样本集截图回归。
- [ ] 返回原 Post/index/scroll position 完成。
- [ ] iPhone 15 + 小屏 iPhone + Android 三档真机视觉证据。

放行证据：截图矩阵、手势录屏、E2E、性能 trace。  
当前状态：**BLOCKED**。

### Gate 4 — 发布器

- [x] 相机、相册、多选和 6 张上限已有基础实现。
- [ ] 排序、替换、替代文本、逐项进度、重试、取消。
- [ ] 草稿跨后台恢复。
- [ ] 处理失败不能静默发布。
- [ ] CreatePost 幂等与重复点击测试。
- [ ] 发布后删除媒体和撤销公开缓存。

放行证据：状态机测试、弱网真机录屏、重复命令测试。  
当前状态：**BLOCKED**。

### Gate 5 — 分享 Link

- [ ] Post 生成 opaque public ID 与 canonical HTTPS URL。
- [ ] iOS Universal Links。
- [ ] Android App Links。
- [ ] App 路由、登录后回跳、找不到/无权限回落。
- [ ] 系统 Share Sheet、复制链接和分享事件。
- [ ] 公开 Web Post、OG/Twitter Card、SHARE_OG。
- [ ] PRIVATE/FOLLOWERS/HIDDEN/REMOVED 爬虫与用户权限矩阵。

放行证据：Apple/Android association 校验、分享平台预览、权限 E2E。  
当前状态：**BLOCKED**。

### Gate 6 — 运营、隐私与规模

- [ ] Dashboard、告警和 SLO。
- [ ] 删除/封禁到 CDN 失效演练。
- [ ] 存储生命周期与成本预算。
- [ ] 数据导出/删除/申诉流程。
- [ ] 崩溃、OOM、弱网、队列积压演练。
- [ ] App Store / Play 隐私披露与权限文案核对。

放行证据：运行手册、监控截图、演练记录、隐私审核。  
当前状态：**BLOCKED**。

## 13. 放行规则

1. Gate 必须按 0 → 6 顺序；后续开发可并行，但不能越级宣称完成。
2. `[x]` 只表示有实现和证据，不表示“看起来有”。
3. 任一 P0 数据泄露、原图覆盖、错误可见性、崩溃或重复发布，当前 Gate 立即退回 BLOCKED。
4. 模拟器只用于开发；Gate 3、4、5 必须有 iOS 与 Android 真机证据。
5. 原型视觉对齐与服务端合同分别验收，任何一边失败都不放行。
6. 每次 recipe、schema、深链或可见性变更必须更新本文件和自动化矩阵。

## 14. 执行顺序

```text
Sprint A: Gate 0 + Gate 1
Sprint B: Gate 2
Sprint C: Gate 3 + Gate 4
Sprint D: Gate 5
Sprint E: Gate 6 + release candidate
```

当前立即执行：补齐 `MediaVariant` 合同与迁移，随后实现图片 worker。分享 UI 不先做假按钮；必须等 canonical HTTPS resolver 与权限回落合同成立后一起接线。
