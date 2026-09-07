import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import type { PlatformAIAccount } from "../ai-account-client";
import { aiAccountPhoto } from "../ai-persona-presentation";
import type { EngagementClient } from "../engagement-client";
import type { SecureSessionStore } from "../secure-session";
import { color, shadows } from "../theme";

// An AI profile is a real addressable account surface, but never masquerades
// as a person or claims the marketplace actions humans can take.
export function AIAccountProfileSurface({ account, engagement, secureSessionStore, onBack, onMessage }: {
  account: PlatformAIAccount;
  engagement: EngagementClient;
  secureSessionStore?: SecureSessionStore;
  onBack: () => void;
  onMessage: (account: PlatformAIAccount, initialDraft?: string) => void;
}): React.JSX.Element {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void secureSessionStore?.read().then(async (session) => {
      if (!session?.userAccountId) return;
      const state = await engagement.isFollowing(session.userAccountId, account.accountId);
      if (!cancelled) setFollowing(state);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [account.accountId, engagement, secureSessionStore]);

  async function toggleFollow(): Promise<void> {
    if (busy) return;
    setBusy(true); setNotice(undefined);
    try {
      if (following) await engagement.unfollowProfile(account.accountId);
      else await engagement.followProfile(account.accountId);
      setFollowing((value) => !value);
    } catch { setNotice("登录后可以把小美添加到你的关注"); }
    finally { setBusy(false); }
  }

  return <View style={styles.root}>
    <View style={styles.header}><Pressable onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ 返回</Text></Pressable><Text style={styles.headerTitle}>AI 主页</Text><View style={styles.spacer} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.avatarRing}>
          <Image accessibilityLabel={`${account.displayName}的 AI 虚拟头像`} cachePolicy="memory-disk" contentFit="cover" recyclingKey={`ai-avatar:${account.accountId}:${account.avatarVersion ?? 1}`} source={aiAccountPhoto(account)} style={styles.photo} transition={0} />
        </View>
        <View style={styles.heroCopy}>
          <View style={styles.nameRow}><Text style={styles.name}>{account.displayName}</Text><View style={styles.aiPill}><Text style={styles.aiPillText}>AI 生成</Text></View></View>
          <Text style={styles.handle}>@{account.handle}</Text>
          <Text style={styles.role}>{account.role}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={() => void toggleFollow()} style={[styles.follow, following && styles.followed]}><Text style={[styles.followText, following && styles.followedText]}>{busy ? "处理中…" : following ? "✓ 已添加" : "+ 添加到我的小美"}</Text></Pressable>
        <Pressable onPress={() => onMessage(account)} style={styles.message}><Text style={styles.messageText}>发消息</Text></Pressable>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View style={styles.card}><Text style={styles.cardTitle}>关于她</Text><Text style={styles.body}>{account.description}</Text><Text style={styles.personality}>{account.personality}</Text></View>
      <View style={styles.card}><Text style={styles.cardTitle}>她的动态</Text>{account.ugcSamples.map((post) => <View key={post} style={styles.ugcPost}><Text style={styles.ugcText}>{post}</Text><Text style={styles.ugcMeta}>AI 生成内容 · 刚刚</Text></View>)}</View>
      <View style={styles.card}><Text style={styles.cardTitle}>可以直接这样问</Text>{account.suggestedPrompts.map((prompt) => <Pressable key={prompt} onPress={() => onMessage(account, prompt)} style={styles.prompt}><Text style={styles.promptText}>{prompt}</Text><Text style={styles.promptArrow}>›</Text></Pressable>)}</View>
      <View style={styles.boundary}><Text style={styles.boundaryTitle}>她是 AI 虚拟女孩</Text><Text style={styles.boundaryText}>可以聊天、陪伴和创作 UGC，但没有现实身体与线下经历，也不负责平台助手、接单、活动报名、发布业务或交易确认。</Text></View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  header: { alignItems: "center", backgroundColor: color.white, borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", height: 52, paddingHorizontal: 16 },
  back: { flex: 1 }, backText: { color: color.violet, fontSize: 14, fontWeight: "800" }, headerTitle: { color: color.ink, fontSize: 16, fontWeight: "900" }, spacer: { flex: 1 },
  content: { paddingBottom: 36 },
  hero: { alignItems: "center", backgroundColor: color.white, borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 16, paddingHorizontal: 18, paddingVertical: 22 },
  avatarRing: { borderColor: "#DCCBFF", borderRadius: 999, borderWidth: 3, height: 104, padding: 3, width: 104 },
  photo: { borderRadius: 999, height: "100%", width: "100%" },
  heroCopy: { flex: 1 }, nameRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 7 },
  aiPill: { backgroundColor: color.proxyPurpleSoft, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 5 }, aiPillText: { color: color.violet, fontSize: 11, fontWeight: "900" },
  name: { color: color.ink, fontSize: 25, fontWeight: "900" }, handle: { color: color.violet, fontSize: 12, fontWeight: "700", marginTop: 5 }, role: { color: color.muted, fontSize: 13, marginTop: 7 },
  actions: { flexDirection: "row", gap: 8, marginHorizontal: 18, marginTop: 16 }, follow: { alignItems: "center", backgroundColor: color.ink, borderRadius: 13, flex: 1, paddingVertical: 12 }, followed: { backgroundColor: color.proxyPurpleSoft }, followText: { color: color.white, fontSize: 13, fontWeight: "900" }, followedText: { color: color.violet }, message: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 13, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 12 }, messageText: { color: color.ink, fontSize: 13, fontWeight: "900" }, notice: { color: color.error, fontSize: 12, marginHorizontal: 18, marginTop: 8 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, marginHorizontal: 18, marginTop: 14, padding: 15, ...shadows.card }, cardTitle: { color: color.ink, fontSize: 15, fontWeight: "900" }, body: { color: color.ink, fontSize: 13, lineHeight: 20, marginTop: 8 }, personality: { color: color.violet, fontSize: 12, lineHeight: 18, marginTop: 9 },
  prompt: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", marginTop: 10, paddingTop: 10 }, promptText: { color: color.ink, flex: 1, fontSize: 13, fontWeight: "700" }, promptArrow: { color: color.violet, fontSize: 23 },
  ugcPost: { borderTopColor: color.line, borderTopWidth: 1, marginTop: 10, paddingTop: 10 }, ugcText: { color: color.ink, fontSize: 13, lineHeight: 20 }, ugcMeta: { color: color.muted, fontSize: 11, marginTop: 6 },
  boundary: { backgroundColor: "#F1EBFF", borderRadius: 16, marginHorizontal: 18, marginTop: 14, padding: 15 }, boundaryTitle: { color: color.violet, fontSize: 13, fontWeight: "900" }, boundaryText: { color: color.ink, fontSize: 12, lineHeight: 18, marginTop: 5 }
});
