import { Directory, File, Paths } from "expo-file-system";
import type { CustomFeed } from "./surfaces/custom-feed";

// 自定频道本地持久化（R36.x FEED-004）：固定/新增的频道只存本机，
// 无后端。版本化 JSON，损坏时回退默认频道。
export type CustomFeedSnapshot = {
  version: 1;
  feeds: CustomFeed[];
  updatedAt: string;
};

const directory = new Directory(Paths.document, "proxy-custom-feeds");
const snapshotFile = new File(directory, "feeds-v1.json");

function sanitizeFeeds(raw: unknown): CustomFeed[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CustomFeed[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name) continue;
    out.push({
      id: item.id,
      name: item.name,
      desc: typeof item.desc === "string" ? item.desc : "",
      icon: typeof item.icon === "string" && item.icon ? item.icon : "▣",
      pinned: item.pinned === true,
      ...(item.aiGenerated === true ? { aiGenerated: true as const } : {}),
    });
  }
  return out;
}

export function readCustomFeeds(fallback: CustomFeed[]): CustomFeed[] {
  try {
    if (!snapshotFile.exists) return fallback;
    const snapshot = snapshotFile.json() as Partial<CustomFeedSnapshot>;
    if (!snapshot || snapshot.version !== 1) return fallback;
    return sanitizeFeeds(snapshot.feeds) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeCustomFeeds(feeds: CustomFeed[]): void {
  try {
    directory.create({ idempotent: true, intermediates: true });
    const payload: CustomFeedSnapshot = {
      version: 1,
      feeds,
      updatedAt: new Date().toISOString(),
    };
    snapshotFile.write(JSON.stringify(payload));
  } catch {
    // 本地持久化失败不打断频道页。
  }
}
