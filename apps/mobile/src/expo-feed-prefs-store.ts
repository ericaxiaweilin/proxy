import { Directory, File, Paths } from "expo-file-system";

// Feed prefs 本地持久化（R36.x PREFS-001）：推荐权重/时间范围/屏蔽话题
// 只存本机，无后端。版本化 JSON，损坏时回退默认。
export type FeedPrefsSnapshot = {
  version: 1;
  weights: Record<string, number>;
  scope: "7D" | "30D" | "PERSISTENT";
  muted: string[];
  algoApplied: string | null;
  updatedAt: string;
};

export const DEFAULT_FEED_PREFS: Omit<FeedPrefsSnapshot, "updatedAt"> = {
  version: 1,
  weights: {
    opportunity: 70,
    people: 60,
    activity: 50,
    intelligence: 40,
    lifestyle: 30,
    commercial: 20,
  },
  // FEED-SCOPE-001: 曾经默认 "7D"。因为窗口是相对 Date.now() 滚动的，帖文会一天天
  // 无声消失 —— 实测隐藏了 62% 的帖文（39 篇只剩 15 篇可见），而时间线上又完全
  // 不显示筛选状态，看起来就是「数据丢失」。默认改为长期，时间范围变成一个用户
  // 主动选择的筛选项。
  scope: "PERSISTENT",
  muted: [],
  algoApplied: null,
};

const prefsDirectory = new Directory(Paths.document, "proxy-feed-prefs");
const snapshotFile = new File(prefsDirectory, "prefs-v1.json");

function sanitizeWeights(raw: unknown): Record<string, number> {
  const out = { ...DEFAULT_FEED_PREFS.weights };
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        out[key] = Math.max(0, Math.min(100, Math.round(value)));
      }
    }
  }
  return out;
}

export function defaultFeedPrefs(): FeedPrefsSnapshot {
  return { ...DEFAULT_FEED_PREFS, updatedAt: new Date().toISOString() };
}

/** 纯解析（SYNC-FS-001 单测入口）：坏数据一律回默认。 */
export function parseFeedPrefsSnapshot(raw: unknown): FeedPrefsSnapshot {
  const snapshot = raw as Partial<FeedPrefsSnapshot> | null;
  if (!snapshot || typeof snapshot !== "object" || snapshot.version !== 1) {
    return defaultFeedPrefs();
  }
  return {
    version: 1,
    weights: sanitizeWeights(snapshot.weights),
    // FEED-SCOPE-001: 三个取值都显式接受，只有「缺失/非法」才回落到默认长期。
    // 旧实现把显式保存的 "7D" 也当成非法值，改默认值时会静默覆盖用户选择。
    scope: snapshot.scope === "7D" || snapshot.scope === "30D" || snapshot.scope === "PERSISTENT" ? snapshot.scope : "PERSISTENT",
    muted: Array.isArray(snapshot.muted) ? snapshot.muted.filter((m): m is string => typeof m === "string") : [],
    algoApplied: typeof snapshot.algoApplied === "string" ? snapshot.algoApplied : null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * SYNC-FS-001: File.json() 是异步的，同步读永远拿到 Promise。
 * 本函数为唯一读入口（await）。
 */
export async function readFeedPrefsAsync(): Promise<FeedPrefsSnapshot> {
  try {
    if (!snapshotFile.exists) return defaultFeedPrefs();
    return parseFeedPrefsSnapshot(await snapshotFile.json());
  } catch {
    return defaultFeedPrefs();
  }
}

export function writeFeedPrefs(snapshot: Omit<FeedPrefsSnapshot, "version" | "updatedAt">): void {
  try {
    prefsDirectory.create({ idempotent: true, intermediates: true });
    const payload: FeedPrefsSnapshot = {
      version: 1,
      weights: sanitizeWeights(snapshot.weights),
      scope: snapshot.scope,
      muted: snapshot.muted,
      algoApplied: snapshot.algoApplied,
      updatedAt: new Date().toISOString(),
    };
    snapshotFile.write(JSON.stringify(payload));
  } catch {
    // 本地持久化失败不打断设置页。
  }
}
