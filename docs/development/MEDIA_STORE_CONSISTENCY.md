# 媒体仓库一致性 (MEDIA-FILE-001)

状态：已修复 + 已上门禁。逃逸日期 2026-09-12。

---

## 1. 出了什么事

动态里带图片的帖文**全是黑屏**。帖子本身没丢，接口也没报错。

真正的原因：`media.media_variants` 里有 **528 条 `status='READY'` 的 variant，其中 104 条（19.7%，分布在 27 个资产上）在磁盘上根本没有文件**。
服务端只信数据库，照样为每一条生成 URL；客户端 `expo-image` 请求 404 后什么都不渲染，于是露出父容器的深色背景 ——
一个黑矩形，和「这篇帖子本来就没有图」在视觉上无法区分。

`media/media_assets` 侧同样失真：56 个 `processing_status='READY'` 的资产，thumb/playback 指向的文件不存在，且没有任何可用 variant。

## 2. 为什么没人发现

- **成功和失败打的是同一行日志。** `media access variant=` 对 200 和 404 都打印，字面完全相同。
- **没有任何环节比对过数据库和磁盘。** 门禁覆盖了代码约定，但从未覆盖「数据是否自洽」。
- 客户端把加载失败渲染成「无内容」而不是「加载失败」，把故障伪装成了正常状态。

## 3. 现在怎么查

```bash
# 巡检：任何 READY 对象背后必须有字节。有问题的直接退出码 1。
PROXY_MEDIA_STORE_DIR=~/Developer/kake-data/media_store \
  go -C apps/api-go run ./cmd/media-audit --check-files

# 修复：只改状态，不删行不删文件，并把改动过的 ID 全部打印出来。
#   variant: READY -> REMOVED
#   asset:   READY -> FAILED（且仅当它一个可用源都没有时）
# 需要跑两遍：把 variant 标记为 REMOVED 之后，可能又有资产变成「无可用源」。
PROXY_MEDIA_STORE_DIR=~/Developer/kake-data/media_store \
  go -C apps/api-go run ./cmd/media-audit --quarantine-missing
```

巡检已经接进 `scripts/check-regression-contracts.sh`（MEDIA-FILE-001）。
它需要连到开发库，所以 API 没起时会打印 `SKIP` 而不是假装通过。

**别改 `PROXY_MEDIA_STORE_DIR` 去绕开巡检。** 那个目录里有 900+ 个真实媒体文件，换目录会破坏媒体 QA，
而且在本地起 API 时会因为 `ResolveLocalStoreDir` 的探针失败而报 `operation not permitted`。

## 4. 三道防线

| 层 | 守什么 | 在哪 |
| --- | --- | --- |
| 读模型 | 没有字节就不许发 URL | `internal/media/postmedia_lookup.go` + `TestPostMediaLookupDoesNotAdvertiseMissingFiles` |
| 日志 | 缺失必须和成功打得不一样 | `internal/api/media_handlers.go` 的 `media object MISSING` |
| 客户端 | 加载不出来就显示带文案的占位，而不是黑块 | `apps/mobile/src/media/media-fallback.tsx` (`media-unavailable-v1`) |

读模型层是主防线：URL 掉了以后，客户端会退到下一个候选（gallery → feed → thumbnail），
所以缺一个派生图只是降级成小一点的图，而不是黑洞。

## 5. 已做的数据修复（2026-09-12）

- 6 条 `FEED_1X` variant 指向此前一次半途而废的恢复留下的 `recovered_<asset>_feed_1x.jpg`（真实 JPEG）。
  `seed_media_coffee / hoankiem / westlake` 这三张是**字节完全相同的 SMPTE 彩条测试图**，故意没接。
- 104 条 variant → `REMOVED`，57 个资产 → `FAILED`（两遍跑到不动点）。
- 修复后：`variants=424 missing=0 assets-missing=0`；动态 43 个媒体 URL **全部 200**（修复前 25 个里 20 个 404）。
