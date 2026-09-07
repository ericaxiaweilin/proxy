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
  scope: "7D",
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

export function readFeedPrefs(): FeedPrefsSnapshot {
  try {
    if (!snapshotFile.exists) {
      return { ...DEFAULT_FEED_PREFS, updatedAt: new Date().toISOString() };
    }
    const snapshot = snapshotFile.json() as Partial<FeedPrefsSnapshot>;
    if (!snapshot || snapshot.version !== 1) {
      return { ...DEFAULT_FEED_PREFS, updatedAt: new Date().toISOString() };
    }
    return {
      version: 1,
      weights: sanitizeWeights(snapshot.weights),
      scope: snapshot.scope === "30D" || snapshot.scope === "PERSISTENT" ? snapshot.scope : "7D",
      muted: Array.isArray(snapshot.muted) ? snapshot.muted.filter((m): m is string => typeof m === "string") : [],
      algoApplied: typeof snapshot.algoApplied === "string" ? snapshot.algoApplied : null,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return { ...DEFAULT_FEED_PREFS, updatedAt: new Date().toISOString() };
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
