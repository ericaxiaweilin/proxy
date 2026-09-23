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
