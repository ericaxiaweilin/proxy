import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AIAssistant } from "@proxy/contracts";
import { parseListAIAssistantsPayload } from "@proxy/contracts";
import type { TransportResponse, TransportRequest } from "./auth-client";
import { nativeSecureSessionStore, sessionAuthClient } from "./native-clients";
import { localApiBaseUrl } from "./native-clients";
import { EngagementClient } from "./engagement-client";
import { HorizontalSwipeRail } from "./components/horizontal-swipe-rail";
import { ConversationClient } from "./conversation-client";
import { color } from "./theme";

export class AIAssistantsProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AIAssistantsProtocolError";
  }
}

async function fetchAssistants(baseUrl: string): Promise<AIAssistant[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/ai/assistants`, {
    method: "GET",
    headers: { Accept: "application/json", "X-Proxy-App-Version": "1.0.0" }
  });
  if (!response.ok) throw new AIAssistantsProtocolError(`assistants status ${response.status}`);
  return parseListAIAssistantsPayload(await response.json()).assistants;
}

/**
 * 首页 AI 助手行（AI-ASSIST-001）：5 小美推荐卡 + 主页 sheet + 关注/发消息。
 * 数据来自服务端公开目录（非本地假名单）；关注走现有关系图
 * （engagement follow/unfollow/isFollowing），切页回来回读恢复；
 * 发消息走 StartConversation DM。AI 能力不扩大：接单/报名/收付款仍由
 * 服务端门禁禁止，这里只有看/关注/聊。
 */
export function AIAssistantsRow({ baseUrl = localApiBaseUrl }: { baseUrl?: string }): React.JSX.Element {
  const [items, setItems] = useState<AIAssistant[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [following, setFollowing] = useState<ReadonlySet<string>>(new Set());
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const engagement = useEngagementClient();
  const conversation = useConversationClient();

  useEffect(() => {
    let cancelled = false;
    void fetchAssistants(baseUrl)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [baseUrl]);

  // 切页回来回读关注态（isFollowing 逐个查，有 session 才查得到）。
  const refreshFollowing = useCallback(async () => {
    if (!items) return;
    try {
      const session = await nativeSecureSessionStore.read();
      const me = session?.principal ? session.userAccountId : undefined;
      if (!me) return;
      const next = new Set<string>();
      await Promise.all(items.map(async (item) => {
        try {
          if (await engagement.isFollowing(me, item.id)) next.add(item.id);
        } catch { /* 单个失败不挡整行 */ }
      }));
      setFollowing(next);
    } catch { /* 匿名：保持未关注态 */ }
  }, [engagement, items]);
  useEffect(() => { void refreshFollowing(); }, [refreshFollowing]);

  async function toggleFollow(item: AIAssistant): Promise<void> {
    if (acting) return;
    setActing(true);
    setNotice(undefined);
    try {
      if (following.has(item.id)) {
        await engagement.unfollowProfile(item.id);
        setFollowing((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      } else {
        await engagement.followProfile(item.id);
        setFollowing((current) => new Set(current).add(item.id));
      }
    } catch {
      setNotice("操作失败，请登录后重试");
    } finally {
      setActing(false);
    }
  }

  async function message(item: AIAssistant): Promise<void> {
    setNotice(undefined);
    try {
      await conversation.startConversation({
        originType: "PROFILE",
        originId: item.id,
        participantId: item.id,
        firstMessage: `你好${item.name}，我想聊聊${item.role}。`
      });
      setNotice("已发起会话，去消息页查看");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (/authenticated principal|real sign-in|signed out|401/i.test(msg)) {
        setNotice("发起会话失败，请登录后重试");
      } else {
        setNotice("发起会话失败，请稍后重试");
      }
    }
  }

  const selected = items?.find((entry) => entry.id === selectedId);
  // 图挂了回退色块（真图走服务端原文件；加载失败不留白板）。
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const markBroken = useCallback((id: string): void => {
    setBroken((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);
  const photoUri = (id: string): string => `${baseUrl.replace(/\/$/, "")}/v1/ai/personas/photo/${encodeURIComponent(id)}?v=png1`;

  if (failed) return <View />;
  if (!items) return <View style={styles.rowSkeleton} />;
  // 点进个人主页（整页替换行，不是底部弹卡）。
  if (selected) {
    return (
      <View>
        <Pressable onPress={() => { setSelectedId(undefined); setNotice(undefined); }} style={styles.backButton}>
          <Text selectable style={styles.backText}>‹ 小美们</Text>
        </Pressable>
        {broken.has(selected.id) ? (
          <View style={[styles.homeToken, { backgroundColor: selected.color }]}>
            <Text selectable style={styles.homeTokenText}>{selected.avatar}</Text>
          </View>
        ) : (
          <Image source={{ uri: photoUri(selected.id) }} style={styles.homePortrait} onError={() => markBroken(selected.id)} />
        )}
        <Text selectable style={styles.homeName}>{selected.name}</Text>
        <Text selectable style={styles.homeBadge}>{selected.aiBadge}</Text>
        <Text selectable style={styles.homeTagline}>{selected.tagline}</Text>
        <View style={styles.homeActions}>
          <Pressable disabled={acting} onPress={() => void toggleFollow(selected)} style={[styles.homeBtn, styles.homeBtnPrimary]}>
            <Text selectable style={styles.homeBtnPrimaryText}>{acting ? "请稍候…" : following.has(selected.id) ? "取消关注" : "关注"}</Text>
          </Pressable>
          <Pressable onPress={() => void message(selected)} style={[styles.homeBtn, styles.homeBtnGhost]}>
            <Text selectable style={styles.homeBtnGhostText}>发消息</Text>
          </Pressable>
        </View>
        {notice ? <Text selectable style={styles.notice}>{notice}</Text> : null}
      </View>
    );
  }
  return (
    <View>
      <View style={styles.rowHead}>
        <Text selectable style={styles.rowTitle}>小美们</Text>
        <Text selectable style={styles.rowGen}>AI生成</Text>
      </View>
      {/* SWIPE-RAIL-001：小美头像横滑不能触发外层切页。 */}
      <HorizontalSwipeRail contentContainerStyle={styles.row} preserveChildPresses threshold={3}>
        {items.map((item) => (
          <Pressable key={item.id} onPress={() => { setSelectedId(item.id); setNotice(undefined); }} style={styles.story}>
            {broken.has(item.id) ? (
              <View style={[styles.storyToken, { backgroundColor: item.color }]}>
                <Text selectable style={styles.storyTokenText}>{item.avatar}</Text>
              </View>
            ) : (
              <Image source={{ uri: photoUri(item.id) }} style={styles.storyPortrait} onError={() => markBroken(item.id)} />
            )}
            <Text selectable style={styles.storyName} numberOfLines={1}>{item.role}</Text>
            {following.has(item.id) ? <Text selectable style={styles.followed}>已关注</Text> : null}
          </Pressable>
        ))}
      </HorizontalSwipeRail>
    </View>
  );
}

function useEngagementClient(): EngagementClient {
  const [client] = useState(
    () => new EngagementClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore })
  );
  return client;
}

function useConversationClient(): ConversationClient {
  const [client] = useState(
    () => new ConversationClient({ baseUrl: localApiBaseUrl, authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore })
  );
  return client;
}

const styles = StyleSheet.create({
  rowSkeleton: { height: 120 },
  rowHead: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 8, marginHorizontal: 16 },
  rowTitle: { color: color.ink, fontSize: 16, fontWeight: "900" },
  rowGen: { backgroundColor: "#F4F0FF", borderRadius: 6, color: "#5B3FA3", fontSize: 10, fontWeight: "700", paddingHorizontal: 6, paddingVertical: 2 },
  row: { gap: 12, paddingHorizontal: 16 },
  // 常规圆头像（与真人 stories 同语言，无白卡）：头像 + 角色名。
  story: { alignItems: "center", gap: 4, width: 72 },
  storyPortrait: { borderRadius: 36, height: 72, width: 72 },
  storyToken: { alignItems: "center", borderRadius: 36, height: 72, justifyContent: "center", width: 72 },
  storyTokenText: { fontSize: 28 },
  storyName: { color: color.ink, fontSize: 12, fontWeight: "700", textAlign: "center" },
  followed: { color: color.muted, fontSize: 10 },
  // 个人主页（整页替换行，非底部弹卡）。
  backButton: { alignItems: "center", flexDirection: "row", paddingHorizontal: 16, paddingVertical: 8 },
  backText: { color: color.ink, fontSize: 14, fontWeight: "800" },
  homePortrait: { aspectRatio: 1, borderRadius: 18, marginHorizontal: 16, width: "100%" },
  homeToken: { alignItems: "center", borderRadius: 18, height: 240, justifyContent: "center", marginHorizontal: 16 },
  homeTokenText: { fontSize: 64 },
  homeName: { color: color.ink, fontSize: 22, fontWeight: "900", marginHorizontal: 16, marginTop: 12 },
  homeBadge: { color: "#5B3FA3", fontSize: 12, fontWeight: "700", marginHorizontal: 16, marginTop: 2 },
  homeTagline: { color: color.muted, fontSize: 14, marginHorizontal: 16, marginTop: 6 },
  homeActions: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginTop: 12 },
  homeBtn: { alignItems: "center", borderRadius: 999, flex: 1, paddingVertical: 12 },
  homeBtnPrimary: { backgroundColor: color.ink },
  homeBtnPrimaryText: { color: color.white, fontSize: 13, fontWeight: "800" },
  homeBtnGhost: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1 },
  homeBtnGhostText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  notice: { color: color.muted, fontSize: 12, marginHorizontal: 16, marginTop: 8 },
});
