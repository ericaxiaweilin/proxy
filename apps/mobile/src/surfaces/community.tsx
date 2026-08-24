// Community — 兴趣圈子，非接单市场。河内摄影/中文生活/创业/咖啡/羽毛球等。
// 人围绕兴趣聚集，不围绕接单聚集；Community Hub + Flair + Activity 关联。
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type SocialCommunity, type SocialSpaceClient } from "../socialspace-client";
import { color, shadows } from "../theme";

export interface Community {
  id: string;
  name: string;
  desc: string;
  members: number;
  color: string;
  flair?: string;
  joined: boolean;
}

function toCommunity(community: SocialCommunity): Community {
  return {
    id: community.id,
    name: community.name,
    desc: community.desc,
    members: community.members,
    color: community.color,
    joined: community.joined,
    ...(community.flair ? { flair: community.flair } : {})
  };
}

export function CommunityHub({ client, onOpenCommunity }: { client: SocialSpaceClient; onOpenCommunity?: (id: string) => void }): React.JSX.Element {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void client.listCommunities().then((items) => {
      if (active) setCommunities(items.map(toCommunity));
    }).catch(() => {
      if (active) setError("社区暂时无法加载，请稍后重试");
    });
    return () => { active = false; };
  }, [client]);

  async function toggle(id: string): Promise<void> {
    const current = communities.find((item) => item.id === id);
    if (!current || busy.has(id)) return;
    const joined = !current.joined;
    setBusy((prev) => new Set(prev).add(id));
    setError(undefined);
    setCommunities((prev) => prev.map((item) => item.id === id ? { ...item, joined } : item));
    try {
      await client.setCommunityMembership(id, joined);
    } catch {
      setCommunities((prev) => prev.map((item) => item.id === id ? { ...item, joined: !joined } : item));
      setError("加入状态保存失败，请重试");
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  const selected = communities.find((community) => community.id === selectedId);
  if (selected) {
    const isJoined = selected.joined;
    return (
      <View>
        <Pressable onPress={() => setSelectedId(undefined)}><Text style={styles.back}>‹ 返回社区</Text></Pressable>
        <View style={styles.detailHero}>
          <View style={[styles.icon, { backgroundColor: selected.color }]}><Text style={styles.iconText}>{selected.name.charAt(0)}</Text></View>
          <View style={styles.copy}><Text style={styles.detailTitle}>{selected.name}</Text><Text style={styles.desc}>{selected.desc}</Text><Text style={styles.meta}>{selected.members} 成员 · {selected.flair}</Text></View>
          <Pressable disabled={busy.has(selected.id)} onPress={() => void toggle(selected.id)} style={[styles.joinBtn, isJoined && styles.joinBtnOn]}><Text style={[styles.joinText, isJoined && styles.joinTextOn]}>{isJoined ? "已加入" : "加入"}</Text></Pressable>
        </View>
        <Text style={styles.sectionTitle}>圈内正在讨论</Text>
        <View style={styles.discussion}><Text style={styles.discussionTitle}>本周大家最推荐的地点</Text><Text style={styles.discussionBody}>分享具体地点、作品或经验；回复会留在这个兴趣社区，不进入接单市场。</Text></View>
        <View style={styles.discussion}><Text style={styles.discussionTitle}>相关公开活动</Text><Text style={styles.discussionBody}>社区内容可以关联活动，但参加活动仍需单独确认，不会因加入社区自动报名。</Text></View>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>Community</Text>
        <Text style={styles.sub}>人围绕兴趣聚集，不围绕接单聚集</Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {communities.length === 0 && !error ? <Text style={styles.loading}>社区加载中…</Text> : null}
      {communities.map((c) => {
        const isJoined = c.joined;
        return (
          <Pressable key={c.id} onPress={() => { setSelectedId(c.id); onOpenCommunity?.(c.id); }} style={styles.card}>
            <View style={[styles.icon, { backgroundColor: c.color }]}>
              <Text style={styles.iconText}>{c.name.charAt(0)}</Text>
            </View>
            <View style={styles.copy}>
              <Text style={styles.name}>{c.name}</Text>
              <Text numberOfLines={1} style={styles.desc}>{c.desc}</Text>
              <Text style={styles.meta}>{c.members} 成员 · {c.flair}</Text>
            </View>
            <Pressable disabled={busy.has(c.id)} onPress={(event) => { event.stopPropagation(); void toggle(c.id); }} style={[styles.joinBtn, isJoined && styles.joinBtnOn]}>
              <Text style={[styles.joinText, isJoined && styles.joinTextOn]}>{isJoined ? "已加入" : "加入"}</Text>
            </Pressable>
          </Pressable>
        );
      })}
      <Text style={styles.hint}>小美在 河内摄影 发照片 → 摄影关注 → 讨论地点 → 看见摄影散步 Activity → 同参加 → 认识。全程无「找女孩」。</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: 8, marginTop: 4 },
  title: { color: color.ink, fontSize: 11, fontWeight: "800" },
  sub: { color: color.muted, fontSize: 11, marginTop: 2 },
  card: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginVertical: 4, padding: 10, ...shadows.card },
  icon: { alignItems: "center", borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  iconText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  copy: { flex: 1, minWidth: 0 },
  name: { color: color.ink, fontSize: 11, fontWeight: "800" },
  desc: { color: color.muted, fontSize: 11, marginTop: 2 },
  meta: { color: color.muted, fontSize: 11, marginTop: 2 },
  joinBtn: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  joinBtnOn: { backgroundColor: color.ink, borderColor: color.ink },
  joinText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  joinTextOn: { color: color.white },
  hint: { color: color.muted, fontSize: 11, lineHeight: 14, marginTop: 8, textAlign: "center" },
  back: { color: color.magenta, fontSize: 12, fontWeight: "800", marginBottom: 8, marginTop: 4 },
  detailHero: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, padding: 10, ...shadows.card },
  detailTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  sectionTitle: { color: color.ink, fontSize: 13, fontWeight: "800", marginBottom: 3, marginTop: 14 },
  discussion: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 6, padding: 11 },
  discussionTitle: { color: color.ink, fontSize: 12, fontWeight: "800" },
  discussionBody: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  error: { color: color.magenta, fontSize: 11, marginBottom: 6 },
  loading: { color: color.muted, fontSize: 11, paddingVertical: 12, textAlign: "center" }
});
