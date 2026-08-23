// Conversation Surface：会话页面（PRD v1.2 §14 通知 · 消息 · 任务沟通中心）。
// 基于 Feed 的"聊一下"入口进入的会话界面。
// 接入模型底座：SendMessage 后服务端调用 modelStack.Complete() 生成 AI 回复。
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { readServerTemporaryUI, ServerTemporaryForm, type ServerTemporaryUI } from "../components/server-temporary-form";
import type { ConversationClient } from "../conversation-client";
import { color } from "../theme";

interface Message {
  id: string;
  sender: string;
  body: string;
  time: string;
  isOwn: boolean;
  isAI?: boolean;
}

export function ConversationSurface({
  author,
  conversationClient,
  conversationId: initialConvId,
  onBack
}: {
  author: string;
  conversationClient: ConversationClient;
  conversationId?: string;
  onBack: () => void;
}): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [convId, setConvId] = useState<string | undefined>(initialConvId);
  const [loading, setLoading] = useState(!initialConvId);
  const [error, setError] = useState<string | undefined>();
  const [temporaryUI, setTemporaryUI] = useState<ServerTemporaryUI>();
  const scrollRef = useRef<ScrollView>(null);

  // 自动滚到底部
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages]);

  // 解析命令结果中的 operationRef
  const parseOperationRef = useCallback((result: Record<string, unknown>): Record<string, unknown> | undefined => {
    const ref = typeof result?.operationRef === "string" ? result.operationRef : undefined;
    if (!ref) return undefined;
    try {
      return JSON.parse(ref) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }, []);

  // 挂载时创建会话
  useEffect(() => {
    if (convId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const result = await conversationClient.startConversation({
          originType: "POST",
          originId: "feed_post_001",
          participantId: "user_proxy_ai",
          firstMessage: `你好！我想了解关于「${author}」的更多信息。`
        });
        if (cancelled) return;

        const payload = parseOperationRef(result);
        if (payload?.conversationId) {
          setConvId(payload.conversationId as string);
        }

        // 如果返回了 AI 首条回复
        const aiMsg = payload?.aiMessage as Record<string, unknown> | undefined;
        setTemporaryUI(readServerTemporaryUI(payload?.temporaryUI));
        if (aiMsg) {
          setMessages([{
            id: (aiMsg.messageId as string) || "ai_1",
            sender: "Proxy AI",
            body: (aiMsg.body as string) || "",
            time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
            isOwn: false,
            isAI: true
          }]);
        }
      } catch (e) {
        if (!cancelled) setError("无法创建会话，请重试");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [convId, author, conversationClient, parseOperationRef]);

  async function send(preparedText?: string, temporaryUIResponseId?: string): Promise<void> {
    const text = (preparedText ?? draft).trim();
    if (!text || sending || !convId) return;
    setSending(true);
    const userText = text;
    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      sender: "你",
      body: userText,
      time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      isOwn: true
    };
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setTemporaryUI(undefined);

    try {
      const result = await conversationClient.sendMessage(convId, userText, undefined, temporaryUIResponseId);
      // 解析 AI 回复
      const payload = parseOperationRef(result);
      setTemporaryUI(readServerTemporaryUI(payload?.temporaryUI));
      const aiMsg = payload?.aiMessage as Record<string, unknown> | undefined;
      if (aiMsg) {
        const reply: Message = {
          id: (aiMsg.messageId as string) || `ai_${Date.now()}`,
          sender: "Proxy AI",
          body: (aiMsg.body as string) || "",
          time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
          isOwn: false,
          isAI: true
        };
        setMessages((prev) => [...prev, reply]);
      }
      if (payload?.assistantStatus === "FAILED") setError("模型服务暂时不可用，消息已保留");
      if (payload?.assistantStatus === "UNAVAILABLE") setError("模型服务未配置，消息已保留");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "发送失败，请重试");
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{author}</Text>
          <Text style={styles.headerStatus}>{convId ? "已连接" : "连接中..."}</Text>
        </View>
      </View>

      {/* Messages */}
      <ScrollView ref={scrollRef} style={styles.messageList} contentContainerStyle={styles.messageContent}>
        {loading && (
          <View style={styles.systemMsg}>
            <Text style={styles.systemMsgText}>正在创建会话...</Text>
          </View>
        )}
        {error && (
          <View style={styles.systemMsg}>
            <Text style={styles.systemMsgText}>{error}</Text>
          </View>
        )}
        {messages.map((msg) => (
          <View key={msg.id} style={[styles.messageBubble, msg.isOwn ? styles.messageOwn : msg.isAI ? styles.messageAI : styles.messageOther]}>
            {!msg.isOwn && <Text style={styles.messageSender}>{msg.sender}</Text>}
            <Text style={[styles.messageBody, msg.isOwn && styles.messageBodyOwn]}>{msg.body}</Text>
            <Text style={[styles.messageTime, msg.isOwn && styles.messageTimeOwn]}>{msg.time}</Text>
          </View>
        ))}
        {temporaryUI ? <ServerTemporaryForm disabled={sending} onSubmit={(summary) => void send(`我的补充信息：${summary}`, temporaryUI.id)} spec={temporaryUI} /> : null}
      </ScrollView>

      {/* Composer */}
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={convId ? "输入消息..." : "连接中..."}
          placeholderTextColor="#A9A2B0"
          style={styles.composerInput}
          multiline
          editable={!!convId && !sending}
        />
        <Pressable
          disabled={!draft.trim() || sending || !convId}
          onPress={() => void send()}
          style={[styles.sendBtn, (!draft.trim() || sending || !convId) && styles.sendBtnDisabled]}
        >
          <Text style={styles.sendBtnText}>{sending ? "..." : "发送"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },

  header: {
    alignItems: "center",
    backgroundColor: color.white,
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  backBtn: { alignItems: "center", height: 30, justifyContent: "center", width: 30 },
  backText: { color: color.ink, fontSize: 24, lineHeight: 28 },
  headerInfo: { flex: 1 },
  headerName: { color: color.ink, fontSize: 14, fontWeight: "700" },
  headerStatus: { color: "#4CAF50", fontSize: 11 },

  messageList: { flex: 1 },
  messageContent: { padding: 14, gap: 10 },

  messageBubble: {
    borderRadius: 16,
    maxWidth: "80%",
    padding: 10
  },
  messageOwn: {
    alignSelf: "flex-end",
    backgroundColor: color.ink
  },
  messageOther: {
    alignSelf: "flex-start",
    backgroundColor: color.white,
    borderColor: color.line,
    borderWidth: 1
  },
  messageAI: {
    alignSelf: "flex-start",
    backgroundColor: "#F0EBF5",
    borderColor: "#C4B5D4",
    borderWidth: 1
  },
  messageSender: { color: color.muted, fontSize: 11, fontWeight: "700", marginBottom: 3 },
  messageBody: { color: color.ink, fontSize: 11, lineHeight: 16 },
  messageBodyOwn: { color: color.white },
  messageTime: { color: color.muted, fontSize: 11, marginTop: 4, textAlign: "right" },
  messageTimeOwn: { color: "rgba(255,255,255,0.6)" },

  systemMsg: {
    alignSelf: "center",
    backgroundColor: "#E8E3EE",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  systemMsgText: { color: color.muted, fontSize: 11 },

  composer: {
    alignItems: "center",
    backgroundColor: color.white,
    borderTopColor: color.line,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  composerInput: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: 14,
    borderWidth: 1,
    color: color.ink,
    flex: 1,
    fontSize: 11,
    maxHeight: 80,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  sendBtn: {
    backgroundColor: color.ink,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: color.white, fontSize: 11, fontWeight: "700" }
});
