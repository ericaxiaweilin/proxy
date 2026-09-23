import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  };
});

import {
  GREET_COOLDOWN_MS,
  GREET_MAX_UNANSWERED,
  countUnansweredOwnMessages,
  isInvited,
  loadGreetState,
  saveGreetState,
} from "./greet-state";

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

describe("HOME-MORE-GREET-003 greet state", () => {
  it("stays invited for 12 hours and only then resets", () => {
    const state = { user_linh: NOW };
    expect(isInvited(state, "user_linh", NOW + GREET_COOLDOWN_MS - 1)).toBe(true);
    expect(isInvited(state, "user_linh", NOW + GREET_COOLDOWN_MS)).toBe(false);
    expect(isInvited(state, "user_minh", NOW)).toBe(false);
  });

  it("survives a reload and is kept per logged-in account", async () => {
    await saveGreetState("user_me", { user_linh: NOW });
    expect(await loadGreetState("user_me", NOW + 1000)).toEqual({ user_linh: NOW });
    expect(await loadGreetState("user_other", NOW + 1000)).toEqual({});
    // 过了冷静期的条目读回来时丢掉
    expect(await loadGreetState("user_me", NOW + GREET_COOLDOWN_MS)).toEqual({});
  });

  it("allows three unanswered messages in a row, counting only the real person's reply", () => {
    expect(GREET_MAX_UNANSWERED).toBe(3);
    const me = "user_me";
    const peer = "user_linh";
    // AI 代回复（proxy_ai）秒回也不算对方回复 —— 否则上限永远到不了
    const rows = [
      { senderId: peer },
      { senderId: me }, { senderId: "proxy_ai" },
      { senderId: me }, { senderId: "proxy_ai" },
      { senderId: me }, { senderId: "proxy_ai" },
    ];
    expect(countUnansweredOwnMessages(rows, me, peer)).toBe(3);
    // 对方本人一回，计数清零
    expect(countUnansweredOwnMessages([...rows, { senderId: peer }], me, peer)).toBe(0);
    expect(countUnansweredOwnMessages([], me, peer)).toBe(0);
  });
});
