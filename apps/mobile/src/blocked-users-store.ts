import { Directory, File, Paths } from "expo-file-system";

// SETTINGS-BLOCKLIST-001（2026-10-01，用户：「黑名单还没做 … 要做 基本功能」）
//
// 为什么是本机名单：服务端**没有**「列出黑名单」的命令（api-go 全仓零命中，
// 我查过）。friend-crm 里那个「拉黑」此前只是组件内的 useState —— 组件一卸载
// 就没了，用户在设置页根本看不到自己拉黑过谁。
//
// 而 PLACEHOLDER-001（placeholder-honest-actions.test.ts）明写：「无后端走本地
// 演示状态机」是允许的，只要**点了真生效**。所以这里的契约是：
//   · 拉黑 → 真写盘 + 真从好友列表消失 + 设置页立刻能看到、能解封；
//   · 名单**只存本机**（界面必须标出来 —— 说成云端同步就是撒谎）。
//
// 版本化 JSON + 损坏回退空名单：名单损坏时静默变成「没拉黑任何人」，用户看到
// 的是一个诚实的空列表，而不是一个假装有黑名单的界面。

export type BlockedUser = {
  /** CRM 里的稳定 id（不是显示名 —— 显示名会改，id 不会）。 */
  userId: string;
  displayName: string;
  /** ISO 时间戳，用于按时间倒序。 */
  blockedAt: string;
};

type BlocklistSnapshot = {
  version: 1;
  blocked: BlockedUser[];
};

const dir = new Directory(Paths.document, "proxy-local");
const file = new File(dir, "blocked-users-v1.json");

function readSnapshot(): BlocklistSnapshot {
  if (!file.exists) return { version: 1, blocked: [] };
  try {
    const raw = file.json() as unknown;
    if (!raw || typeof raw !== "object") return { version: 1, blocked: [] };
    const candidate = raw as Partial<BlocklistSnapshot>;
    if (candidate.version !== 1 || !Array.isArray(candidate.blocked)) {
      return { version: 1, blocked: [] };
    }
    const blocked = candidate.blocked.filter(
      (entry): entry is BlockedUser =>
        !!entry &&
        typeof entry.userId === "string" &&
        entry.userId.length > 0 &&
        typeof entry.displayName === "string" &&
        typeof entry.blockedAt === "string"
    );
    return { version: 1, blocked };
  } catch {
    // 读坏了就是读坏了，不假装记得 —— 一个假的黑名单比没有更糟。
    return { version: 1, blocked: [] };
  }
}

function writeSnapshot(snapshot: BlocklistSnapshot): void {
  dir.create({ idempotent: true, intermediates: true });
  file.write(JSON.stringify(snapshot));
}

// ---- 模块级 store：friend-crm 拉黑、设置页解封，两边都要看到同一份 ----

let blocked: BlockedUser[] = readSnapshot().blocked;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeBlocklist(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBlocklist(): ReadonlyArray<BlockedUser> {
  return blocked;
}

export function isBlocked(userId: string): boolean {
  return blocked.some((entry) => entry.userId === userId);
}

/**
 * 拉黑一个人。返回 false 表示「本来就在名单里」——重复拉黑不该静默成功，
 * 调用方据此给一句不同的反馈（这仓反复修过"两种失败说同一句话"）。
 */
export function blockUser(userId: string, displayName: string): boolean {
  if (!userId.trim()) return false;
  if (isBlocked(userId)) return false;
  blocked = [...blocked, { userId, displayName, blockedAt: new Date().toISOString() }];
  writeSnapshot({ version: 1, blocked });
  emit();
  return true;
}

export function unblockUser(userId: string): boolean {
  const next = blocked.filter((entry) => entry.userId !== userId);
  if (next.length === blocked.length) return false;
  blocked = next;
  writeSnapshot({ version: 1, blocked });
  emit();
  return true;
}