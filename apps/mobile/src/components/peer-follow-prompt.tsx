import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import type { EngagementClient } from "../engagement-client";

// CONVO-AVATAR-PROFILE-001: 对话头像进主页时，非关注才弹的关注 sheet。
//
// 主页本身已经开了（这张 sheet 盖在上面），按钮只有两个：＋关注（真接口，
// 失败留屏重试，不吞错）、进入主页看看（关 sheet，主页就在后面）。
// 已关注不弹 —— 调用方（app-shell）查过 isFollowing 才决定弹不弹，这里不复查。
export function PeerFollowPromptSheet({ target, engagement, onClose, onFollowed }: {
  target: { userId: string; name: string };
  engagement: EngagementClient;
  onClose: () => void;
  onFollowed: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function follow(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await engagement.followProfile(target.userId);
      onFollowed();
    } catch {
      setError("关注失败，请检查连接后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.overlay}>
        <Pressable onPress={(event) => event.stopPropagation()} style={styles.card}>
          <View style={styles.ava}>
            <Text style={styles.avaText}>{target.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{target.name}</Text>
          <Text style={styles.sub}>你还没有关注对方。</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityLabel={`关注${target.name}`}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void follow()}
            style={[styles.followBtn, busy ? styles.followBtnBusy : undefined]}
          >
            <Text style={styles.followBtnText}>{busy ? "处理中…" : "＋ 关注"}</Text>
          </Pressable>
          <Pressable accessibilityLabel="进入主页看看" onPress={onClose} style={styles.viewBtn}>
            <Text style={styles.viewBtnText}>进入主页看看</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(20,18,31,0.42)", justifyContent: "flex-end", padding: 12 },
  card: { backgroundColor: color.white, borderRadius: 22, padding: 20, alignItems: "center" },
  ava: { width: 56, height: 56, borderRadius: 28, backgroundColor: color.ink, alignItems: "center", justifyContent: "center" },
  avaText: { color: color.white, fontSize: 20, fontWeight: "800" },
  name: { color: color.ink, fontSize: 17, fontWeight: "800", marginTop: 10 },
  sub: { color: color.muted, fontSize: 13, marginTop: 4 },
  error: { color: "#B3261E", fontSize: 12, marginTop: 8 },
  followBtn: { backgroundColor: color.ink, borderRadius: 14, paddingVertical: 12, alignItems: "center", width: "100%", marginTop: 14 },
  followBtnBusy: { opacity: 0.5 },
  followBtnText: { color: color.white, fontSize: 14, fontWeight: "800" },
  viewBtn: { borderColor: color.line, borderWidth: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center", width: "100%", marginTop: 8 },
  viewBtnText: { color: color.ink, fontSize: 14, fontWeight: "700" },
});
