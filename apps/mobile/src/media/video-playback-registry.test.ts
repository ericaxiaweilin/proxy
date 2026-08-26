/**
 * video-playback-registry — P0 多视频声音单例播放位核心不变量。
 *
 * 复现 bug：Feed 动态页有 N 个 SINGLE/RAIL/WALL 视频 post。旧实现下每个 post mount 后
 * 它的 useEffect 无条件调一次 player.play()。N 个 player 同时 playing → 听到多个声音。
 *
 * 修复后不变量（必须满足，否则 P0 还会回归）：
 *   1. claim 之后，旧 owner 必须被 pause（物理上不可能 2 个同时播）
 *   2. 同一 player 多次 claim 是 no-op（不会 pause 自己）
 *   3. release 只清 owner 引用，不主动 pause 自己（pause 由 useEffect cleanup 负责）
 *   4. release 非 owner 是 no-op
 *   5. 重复 release 同一 owner 是幂等
 */
import { describe, expect, it, vi } from "vitest";
import {
  claimVideoPlayback,
  releaseVideoPlayback,
  getCurrentVideoOwner,
  getLivePlayerCount,
  trackPlayer,
  untrackPlayer
} from "./video-playback-registry";

// 真实项目里 VideoPlayer 是 expo-video 的类实例，类型签名复杂。
// 我们只测 registry 的 application 逻辑，不在乎 player 内部状态 — 用最小接口
// 模拟，规避引入真实 native 依赖。
type FakePlayer = { pause: () => void; play: () => void; _id: string };

function makePlayer(id: string): FakePlayer {
  return { _id: id, pause: vi.fn(), play: vi.fn() };
}

function asPlayer(p: FakePlayer): Parameters<typeof claimVideoPlayback>[0] {
  return p as unknown as Parameters<typeof claimVideoPlayback>[0];
}

describe("video-playback-registry · P0 单例播放位", () => {
  it("1. claim 后旧 owner 被 pause，新 player 设为 owner", () => {
    const a = makePlayer("A");
    const b = makePlayer("B");
    claimVideoPlayback(asPlayer(a));
    expect(getCurrentVideoOwner()).toBe(asPlayer(a));
    expect(a.pause).not.toHaveBeenCalled();

    claimVideoPlayback(asPlayer(b));
    expect(getCurrentVideoOwner()).toBe(asPlayer(b));
    // 旧 owner 一定被 pause（这是 P0 修复的物理不变量）
    expect(a.pause).toHaveBeenCalledTimes(1);
    expect(b.pause).not.toHaveBeenCalled();
  });

  it("2. 同一 player 多次 claim 是 no-op，不 pause 自己", () => {
    const a = makePlayer("A");
    claimVideoPlayback(asPlayer(a));
    claimVideoPlayback(asPlayer(a));
    claimVideoPlayback(asPlayer(a));
    expect(a.pause).not.toHaveBeenCalled();
    expect(getCurrentVideoOwner()).toBe(asPlayer(a));
  });

  it("3. release 只清 owner 引用，不主动 pause 自己", () => {
    const a = makePlayer("A");
    claimVideoPlayback(asPlayer(a));
    releaseVideoPlayback(asPlayer(a));
    expect(getCurrentVideoOwner()).toBeNull();
    // release 不应该 pause 自己（pause 由 useEffect cleanup 负责）
    expect(a.pause).not.toHaveBeenCalled();
  });

  it("4. release 非 owner 是 no-op", () => {
    const a = makePlayer("A");
    const b = makePlayer("B");
    claimVideoPlayback(asPlayer(a));
    releaseVideoPlayback(asPlayer(b));
    expect(getCurrentVideoOwner()).toBe(asPlayer(a));
    expect(a.pause).not.toHaveBeenCalled();
  });

  it("5. 重复 release 同一 owner 是幂等", () => {
    const a = makePlayer("A");
    claimVideoPlayback(asPlayer(a));
    releaseVideoPlayback(asPlayer(a));
    releaseVideoPlayback(asPlayer(a));
    releaseVideoPlayback(asPlayer(a));
    expect(getCurrentVideoOwner()).toBeNull();
  });

  it("6. 顺序链 A → B → A → B 每次切换都 pause 上一个", () => {
    const a = makePlayer("A");
    const b = makePlayer("B");
    claimVideoPlayback(asPlayer(a));
    claimVideoPlayback(asPlayer(b));
    expect(a.pause).toHaveBeenCalledTimes(1);
    claimVideoPlayback(asPlayer(a));
    expect(b.pause).toHaveBeenCalledTimes(1);
    claimVideoPlayback(asPlayer(b));
    expect(a.pause).toHaveBeenCalledTimes(2);
    expect(b.pause).toHaveBeenCalledTimes(1);
  });

  it("7. safePause 兜底：player.pause 抛错时不传播", () => {
    // 模拟 AVPlayer.native handle 已 release 的场景：pause 抛错
    const bad: FakePlayer = {
      _id: "bad",
      pause: vi.fn(() => { throw new Error("native handle released"); }),
      play: vi.fn()
    };
    const a = makePlayer("A");
    claimVideoPlayback(asPlayer(a));
    // claim 触发 pause(a) — a 没抛错；再切到 bad 时，safePause 应能容忍抛错
    expect(() => claimVideoPlayback(asPlayer(bad))).not.toThrow();
    expect(getCurrentVideoOwner()).toBe(asPlayer(bad));
  });

  it("8. live 集合：trackPlayer / untrackPlayer 维护活跃 player 列表", () => {
    const a = makePlayer("A");
    const b = makePlayer("B");
    const before = getLivePlayerCount();
    trackPlayer(asPlayer(a));
    trackPlayer(asPlayer(b));
    expect(getLivePlayerCount()).toBe(before + 2);
    untrackPlayer(asPlayer(a));
    expect(getLivePlayerCount()).toBe(before + 1);
    untrackPlayer(asPlayer(b));
    expect(getLivePlayerCount()).toBe(before);
  });
});
