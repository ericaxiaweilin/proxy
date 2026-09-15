// R15.13 P6：自定义坐标的持久化层。
// 用户在地图上放的点不应该每次开 app 都重做 — expo-secure-store
// 跟 session 一样走 keychain，比 AsyncStorage 安全 (不需要
// 单独的 native module)，又跟现有 preferences.ts 的存储方式一致。
//
// 数据形状：JSON 序列化的 CustomLocation[] (历史记录，1-5 条) +
// 当前激活的 custom id (这样切回 preset 不会丢历史)。同 id 重复
// 写会自动覆盖 (last-write-wins)，不会出现"两个点都叫 custom_*"
// 的脏数据。
import * as SecureStore from "expo-secure-store";
import { type CustomLocation } from "./location-options";

const KEY_CUSTOM_HISTORY = "proxy_location_custom_history";
const KEY_CUSTOM_ACTIVE = "proxy_location_custom_active";
const MAX_HISTORY = 5;

interface PersistedHistory {
  version: 1;
  items: CustomLocation[];
}

function safeParse(value: string | null): PersistedHistory | undefined {
  if (!value) return undefined;
  try {
    const obj = JSON.parse(value);
    if (obj && obj.version === 1 && Array.isArray(obj.items)) {
      return obj as PersistedHistory;
    }
  } catch {
    // fall through
  }
  return undefined;
}

export async function loadCustomHistory(): Promise<CustomLocation[]> {
  const raw = await SecureStore.getItemAsync(KEY_CUSTOM_HISTORY);
  const parsed = safeParse(raw);
  return parsed?.items ?? [];
}

export async function loadActiveCustomId(): Promise<string | undefined> {
  return (await SecureStore.getItemAsync(KEY_CUSTOM_ACTIVE)) ?? undefined;
}

export async function saveCustomLocation(next: CustomLocation): Promise<void> {
  const history = await loadCustomHistory();
  // 同 id 优先更新 (用户微调了 pin / 半径)
  const existingIndex = history.findIndex((entry) => entry.id === next.id);
  let updated: CustomLocation[];
  if (existingIndex >= 0) {
    updated = history.slice();
    updated[existingIndex] = next;
  } else {
    // 新点 — 头部插入，保留最近 5 条
    updated = [next, ...history].slice(0, MAX_HISTORY);
  }
  const payload: PersistedHistory = { version: 1, items: updated };
  await Promise.all([
    SecureStore.setItemAsync(KEY_CUSTOM_HISTORY, JSON.stringify(payload)),
    SecureStore.setItemAsync(KEY_CUSTOM_ACTIVE, next.id)
  ]);
}

export async function clearActiveCustom(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_CUSTOM_ACTIVE);
}

const KEY_FOLLOW_DEVICE = "proxy_location_follow_device";

// DEVICE-LOCATION-002: 跟随开关必须和手动地点一样持久。之前开关只活在内存，
// 手动地点存在 keychain —— 每次冷启动恢复流程都把开关打回 false，用户点了
// "开启"也没用（杀掉重进就回去）。现在开关和地点同一持久层：
//   - true = 用户明确要跟随，手动地点只当首帧回退，不拦跟随；
//   - false = 用户明确关掉，手动优先；
//   - undefined = 从没动过开关，走老口径（有存过手动地点就手动优先）。
export async function loadFollowDevice(): Promise<boolean | undefined> {
  const raw = await SecureStore.getItemAsync(KEY_FOLLOW_DEVICE);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return undefined;
}

export async function saveFollowDevice(next: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY_FOLLOW_DEVICE, next ? "1" : "0");
}
