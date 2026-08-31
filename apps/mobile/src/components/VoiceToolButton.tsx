// VoiceToolButton — v2 composer 风格的语音录入按钮 + popover。
//
// 复用 useVoiceRecorder 的状态机（30s 硬顶 / 录音-处理-DONE 三态），
// UI 自己写：风格与 ComposerV2Screen 工具栏一致（白底、ink 文本、rounded）。

import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder
} from "expo-audio";
import { color } from "../theme";
import { useVoiceRecorder } from "../voice-recorder";
import { formatVoiceElapsed } from "../voice-recorder";

type Props = {
  disabled?: boolean;
  onDone: (recording: { uri: string; durationMs: number }) => void;
};

export function VoiceToolButton({ disabled, onDone }: Props): React.JSX.Element {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const voice = useVoiceRecorder(
    useMemo(
      () => ({
        requestPermissions: () => requestRecordingPermissionsAsync(),
        startRecording: async () => {
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
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
        <MicGlyph color={color.ink} />
      </Pressable>
    );
  }

  // 展开态：popover 显示录音进度 / 完成态
  return (
    <View style={styles.popover}>
      {voice.phase === "RECORDING" ? (
        <>
          <View style={styles.popoverRow}>
            <View style={styles.recordingDot} />
            <Text style={styles.elapsed}>{formatVoiceElapsed(voice.elapsedMs)}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { flex: Math.min(1, voice.elapsedMs / 30000) }]} />
              <View style={[styles.progressRest, { flex: Math.max(0.0001, 1 - Math.min(1, voice.elapsedMs / 30000)) }]} />
            </View>
          </View>
          <View style={styles.actions}>
            <Pressable accessibilityLabel="取消录音" onPress={voice.cancel} style={[styles.actionBtn, styles.cancelBtn]}>
              <Text style={styles.actionText}>取消</Text>
            </Pressable>
            <Pressable accessibilityLabel="停止录音" onPress={() => void voice.finish()} style={[styles.actionBtn, styles.stopBtn]}>
              <Text style={styles.actionTextStop}>■ 停止</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {voice.phase === "PROCESSING" ? (
        <Text style={styles.elapsed}>处理中…</Text>
      ) : null}

      {voice.phase === "DONE" && voice.result ? (
        <View style={styles.actions}>
          <Text style={styles.elapsed}>已录制 {Math.round(voice.result.durationMs / 1000)}s</Text>
          <Pressable
            accessibilityLabel="重新录制"
            onPress={() => voice.reset()}
            style={styles.actionBtn}
          >
            <Text style={styles.actionText}>重录</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="保留这段录音"
            onPress={() => {
              if (voice.result) onDone(voice.result);
              voice.reset();
            }}
            style={[styles.actionBtn, styles.keepBtn]}
          >
            <Text style={styles.actionTextKeep}>✓ 保留</Text>
          </Pressable>
        </View>
      ) : null}

      {voice.error ? <Text style={styles.error}>{voice.error}</Text> : null}
    </View>
  );
}

function MicGlyph({ color: c }: { color: string }): React.JSX.Element {
  // 简化麦克风图标（横杠 + 圆 + U 形支座）
  return (
    <View style={styles.mic}>
      <View style={[styles.micBody, { backgroundColor: c }]} />
      <View style={[styles.micBase, { borderColor: c }]} />
      <View style={[styles.micStand, { backgroundColor: c }]} />
    </View>
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
  mic: { alignItems: "center", height: 20, justifyContent: "center", width: 20 },
  micBody: { borderRadius: 5, height: 11, width: 9 },
  micBase: {
    borderBottomWidth: 0,
    borderColor: "transparent",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: 1,
    height: 5,
    marginTop: -1,
    width: 11
  },
  micStand: { height: 2, marginTop: 1, width: 2 },

  // Popover（展开态：覆盖在工具栏上方一行）
  popover: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 12,
    borderWidth: 1,
    bottom: 50,
    gap: 8,
    left: 0,
    padding: 10,
    position: "absolute",
    right: 0,
    zIndex: 30,
    ...{
      shadowColor: "#17121F",
      shadowOffset: { height: 4, width: 0 },
      shadowOpacity: 0.18,
      shadowRadius: 12,
      elevation: 8
    }
  },
  popoverRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  recordingDot: {
    backgroundColor: "#FF2D55",
    borderRadius: 4,
    height: 8,
    width: 8
  },
  elapsed: { color: color.ink, fontSize: 12, fontVariant: ["tabular-nums"], minWidth: 60 },
  progressTrack: {
    backgroundColor: "#F0ECF3",
    borderRadius: 2,
    flex: 1,
    flexDirection: "row",
    height: 4,
    overflow: "hidden"
  },
  progressFill: { backgroundColor: color.violet },
  progressRest: { backgroundColor: "#F0ECF3" },
  actions: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  actionBtn: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  cancelBtn: {},
  stopBtn: { backgroundColor: "#FF2D55" },
  keepBtn: { backgroundColor: color.lime },
  actionText: { color: color.ink, fontSize: 12, fontWeight: "700" },
  actionTextStop: { color: "#fff", fontSize: 12, fontWeight: "700" },
  actionTextKeep: { color: "#04241C", fontSize: 12, fontWeight: "800" },
  error: { color: color.error, fontSize: 11 }
});