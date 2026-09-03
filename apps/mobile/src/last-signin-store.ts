// R15.36 历史登录账户 — UI hint 持久化层。
//
// 目的: 登录页如果用户之前登录过, 显示一张 "继续使用" 卡片
// (avatar + 脱敏的 identifier + "继续" 按钮), 一键重新发起
// 验证码流程。不放 PII 到日志; 标识符只是 email/手机号原文
// (跟 secureSessionStore 里的 accessToken 不同 — 这是 UI 提示,
// 不是凭证, 丢失不构成安全事件)。
//
// 存储策略: 沿用 SecureStore (iOS Keychain / Android Keystore),
// 跟 secureSessionStore 共用同一个 nativeSecureStorageDriver。
// 不需要 AfterFirstUnlock 级别 — 但保持一致更简单。
//
// 写入时机:
//   - createSessionFromChallenge 成功 (用户完成 OTP 流程) — 写
//   - sessionAuthClient.signOut() — 清
//   - 用户点 "切换账号" 在 UI 里手动清
//
// 读出: AuthenticationEntryScreen 渲染前 readLastSignIn()。

import type { SecureStorageDriver } from "./secure-session";

const LAST_SIGNIN_KEY = "proxy.lastSignIn.v1";

export type LastSignInChannel = "EMAIL" | "SMS";

export type LastSignIn = {
  channel: LastSignInChannel;
  identifier: string;
  signedInAt: string;
  userAccountId?: string;
};

export type LastSignInStore = {
  read: () => Promise<LastSignIn | undefined>;
  write: (value: LastSignIn) => Promise<void>;
  clear: () => Promise<void>;
};

function isLastSignIn(value: unknown): value is LastSignIn {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.channel === "EMAIL" || v.channel === "SMS") &&
    typeof v.identifier === "string" &&
    v.identifier.length > 0 &&
    typeof v.signedInAt === "string" &&
    (v.userAccountId === undefined || (typeof v.userAccountId === "string" && v.userAccountId.length > 0))
  );
}

export function createLastSignInStore(driver: SecureStorageDriver): LastSignInStore {
  return {
    async read() {
      try {
        const raw = await driver.getItem(LAST_SIGNIN_KEY);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as unknown;
        if (!isLastSignIn(parsed)) {
          // 旧数据 / 坏数据 — 静默清掉, 避免重复抛错
          await driver.deleteItem(LAST_SIGNIN_KEY).catch(() => undefined);
          return undefined;
        }
        return parsed;
      } catch {
        return undefined;
      }
    },
    async write(value) {
      if (!isLastSignIn(value)) throw new Error("invalid LastSignIn value");
      await driver.setItem(LAST_SIGNIN_KEY, JSON.stringify(value));
    },
    async clear() {
      await driver.deleteItem(LAST_SIGNIN_KEY).catch(() => undefined);
    }
  };
}

// 脱敏 — 给 UI 显示用, 不暴露完整 identifier。
//   email: "thanh@gmail.com" -> "th••••@gmail.com"
//   phone: "+84912345678"   -> "+84 •••• 5678"
export function maskIdentifier(channel: LastSignInChannel, identifier: string): string {
  if (channel === "EMAIL") {
    const at = identifier.indexOf("@");
    if (at <= 0) return identifier;
    const local = identifier.slice(0, at);
    const domain = identifier.slice(at);
    const head = local.slice(0, 2);
    return `${head}••••${domain}`;
  }
  // SMS — 越南手机号
  const digits = identifier.replace(/\D/g, "");
  if (digits.length < 4) return identifier;
  const tail = digits.slice(-4);
  // 找国家码: 84, +84, 0084, 0
  if (digits.startsWith("84")) return `+84 •••• ${tail}`;
  if (digits.startsWith("0")) return `0•••• ${tail}`;
  return `•••• ${tail}`;
}

// avatar 字母 — 取首字符 (email 本地首字母, 或手机号末位)
export function avatarLetterFor(channel: LastSignInChannel, identifier: string): string {
  if (channel === "EMAIL") {
    const local = identifier.split("@")[0] ?? "";
    const ch = local.charAt(0).toUpperCase();
    return ch || "U";
  }
  // SMS — 取国家码后的首数字
  const digits = identifier.replace(/\D/g, "");
  return digits.charAt(digits.length - 4) || "•";
}
