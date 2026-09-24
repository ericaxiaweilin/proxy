// scene-favorites.ts — 场景卡片 🤍 的本机持久化（SCENE-FAVORITE-001）。
//
// home 场景卡片的收藏心以前只翻 useState，退出重进就丢，更到不了「我的 → 收藏」
// —— 点了等于没点。Moments 是全员一致的静态目录（见 scene-activity-discovery
// 的 MOMENTS），服务端没有「场景收藏」概念，所以 hearts 按账号存本机（SecureStore，
// 跟 profileStore 同一条驱动），绝不编造服务端记录。读到未知 id 直接丢弃，
// 目录变了也不会画出幽灵卡。
import type { SecureStorageDriver } from "./secure-session";

const SCENE_FAVORITES_KEY = "proxy.scene-favorites.v1";
const MAX_SAVED = 200;
const MAX_ID_LENGTH = 128;

/** profileKeyFor 同规则：分账号隔离，无账号走 legacy 公共槽（只读不写活源）。 */
export function sceneFavoritesKeyFor(accountId?: string | undefined): string {
  const scope = (accountId ?? "").trim();
  return scope === "" ? SCENE_FAVORITES_KEY : `${SCENE_FAVORITES_KEY}.${scope}`;
}

export type SceneFavoritesStore = {
  read: () => Promise<readonly string[]>;
  write: (ids: readonly string[]) => Promise<void>;
};

/** SCENE-FAVORITE-002：收藏条目 —— id + 真目录里的标题 + 真实标签副标题。 */
export type SavedSceneEntry = { id: string; title: string; meta: string };

/**
 * 目录回查：id → 可渲染条目。目录里没有的 id 必须返回 undefined
 * （绝不拿 id 当标题、也不用 taxon() 首项回退糊弄）。
 * 具体实现在 scene-activity-discovery.tsx 的 savedSceneLookup —— 那里能拿到
 * MOMENTS 真目录，但也因此依赖 React Native、没法在这里被导入。
 */
export type SceneCatalogLookup = (id: string) => SavedSceneEntry | undefined;

/**
 * SCENE-FAVORITE-002：把本机存的收藏 id 解析成可渲染条目 —— **唯一实现**。
 *
 * 为什么要有这个函数：「收藏」这一个词下面有两个面（我的 → 收藏、个人主页 →
 * 收藏 tab），两边都要画同一份 hearts。各自写一遍解析等于把「两处会漂移」
 * 变成「三处」。所以解析只留这一份，两个面都调它。
 *
 * 目录查不到的 id 直接丢弃（目录变了不画幽灵卡），重复 id 只留一条。
 * 目录通过 lookup 注入 —— 这样这段逻辑不依赖 React Native，能被真的测。
 */
export function resolveSavedSceneIds(ids: readonly string[], lookup: SceneCatalogLookup): SavedSceneEntry[] {
  const out: SavedSceneEntry[] = [];
  for (const id of ids) {
    const entry = lookup(id);
    if (!entry) continue;
    if (out.some((existing) => existing.id === entry.id)) continue;
    out.push(entry);
  }
  return out;
}

function sanitize(ids: unknown): readonly string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (trimmed === "" || trimmed.length > MAX_ID_LENGTH || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= MAX_SAVED) break;
  }
  return out;
}

export function createSceneFavoritesStore(
  driver: SecureStorageDriver,
  accountId?: string | undefined,
): SceneFavoritesStore {
  const key = sceneFavoritesKeyFor(accountId);
  return {
    async read(): Promise<readonly string[]> {
      try {
        const raw = await driver.getItem(key);
        if (!raw) return [];
        return sanitize(JSON.parse(raw));
      } catch {
        return [];
      }
    },
    async write(ids: readonly string[]): Promise<void> {
      await driver.setItem(key, JSON.stringify(sanitize(ids)));
    },
  };
}
