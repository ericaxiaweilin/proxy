import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { createAudioPlayer } from "expo-audio";
import type { AudioPlayer } from "expo-audio";
import type { FeedMediaItem } from "@proxy/contracts";

const FRAME_COLOR = "rgba(255,255,255,0.05)";

/**
 * §5.2.3 AudioStage — AUDIO（语音推文）专用 stage。
 *
 * 设计要点：
 * - 语音没有画面：固定高度播放卡（波形占位 + 时长 + 播放/暂停），不进图片墙。
 * - 点整卡切换播放/暂停；不自动播（连刷会互相打断，体验差）。
 * - 播放完回零；组件卸载或 uri 变化时释放 player。
 */
export function AudioStage({ item, uri }: { item: FeedMediaItem; uri: string }): React.JSX.Element {
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<AudioPlayer | null>(null);
  const playingRef = useRef(false);

  useEffect(() => {
    const player = createAudioPlayer({ uri });
    playerRef.current = player;
    playingRef.current = false;
    setPlaying(false);
    const subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) {
        playingRef.current = false;
        setPlaying(false);
      }
    });
    return () => {
      subscription.remove();
      player.remove();
      playerRef.current = null;
      playingRef.current = false;
    };
  }, [uri]);

  function toggle(): void {
    const player = playerRef.current;
    if (!player) return;
    if (playingRef.current) {
      player.pause();
      playingRef.current = false;
      setPlaying(false);
    } else {
      player.play();
      playingRef.current = true;
      setPlaying(true);
    }
  }

  const durationLabel = item.durationMs
    ? `${Math.max(1, Math.round(item.durationMs / 1000))}″`
    : "语音";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playing ? `暂停语音 ${durationLabel}` : `播放语音 ${durationLabel}`}
      onPress={toggle}
    >
      <View style={[styles.audioCard, playing && styles.audioCardPlaying]}>
        <View style={styles.playBadge}>
          <Text style={styles.playGlyph}>{playing ? "❚❚" : "▶"}</Text>
        </View>
        <View style={styles.waveWrap}>
          <View style={styles.waveRow}>
            {[10, 18, 26, 14, 30, 22, 12, 28, 20, 34, 16, 24].map((height, index) => (
              <View
                key={index}
                style={[styles.waveBar, playing && index % 3 === 0 && styles.waveBarLive, { height }]}
              />
            ))}
          </View>
          <Text style={styles.audioMeta}>语音 · {durationLabel}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  audioCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 96,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: FRAME_COLOR,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.10)"
  },
  audioCardPlaying: {
    borderColor: "#ff2d8d",
    backgroundColor: "rgba(255,45,141,0.08)"
  },
  playBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ff2d8d"
  },
  playGlyph: { color: "#fff", fontSize: 15 },
  waveWrap: { flex: 1, gap: 6 },
  waveRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 36 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.35)" },
  waveBarLive: { backgroundColor: "#ff2d8d" },
  audioMeta: { color: "rgba(255,255,255,0.7)", fontSize: 12 }
});
