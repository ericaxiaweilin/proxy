import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";

import { color } from "../theme";
import { SOCIAL_PLATFORMS, SOCIAL_VISIBILITIES, socialPlatformLabel, type AgentSocial, type SupplyClient } from "../supply-client";

// CREATOR-SOCIAL-001：社媒绑定区（Creator 给自己挂社媒）。
//
// 平台走 chips（服务端封闭集合 tiktok/zalo/instagram/facebook，加平台要三处一起）；
// 用户名手填（服务端校验形状，URL/空格/@ 直接拒）；可见性默认 merchants（仅商家可见）。
// 提交走 supply.linkAgentSocial —— 只能绑自己的，服务端按 principal 校验，
// 别人的 agentId 传过去会被 AGENT_NOT_OWNED 拒掉。
const VISIBILITY_LABEL: Record<string, string> = {
  public: "公开可见",
  merchants: "仅商家可见",
  private: "仅自己可见",
};

// CREATOR-PROFILE-001：preview 是"商家看到的主页长这样"（只读镜像）。
// Creator 绑定完社媒，当场就能看到商家侧的样子，不用切号去验证。
export function SocialLinkSection({ agentId, socials, supply, onChanged, onError, preview }: {
  agentId: string;
  socials: AgentSocial[];
  supply: SupplyClient;
  onChanged: (socials: AgentSocial[]) => void;
  onError: (message: string) => void;
  preview?: { name: string; bio: string; photoUri?: string | undefined } | undefined;
}): React.JSX.Element {
  const [platform, setPlatform] = useState<string>(SOCIAL_PLATFORMS[0]!);
  const [handle, setHandle] = useState("");
  const [visibility, setVisibility] = useState<string>("merchants");
  const [busy, setBusy] = useState(false);

  async function link(): Promise<void> {
    const name = handle.trim().replace(/^@+/, "");
    if (!name || busy) return;
    setBusy(true);
    try {
      const next = await supply.linkAgentSocial({ agentId, platform, handle: name, visibility });
      onChanged(next);
      setHandle("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "绑定失败");
    } finally {
      setBusy(false);
    }
  }

  async function unlink(p: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await supply.unlinkAgentSocial({ agentId, platform: p });
      onChanged(socials.filter((s) => s.platform !== p));
    } catch (e) {
      onError(e instanceof Error ? e.message : "解绑失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      <Text selectable style={styles.title}>社媒账户</Text>
      {preview ? (
        <View style={styles.preview} testID="creator-home-preview">
          {preview.photoUri ? (
            <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: preview.photoUri }} style={styles.previewAvatar} transition={0} />
          ) : (
            <View style={styles.previewAvatarMissing}>
              <Text selectable style={styles.previewInitial}>{preview.name.slice(0, 1)}</Text>
            </View>
          )}
          <View style={styles.previewMain}>
            <Text selectable style={styles.previewName}>{preview.name}</Text>
            {preview.bio.trim() !== "" ? (
              <Text selectable style={styles.previewBio} numberOfLines={2}>{preview.bio}</Text>
            ) : null}
            <Text selectable style={styles.previewHint}>商家看到的主页是这样 · 社媒按可见性过滤后显示</Text>
          </View>
        </View>
      ) : null}
      {socials.length === 0 ? (
        <Text selectable style={styles.hint}>还没关联社媒 — 商家在你的主页看不到这一节（显示"尚未关联"）。</Text>
      ) : null}
      {socials.map((item) => (
        <View key={item.platform} style={styles.row}>
          <View style={styles.main}>
            <Text selectable style={styles.name}>{socialPlatformLabel(item.platform)} · {item.handle}</Text>
            <Text selectable style={styles.sub}>{VISIBILITY_LABEL[item.visibility] ?? item.visibility}</Text>
          </View>
          <Pressable accessibilityLabel={`解绑${item.platform}`} disabled={busy} onPress={() => void unlink(item.platform)} style={styles.unlink}>
            <Text selectable style={styles.unlinkText}>解绑</Text>
          </Pressable>
        </View>
      ))}
      <Text selectable style={styles.label}>平台</Text>
      <View style={styles.chips}>
        {SOCIAL_PLATFORMS.map((p) => (
          <Pressable key={p} onPress={() => setPlatform(p)} style={[styles.chip, platform === p && styles.chipOn]}>
            <Text selectable style={[styles.chipText, platform === p && styles.chipTextOn]}>{socialPlatformLabel(p)}</Text>
          </Pressable>
        ))}
      </View>
      <Text selectable style={styles.label}>用户名（不带 @）</Text>
      <TextInput
        autoCapitalize="none"
        onChangeText={setHandle}
        value={handle}
        placeholder="例如 linh_hanoi"
        placeholderTextColor={color.muted}
        style={styles.input}
      />
      <Text selectable style={styles.label}>谁可见</Text>
      <View style={styles.chips}>
        {SOCIAL_VISIBILITIES.map((v) => (
          <Pressable key={v} onPress={() => setVisibility(v)} style={[styles.chip, visibility === v && styles.chipOn]}>
            <Text selectable style={[styles.chipText, visibility === v && styles.chipTextOn]}>{VISIBILITY_LABEL[v] ?? v}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityLabel="关联社媒" disabled={busy || handle.trim() === ""} onPress={() => void link()} style={[styles.add, (busy || handle.trim() === "") && styles.addDisabled]}>
        <Text selectable style={styles.addText}>{busy ? "保存中…" : "关联"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, gap: 6, marginTop: 12, padding: 12 },
  title: { color: color.ink, fontSize: 13, fontWeight: "800" },
  // CREATOR-PROFILE-001：只读预览（圆头像，和商家侧同一规矩）。
  preview: { alignItems: "center", backgroundColor: color.surface, borderRadius: 12, flexDirection: "row", gap: 10, padding: 10 },
  previewAvatar: { borderRadius: 999, height: 48, width: 48 },
  previewAvatarMissing: { alignItems: "center", backgroundColor: "#E8E4E0", borderRadius: 999, height: 48, justifyContent: "center", width: 48 },
  previewInitial: { color: color.muted, fontSize: 16, fontWeight: "900" },
  previewMain: { flex: 1, minWidth: 0 },
  previewName: { color: color.ink, fontSize: 13, fontWeight: "800" },
  previewBio: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  previewHint: { color: color.muted, fontSize: 11, marginTop: 3 },
  hint: { color: color.muted, fontSize: 11, lineHeight: 16 },
  row: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 8, paddingVertical: 8 },
  main: { flex: 1, minWidth: 0 },
  name: { color: color.ink, fontSize: 13, fontWeight: "700" },
  sub: { color: color.muted, fontSize: 11, marginTop: 2 },
  unlink: { borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  unlinkText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  label: { color: color.muted, fontSize: 11, fontWeight: "800", marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: "#F7F4F6", borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipText: { color: "#6D666C", fontSize: 11, fontWeight: "800" },
  chipTextOn: { color: color.white },
  input: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, color: color.ink, fontSize: 13, fontWeight: "700", height: 44, paddingHorizontal: 12 },
  add: { alignItems: "center", backgroundColor: color.ink, borderRadius: 12, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
  addDisabled: { opacity: 0.5 },
  addText: { color: color.white, fontSize: 13, fontWeight: "800" },
});
