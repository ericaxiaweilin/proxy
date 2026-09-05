import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AIAssistant } from "@proxy/contracts";
import { parseListAIAssistantsPayload } from "@proxy/contracts";
import type { TransportResponse, TransportRequest } from "./auth-client";
import { nativeSecureSessionStore, sessionAuthClient } from "./native-clients";
import { localApiBaseUrl } from "./native-clients";
import { EngagementClient } from "./engagement-client";
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
        originType: "AI_ASSISTANT",
        originId: item.id,
        participantId: item.id,
        firstMessage: `你好${item.name}，我想聊聊${item.role}。`
      });
      setNotice("已发起会话，去消息页查看");
    } catch {
      setNotice("发起会话失败，请登录后重试");
    }
  }

  const selected = items?.find((entry) => entry.id === selectedId);
  // 图挂了的卡回退色块（真图走服务端原文件；加载失败不留白板）。
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const markBroken = useCallback((id: string): void => {
    setBroken((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);
  const photoUri = (id: string): string => `${baseUrl.replace(/\/$/, "")}/v1/ai/personas/photo/${encodeURIComponent(id)}?v=png1`;

  if (failed) return <View />;
  if (!items) return <View style={styles.rowSkeleton} />;
  return (
    <View>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>小美们</Text>
        <Text style={styles.rowGen}>AI生成</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => (
          <Pressable key={item.id} onPress={() => { setSelectedId(item.id); setNotice(undefined); }} style={styles.card}>
            {broken.has(item.id) ? (
              <View style={[styles.token, { backgroundColor: item.color }]}>
                <Text style={styles.tokenText}>{item.avatar}</Text>
              </View>
            ) : (
              <Image source={{ uri: photoUri(item.id) }} style={styles.portrait} onError={() => markBroken(item.id)} />
            )}
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.badge}>{item.aiBadge}</Text>
            {following.has(item.id) ? <Text style={styles.followed}>已关注</Text> : null}
          </Pressable>
        ))}
      </ScrollView>
      {selected ? (
        <View style={styles.sheet}>
          {broken.has(selected.id) ? (
            <View style={[styles.sheetToken, { backgroundColor: selected.color }]}>
              <Text style={styles.sheetTokenText}>{selected.avatar}</Text>
            </View>
          ) : (
            <Image source={{ uri: photoUri(selected.id) }} style={styles.sheetPortrait} onError={() => markBroken(selected.id)} />
          )}
          <Text style={styles.sheetName}>{selected.name}</Text>
          <Text style={styles.sheetBadge}>{selected.aiBadge} · 不是真人</Text>
          <Text style={styles.sheetTagline}>{selected.tagline}</Text>
          <View style={styles.sheetActions}>
            <Pressable disabled={acting} onPress={() => void toggleFollow(selected)} style={[styles.sheetBtn, styles.sheetBtnPrimary]}>
              <Text style={styles.sheetBtnPrimaryText}>{acting ? "请稍候…" : following.has(selected.id) ? "取消关注" : "关注"}</Text>
            </Pressable>
            <Pressable onPress={() => void message(selected)} style={[styles.sheetBtn, styles.sheetBtnGhost]}>
              <Text style={styles.sheetBtnGhostText}>发消息</Text>
            </Pressable>
          </View>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <Pressable onPress={() => setSelectedId(undefined)}><Text style={styles.close}>收起</Text></Pressable>
        </View>
      ) : null}
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
  rowTitle: { color: color.ink, fontSize: 16, fontWeight: "900" },
  rowHead: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 8, marginHorizontal: 16 },
  rowGen: { backgroundColor: "#F4F0FF", borderRadius: 6, color: "#5B3FA3", fontSize: 10, fontWeight: "700", paddingHorizontal: 6, paddingVertical: 2 },
  portrait: { borderRadius: 38, height: 76, width: 76 },
  sheetPortrait: { borderRadius: 14, height: 190, width: "100%" },
  row: { gap: 10, paddingHorizontal: 16 },
  card: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, gap: 4, padding: 12, width: 132 },
  token: { alignItems: "center", borderRadius: 28, height: 56, justifyContent: "center", width: 56 },
  tokenText: { fontSize: 28 },
  name: { color: color.ink, fontSize: 12, fontWeight: "800", textAlign: "center" },
  badge: { backgroundColor: "#F4F0FF", borderRadius: 6, color: "#5B3FA3", fontSize: 10, fontWeight: "700", paddingHorizontal: 6, paddingVertical: 2 },
  followed: { color: color.muted, fontSize: 10 },
  sheet: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, gap: 6, margin: 16, marginTop: 10, padding: 16 },
  sheetToken: { alignItems: "center", borderRadius: 32, height: 64, justifyContent: "center", width: 64 },
  sheetTokenText: { fontSize: 32 },
  sheetName: { color: color.ink, fontSize: 17, fontWeight: "900" },
  sheetBadge: { color: "#5B3FA3", fontSize: 11, fontWeight: "700" },
  sheetTagline: { color: color.muted, fontSize: 13 },
  sheetActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  sheetBtn: { alignItems: "center", borderRadius: 999, flex: 1, paddingVertical: 11 },
  sheetBtnPrimary: { backgroundColor: color.ink },
  sheetBtnPrimaryText: { color: color.white, fontSize: 13, fontWeight: "800" },
  sheetBtnGhost: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1 },
  sheetBtnGhostText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  notice: { color: color.muted, fontSize: 12 },
  close: { color: color.muted, fontSize: 12, marginTop: 2, textAlign: "center" }
});
