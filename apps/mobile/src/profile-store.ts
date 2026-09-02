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

export function createProfileStore(driver: SecureStorageDriver): ProfileStore {
  return {
    async read() {
      try {
        const raw = await driver.getItem(PROFILE_KEY);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as unknown;
        if (!isProfileRecord(parsed)) {
          await driver.deleteItem(PROFILE_KEY).catch(() => undefined);
          return undefined;
        }
        return parsed;
      } catch {
        return undefined;
      }
    },
    async write(value) {
      if (!isProfileRecord(value)) throw new Error("invalid ProfileRecord value");
      await driver.setItem(PROFILE_KEY, JSON.stringify(value));
    },
    async clear() {
      await driver.deleteItem(PROFILE_KEY).catch(() => undefined);
    }
  };
}

/** 默认 profile — me tab 初次进入、未登录态 / 未编辑过时使用。 */
export const DEFAULT_PROFILE: ProfileRecord = {
  name: "Huyen",
  handle: "huyen.hanoi",
  bio: "喜欢旅行、拍照和城市里的新鲜体验。",
  city: "河内",
  avatarPath: undefined,
  updatedAt: new Date(0).toISOString()
};
