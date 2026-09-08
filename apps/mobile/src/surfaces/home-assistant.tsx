// Home semantic runtime：Home 的三个快捷入口只给模型语义方向，发送后进入这里。
// 这里不是 Market 页面跳转，也不直接创建 Need / Order / Activity；业务事实仍由后续确认动作产生。
import { useEffect, useRef, useState } from "react";
import { Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ConversationClient } from "../conversation-client";
import type { HomeAttachment, HomeIntentMode } from "../components/home-chat-box";
import type { MediaClient } from "../media-client";
import { readServerTemporaryUI, ServerTemporaryForm, type ServerTemporaryUI } from "../components/server-temporary-form";
import { color, shadows } from "../theme";
import type { MarketTab } from "../market-fixtures";
import { ExperienceSurfaceBanner } from "../experience-runtime/ExperienceSurfaceBanner";
import type { SurfacePlan, UISchema } from "@proxy/contracts";
import { useKeyboardSafeInset } from "../components/use-keyboard-safe-inset";

interface AssistantMessage {
  id: string;
  body: string;
  isOwn: boolean;
  isAI?: boolean;
  attachmentUri?: string;
  time: string;
  isDivider?: boolean;
}

export function HomeAssistantSurface({
  conversationClient,
  mediaClient,
  initialText,
  initialAttachment,
  mode,
  onBack,
  onOpenMarket,
  onOpenXiaomei,
  onOpenFeed,
  experiencePlan,
  experienceSchema,
  ensureSession,
  embedded = false,
  externalComposer = false,
}: {
  conversationClient: ConversationClient;
  mediaClient: MediaClient;
  initialText: string;
  initialAttachment?: HomeAttachment;
  mode?: HomeIntentMode;
  onBack: () => void;
  onOpenMarket?: (tab: MarketTab) => void;
  onOpenXiaomei?: () => void;
  onOpenFeed?: () => void;
  experiencePlan?: SurfacePlan | null;
  experienceSchema?: UISchema | null;
  ensureSession?: () => Promise<void>;
  embedded?: boolean;
  externalComposer?: boolean;
}): React.JSX.Element {
  const [conversationId, setConversationId] = useState<string>();
  // 首轮建会话失败：之前只留一条 status，输入框永久 disabled、无重试。
  // 现在记失败态并给重试按钮，重试计数进 effect 依赖重新建连。
  const [startFailed, setStartFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [messages, setMessages] = useState<AssistantMessage[]>(() =>
    initialText || initialAttachment ? [makeMessage(initialText, true, initialAttachment?.uri)] : []
  );
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string>();
  const [temporaryUI, setTemporaryUI] = useState<ServerTemporaryUI>();
  const [suggestedActions, setSuggestedActions] = useState<Array<{ label: string; tab?: MarketTab; isFeed?: boolean }>>([]);
  const scrollRef = useRef<ScrollView>(null);
  const keyboardInset = useKeyboardSafeInset();

  useEffect(() => {
    let cancelled = false;
    const start = async (): Promise<Record<string, unknown>> => {
      if (ensureSession) {
        setStatus("正在连接 Proxy…");
        await ensureSession();
        setStatus(undefined);
      }
      let mediaRef: string | undefined;
      if (initialAttachment) {
        setStatus("正在安全上传照片…");
        const uploaded = await mediaClient.uploadImage(initialAttachment);
        // Keep both identities: the server prefers the processed 1080px
        // derivative for vision latency and can still fall back to ORIGINAL.
        mediaRef = `asset:${uploaded.mediaAssetId}:${uploaded.storageKey}`;
        setStatus(undefined);
      }
      return conversationClient.startConversation({
        originType: "HOME",
        originId: "proxy_ai_home",
        participantId: "proxy_ai",
        firstMessage: initialText,
        ...(mode ? { assistantMode: mode } : {}),
        ...(mediaRef ? { mediaRef } : {})
      });
    };
    void start().then(async (result) => {
      if (cancelled) return;
      const payload = parseOperationRef(result);
      if (typeof payload?.conversationId === "string") {
        setConversationId(payload.conversationId);
        try {
          const historyResult = await conversationClient.listMessages(payload.conversationId);
          if (!cancelled) setMessages(readAssistantHistory(historyResult));
        } catch {
          if (!cancelled) appendAIReply(payload, setMessages);
        }
      } else {
        appendAIReply(payload, setMessages);
      }
      setTemporaryUI(readServerTemporaryUI(payload?.temporaryUI));
      setStatus(statusMessage(payload?.assistantStatus));
      setStartFailed(false);
    }).catch(() => {
      if (!cancelled) {
        setStatus("无法连接 Proxy 对话，请检查连接后重试。");
        setStartFailed(true);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [conversationClient, ensureSession, initialAttachment, initialText, mediaClient, mode, retryNonce]);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [messages, status]);

  function handleLocalIntent(text: string): void {
    const t = text.toLowerCase();
    if (/(周六|周日|今晚|明天|拍照|咖啡|西湖|有空|状态|临时)/i.test(t) && /(小美|找|想|有空)/i.test(t)) {
      setSuggestedActions([{ label: "看临时状态 ›", isFeed: true }]);
      setMessages((cur) => [...cur, makeMessage("小美们的 24h 临时状态在动态里，24h 后自动归档、不进永久主页。点下面去看看，有中意的再约。", false)]);
      return;
    }
    if (/(小美|xiaomei|陪同|找.*妹|挑.*人|找小美)/i.test(text)) {
      setSuggestedActions([{ label: "看小美机会 ›", tab: "OPPORTUNITY" }]);
      setMessages((cur) => [...cur, makeMessage("小美相关机会已备好 · 不会把她做成货架，价格只属于本次需求。点下面去市场看看，或直接告诉我你想要的时间/地点。", false)]);
      return;
    }
    if (/(活动|聚会|摄影活动|咖啡|品牌活动|周末活动)/i.test(t)) {
      setSuggestedActions([{ label: "去活动市场 ›", tab: "ACTIVITY" }]);
      setMessages((cur) => [...cur, makeMessage("活动在另一条主线 · 趋势/附近/本周都在市场-活动里。", false)]);
      return;
    }
    if (/(机会|接单|报名|工作|兼职|找.*机会)/i.test(t)) {
      setSuggestedActions([{ label: "去机会市场 ›", tab: "OPPORTUNITY" }]);
      setMessages((cur) => [...cur, makeMessage("机会市场已打开 · 先看客户预算与公平区间，再决定是否报价。", false)]);
      return;
    }
  }

  useEffect(() => {
    if (!conversationId || loading) return;
    handleLocalIntent(initialText);
  }, [conversationId, loading]);

  // 对话失败说人话：英文技术错不直接上屏；发送失败撤回乐观气泡、
  // 恢复草稿，不让"发出去了"成假的。
  function chatErrorMessage(error: unknown, fallback: string): string {
    const msg = error instanceof Error ? error.message : "";
    if (/principal|session|signed|sign in|auth|401|403/i.test(msg)) return "登录已过期，请重新登录后再聊。";
    // 服务端 messageKey（xxx.yyy 形）和空消息不直接上屏。
    if (!msg || /[a-z_]+\.[a-z_]+/i.test(msg)) return fallback;
    return msg;
  }

  async function send(preparedText?: string, temporaryUIResponseId?: string): Promise<void> {
    const text = (preparedText ?? draft).trim();
    if (!text || !conversationId || sending) return;
    setDraft("");
    setStatus(undefined);
    setTemporaryUI(undefined);
    const optimistic = makeMessage(text, true);
    setMessages((current) => [...current, optimistic]);
    handleLocalIntent(text);
    setSending(true);
    try {
      const result = await conversationClient.sendMessage(conversationId, text, mode, temporaryUIResponseId);
      const payload = parseOperationRef(result);
      appendAIReply(payload, setMessages);
      setTemporaryUI(readServerTemporaryUI(payload?.temporaryUI));
      setStatus(statusMessage(payload?.assistantStatus));
    } catch (error: unknown) {
      setMessages((current) => current.filter((msg) => msg !== optimistic));
      setDraft(text);
      setStatus(chatErrorMessage(error, "消息发送失败，请检查连接后重试。"));
    } finally {
      setSending(false);
      Keyboard.dismiss();
    }
  }

  async function finishEvent(): Promise<void> {
    if (!conversationId || sending) return;
    setSending(true);
    setStatus("正在整理本次事件总结…");
    try {
      const result = await conversationClient.sendMessage(
        conversationId,
        "请把本次 Home 事件整理成一段简洁总结，包含目标、已确认条件、待确认事项和下一步。",
        mode
      );
      const payload = parseOperationRef(result);
      if (!payload?.aiMessage) {
        setStatus("总结暂未生成，请稍后重试完成。");
        return;
      }
      appendAIReply(payload, setMessages);
      onBack();
    } catch (error: unknown) {
      setStatus(chatErrorMessage(error, "事件总结生成失败，请重试。"));
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={[styles.root, embedded && styles.embeddedRoot, keyboardInset > 0 && { paddingBottom: keyboardInset }]}>
      {!embedded ? <View style={styles.header}>
        <Pressable accessibilityLabel="返回 Home" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Proxy</Text>
        </View>
        <View style={styles.aiBadge}><Text style={styles.aiBadgeText}>AI</Text></View>
      </View> : (
        <View style={styles.embeddedHeader}>
          <View>
            <Text style={styles.embeddedTitle}>Proxy</Text>
          </View>
          <View style={styles.embeddedActions}>
            <Pressable accessibilityLabel="收起 Home 对话" onPress={() => { Keyboard.dismiss(); onBack(); }} style={styles.embeddedClose}>
              <Text style={styles.embeddedCloseText}>收起</Text>
            </Pressable>
            <Pressable accessibilityLabel="总结并结束 Home 会话" disabled={sending || !conversationId} onPress={() => void finishEvent()} style={[styles.embeddedClose, (sending || !conversationId) && styles.disabled]}>
              <Text style={styles.embeddedCloseText}>{sending ? "总结中…" : "完成"}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {experiencePlan && experienceSchema ? (
        <ExperienceSurfaceBanner plan={experiencePlan} schema={experienceSchema} onAction={(id) => { if (id === "open_fastest_plan" && onOpenMarket) onOpenMarket("OPPORTUNITY"); }} />
      ) : null}

      <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messageContent} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
        {messages.map((message) => message.isDivider ? (
          <View key={message.id} style={styles.timelineDivider}><View style={styles.timelineLine} /><Text style={styles.timelineText}>{message.body}</Text><View style={styles.timelineLine} /></View>
        ) : (
          <View key={message.id} style={[styles.bubble, message.isOwn ? styles.userBubble : styles.aiBubble]}>
            {message.attachmentUri ? <Image accessibilityLabel="会话照片" source={{ uri: message.attachmentUri }} style={styles.messageImage} /> : null}
            {!message.isOwn ? <Text style={styles.sender}>Proxy AI</Text> : null}
            <Text style={[styles.body, message.isOwn && styles.userBody]}>{message.body}</Text>
            <Text style={[styles.time, message.isOwn && styles.userTime]}>{message.time}</Text>
          </View>
        ))}
        {temporaryUI ? <ServerTemporaryForm disabled={sending} onSubmit={(summary) => void send(`我的补充信息：${summary}`, temporaryUI.id)} spec={temporaryUI} /> : null}
        {suggestedActions.length > 0 ? (
          <View style={styles.suggestedRow}>
            {suggestedActions.map((a) => (
              // 优先级：显式目标（动态/市场 Tab）优先；小美回调只在没有
              // 明确目标时兜底——之前“看小美机会”被 label 分支截胡，
              // 只关窗口、进不了市场（调用方 onOpenXiaomei 仅关闭）。
              // 都没有 handler 则收起建议条，不留死按钮。
              <Pressable key={a.label} onPress={() => { if (a.isFeed && onOpenFeed) onOpenFeed(); else if (a.tab && onOpenMarket) onOpenMarket(a.tab); else if (a.label.includes("小美") && onOpenXiaomei) onOpenXiaomei(); else setSuggestedActions([]); }} style={styles.suggestedPill}>
                <Text style={styles.suggestedText}>{a.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setSuggestedActions([])} style={[styles.suggestedPill, styles.suggestedGhost]}>
              <Text style={[styles.suggestedText, styles.suggestedGhostText]}>留在对话</Text>
            </Pressable>
          </View>
        ) : null}
        {loading ? <View style={styles.systemPill}><Text style={styles.systemText}>正在理解你的意图…</Text></View> : null}
        {status ? <View style={styles.statusBox}><Text style={styles.statusText}>{status}</Text></View> : null}
        {startFailed && !conversationId && !loading ? (
          <Pressable
            onPress={() => { setStartFailed(false); setLoading(true); setRetryNonce((n) => n + 1); }}
            style={[styles.suggestedPill]}
            accessibilityLabel="重试连接"
          >
            <Text style={styles.suggestedText}>↻ 重试连接</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {!externalComposer ? <View style={styles.composer}>
        <TextInput
          editable={Boolean(conversationId) && !sending}
          multiline
          onChangeText={setDraft}
          onSubmitEditing={() => void send()}
          placeholder={conversationId ? "输入 挑选小美 / 活动 / 机会 / 状态 试试…" : "连接中…"}
          placeholderTextColor="#A9A2B0"
          style={styles.input}
          value={draft}
        />
        <Pressable disabled={!draft.trim() || !conversationId || sending} onPress={() => void send()} style={[styles.sendButton, (!draft.trim() || !conversationId || sending) && styles.disabled]}>
          <Text style={styles.sendText}>{sending ? "…" : "↑"}</Text>
        </Pressable>
      </View> : null}
    </View>
  );
}

function makeMessage(body: string, isOwn: boolean, attachmentUri?: string): AssistantMessage {
  return {
    id: `${isOwn ? "user" : "ai"}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    body,
    isOwn,
    time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    ...(attachmentUri ? { attachmentUri } : {})
  };
}

function parseOperationRef(result: Record<string, unknown>): Record<string, unknown> | undefined {
  if (typeof result.operationRef !== "string") return undefined;
  try { return JSON.parse(result.operationRef) as Record<string, unknown>; } catch { return undefined; }
}

function readAssistantHistory(result: Record<string, unknown>): AssistantMessage[] {
  const payload = parseOperationRef(result);
  const rows = Array.isArray(payload?.messages) ? payload.messages : [];
  const actorId = typeof payload?.actorId === "string" ? payload.actorId : "";
  return rows.flatMap((value): AssistantMessage[] => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const body = typeof row.body === "string" ? row.body : "";
    const messageType = typeof row.messageType === "string" ? row.messageType : "TEXT";
    const isDivider = messageType === "SYSTEM_CONTEXT" && row.senderId === "SYSTEM";
    if (!body && !isDivider) return [];
    return [{
      id: typeof row.messageId === "string" ? row.messageId : `history_${Math.random().toString(36).slice(2)}`,
      body: body || "新的 Home 对话",
      isOwn: row.senderId === actorId,
      isAI: row.senderId === "proxy_ai",
      isDivider,
      time: typeof row.createdAt === "string" ? new Date(row.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : ""
    }];
  });
}

function appendAIReply(payload: Record<string, unknown> | undefined, setMessages: React.Dispatch<React.SetStateAction<AssistantMessage[]>>): void {
  const ai = payload?.aiMessage;
  if (!ai || typeof ai !== "object") return;
  const message = ai as Record<string, unknown>;
  const body = message.body;
  if (typeof body !== "string" || !body) return;
  setMessages((current) => [...current, {
    id: typeof message.messageId === "string" ? message.messageId : `ai_${Date.now()}`,
    body,
    isOwn: false,
    isAI: true,
    time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  }]);
}

function statusMessage(value: unknown): string | undefined {
  if (value === "UNAVAILABLE") return "已收到消息，但本地模型服务尚未配置。";
  if (value === "FAILED") return "已收到消息，但当前模型服务配置或额度不可用；消息已保留，可稍后重试。";
  return undefined;
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  embeddedRoot: { borderColor: color.line, borderRadius: 22, borderWidth: 1, flex: 0, height: 520, overflow: "hidden", ...shadows.card },
  embeddedHeader: { alignItems: "center", backgroundColor: color.white, borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11 },
  timelineDivider: { alignItems: "center", flexDirection: "row", gap: 8, marginVertical: 7 },
  timelineLine: { backgroundColor: color.line, flex: 1, height: StyleSheet.hairlineWidth },
  timelineText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  embeddedTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  embeddedActions: { alignItems: "center", flexDirection: "row", gap: 7 },
  embeddedClose: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 6 },
  embeddedCloseText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  header: { alignItems: "center", backgroundColor: color.white, borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  backButton: { alignItems: "center", height: 32, justifyContent: "center", width: 30 },
  backText: { color: color.ink, fontSize: 26, lineHeight: 30 },
  headerCopy: { flex: 1 },
  headerTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  headerSub: { color: color.muted, fontSize: 11, marginTop: 2 },
  aiBadge: { alignItems: "center", backgroundColor: color.ink, borderRadius: 9, height: 28, justifyContent: "center", width: 28 },
  aiBadgeText: { color: color.white, fontSize: 11, fontWeight: "900" },
  contextCard: { backgroundColor: color.ink, borderRadius: 18, marginHorizontal: 14, marginTop: 12, padding: 13, ...shadows.card },
  contextTitle: { color: color.white, fontSize: 11, fontWeight: "800" },
  contextText: { color: "#D8CFDC", fontSize: 11, lineHeight: 15, marginTop: 4 },
  messages: { flex: 1 },
  messageContent: { gap: 9, padding: 14 },
  bubble: { borderRadius: 16, maxWidth: "84%", padding: 10 },
  userBubble: { alignSelf: "flex-end", backgroundColor: color.ink, borderBottomRightRadius: 5 },
  aiBubble: { alignSelf: "flex-start", backgroundColor: color.white, borderColor: color.line, borderWidth: 1, borderBottomLeftRadius: 5 },
  messageImage: { borderRadius: 12, height: 160, marginBottom: 8, width: 220 },
  sender: { color: color.muted, fontSize: 11, fontWeight: "800", marginBottom: 3 },
  body: { color: color.ink, fontSize: 11, lineHeight: 17 },
  userBody: { color: color.white },
  time: { color: color.muted, fontSize: 11, marginTop: 4, textAlign: "right" },
  userTime: { color: "rgba(255,255,255,0.6)" },
  systemPill: { alignSelf: "center", backgroundColor: "#EAE4EF", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  systemText: { color: color.muted, fontSize: 11 },
  statusBox: { backgroundColor: "#FFF4F8", borderColor: color.attentionBorder, borderRadius: 12, borderWidth: 1, padding: 9 },
  statusText: { color: color.error, fontSize: 11, lineHeight: 15 },
  composer: { alignItems: "flex-end", backgroundColor: color.white, borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 7, paddingHorizontal: 14, paddingVertical: 10 },
  input: { backgroundColor: "#FCFBFD", borderColor: "#DDD5E3", borderRadius: 15, borderWidth: 1, color: color.ink, flex: 1, fontSize: 11, lineHeight: 16, maxHeight: 88, minHeight: 42, paddingHorizontal: 11, paddingVertical: 8 },
  sendButton: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  disabled: { opacity: 0.4 },
  sendText: { color: color.white, fontSize: 20, fontWeight: "900" },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 14, paddingBottom: 8 },
  quickPill: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  quickText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  suggestedRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 2, paddingTop: 4 },
  suggestedPill: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  suggestedText: { color: color.white, fontSize: 11, fontWeight: "800" },
  suggestedGhost: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1 },
  suggestedGhostText: { color: color.muted }
});
