// profile-store.ts — 个人主页 profile 持久化层。
//
// 目的: "我的" 页 profile 编辑 (头像 / 名称 / 用户名 / 简介 / 城市)
// "完成" 后真正写盘, 重新进入 me tab / 重启 app 后能恢复, 而不是
// 回到 useState 初值 (logo 头像 + "Huyen" 占位文)。
//
// 存储策略: 沿用 SecureStore (iOS Keychain / Android Keystore),
// 跟 secureSessionStore / lastSignInStore 共用同一个
// nativeSecureStorageDriver。profile 是 UI 显示数据, 不放凭证,
// 丢失不构成安全事件 — 但保持一致更简单。
//
// 头像: 选完相册后, 把原 file:// URI 复制到 documentDirectory
// 内的稳定路径 (proxy-avatar-<userAccountId 或 'me'>.jpg),
// profileStore 只存稳定路径 (不是原 URI, 因为 iOS/Android 在
// app 卸载/沙盒变更后原 URI 会失效)。

import type { SecureStorageDriver } from "./secure-session";

const PROFILE_KEY = "proxy.profile.v1";

/**
 * PROFILE-READ-001: profile storage is scoped per account so two accounts
 * sharing one device never see each other's name/handle. The unscoped key
 * is the pre-pipeline legacy slot and must only be read for one-time
 * same-account adoption (see me.tsx hydration), never as a live source.
 */
export function profileKeyFor(accountId?: string | undefined): string {
  const scope = (accountId ?? "").trim();
  return scope === "" ? PROFILE_KEY : `${PROFILE_KEY}.${scope}`;
}

export type ProfileRecord = {
  name: string;
  handle: string;
  bio: string;
  city: string;
  /** 稳定路径, 指向 documentDirectory 下的头像副本 (或 undefined). */
  avatarPath: string | undefined;
  updatedAt: string;
};

export type ProfileStore = {
  read: () => Promise<ProfileRecord | undefined>;
  write: (value: ProfileRecord) => Promise<void>;
  clear: () => Promise<void>;
};

const MAX_NAME = 60;
const MAX_HANDLE = 60;
const MAX_BIO = 280;
const MAX_CITY = 60;
const MAX_AVATAR_PATH = 4096;

export function isProfileRecord(value: unknown): value is ProfileRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" && v.name.length > 0 && v.name.length <= MAX_NAME &&
    typeof v.handle === "string" && v.handle.length > 0 && v.handle.length <= MAX_HANDLE &&
    typeof v.bio === "string" && v.bio.length <= MAX_BIO &&
    typeof v.city === "string" && v.city.length > 0 && v.city.length <= MAX_CITY &&
    (v.avatarPath === undefined || (typeof v.avatarPath === "string" && v.avatarPath.length > 0 && v.avatarPath.length <= MAX_AVATAR_PATH)) &&
    typeof v.updatedAt === "string" && v.updatedAt.length > 0
  );
}

/**
 * AVATAR-SAVE-002: 服务端 profile 合并回本地记录时的规则。
 *
 * remote.avatarPath 形如 `assets/<mediaAssetId>` —— 那是服务端媒体 id，不是本机
 * 文件名。旧实现直接 `avatarFileName(remote.avatarPath)` 覆盖本地记录，把
 * documentDirectory 里那份 `avatar-<ts>.jpg` 的指针抹掉：重启/离线时本地头像再也
 * 指不回去，表现为「换完头像被默认重置成字母头」。
 *
 * 规则：本地已有副本文件名时永远保留（它是唯一的离线可读来源）；只有本地没有头像
 * 时才退回服务端派生的名字。
 */
export function mergeRemoteProfile(
  remote: { name: string; handle: string; bio: string; city: string; avatarPath?: string | undefined; updatedAt: string },
  existing?: ProfileRecord | undefined
): ProfileRecord {
  const remoteDerived = remote.avatarPath ? avatarFileName(remote.avatarPath) : undefined;
  return {
    name: remote.name,
    handle: remote.handle,
    bio: remote.bio,
    city: remote.city,
    avatarPath: existing?.avatarPath ?? remoteDerived,
    updatedAt: remote.updatedAt
  };
}

export function createProfileStore(driver: SecureStorageDriver, accountId?: string | undefined): ProfileStore {
  const key = profileKeyFor(accountId);
  return {
    async read() {
      try {
        const raw = await driver.getItem(key);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as unknown;
        if (!isProfileRecord(parsed)) {
          await driver.deleteItem(key).catch(() => undefined);
          return undefined;
        }
        return parsed;
      } catch {
        return undefined;
      }
    },
    async write(value) {
      if (!isProfileRecord(value)) throw new Error("invalid ProfileRecord value");
      await driver.setItem(key, JSON.stringify(value));
    },
    async clear() {
      await driver.deleteItem(key).catch(() => undefined);
    }
  };
}

/** 默认 profile — me tab 初次进入、未登录态 / 未编辑过时使用。 */
export const DEFAULT_PROFILE: ProfileRecord = {
  name: "用户",
  handle: "@user",
  bio: "",
  city: "河内",
  avatarPath: undefined,
  updatedAt: new Date(0).toISOString()
};

/**
 * AVATAR-001: 头像在 profileStore 里只存文件名（相对名），读取时按当前
 * 沙盒的 documentDirectory 重新锚定。iOS 每次重装 App container UUID 会变，
 * 存绝对 file:// URI 下次必死；之前 hydration 还用了不存在的 file.exists
 *（恒为 undefined），导致每次冷启动头像都丢、只剩字母头。
 */
export function avatarFileName(storedPath: string): string {
  const cut = storedPath.split("?")[0] ?? storedPath;
  const parts = cut.split("/").filter((part) => part.length > 0);
  const last = parts[parts.length - 1];
  return typeof last === "string" && last.length > 0 ? last : storedPath;
}
