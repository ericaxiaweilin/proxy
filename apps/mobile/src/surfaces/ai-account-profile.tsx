import { type ReactNode, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { GlassContainer, GlassView } from "expo-glass-effect";
import type { PlatformAIAccount } from "../ai-account-client";
import { aiAccountPhoto } from "../ai-persona-presentation";
import type { EngagementClient } from "../engagement-client";
import type { RelationshipClient } from "../relationship-client";
import type { SecureSessionStore } from "../secure-session";
import { mapFollowError } from "./feed-error-map";
import { color, shadows } from "../theme";

// An AI profile is a real addressable account surface, but never masquerades
// as a person or claims the marketplace actions humans can take.
//
// 添加状态机（与首页 + 号同源）：好友关系是真相来源——NONE 可添加，
// OUTGOING（已申请、等对方同意）显示“添加中”，FRIEND 显示已添加。
// 只看 engagement 二进制会把“已申请”误判成“没添加”，这正是之前
// 首页点了 +、主页还显示旧文案的原因。
export type AiFriendState = "NONE" | "OUTGOING" | "FRIEND";

function LiquidGlassAction({ accessibilityLabel, children, disabled = false, onPress }: {
  accessibilityLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <View style={[styles.glassBtn, disabled && styles.glassBtnDisabled]}>
      <GlassView
        glassEffectStyle={{ style: "regular", animate: true, animationDuration: 0.12 }}
        isInteractive={false}
        style={styles.glassSurface}
      >
        <View pointerEvents="none" style={styles.glassSheen} />
      </GlassView>
      <Pressable accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} style={styles.glassPress}>
        {children}
      </Pressable>
    </View>
  );
}

