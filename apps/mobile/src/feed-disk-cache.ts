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
