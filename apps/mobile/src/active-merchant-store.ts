import { Directory, File, Paths } from "expo-file-system";

import { resolveActiveMerchant } from "./active-merchant";

// MERCHANT-ACTIVE-ACCOUNT-001：商家端共用的「当前商家账号」。首页、我的、专属码页任何一处切换，
// 其他页面跟着切；记在本机，下次打开还是这家（不再各自默认取列表第一个）。
// 只存一个账号 id —— 读坏了就当没记过（回到列表第一个），不假装记得。

const dir = new Directory(Paths.document, "proxy-local");
const file = new File(dir, "active-merchant-v1.json");

function read(): string | undefined {
  try {
    if (!file.exists) return undefined;
    const raw = file.json() as { version?: number; accountId?: unknown } | null;
    return raw && raw.version === 1 && typeof raw.accountId === "string" && raw.accountId !== "" ? raw.accountId : undefined;
  } catch {
    return undefined;
  }
}

let current: string | undefined = read();
const listeners = new Set<(accountId: string | undefined) => void>();

export function getActiveMerchantId(): string | undefined {
  return current;
}

/** 当前账号：记过且还在列表里就用它，否则列表第一个。 */
export function pickActiveMerchant(accountIds: readonly string[]): string | undefined {
  return resolveActiveMerchant(accountIds, current);
}

export function setActiveMerchantId(accountId: string): void {
  if (accountId === current) return;
  current = accountId;
  try {
    dir.create({ idempotent: true, intermediates: true });
    file.write(JSON.stringify({ version: 1, accountId }));
  } catch {
    // 写不进本机也不挡切换：这次会话里照样生效，只是下次打开回到列表第一个。
  }
  for (const listener of listeners) listener(accountId);
}

export function subscribeActiveMerchant(listener: (accountId: string | undefined) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