export function AIAccountProfileSurface({ account, engagement, relationship, initialFriendState, secureSessionStore, onBack, onMessage, onViewPosts }: {
  account: PlatformAIAccount;
  engagement: EngagementClient;
  relationship?: RelationshipClient | undefined;
  initialFriendState?: AiFriendState | undefined;
  secureSessionStore?: SecureSessionStore | undefined;
  onBack: () => void;
  onMessage: (account: PlatformAIAccount, initialDraft?: string) => void;
  // 查看个人主页：跳到动态看她的全部内容（feed 搜索是现成真链路）。
  onViewPosts?: ((account: PlatformAIAccount) => void) | undefined;
}): React.JSX.Element {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const useFriendFlow = Boolean(relationship);
  const [friendState, setFriendState] = useState<AiFriendState>(initialFriendState ?? "NONE");
  const [friendBusy, setFriendBusy] = useState(false);

  useEffect(() => {
    if (useFriendFlow) return;
    let cancelled = false;
    void secureSessionStore?.read().then(async (session) => {
      if (!session?.userAccountId) return;
      const state = await engagement.isFollowing(session.userAccountId, account.accountId);
      if (!cancelled) setFollowing(state);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [account.accountId, engagement, secureSessionStore, useFriendFlow]);

  // 好友关系真相：进主页即读一次，首页 + 过的账号直接显示“添加中”，
  // 不再顶着旧文案等人点。
  useEffect(() => {
    if (!relationship) return;
    let cancelled = false;
    void relationship.listMyFriendships().then((payload) => {
      if (cancelled) return;
      if (payload.active.some((item) => item.userId === account.accountId)) setFriendState("FRIEND");
      else if (payload.pending.some((item) => item.userId === account.accountId && item.direction !== "INCOMING")) setFriendState("OUTGOING");
      else if (!initialFriendState) setFriendState("NONE");
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [account.accountId, relationship, initialFriendState]);

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

  // 添加走好友申请（与首页 + 号同一条链）：发出后即 OUTGOING，
  // 对方同意前按钮锁定为“添加中”，不再挂添加前的文案。
  async function sendFriendAdd(): Promise<void> {
    if (!relationship || friendBusy || friendState !== "NONE") return;
    setFriendBusy(true); setNotice(undefined);
    try {
      await relationship.sendFriendRequest(account.accountId);
      setFriendState("OUTGOING");
    } catch (e) {
      const reason = e instanceof Error ? e.message : "";
      setNotice(/principal|session|signed|sign in|auth|401|403/i.test(reason)
        ? "请先登录后再添加。"
        : mapFollowError(e, "follow"));
    } finally {
      setFriendBusy(false);
    }
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
      {/* 三连液态水滴：逐像素复刻底栏 lens（对象式 regular + 高光带 +
          描边 + 底色），dock 本体不动 */}
      <GlassContainer spacing={12} style={styles.glassRow}>
        <LiquidGlassAction accessibilityLabel={friendState === "OUTGOING" ? "添加中" : friendState === "FRIEND" ? "已添加" : "添加到我的小美"} disabled={useFriendFlow && (friendState !== "NONE" || friendBusy)} onPress={() => { if (useFriendFlow) void sendFriendAdd(); else void toggleFollow(); }}>
          {useFriendFlow ? (
            <Text style={[styles.glassText, friendState === "FRIEND" && styles.followedText, friendState === "OUTGOING" && styles.pendingText]}>{friendBusy ? "处理中…" : friendState === "OUTGOING" ? "添加中" : friendState === "FRIEND" ? "✓ 已添加" : "+ 添加"}</Text>
          ) : (
            <Text style={[styles.glassText, following && styles.followedText]}>{busy ? "处理中…" : following ? "✓ 已添加" : "+ 添加"}</Text>
          )}
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
  glassRow: { flexDirection: "row", gap: 12, marginHorizontal: 18, marginTop: 16 },
  glassBtn: { backgroundColor: "rgba(255,255,255,0.035)", borderColor: "rgba(255,255,255,0.34)", borderCurve: "continuous", borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, flex: 1, height: 54, overflow: "hidden", position: "relative" },
  glassBtnDisabled: { opacity: 0.55 },
  glassSurface: { borderCurve: "continuous", borderRadius: 28, bottom: 0, left: 0, overflow: "hidden", position: "absolute", right: 0, top: 0 },
  glassPress: { alignItems: "center", height: "100%", justifyContent: "center", paddingHorizontal: 6, width: "100%", zIndex: 2 },
  glassSheen: { backgroundColor: "rgba(255,255,255,0.7)", borderRadius: 999, height: 8, left: 8, opacity: 0.16, position: "absolute", right: 8, top: 4 },
  glassText: { color: color.ink, fontSize: 13, fontWeight: "900" },
  followedText: { color: color.violet }, pendingText: { color: color.muted }, notice: { color: color.error, fontSize: 12, marginHorizontal: 18, marginTop: 8 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, marginHorizontal: 18, marginTop: 14, padding: 15, ...shadows.card }, cardTitle: { color: color.ink, fontSize: 15, fontWeight: "900" }, body: { color: color.ink, fontSize: 13, lineHeight: 20, marginTop: 8 }, personality: { color: color.violet, fontSize: 12, lineHeight: 18, marginTop: 9 },
  prompt: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", marginTop: 10, paddingTop: 10 }, promptText: { color: color.ink, flex: 1, fontSize: 13, fontWeight: "700" }, promptArrow: { color: color.violet, fontSize: 23 },
  ugcPost: { borderTopColor: color.line, borderTopWidth: 1, marginTop: 10, paddingTop: 10 }, ugcText: { color: color.ink, fontSize: 13, lineHeight: 20 }, ugcMeta: { color: color.muted, fontSize: 11, marginTop: 6 },
  boundary: { backgroundColor: "#F1EBFF", borderRadius: 16, marginHorizontal: 18, marginTop: 14, padding: 15 }, boundaryTitle: { color: color.violet, fontSize: 13, fontWeight: "900" }, boundaryText: { color: color.ink, fontSize: 12, lineHeight: 18, marginTop: 5 }
});
