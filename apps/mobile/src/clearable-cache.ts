import { Directory, Paths } from "expo-file-system";

// CACHE-CLEAR-MATURE-001（2026-10-01）
//
// 「清理缓存」的标准做法就一条：**清操作系统指定的缓存目录，不碰用户数据目录。**
// expo-file-system 把这件事写在了类型定义里 ——
//
//   Paths.cache    : "a place to store files that can be deleted by the system
//                     when the device runs low on storage"
//   Paths.document : "a place to store files that are safe from being deleted
//                     by the system"
//
// 换句话说：`Paths.cache` 就是"缓存"这个词在这套 API 里的准确所指，`Paths.document`
// 是"用户数据"。iOS 自己在存储紧张时清的就是 `Caches/`，Android 在应用信息里的
// 「清除缓存」也是同一件事。所以成熟实现只有一行是正确的：清 `Paths.cache`。
//
// 上一版（SETTINGS-HUB-CACHE-CLEAR-001）把范围缩到 `proxy-feed-cache` 一个目录，
// 于是行名叫「清理缓存」而实际只删了一个 JSON —— 标签与范围不符，用户点完看到
// 「没有可清理的缓存」，而 `Paths.cache` 里其实堆着 expo-image 的缩略图。
// 现在按标准做法重写。
//
// ⚠️ 白名单是这张文件存在的全部意义。本仓在 `Paths.document` 下放了 6 个目录，
// 其中 5 个是**用户数据**，删任何一个都是数据丢失：
//
//   proxy-feed-cache      真缓存（feed 快照，可重新拉）
//   proxy-feed-prefs      用户 feed 偏好
//   proxy-custom-feeds    用户订阅的自定义源
//   proxy-composer-draft  发帖草稿 + proxy-store-photos 照片
//   proxy-profile         头像
//   proxy-local           黑名单（blocked-users-store.ts）
//
// 所以下面这个数组**只能加 Paths.cache**。加任何 Paths.document 下的目录都
// 是数据丢失，而 AGENTS.md 那条「用户业务数据不许被代码硬删」正好覆盖这里。
// SETTINGS-CACHE-WHITELIST-001 那条门禁把这份清单钉死了。

export type CacheRootId = "SYSTEM_CACHE" | "FEED_CACHE";

export type CacheRoot = {
  id: CacheRootId;
  /** 真名字（不是翻译）—— 错误信息里要说清删的是哪个目录。 */
  dir: () => Directory;
};

/**
 * 可清理的缓存根目录白名单。
 *
 * ⚠️ 这里**只能**出现 Paths.cache 和一个明确可重建的缓存目录。
 * 任何 Paths.document 下的用户数据目录进来，就是数据丢失。
 */
export const CLEARABLE_CACHE_ROOTS: ReadonlyArray<CacheRoot> = [
  // 操作系统指定的缓存目录。expo-image / expo-video / expo-audio 的解码与缩略
  // 缓存落在这里，删掉只是下次重新生成或重新下载。
  { id: "SYSTEM_CACHE", dir: () => Paths.cache },
  // App 自己那份可重建的 feed 快照。
  { id: "FEED_CACHE", dir: () => new Directory(Paths.document, "proxy-feed-cache") }
];

export type CacheRootStatus = {
  id: CacheRootId;
  bytes: number;
  /** 不存在 = 之前就没有，不是失败。 */
  present: boolean;
};

export type CacheFootprint = {
  totalBytes: number;
  roots: ReadonlyArray<CacheRootStatus>;
};

function sizeOf(dir: Directory): number {
  if (!dir.exists) return 0;
  // Directory.size 是**递归**体积（类型定义：size of the directory in bytes，
  // null when it cannot be read）。读不到就当 0，但下面 present 会分开说。
  const bytes = dir.size;
  return typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0;
}

/**
 * 量出可清理缓存的总体积与分项。
 *
 * 一个目录都读不到时，present 全是false —— 界面要说「没有可清理的缓存」，
 * 那句话对**可清理范围**成立，而不再是对整个 App 撒谎。
 */
export function cacheFootprint(): CacheFootprint {
  const roots = CLEARABLE_CACHE_ROOTS.map((root) => {
    const dir = root.dir();
    const present = dir.exists;
    return { id: root.id, bytes: present ? sizeOf(dir) : 0, present };
  });
  return { totalBytes: roots.reduce((sum, r) => sum + r.bytes, 0), roots };
}

export type ClearResult = {
  ok: boolean;
  /** 真正删掉的字节数（重新量一次，而不是拿清理前的数充数）。 */
  freedBytes: number;
  /** 哪几个没删掉。空数组 = 全部成功。 */
  failed: ReadonlyArray<CacheRootId>;
};

/**
 * 清掉白名单里的缓存。
 *
 * 两个关键细节，都是成熟实现必须做的：
 *
 *  1. **逐个目录、逐个 try**。一个目录失败不能连带把别的也判失败，更不能
 *     静默 —— 用户要知道到底清没清掉。这仓反复修过「错误静默丢弃」。
 *  2. **删完把 `Paths.cache` 重建出来**。`delete()` 会把目录本身删掉，
 *     而 expo-image / expo-video 之后还要往里写；不重建的话下一个要缓存
 *     东西的库会碰到「目录不存在」。用 idempotent 重建，重复调用也无妨。
 */
export function clearCaches(): ClearResult {
  // 先量后删，省下的字节数才是真的省下的。
  const before = cacheFootprint();
  const failed: CacheRootId[] = [];
  for (const root of CLEARABLE_CACHE_ROOTS) {
    const dir = root.dir();
    if (!dir.exists) continue; // 本来就没有 = 已清空，不是失败
    try {
      dir.delete();
      // 只有会被后续库继续写入的目录才需要重建（SYSTEM_CACHE）。
      // FEED_CACHE 由 writeFeedDiskCache 自己 create，无所谓。
      if (root.id === "SYSTEM_CACHE") dir.create({ idempotent: true, intermediates: true });
    } catch {
      failed.push(root.id);
    }
  }
  // 重新量一次，而不是拿清理前的体积充数 —— 那会把一次失败的清理报成成功。
  const after = cacheFootprint();
  const ok = failed.length === 0;
  return {
    ok,
    // 部分失败时不报「省了多少」：其中一部分没删掉，报一个漂亮的数字会让人以为清干净了。
    freedBytes: ok ? Math.max(0, before.totalBytes - after.totalBytes) : 0,
    failed
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}