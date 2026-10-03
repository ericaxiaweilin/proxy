import { Directory, File, Paths } from "expo-file-system";
import { ListFeedPostsPayloadSchema, type FeedMediaItem, type FeedPost } from "@proxy/contracts";

type FeedDiskSnapshot = {
  version: 1;
  fetchedAt: string;
  posts: FeedPost[];
  media: Record<string, FeedMediaItem[]>;
};

const cacheDirectory = new Directory(Paths.document, "proxy-feed-cache");
const cacheFile = new File(cacheDirectory, "timeline-v1.json");

export async function readFeedDiskCache(): Promise<FeedDiskSnapshot | undefined> {
  if (!cacheFile.exists) return undefined;
  try {
    const raw = await cacheFile.json() as unknown;
    if (!raw || typeof raw !== "object") return undefined;
    const candidate = raw as Partial<FeedDiskSnapshot>;
    if (candidate.version !== 1 || typeof candidate.fetchedAt !== "string") return undefined;
    const parsed = ListFeedPostsPayloadSchema.safeParse({ posts: candidate.posts, media: candidate.media });
    if (!parsed.success) return undefined;
    return { version: 1, fetchedAt: candidate.fetchedAt, posts: parsed.data.posts, media: parsed.data.media };
  } catch {
    return undefined;
  }
}

export function writeFeedDiskCache(posts: FeedPost[], media: Record<string, FeedMediaItem[]>): void {
  cacheDirectory.create({ idempotent: true, intermediates: true });
  const snapshot: FeedDiskSnapshot = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    posts,
    media
  };
  cacheFile.write(JSON.stringify(snapshot));
}

// CACHE-CLEAR-MATURE-001（2026-10-01）：**清理缓存的逻辑已经搬走了**，不在这里。
//
// 原来这个文件末尾有 feedDiskCacheSize / clearFeedDiskCache / formatCacheSize ——
// 那是 SETTINGS-HUB-CACHE-CLEAR-001 的版本，范围只有 proxy-feed-cache 这一个目录，
// 于是行名叫「清理缓存」而实际只删一个 JSON：标签与范围不符，用户点完看到
// 「没有可清理的缓存」，而 Paths.cache 里其实堆着 expo-image 的缩略图。
//
// 正确范围见 clearable-cache.ts：Paths.cache（操作系统指定的缓存目录，iOS 存储
// 紧张时清的就是它）+ 本文件这个可重建的 feed 快照。白名单钉在那里。
//
// 这个文件现在只负责 feed 缓存自己的读写。
