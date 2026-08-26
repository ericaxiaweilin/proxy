import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState
} from "expo-audio";
import { MAX_AUDIO_DURATION_MS } from "@proxy/contracts";
import { formatVoiceElapsed, useVoiceRecorder, type VoiceRecorderDeps } from "../voice-recorder";

/**
 * 发帖侧语音录制面板。
 *
 * - 30s 硬顶：状态机到点自动收音；进度条同步走。
 * - 录完进入 DONE：可试听（重录/保留），保留后由父组件把 uri 变成草稿媒体项。
 * - expo-audio 的 recorder 实例与状态订阅都收在本组件内，父组件零音频 API 暴露。
 */
export function VoiceRecordPanel(props: {
  disabled?: boolean;
  onDone: (recording: { uri: string; durationMs: number }) => void;
}): React.JSX.Element {
  const [panelOpen, setPanelOpen] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const recordingRef = useRef(false);
  void recorderState;

  const deps = useMemo<VoiceRecorderDeps>(() => ({
    requestPermissions: async () => await requestRecordingPermissionsAsync(),
    startRecording: async () => {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      recorder.record();
      recordingRef.current = true;
    },
    stopRecording: async () => {
      if (!recordingRef.current) return null;
      recordingRef.current = false;
      try {
        await recorder.stop();
        return recorder.uri;
      } catch {
        return null;
      }
    }
  }), [recorder]);


  const voice = useVoiceRecorder(deps);
  const progress = Math.min(1, voice.elapsedMs / MAX_AUDIO_DURATION_MS);

  const handleKeep = useCallback(() => {
    if (!voice.result) return;
    props.onDone({ uri: voice.result.uri, durationMs: voice.result.durationMs });
    setPanelOpen(false);
    voice.reset();
  }, [props, voice]);

  if (!panelOpen) {
    return (
      <Pressable
        accessibilityLabel="录制语音"
        disabled={props.disabled}
        onPress={() => setPanelOpen(true)}
        style={[styles.tool, props.disabled && styles.disabled]}
      >
        <Text style={styles.toolText}>语音</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { flex: progress }]} />
        <View style={[styles.progressRest, { flex: Math.max(0.0001, 1 - progress) }]} />
      </View>
      <Text style={styles.elapsed}>{formatVoiceElapsed(voice.elapsedMs)}</Text>
      {voice.error ? <Text style={styles.error}>{voice.error}</Text> : null}
      <View style={styles.actions}>
        {voice.phase === "RECORDING" ? (
          <>
            <Pressable accessibilityLabel="取消录音" onPress={voice.cancel} style={[styles.actionBtn, styles.cancelBtn]}>
              <Text style={styles.actionText}>取消</Text>
            </Pressable>
            <Pressable accessibilityLabel="停止录音" onPress={() => void voice.finish()} style={[styles.actionBtn, styles.stopBtn]}>
              <Text style={styles.actionTextStop}>■ 停止</Text>
            </Pressable>
          </>
        ) : voice.phase === "DONE" && voice.result ? (
          <>
            <Pressable
              accessibilityLabel="重录语音"
              onPress={() => { voice.reset(); }}
              style={styles.actionBtn}
            >
              <Text style={styles.actionText}>重录</Text>
            </Pressable>
            <Pressable accessibilityLabel="保留这段录音" onPress={handleKeep} style={[styles.actionBtn, styles.keepBtn]}>
              <Text style={styles.actionTextKeep}>✓ 保留</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable accessibilityLabel="关闭语音面板" onPress={() => { voice.cancel(); setPanelOpen(false); }} style={styles.actionBtn}>
              <Text style={styles.actionText}>关闭</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="开始录音"
              onPress={() => void voice.start()}
              style={[styles.actionBtn, styles.recordBtn]}
            >
              <Text style={styles.actionTextRecord}>● 录音</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tool: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)"
  },
  toolText: { color: "#fff", fontSize: 12 },
  disabled: { opacity: 0.4 },
  panel: { gap: 8 },
  progressTrack: { flexDirection: "row", height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { backgroundColor: "#ff2d8d" },
  progressRest: { backgroundColor: "rgba(255,255,255,0.12)" },
  elapsed: { color: "#fff", fontSize: 12, fontVariant: ["tabular-nums"] },
  error: { color: "#ffb4c8", fontSize: 11 },
  actions: { flexDirection: "row", gap: 8, alignItems: "center" },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)"
  },
  cancelBtn: {},
  recordBtn: { backgroundColor: "#ff2d8d" },
  stopBtn: { backgroundColor: "#ff2d8d" },
  keepBtn: { backgroundColor: "#2dd4a7" },
  actionText: { color: "#fff", fontSize: 13 },
  actionTextRecord: { color: "#fff", fontSize: 13, fontWeight: "600" },
  actionTextStop: { color: "#fff", fontSize: 13, fontWeight: "600" },
  actionTextKeep: { color: "#04241c", fontSize: 13, fontWeight: "600" }
});
