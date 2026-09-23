import * as SecureStore from "expo-secure-store";

// HOME-MORE-GREET-003（2026-09-23，用户：「已邀约 切换到 home-更多 又重置了 … 按照互联网产品
// 通行做法 可以发 3 条连续 超过没有回复等待回复吧 但是状态不能重置 必须要冷静 12H 后才能重置
// 状态 因为打招呼了 对话在消息 list 里 不影响持续锁定一个人对话」）：
//
// - 「已邀约」是**落盘**的：记每个人最近一次打招呼的时间，12 小时内一直是「已邀约」，
//   切页面、杀进程都不重置；过了 12 小时才回到「邀约」。
// - 「已邀约」还能再点：同一个人最多连发 GREET_MAX_UNANSWERED 条没被回复的消息，
//   超过就等对方回复。「回复」只认对方本人发的消息 —— 真人账号的 AI 代回复署名是
//   proxy_ai，它每条都会秒回，算它的话这条上限等于没有。
// - 按当前登录账号分开存：换号登录不会继承上一个号的「已邀约」。

export const GREET_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const GREET_MAX_UNANSWERED = 3;

// 人（服务端账号 id）→ 最近一次打招呼的时间（epoch ms）。
export type GreetState = Record<string, number>;

function storageKey(viewerAccountId: string): string {
  // SecureStore 的 key 只收字母数字和 . - _
  return `greet_state_v1_${viewerAccountId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export function isInvited(state: GreetState, accountId: string, now: number): boolean {
  const at = state[accountId];
  return at !== undefined && now - at < GREET_COOLDOWN_MS;
}

// 冷静期过了的条目丢掉，存储不会无限长。
export function pruneGreetState(state: GreetState, now: number): GreetState {
  const next: GreetState = {};
  for (const [id, at] of Object.entries(state)) {
    if (typeof at === "number" && now - at < GREET_COOLDOWN_MS) next[id] = at;
  }
  return next;
}

export async function loadGreetState(viewerAccountId: string, now: number): Promise<GreetState> {
  try {
    const raw = await SecureStore.getItemAsync(storageKey(viewerAccountId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return pruneGreetState(parsed as GreetState, now);
  } catch {
    return {};
  }
}

export async function saveGreetState(viewerAccountId: string, state: GreetState): Promise<void> {
  await SecureStore.setItemAsync(storageKey(viewerAccountId), JSON.stringify(state));
}

// 从会话末尾往前数：我连续发了几条、对方本人还没回。
// 对方本人的消息 = 停；我的消息 = +1；其它发送者（proxy_ai 代回复、SYSTEM 分隔）不打断也不计数。
export function countUnansweredOwnMessages(
  messages: ReadonlyArray<{ senderId?: unknown }>,
  actorId: string,
  peerId: string
): number {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const sender = messages[index]?.senderId;
    if (sender === peerId) break;
    if (sender === actorId) count += 1;
  }
  return count;
}
