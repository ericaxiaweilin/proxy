import { describe, expect, it, vi } from "vitest";

// DEVICE-LOCATION-002: 跟随开关的持久化。mock 整块 SecureStore ——
// 测的是"开关和手动地点同一持久层、读写同一编解码"，不是 native 本体。
vi.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

import { loadFollowDevice, saveFollowDevice } from "./location-store";

describe("DEVICE-LOCATION-002 follow toggle survives restarts", () => {
  it("reads undefined when the toggle was never touched (legacy manual-first path)", async () => {
    // mock store 全新：跟随键不存在 —— 老用户第一次升级上来走老口径。
    await expect(loadFollowDevice()).resolves.toBeUndefined();
  });

  it("round-trips an explicit ON so a cold start no longer flips it back off", async () => {
    await saveFollowDevice(true);
    await expect(loadFollowDevice()).resolves.toBe(true);
  });

  it("round-trips an explicit OFF so a manual choice is not resurrected as follow", async () => {
    await saveFollowDevice(false);
    await expect(loadFollowDevice()).resolves.toBe(false);
  });
});
