// VoiceToolButton — v2 composer 风格的语音录入按钮 + 录音条。
//
// 复用 useVoiceRecorder 的状态机（30s 硬顶 / 录音-处理-DONE 三态），UI 照 WhatsApp /
// Telegram 这类成熟 IM 的语音条范式重画：录音时是一条居中的实时波形 + 计时条，
// 波形跟着 expo-audio 的真实 metering（麦克风电平）跳动，不是假动画；取消/停止/
// 重录/确认统一成两侧的圆形操作键，不再是纯文字按钮堆一排。

import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState
} from "expo-audio";
import { color } from "../theme";
import { useVoiceRecorder } from "../voice-recorder";
import { formatVoiceElapsed } from "../voice-recorder";
import { ProxyIcon } from "./proxy-icon";

type Props = {
  disabled?: boolean;
  onDone: (recording: { uri: string; durationMs: number }) => void;
};

const WAVE_BAR_COUNT = 24;
const WAVE_POLL_MS = 90;
// dBFS 大概范围：安静的房间在 -50 上下，正常说话峰值在 -10 附近。夹在这段区间
// 内线性映射成 0..1 的柱高比例，比直接拿 dB 画柱子更接近人眼看惯的语音波形。
const METERING_FLOOR_DB = -50;
const METERING_CEIL_DB = -8;

function levelFromMetering(db: number | undefined): number {
  if (db === undefined || Number.isNaN(db)) return 0.08;
  const clamped = Math.max(METERING_FLOOR_DB, Math.min(METERING_CEIL_DB, db));
  return 0.08 + 0.92 * ((clamped - METERING_FLOOR_DB) / (METERING_CEIL_DB - METERING_FLOOR_DB));
}

function PulsingDot(): React.JSX.Element {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  return <Animated.View style={[styles.recordingDot, { opacity, transform: [{ scale }] }]} />;
}

