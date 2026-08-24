// Status 24h — Ghost Posts 轻量化：发布后 24/48h 自动归档，不进永久主页/市场。
// 小美发「周六下午想去西湖拍照 ☕️」产生机会但不挂牌；回复走私信，Agent 可召回。
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { type SocialSpaceClient, type SocialStatus } from "../socialspace-client";
import { color, shadows } from "../theme";

export interface Status {
  id: string;
  author: string;
  body: string;
  createdAt: number;
  expiresAt: number;
  location?: string;
}

function lifespanHours(status: Status): number {
  return Math.max(1, Math.round((status.expiresAt - status.createdAt) / 3600_000));
}

function toStatus(status: SocialStatus): Status {
  return {
    id: status.id,
    author: status.author,
    body: status.body,
    createdAt: Date.parse(status.createdAt),
    expiresAt: Date.parse(status.expiresAt),
    ...(status.location ? { location: status.location } : {})
  };
}

function hoursLeft(expiresAt: number): string {
  const diff = Math.max(0, expiresAt - Date.now());
  const h = Math.floor(diff / 3600_000);
  if (h < 1) return "即将归档";
  return `${h}h 后归档`;
}

export function StatusFeed({ client, onReply }: { client: SocialSpaceClient; onReply?: (author: string) => void }): React.JSX.Element {
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [draft, setDraft] = useState("");
  const [location, setLocation] = useState("");
  const [expiry, setExpiry] = useState<24 | 48>(24);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void client.listStatuses().then((items) => {
      if (active) setStatuses(items.map(toStatus));
    }).catch(() => {
      if (active) setError("状态暂时无法加载，请稍后重试");
    }).finally(() => {
      if (active) setLoading(false);
    });
    const timer = setInterval(() => setStatuses((prev) => [...prev]), 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [client]);

  const visible = statuses.filter((s) => Date.now() < s.expiresAt);

  async function publish(): Promise<void> {
    const body = draft.trim();
    if (!body || publishing) return;
    setPublishing(true);
    setError(undefined);
    try {
      const created = await client.createStatus({ body, expiryHours: expiry, authorDisplayName: "你", ...(location.trim() ? { location: location.trim() } : {}) });
      setStatuses((prev) => [toStatus(created), ...prev.filter((item) => item.id !== created.id)]);
      setDraft("");
      setLocation("");
    } catch {
      setError("发布失败，内容已保留，可稍后重试");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <View>
      <View style={styles.composer}>
        <Text style={styles.composerTitle}>24/48 小时临时广播</Text>
        <Text style={styles.composerDescription}>发布临时想法、计划或可用时间；不进入永久主页，别人回复时转入私信。</Text>
        <TextInput value={draft} onChangeText={setDraft} placeholder="发个临时状态… 24h 后自动归档（不进永久主页）" placeholderTextColor={color.muted} style={styles.input} multiline maxLength={140} />
        <View style={styles.composerRow}>
          <TextInput value={location} onChangeText={setLocation} placeholder="地点（选填）" placeholderTextColor={color.muted} style={styles.locationInput} />
          <View style={styles.expiryRow}>
            {([24, 48] as const).map((h) => (
              <Pressable key={h} onPress={() => setExpiry(h)} style={[styles.expiryChip, expiry === h && styles.expiryChipOn]}>
                <Text style={[styles.expiryText, expiry === h && styles.expiryTextOn]}>{h}h</Text>
              </Pressable>
            ))}
          </View>
          <Pressable disabled={!draft.trim() || publishing} onPress={() => void publish()} style={[styles.postBtn, (!draft.trim() || publishing) && styles.disabled]}>
            <Text style={styles.postBtnText}>{publishing ? "发布中" : "发布"}</Text>
          </Pressable>
        </View>
        <Text style={styles.composerHint}>示例：周六下午想去西湖拍照 ☕️。系统可据此推荐相关的人、活动或机会，但不会自动创建订单。</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>正在发生 · 临时状态</Text>
        <Text style={styles.sectionSub}>{loading ? "加载中" : `${visible.length} 条 · 服务器同步`}</Text>
      </View>

      {visible.map((s) => (
        <View key={s.id} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{s.author.charAt(0)}</Text>
            </View>
            <View style={styles.cardIdentity}>
              <Text style={styles.author}>{s.author}</Text>
              <Text style={styles.meta}>
                {s.location ? `${s.location} · ` : ""}
                {hoursLeft(s.expiresAt)}
              </Text>
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{lifespanHours(s)}h</Text>
            </View>
          </View>
          <Text style={styles.body}>{s.body}</Text>
          <View style={styles.actions}>
            <Pressable onPress={() => onReply?.(s.author)} style={styles.actionBtn}>
              <Text style={styles.actionText}>回复 → 私信</Text>
            </Pressable>
            <Text style={styles.actionHint}>回复不留痕，仅私信可见</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginBottom: 10, padding: 10, ...shadows.card },
  composerTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  composerDescription: { color: color.muted, fontSize: 11, lineHeight: 16, marginBottom: 7, marginTop: 2 },
  input: { color: color.ink, fontSize: 11, lineHeight: 16, minHeight: 44, textAlignVertical: "top" },
  composerRow: { alignItems: "center", flexDirection: "row", gap: 6, marginTop: 8 },
  locationInput: { backgroundColor: color.surface, borderRadius: 999, color: color.ink, flex: 1, fontSize: 11, paddingHorizontal: 10, paddingVertical: 6 },
  expiryRow: { flexDirection: "row", gap: 4 },
  expiryChip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  expiryChipOn: { backgroundColor: color.ink, borderColor: color.ink },
  expiryText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  expiryTextOn: { color: color.white },
  postBtn: { backgroundColor: color.magenta, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  postBtnText: { color: color.white, fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.4 },
  composerHint: { color: color.muted, fontSize: 11, lineHeight: 14, marginTop: 6 },
  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginBottom: 6, marginTop: 4 },
  sectionTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  sectionSub: { color: color.muted, fontSize: 11 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginVertical: 4, padding: 10, ...shadows.card },
  cardHead: { alignItems: "center", flexDirection: "row", gap: 8 },
  avatar: { alignItems: "center", backgroundColor: "#F0EAF5", borderRadius: 999, height: 32, justifyContent: "center", width: 32 },
  avatarText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  cardIdentity: { flex: 1 },
  author: { color: color.ink, fontSize: 11, fontWeight: "800" },
  meta: { color: color.muted, fontSize: 11, marginTop: 1 },
  badge: { backgroundColor: "#FFF0F6", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { color: "#7A0033", fontSize: 11, fontWeight: "700" },
  body: { color: color.ink, fontSize: 11, lineHeight: 16, marginTop: 7 },
  actions: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 8 },
  actionBtn: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  actionText: { color: color.white, fontSize: 11, fontWeight: "700" },
  actionHint: { color: color.muted, fontSize: 11 },
  error: { color: color.magenta, fontSize: 11, marginBottom: 6 }
});
