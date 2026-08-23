// Home semantic runtime：Home 的三个快捷入口只给模型语义方向，发送后进入这里。
// 这里不是 Market 页面跳转，也不直接创建 Need / Order / Activity；业务事实仍由后续确认动作产生。
import { useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ConversationClient } from "../conversation-client";
import type { HomeAttachment, HomeIntentMode } from "../components/home-chat-box";
import type { MediaClient } from "../media-client";
import { readServerTemporaryUI, ServerTemporaryForm, type ServerTemporaryUI } from "../components/server-temporary-form";
import { color, shadows } from "../theme";

const MODE_LABEL: Record<HomeIntentMode, string> = {
  SERVICE: "体验",
  ORDER: "机会",
  ACTIVITY: "活动"
};

interface AssistantMessage {
  id: string;
  body: string;
  isOwn: boolean;
  isAI?: boolean;
  attachmentUri?: string;
  time: string;
}

export function HomeAssistantSurface({
  conversationClient,
  mediaClient,
  initialText,
  initialAttachment,
  mode,
  onBack
}: {
  conversationClient: ConversationClient;
  mediaClient: MediaClient;
  initialText: string;
  initialAttachment?: HomeAttachment;
  mode?: HomeIntentMode;
  onBack: () => void;
}): React.JSX.Element {
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<AssistantMessage[]>([
    makeMessage(initialText, true, initialAttachment?.uri)
  ]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string>();
  const [temporaryUI, setTemporaryUI] = useState<ServerTemporaryUI>();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let cancelled = false;
    const start = async (): Promise<Record<string, unknown>> => {
      let mediaRef: string | undefined;
      if (initialAttachment) {
        setStatus("正在安全上传照片…");
        const uploaded = await mediaClient.uploadImage(initialAttachment);
        // 视觉任务需要 storageKey 直读文件，assetId 仅用于播放；此处传 storageKey 供模型底座读取
        mediaRef = (uploaded as unknown as { storageKey?: string }).storageKey || uploaded.mediaAssetId;
        setStatus(undefined);
      }
      return conversationClient.startConversation({
        originType: "HOME",
        originId: `home_intent_${Date.now().toString(36)}`,
        participantId: "proxy_ai",
        firstMessage: initialText,
        ...(mode ? { assistantMode: mode } : {}),
        ...(mediaRef ? { mediaRef } : {})
      });
    };
    void start().then((result) => {
      if (cancelled) return;
      const payload = parseOperationRef(result);
      if (typeof payload?.conversationId === "string") setConversationId(payload.conversationId);
      appendAIReply(payload, setMessages);
      setTemporaryUI(readServerTemporaryUI(payload?.temporaryUI));
      setStatus(statusMessage(payload?.assistantStatus));
    }).catch((error: unknown) => {
      if (!cancelled) setStatus(error instanceof Error ? error.message : "无法连接 Proxy 对话");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [conversationClient, initialAttachment, initialText, mediaClient, mode]);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [messages, status]);

  async function send(preparedText?: string, temporaryUIResponseId?: string): Promise<void> {
    const text = (preparedText ?? draft).trim();
    if (!text || !conversationId || sending) return;
    setDraft("");
    setStatus(undefined);
    setTemporaryUI(undefined);
    setMessages((current) => [...current, makeMessage(text, true)]);
    setSending(true);
    try {
      const result = await conversationClient.sendMessage(conversationId, text, mode, temporaryUIResponseId);
      const payload = parseOperationRef(result);
      appendAIReply(payload, setMessages);
      setTemporaryUI(readServerTemporaryUI(payload?.temporaryUI));
      setStatus(statusMessage(payload?.assistantStatus));
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "消息发送失败");
    } finally {
      setSending(false);
    }
  }

  const routeLabel = mode ? `语义路由 · ${MODE_LABEL[mode]}` : "语义路由 · 自动理解";
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="返回 Home" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>和 Proxy 对话</Text>
          <Text style={styles.headerSub}>{routeLabel} · 不直接跳页面</Text>
        </View>
        <View style={styles.aiBadge}><Text style={styles.aiBadgeText}>AI</Text></View>
      </View>

      <View style={styles.contextCard}>
        <Text style={styles.contextTitle}>Home 语义运行时</Text>
        <Text style={styles.contextText}>Proxy 先理解你要完成的事，再决定是否需要进入体验、机会或活动的后续动作。</Text>
      </View>

      <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messageContent} keyboardShouldPersistTaps="handled">
        {messages.map((message) => (
          <View key={message.id} style={[styles.bubble, message.isOwn ? styles.userBubble : styles.aiBubble]}>
            {message.attachmentUri ? <Image accessibilityLabel="会话照片" source={{ uri: message.attachmentUri }} style={styles.messageImage} /> : null}
            {!message.isOwn ? <Text style={styles.sender}>Proxy AI</Text> : null}
            <Text style={[styles.body, message.isOwn && styles.userBody]}>{message.body}</Text>
            <Text style={[styles.time, message.isOwn && styles.userTime]}>{message.time}</Text>
          </View>
        ))}
        {temporaryUI ? <ServerTemporaryForm disabled={sending} onSubmit={(summary) => void send(`我的补充信息：${summary}`, temporaryUI.id)} spec={temporaryUI} /> : null}
        {loading ? <View style={styles.systemPill}><Text style={styles.systemText}>正在理解你的意图…</Text></View> : null}
        {status ? <View style={styles.statusBox}><Text style={styles.statusText}>{status}</Text></View> : null}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          editable={Boolean(conversationId) && !sending}
          multiline
          onChangeText={setDraft}
          onSubmitEditing={() => void send()}
          placeholder={conversationId ? "继续告诉 Proxy…" : "连接中…"}
          placeholderTextColor="#A9A2B0"
          style={styles.input}
          value={draft}
        />
        <Pressable disabled={!draft.trim() || !conversationId || sending} onPress={() => void send()} style={[styles.sendButton, (!draft.trim() || !conversationId || sending) && styles.disabled]}>
          <Text style={styles.sendText}>{sending ? "…" : "↑"}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
  sendText: { color: color.white, fontSize: 20, fontWeight: "900" }
});