export function VoiceToolButton({ disabled, onDone }: Props): React.JSX.Element {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, WAVE_POLL_MS);
  const voice = useVoiceRecorder(
    useMemo(
      () => ({
        requestPermissions: () => requestRecordingPermissionsAsync(),
        startRecording: async () => {
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          await recorder.prepareToRecordAsync({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
          recorder.record();
        },
        stopRecording: async () => {
          try {
            await recorder.stop();
            return recorder.uri;
          } catch {
            return null;
          }
        }
      }),
      [recorder]
    )
  );

  // 波形：录音期间按真实电平滚动追加，退出录音清空——下一次录音从一条平线重新长出来。
  const [levels, setLevels] = useState<number[]>([]);
  useEffect(() => {
    if (voice.phase !== "RECORDING") {
      setLevels([]);
      return;
    }
    setLevels((prev) => {
      const next = [...prev, levelFromMetering(recorderState.metering)];
      return next.length > WAVE_BAR_COUNT ? next.slice(next.length - WAVE_BAR_COUNT) : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState.metering, voice.phase]);

  // 折叠态：录音按钮（与工具栏其他工具按钮样式一致）
  if (voice.phase === "IDLE") {
    return (
      <Pressable
        accessibilityLabel="录制语音"
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => void voice.start()}
        style={[styles.tool, disabled ? styles.toolDisabled : null]}
      >
        <ProxyIcon color={color.ink} name="microphone" size={24} />
      </Pressable>
    );
  }

  // 展开态用 Modal 承载：这颗按钮在两处宿主里都窝在一个 ~34px 的小图标格子里
  // （conversation.tsx 的 micSlot / ComposerV2Screen 的工具行）。RN 的绝对定位
  // 以最近的父节点为基准，left:0+right:0 会直接把整条录音条压成父格子那么窄——
  // 之前"很难看"很大一部分就是这个：不是配色问题，是布局被挤成了一条缝。
  // Modal 挂在窗口根上，宽度不再受触发它的那个小图标格子摆布。
  return (
    <Modal animationType="none" statusBarTranslucent transparent visible>
      <View pointerEvents="box-none" style={styles.modalRoot}>
        <View style={styles.sheet}>
          {voice.phase === "RECORDING" ? (
            <View style={styles.row}>
              <Pressable accessibilityLabel="取消录音" hitSlop={8} onPress={voice.cancel} style={styles.sideBtn}>
                <ProxyIcon color={color.muted} name="close" size={18} />
              </Pressable>

              <View style={styles.waveArea}>
                <View style={styles.waveHeader}>
                  <PulsingDot />
                  <Text style={styles.timer}>{formatVoiceElapsed(voice.elapsedMs)}</Text>
                </View>
                <View style={styles.wave}>
                  {Array.from({ length: WAVE_BAR_COUNT }).map((_, index) => {
                    const sampleIndex = levels.length - WAVE_BAR_COUNT + index;
                    const level = (sampleIndex >= 0 ? levels[sampleIndex] : undefined) ?? 0.08;
                    return <View key={index} style={[styles.waveBar, { height: 3 + level * 22 }]} />;
                  })}
                </View>
              </View>

              <Pressable accessibilityLabel="停止录音" hitSlop={8} onPress={() => void voice.finish()} style={styles.stopBtn}>
                <View style={styles.stopGlyph} />
              </Pressable>
            </View>
          ) : null}

          {voice.phase === "PROCESSING" ? (
            <View style={styles.row}>
              <PulsingDot />
              <Text style={styles.processingText}>处理中…</Text>
            </View>
          ) : null}

          {voice.phase === "DONE" && voice.result ? (
            <View style={styles.row}>
              <Pressable accessibilityLabel="重新录制" hitSlop={8} onPress={() => voice.reset()} style={styles.sideBtn}>
                <ProxyIcon color={color.muted} name="close" size={18} />
              </Pressable>
              <View style={styles.doneInfo}>
                <ProxyIcon color={color.violet} name="microphone" size={16} />
                <Text style={styles.doneText}>已录制 {Math.round(voice.result.durationMs / 1000)} 秒</Text>
              </View>
              <Pressable
                accessibilityLabel="保留这段录音"
                hitSlop={8}
                onPress={() => {
                  if (voice.result) onDone(voice.result);
                  voice.reset();
                }}
                style={styles.confirmBtn}
              >
                <ProxyIcon color={color.white} name="check" size={20} />
              </Pressable>
            </View>
          ) : null}

          {voice.error ? <Text style={styles.error}>{voice.error}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // 工具按钮（折叠态）
  tool: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40
  },
  toolDisabled: { opacity: 0.35 },

  // Modal 的根容器铺满整个窗口；录音条钉在底部，横向留白与两侧屏幕边缘对齐，
  // 不再受触发它的那个小图标格子的宽度摆布（见上面 return 里的注释）。
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
    paddingBottom: 64,
    paddingHorizontal: 12
  },
  sheet: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 16,
    borderWidth: 1,
    padding: 10,
    ...{
      shadowColor: "#17121F",
      shadowOffset: { height: 6, width: 0 },
      shadowOpacity: 0.16,
      shadowRadius: 16,
      elevation: 10
    }
  },
  row: { alignItems: "center", flexDirection: "row", gap: 10 },

  sideBtn: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36
  },

  waveArea: { flex: 1, gap: 4 },
  waveHeader: { alignItems: "center", flexDirection: "row", gap: 6 },
  recordingDot: { backgroundColor: color.magenta, borderRadius: 4, height: 8, width: 8 },
  timer: { color: color.ink, fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "700" },
  wave: { alignItems: "flex-end", flexDirection: "row", gap: 2, height: 26 },
  waveBar: { backgroundColor: color.violet, borderRadius: 2, width: 3 },

  stopBtn: {
    alignItems: "center",
    backgroundColor: color.magenta,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  stopGlyph: { backgroundColor: color.white, borderRadius: 2, height: 14, width: 14 },

  processingText: { color: color.muted, fontSize: 12, fontWeight: "600" },

  doneInfo: { alignItems: "center", flexDirection: "row", flex: 1, gap: 6, justifyContent: "center" },
  doneText: { color: color.ink, fontSize: 12, fontWeight: "700" },
  confirmBtn: {
    alignItems: "center",
    backgroundColor: color.violet,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40
  },

  error: { color: color.error, fontSize: 11, marginTop: 6 }
});
