import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_AUDIO_DURATION_MS } from "@proxy/contracts";

/**
 * 语音推文录音状态机（纯逻辑，UI 与 React 无关，可确定性单测）。
 *
 * 不变量：
 * - 录音时长硬顶 30s（MAX_AUDIO_DURATION_MS）：计时到达自动停，绝不产出超限文件。
 *   服务端 ffprobe 仍会复核 —— 客户端上限是体验层，服务端才是契约。
 * - 只有 mic 权限授予后才能进入 RECORDING。
 * - stop 后 uri 才可用；取消后不产出草稿。
 */
export type VoiceRecorderPhase = "IDLE" | "RECORDING" | "PROCESSING" | "DONE";

export type VoiceRecordingResult = {
  uri: string;
  durationMs: number;
};

export type VoiceRecorderDeps = {
  requestPermissions: () => Promise<{ granted: boolean }>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
};

export type VoiceRecorderSnapshot = {
  phase: VoiceRecorderPhase;
  elapsedMs: number;
  result?: VoiceRecordingResult;
  error?: string;
};

export type VoiceRecorderTimer = {
  setInterval: (fn: () => void, intervalMs: number) => () => void;
  now: () => number;
};

export const VOICE_TICK_INTERVAL_MS = 100;

export function elapsedClamped(startedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.min(nowMs - startedAtMs, MAX_AUDIO_DURATION_MS));
}

export function formatVoiceElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const whole = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${whole}:${String(remainder).padStart(2, "0")} / 0:30`;
}

export type VoiceRecorderController = {
  snapshot(): VoiceRecorderSnapshot;
  start(): Promise<void>;
  finish(): Promise<void>;
  cancel(): void;
  reset(): void;
  dispose(): void;
};

const realTimer: VoiceRecorderTimer = {
  setInterval: (fn, ms) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  now: () => Date.now()
};

export function createVoiceRecorderController(
  deps: VoiceRecorderDeps,
  options: { timer?: VoiceRecorderTimer; onSnapshot?: (snapshot: VoiceRecorderSnapshot) => void } = {}
): VoiceRecorderController {
  const timer = options.timer ?? realTimer;
  const onSnapshot = options.onSnapshot ?? (() => {});

  let phase: VoiceRecorderPhase = "IDLE";
  let elapsedMs = 0;
  let result: VoiceRecordingResult | undefined;
  let error: string | undefined;
  let startedAtMs = 0;
  let stopTick: (() => void) | null = null;
  let finishing = false;
  let disposed = false;

  const publish = (): void => {
    onSnapshot({
      phase,
      elapsedMs,
      ...(result !== undefined ? { result } : {}),
      ...(error !== undefined ? { error } : {})
    });
  };

  const clearTick = (): void => {
    if (stopTick !== null) {
      stopTick();
      stopTick = null;
    }
  };

  const collect = async (): Promise<void> => {
    clearTick();
    phase = "PROCESSING";
    publish();
    const finalElapsed = elapsedClamped(startedAtMs, timer.now());
    elapsedMs = finalElapsed;
    publish();
    const uri = await deps.stopRecording();
    if (disposed) return;
    if (uri) {
      result = { uri, durationMs: finalElapsed };
      phase = "DONE";
    } else {
      result = undefined;
      phase = "IDLE";
    }
    finishing = false;
    publish();
  };

  return {
    snapshot: () => ({
      phase,
      elapsedMs,
      ...(result !== undefined ? { result } : {}),
      ...(error !== undefined ? { error } : {})
    }),
    start: async () => {
      error = undefined;
      result = undefined;
      const permission = await deps.requestPermissions();
      if (disposed) return;
      if (!permission.granted) {
        error = "需要麦克风权限才能录制语音";
        publish();
        return;
      }
      try {
        startedAtMs = timer.now();
        elapsedMs = 0;
        await deps.startRecording();
        if (disposed) return;
        phase = "RECORDING";
        publish();
        stopTick = timer.setInterval(() => {
          elapsedMs = elapsedClamped(startedAtMs, timer.now());
          // 30s 硬顶：到点自动收音，不依赖用户记得按停。
          if (elapsedMs >= MAX_AUDIO_DURATION_MS && !finishing) {
            finishing = true;
            void collect();
            return;
          }
          publish();
        }, VOICE_TICK_INTERVAL_MS);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : "无法启动录音";
        phase = "IDLE";
        publish();
      }
    },
    finish: async () => {
      if (phase !== "RECORDING" || finishing) return;
      finishing = true;
      await collect();
    },
    cancel: () => {
      clearTick();
      finishing = true;
      void deps.stopRecording().finally(() => {
        finishing = false;
      });
      phase = "IDLE";
      elapsedMs = 0;
      result = undefined;
      publish();
    },
    reset: () => {
      phase = "IDLE";
      elapsedMs = 0;
      result = undefined;
      error = undefined;
      publish();
    },
    dispose: () => {
      disposed = true;
      clearTick();
    }
  };
}

/** React 绑定：hook 只做订阅与转发，逻辑全在 controller。 */
export function useVoiceRecorder(deps: VoiceRecorderDeps): VoiceRecorderSnapshot & {
  start: () => Promise<void>;
  finish: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
} {
  const [, setRenderTick] = useState(0);
  const forceRender = useCallback(() => setRenderTick((tick) => tick + 1), []);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const controllerRef = useRef<VoiceRecorderController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createVoiceRecorderController(
      {
        requestPermissions: () => depsRef.current.requestPermissions(),
        startRecording: () => depsRef.current.startRecording(),
        stopRecording: () => depsRef.current.stopRecording()
      },
      { onSnapshot: () => forceRender() }
    );
  }
  useEffect(() => {
    const controller = controllerRef.current;
    return () => controller?.dispose();
  }, []);
  const controller = controllerRef.current;
  const start = useCallback(() => controller!.start(), [controller]);
  const finish = useCallback(() => controller!.finish(), [controller]);
  const cancel = useCallback(() => controller!.cancel(), [controller]);
  const reset = useCallback(() => controller!.reset(), [controller]);
  return { ...controller!.snapshot(), start, finish, cancel, reset };
}
