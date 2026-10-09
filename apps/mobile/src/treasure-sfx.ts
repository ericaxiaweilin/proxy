import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { Vibration } from "react-native";

// TREASURE-001：寻宝的声音与震动。音效是代码合成的小 wav（assets/treasure），第一次用到才创建播放器；
// 静音时也不震动（和 PAO0 同一条规矩）。任何失败都静默——声音是锦上添花，绝不能挡住开箱。
const SOURCES = {
  blip: require("../assets/treasure/blip.wav"),
  charge: require("../assets/treasure/charge.wav"),
  open: require("../assets/treasure/open.wav"),
  coin: require("../assets/treasure/coin.wav"),
  ding: require("../assets/treasure/ding.wav"),
  fail: require("../assets/treasure/fail.wav"),
} as const;

export type SfxName = keyof typeof SOURCES;

const players = new Map<SfxName, AudioPlayer>();
let muted = false;

export function setTreasureMuted(next: boolean): void {
  muted = next;
  if (next) stopSfx("charge");
}

export function isTreasureMuted(): boolean {
  return muted;
}

export function playSfx(name: SfxName): void {
  if (muted) return;
  try {
    let player = players.get(name);
    if (!player) {
      player = createAudioPlayer(SOURCES[name]);
      players.set(name, player);
    }
    void player.seekTo(0);
    player.play();
  } catch {
    // 静默
  }
}

export function stopSfx(name: SfxName): void {
  try {
    players.get(name)?.pause();
  } catch {
    // 静默
  }
}

export function releaseSfx(): void {
  for (const p of players.values()) {
    try {
      p.remove();
    } catch {
      // 静默
    }
  }
  players.clear();
}

/** 震动：静音时也不震。pattern 单位毫秒（iOS 上只认「震一下」，时长由系统定）。 */
export function buzz(pattern: number | number[]): void {
  if (muted) return;
  try {
    Vibration.vibrate(pattern);
  } catch {
    // 静默
  }
}
