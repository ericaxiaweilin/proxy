/**
 * video-playback-registry — Proxy 多视频同时播放 P0 修复核心
 *
 * 问题（2026-08-26 P0）：
 *   Feed 动态页有 N 个 SINGLE/RAIL/WALL 视频 post。旧实现下，每个 post mount 后
 *   它的 useEffect 会无条件调一次 `player.play()`。N 个 post 同时进入 "playing"
 *   状态 → iOS audio session 争用 → 听到多个声音叠加（甚至屏外、还没滚到的
 *   post 也在播）。
 *
 * 方案（X/IG/TikTok 同款单例播放位）：
 *   - 所有 useVideoPlayer 创建的 VideoPlayer 在 mount 时注册到本单例。
 *   - 任何代码（包括 user tap play）想播一个 player 之前，必须先调
 *     `claimVideoPlayback(player)`：先 pause 之前 owner、设本 player 为新 owner。
 *   - unmount 时 release：清掉 owner 引用（owner 自身的 player.pause() 由 useEffect cleanup 负责）。
 *   - 同时调用 .play() 是 idempotent 的（expo-video 内部会忽略重复 play），所以
 *     即使有竞争，registry 的"先 pause 其他、再设 owner"模型也能保证：同一时刻
 *     至多 1 个 player 真正在播。
 *
 * 为什么不用 expo-audio 的 setAudioModeAsync：
 *   expo-audio 控制的是 recorder + 整体 mode；expo-video 的 player 是独立的
 *   AVPlayer 实例，audio session 争用要靠 application 层去 pause 别人。这里
 *   registry 是 application 层"上帝视角"，比 audio mode 更直接。
 *
 * 设计原则：
 *   1. 模块级 Set：跨组件共享，不需要 React Context（避免 re-render 风暴）。
 *   2. player 用引用相等比较（===）：同一个 player 多次 claim 是 no-op。
 *   3. unmount release 幂等：同一个 player release 多次不报错。
 *   4. 不依赖 React、不依赖 expo-video 在 setup 阶段跑（避开 hook order 问题）。
 */

import type { VideoPlayer } from "expo-video";

const live = new Set<VideoPlayer>();
let currentOwner: VideoPlayer | null = null;

function safePause(player: VideoPlayer): void {
  try {
    player.pause();
  } catch {
    // player 已 released / native handle 没了 — 忽略，避免 uncaught exception。
  }
}

/**
 * 申请单例播放位。
 * - 如果 player 已是 owner：no-op，立即返回 true。
 * - 否则：pause 旧的 owner，把 player 设为新 owner。
 *
 * 调用方拿到 true 后需要自己调 player.play()（caller 通常还需要等
 * isActive / autoPlay 等外部条件 settle；本函数只解决"不能两个同时播"）。
 * 不过因为我们在 useEffect 里 `claimVideoPlayback(player); player.play();`
 * 同步连调（claim 在前，play 在后），audio session 切换窗口期被压到 1 个
 * microtask 之内，iOS 听不到中间态的 silence 跳动。
 */
export function claimVideoPlayback(player: VideoPlayer): boolean {
  if (currentOwner === player) return true;
  if (currentOwner && currentOwner !== player) {
    safePause(currentOwner);
  }
  currentOwner = player;
  return true;
}

/**
 * 释放播放位。
 * - 如果 player 是 owner：清空 owner。
 * - 否则：no-op。
 * 注意：本函数不主动 pause(player)；pause 由 useEffect cleanup 负责（unmount
 * 永远 pause），避免和 ActiveVideoStage 的 [player, autoPlay] effect 抢。
 */
export function releaseVideoPlayback(player: VideoPlayer): void {
  if (currentOwner === player) {
    currentOwner = null;
  }
}

/**
 * 注册一个 player 到活跃集合（仅用于诊断 / 测试）。
 * 普通路径不需要直接调；claimVideoPlayback 内部已隐式注册。
 */
export function trackPlayer(player: VideoPlayer): void {
  live.add(player);
}

export function untrackPlayer(player: VideoPlayer): void {
  live.delete(player);
  if (currentOwner === player) currentOwner = null;
}

/** 当前 owner 引用（仅测试用）。 */
export function getCurrentVideoOwner(): VideoPlayer | null {
  return currentOwner;
}

/** 当前活跃 player 数量（仅测试用）。 */
export function getLivePlayerCount(): number {
  return live.size;
}
