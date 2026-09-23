import { type ReactNode, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { GlassContainer, GlassView } from "expo-glass-effect";
import type { PlatformAIAccount } from "../ai-account-client";
import { aiAccountPhoto } from "../ai-persona-presentation";
import type { EngagementClient } from "../engagement-client";
import type { SecureSessionStore } from "../secure-session";
import { mapFollowError } from "./feed-error-map";
import { color, shadows } from "../theme";

// An AI profile is a real addressable account surface, but never masquerades
// as a person or claims the marketplace actions humans can take.
//
// AI-FRIEND-DEAD-PENDING-001（按钮级合规审计 2026-09-22）：
// 平台 AI 账号不会 accept 好友申请。AI 主页原来的「+ 添加」走
// RelationshipClient.SendFriendRequest，结果是一条永远 PENDING 的死记录；
// 用户看到「添加中」，对方永远不回。这不是好友关系，只是一个有反应但
// 没有意义的按钮。现在 AI 主页只保留两个诚实动作：看主页、发消息。

function LiquidGlassAction({ accessibilityLabel, children, disabled = false, onPress }: {
  accessibilityLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <GlassView glassEffectStyle="clear" isInteractive style={[styles.glassBtn, disabled && styles.glassBtnDisabled]}>
      <Pressable accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} style={styles.glassPress}>
        {children}
      </Pressable>
    </GlassView>
  );
}

export function AIAccountProfileSurface({ account, engagement, secureSessionStore, onBack, onMessage, onViewPosts }: {
  account: PlatformAIAccount;
  engagement: EngagementClient;
  secureSessionStore?: SecureSessionStore | undefined;
  onBack: () => void;
  onMessage: (account: PlatformAIAccount, initialDraft?: string) => void;
  // 查看个人主页：跳到动态看她的全部内容（feed 搜索是现成真链路）。
  onViewPosts?: ((account: PlatformAIAccount) => void) | undefined;
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
    } catch (e) {
      // 同一个 catch 曾全报"登录后…"——登录着网络抖一下也被赶去登录。
      setNotice(mapFollowError(e, following ? "unfollow" : "follow"));
    }
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
      {/* 与动态帖文头像菜单共用 clear GlassView 水滴口径：单层、半透明。 */}
      <GlassContainer spacing={8} style={styles.glassRow}>
          {/* 平台 AI 不是会接受申请的真人账号：不再给一个永远 PENDING 的好友按钮。
              「发消息」是可达、会响应、有真实结果的动作；「主页」看她公开动态。
              关注（engagement.followProfile）保留为内容订阅，不冒充双向好友。 */}
          <LiquidGlassAction accessibilityLabel={following ? "取消关注" : "关注 AI 动态"} disabled={busy} onPress={() => void toggleFollow()}>
            <Text style={[styles.glassText, following && styles.followedText]}>{busy ? "处理中…" : following ? "✓ 已关注" : "+ 关注"}</Text>
          </LiquidGlassAction>
          <LiquidGlassAction accessibilityLabel="查看个人主页" disabled={!onViewPosts} onPress={() => onViewPosts?.(account)}><Text style={styles.glassText}>主页</Text></LiquidGlassAction>
          <LiquidGlassAction accessibilityLabel="发消息" onPress={() => onMessage(account)}><Text style={styles.glassText}>发消息</Text></LiquidGlassAction>
      </GlassContainer>
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
  glassRow: { flexDirection: "row", gap: 8, marginHorizontal: 18, marginTop: 16 },
  glassBtn: { borderRadius: 14, flex: 1, height: 44, overflow: "hidden" },
  glassBtnDisabled: { opacity: 0.55 },
  glassPress: { alignItems: "center", height: "100%", justifyContent: "center", paddingHorizontal: 12, width: "100%" },
  glassText: { color: color.ink, fontSize: 13, fontWeight: "900" },
  followedText: { color: color.violet }, notice: { color: color.error, fontSize: 12, marginHorizontal: 18, marginTop: 8 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, marginHorizontal: 18, marginTop: 14, padding: 15, ...shadows.card }, cardTitle: { color: color.ink, fontSize: 15, fontWeight: "900" }, body: { color: color.ink, fontSize: 13, lineHeight: 20, marginTop: 8 }, personality: { color: color.violet, fontSize: 12, lineHeight: 18, marginTop: 9 },
  prompt: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", marginTop: 10, paddingTop: 10 }, promptText: { color: color.ink, flex: 1, fontSize: 13, fontWeight: "700" }, promptArrow: { color: color.violet, fontSize: 23 },
  ugcPost: { borderTopColor: color.line, borderTopWidth: 1, marginTop: 10, paddingTop: 10 }, ugcText: { color: color.ink, fontSize: 13, lineHeight: 20 }, ugcMeta: { color: color.muted, fontSize: 11, marginTop: 6 },
  boundary: { backgroundColor: "#F1EBFF", borderRadius: 16, marginHorizontal: 18, marginTop: 14, padding: 15 }, boundaryTitle: { color: color.violet, fontSize: 13, fontWeight: "900" }, boundaryText: { color: color.ink, fontSize: 12, lineHeight: 18, marginTop: 5 }
});
