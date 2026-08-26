import { describe, expect, it, vi } from "vitest";
import { MAX_AUDIO_DURATION_MS } from "@proxy/contracts";
import {
  VOICE_TICK_INTERVAL_MS,
  createVoiceRecorderController,
  elapsedClamped,
  formatVoiceElapsed,
  type VoiceRecorderDeps,
  type VoiceRecorderTimer
} from "./voice-recorder";

/** 确定性假时钟：手动推进 tick，无真实等待。 */
function fakeTimer(): VoiceRecorderTimer & { advance: (ms: number) => void; nowMs: () => number } {
  let current = 1_000_000;
  const callbacks = new Set<{ fn: () => void; every: number; next: number }>();
  return {
    setInterval: (fn, ms) => {
      const entry = { fn, every: ms, next: current + ms };
      callbacks.add(entry);
      return () => callbacks.delete(entry);
    },
    now: () => current,
    nowMs: () => current,
    advance: (ms) => {
      const target = current + ms;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let earliest: { fn: () => void; next: number } | null = null;
        for (const entry of callbacks) {
          if (entry.next <= target && (earliest === null || entry.next < earliest.next)) {
            earliest = { fn: entry.fn, next: entry.next };
          }
        }
        if (earliest === null) break;
        current = earliest.next;
        for (const entry of callbacks) {
          if (entry.next <= current) entry.next += entry.every;
        }
        earliest.fn();
      }
      current = target;
    }
  };
}

function setup(overrides?: Partial<{ granted: boolean; stopUri: string | null }>) {
  const timer = fakeTimer();
  const requestPermissions = vi.fn(async () => ({ granted: overrides?.granted ?? true }));
  const startRecording = vi.fn(async () => undefined);
  // 注意：不能用 `?? 默认值` —— stopUri=null 是合法输入（录音失败），
  // 必须显式区分「未传」与「传了 null」。
  const stopRecording = vi.fn(async () =>
    overrides && "stopUri" in overrides ? overrides.stopUri : "file:///tmp/voice.m4a"
  );
  const deps: VoiceRecorderDeps = { requestPermissions, startRecording, stopRecording };
  const controller = createVoiceRecorderController(deps, { timer });
  return { controller, timer, requestPermissions, startRecording, stopRecording };
}

describe("elapsedClamped（30s 硬顶）", () => {
  it("正常累计", () => {
    expect(elapsedClamped(1_000, 4_000)).toBe(3_000);
  });
  it("到达上限后钳制，绝不超 30s", () => {
    expect(elapsedClamped(0, MAX_AUDIO_DURATION_MS)).toBe(MAX_AUDIO_DURATION_MS);
    expect(elapsedClamped(0, MAX_AUDIO_DURATION_MS + 9_999)).toBe(MAX_AUDIO_DURATION_MS);
  });
  it("时钟倒挂不出负数", () => {
    expect(elapsedClamped(5_000, 3_000)).toBe(0);
  });
});

describe("formatVoiceElapsed", () => {
  it("m:ss / 0:30 格式", () => {
    expect(formatVoiceElapsed(0)).toBe("0:00 / 0:30");
    expect(formatVoiceElapsed(65_000)).toBe("1:05 / 0:30");
    expect(formatVoiceElapsed(29_000)).toBe("0:29 / 0:30");
    expect(formatVoiceElapsed(30_000)).toBe("0:30 / 0:30");
  });
});

describe("createVoiceRecorderController 状态机", () => {
  it("权限被拒：不进入 RECORDING，给出错误，不碰底层录音", async () => {
    const { controller, startRecording } = setup({ granted: false });
    await controller.start();
    expect(controller.snapshot().phase).toBe("IDLE");
    expect(controller.snapshot().error).toContain("麦克风");
    expect(startRecording).not.toHaveBeenCalled();
  });

  it("start → RECORDING；finish → DONE 且带 uri 与时长", async () => {
    const { controller, timer } = setup();
    await controller.start();
    expect(controller.snapshot().phase).toBe("RECORDING");
    timer.advance(2_000);
    expect(controller.snapshot().elapsedMs).toBeGreaterThanOrEqual(2_000 - VOICE_TICK_INTERVAL_MS);
    await controller.finish();
    const snapshot = controller.snapshot();
    expect(snapshot.phase).toBe("DONE");
    expect(snapshot.result?.uri).toBe("file:///tmp/voice.m4a");
    expect(snapshot.result?.durationMs).toBeGreaterThan(0);
    expect(snapshot.result?.durationMs).toBeLessThanOrEqual(MAX_AUDIO_DURATION_MS);
  });

  it("30s 到点自动收音，不依赖用户按停", async () => {
    const { controller, timer } = setup();
    await controller.start();
    timer.advance(MAX_AUDIO_DURATION_MS + 10_000);
    await Promise.resolve();
    await Promise.resolve();
    const snapshot = controller.snapshot();
    expect(snapshot.phase).toBe("DONE");
    expect(snapshot.elapsedMs).toBeLessThanOrEqual(MAX_AUDIO_DURATION_MS);
    expect(snapshot.result?.durationMs).toBeLessThanOrEqual(MAX_AUDIO_DURATION_MS);
  });

  it("cancel：回 IDLE、不产出草稿，但底层 stop 被调用以释放资源", async () => {
    const { controller, stopRecording } = setup();
    await controller.start();
    controller.cancel();
    expect(controller.snapshot().phase).toBe("IDLE");
    expect(controller.snapshot().result).toBeUndefined();
    expect(stopRecording).toHaveBeenCalledTimes(1);
  });

  it("stop 返回空 uri（录音失败）：回 IDLE 不给假结果", async () => {
    const { controller, timer } = setup({ stopUri: null });
    await controller.start();
    const finishing = controller.finish();
    // finish 内部先 publish PROCESSING 再 await stopRecording；推进一步时间让微任务落地。
    timer.advance(0);
    await finishing;
    const snapshot = controller.snapshot();
    expect(snapshot.phase).toBe("IDLE");
    expect(snapshot.result).toBeUndefined();
  });

  it("reset 清空 DONE 结果与错误", async () => {
    const { controller } = setup({ granted: false });
    await controller.start();
    expect(controller.snapshot().error).toBeDefined();
    controller.reset();
    const snapshot = controller.snapshot();
    expect(snapshot.phase).toBe("IDLE");
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.elapsedMs).toBe(0);
  });

  it("finish 在 PROCESSING 期间幂等（重复按停不二次收音）", async () => {
    const { controller, stopRecording } = setup();
    await controller.start();
    const first = controller.finish();
    const second = controller.finish();
    await Promise.all([first, second]);
    expect(stopRecording).toHaveBeenCalledTimes(1);
  });
});
