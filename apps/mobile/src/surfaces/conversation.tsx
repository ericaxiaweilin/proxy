// Conversation Surface：会话页面（PRD v1.2 §14 通知 · 消息 · 任务沟通中心）。
// 基于 Feed 的"聊一下"入口进入的会话界面。
// 接入模型底座：SendMessage 后服务端调用 modelStack.Complete() 生成 AI 回复。
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, Image, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SwipeBackShell } from "../architecture/swipe-back";
import { readServerTemporaryUI, ServerTemporaryForm, type ServerTemporaryUI } from "../components/server-temporary-form";
import type { ConversationClient, ProtectionOverride } from "../conversation-client";
import type { ActivityClient } from "../activity-client";
import type { MediaClient, UploadableImage } from "../media-client";
import { attachScreenshotReporter } from "../lib/screenshot-protection";
import { MessageRenderer, type MessageV1 } from "../components/message-renderer";
import { color } from "../theme";

interface Message {
  id: string;
  sender: string;
  body: string;
  time: string;
  isOwn: boolean;
  isAI?: boolean;
  imageUri?: string;
  v1?: MessageV1;
}

export function ConversationSurface({
  author,
  conversationClient,
  activityClient,
  mediaClient,
  conversationId: initialConvId,
  onBack
}: {
  author: string;
  conversationClient: ConversationClient;
  activityClient: ActivityClient;
  mediaClient: MediaClient;
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
  const [ephemeral, setEphemeral] = useState(false);
  const [noForward, setNoForward] = useState(true);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [selectedImage, setSelectedImage] = useState<UploadableImage>();
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>();
  // R17.x: 活动 proxy 选中面板状态。点“活动”按钮不再
  // 发 hardcoded "act_westlake" — 弹 picker, 让用户从 server
  // 真实活动里选, 然后发真 ID。防“聊天发活动”不等同于
  // “活动页有这个活动” 的两路径。
  const [activityPickerOpen, setActivityPickerOpen] = useState(false);
  const [activityOptions, setActivityOptions] = useState<{ id: string; title: string; subtitle: string }[] | undefined>(undefined);
  const [activityPickerError, setActivityPickerError] = useState<string | undefined>(undefined);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  // This surface lives inside AppShell's fixed-height body, where nested
  // KeyboardAvoidingView layouts are unreliable on iOS. Track the keyboard's
  // actual screen frame and reserve exactly the overlapping height instead.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const frameSub = Keyboard.addListener("keyboardWillChangeFrame", (event) => {
      const windowHeight = Dimensions.get("window").height;
      setKeyboardInset(Math.max(0, windowHeight - event.endCoordinates.screenY));
    });
    const hideSub = Keyboard.addListener("keyboardWillHide", () => setKeyboardInset(0));
    return () => {
      frameSub.remove();
      hideSub.remove();
    };
  }, []);

  // Lotus §4: 截屏上报 → RecordScreenshot → SECURITY_ALERT
  useEffect(() => {
    const sub = attachScreenshotReporter(conversationClient, () => messages.filter((m) => !m.isOwn).map((m) => m.id));
    return () => sub.remove();
  }, [conversationClient, messages]);

  // 自动滚到底部
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages]);

  useEffect(() => {
    if (keyboardInset > 0) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
    }
  }, [keyboardInset]);

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

  // Existing conversations open their persisted server history. Creating a
  // new conversation is reserved for entry points that do not provide an id.
  useEffect(() => {
    if (!initialConvId) return;
    let cancelled = false;
    setLoading(true);
    conversationClient.listMessages(initialConvId).then((result) => {
      if (cancelled) return;
      const payload = parseOperationRef(result);
      const rows = Array.isArray(payload?.messages) ? payload.messages as Array<Record<string, unknown>> : [];
      const actorId = typeof payload?.actorId === "string" ? payload.actorId : undefined;
      setMessages(rows.map((row) => ({
        id: String(row.messageId ?? `message_${Date.now()}`),
        sender: row.senderId === actorId ? "你" : String((row.senderSnapshot as Record<string, unknown> | undefined)?.displayName ?? "对方"),
        body: String(row.body ?? (row.messageType === "IMAGE" ? "[图片]" : row.messageType === "VIDEO" ? "[视频]" : "")),
        time: new Date(String(row.createdAt ?? Date.now())).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        isOwn: row.senderId === actorId,
        ...(row.messageType === "IMAGE" && typeof row.mediaRef === "string"
          ? { imageUri: `${conversationClient.baseUrl}/v1/media/thumb/${encodeURIComponent(row.mediaRef)}` }
          : {}),
      })));
      setError(undefined);
    }).catch(() => {
      if (!cancelled) setError("历史消息加载失败，请重试");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [initialConvId, conversationClient, parseOperationRef]);

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

  // R17.x: open activity picker. 拉 server 真实活动列表, 让
  // 用户选一个. (不完成这步, 发送活动 proxy 会被拒 — 硬
  // 编码 "act_westlake" 是不存在的活动, “我的活动”页也不能
  // 看到这个活动.)
  async function openActivityPicker(): Promise<void> {
    if (sending || !convId) return;
    setActivityPickerError(undefined);
    setActivityPickerOpen(true);
    setActivityOptions(undefined);
    try {
      const list = await activityClient.listActivities();
      setActivityOptions(list.map((a) => ({
        id: a.activityId,
        title: a.title,
        subtitle: `${a.time} · ${a.venueIcon} ${a.venueName}`
      })));
    } catch (e: unknown) {
      setActivityPickerError(e instanceof Error ? e.message : "活动加载失败");
    }
  }

  async function sendActivityProxy(activityId: string): Promise<void> {
    if (sending || !convId) return;
    const picked = activityOptions?.find((option) => option.id === activityId);
    if (!picked) {
      setError("选中的活动不可用");
      setActivityPickerOpen(false);
      return;
    }
    setSending(true);
    setActivityPickerOpen(false);
    const snapshot = { title: picked.title, time: picked.subtitle };
    const proxyForService = { objectType: "activity" as const, objectId: picked.id, snapshot, liveState: { state: "选自开放活动" } };
    const proxyForV1 = { object_type: "activity" as const, object_id: picked.id, snapshot, liveState: { state: "选自开放活动" } };
    const v1: MessageV1 = { id: `msg_${Date.now()}`, kind: "proxy_object", proxy_object: proxyForV1, text: picked.title };
    const userMsg: Message = {
      id: v1.id,
      sender: "你",
      body: picked.title,
      time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      isOwn: true,
      v1,
    };
    setMessages((prev) => [...prev, userMsg]);
    try {
      await conversationClient.sendProxyObject(convId, proxyForService);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "发送活动卡片失败");
    } finally {
      setSending(false);
    }
  }

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
      const protectionOverride: ProtectionOverride | undefined = (() => {
        if (!ephemeral && noForward === true) return undefined;
        const o: ProtectionOverride = {};
        if (ephemeral) o.viewLimit = 1;
        o.forwardable = noForward ? false : true;
        return o;
      })();
      const result = await conversationClient.sendMessage(convId, userText, undefined, temporaryUIResponseId, undefined, protectionOverride);
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

  async function chooseImage(source: "CAMERA" | "LIBRARY"): Promise<void> {
    setImageMenuOpen(false);
    setError(undefined);
    const permission = source === "CAMERA"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(source === "CAMERA" ? "请允许 Proxy 使用相机" : "请允许 Proxy 读取照片");
      return;
    }
    const result = source === "CAMERA"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, selectionLimit: 1 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    setSelectedImage({ uri: asset.uri, width: asset.width, height: asset.height, ...(asset.fileName ? { fileName: asset.fileName } : {}), ...(asset.mimeType ? { mimeType: asset.mimeType } : {}) });
  }

  async function sendImage(): Promise<void> {
    if (!selectedImage || !convId || sending) return;
    setSending(true);
    setError(undefined);
    setUploadProgress(0);
    try {
      const uploaded = await mediaClient.uploadImage(selectedImage, { onProgress: setUploadProgress });
      await conversationClient.sendImageMessage(convId, uploaded.storageKey, draft);
      setMessages((current) => [...current, { id:`image_${Date.now()}`, sender:"你", body:draft.trim(), time:new Date().toLocaleTimeString("zh-CN", {hour:"2-digit", minute:"2-digit"}), isOwn:true, imageUri:selectedImage.uri }]);
      setDraft("");
      setSelectedImage(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片发送失败，请重试");
    } finally {
      setUploadProgress(undefined);
      setSending(false);
    }
  }

  return (
    <SwipeBackShell onExit={onBack}>
      <View style={[styles.root, keyboardInset > 0 && { paddingBottom: keyboardInset }]}>
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
      <ScrollView
        ref={scrollRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
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
        {messages.map((msg) =>
          msg.v1 ? (
            <View key={msg.id} style={[styles.v1Wrap, msg.isOwn ? styles.v1Own : styles.v1Other]}>
              {!msg.isOwn && <Text style={styles.messageSender}>{msg.sender}</Text>}
              <MessageRenderer message={msg.v1} />
              <Text style={[styles.messageTime, msg.isOwn && styles.messageTimeOwn]}>{msg.time}</Text>
            </View>
          ) : (
            <View key={msg.id} style={[styles.messageBubble, msg.isOwn ? styles.messageOwn : msg.isAI ? styles.messageAI : styles.messageOther]}>
              {!msg.isOwn && <Text style={styles.messageSender}>{msg.sender}</Text>}
              {msg.imageUri ? <Image accessibilityLabel="聊天图片" resizeMode="cover" source={{ uri:msg.imageUri }} style={styles.messageImage} /> : null}
              {msg.body.trim() ? <Text style={[styles.messageBody, msg.isOwn && styles.messageBodyOwn]}>{msg.body}</Text> : null}
              <Text style={[styles.messageTime, msg.isOwn && styles.messageTimeOwn]}>{msg.time}</Text>
            </View>
          )
        )}
        {temporaryUI ? <ServerTemporaryForm disabled={sending} onSubmit={(summary) => void send(`我的补充信息：${summary}`, temporaryUI.id)} spec={temporaryUI} /> : null}
      </ScrollView>

      {/* Footer remains in normal layout; root padding follows the keyboard. */}
        {/* Protection toggles (Lotus §3 per-message) */}
        <View style={styles.protectionRow}>
          <Pressable onPress={() => setEphemeral((v) => !v)} style={[styles.chip, ephemeral && styles.chipActive]}>
            <Text style={[styles.chipText, ephemeral && styles.chipTextActive]}>阅后即焚 {ephemeral ? "1次" : "关"}</Text>
          </Pressable>
          <Pressable onPress={() => setNoForward((v) => !v)} style={[styles.chip, noForward && styles.chipActive]}>
            <Text style={[styles.chipText, noForward && styles.chipTextActive]}>{noForward ? "禁止转发 ✓" : "允许转发"}</Text>
          </Pressable>
          <Text style={styles.hint}>🔒 端到端加密</Text>
        </View>

        <View style={[styles.composerShell, { paddingBottom: keyboardInset > 0 ? 10 : Math.max(insets.bottom, 16) }]}>
          {selectedImage ? <View style={styles.imagePreviewRow}><Image source={{uri:selectedImage.uri}} style={styles.imagePreview} /><Text numberOfLines={1} style={styles.imagePreviewText}>{uploadProgress === undefined ? (selectedImage.fileName ?? "已选择图片") : `上传 ${Math.round(uploadProgress * 100)}%`}</Text><Pressable accessibilityLabel="移除图片" onPress={() => setSelectedImage(undefined)}><Text style={styles.imageRemove}>×</Text></Pressable></View> : null}
          {imageMenuOpen ? <View style={styles.imageMenu}><Pressable onPress={() => void chooseImage("CAMERA")} style={styles.imageMenuBtn}><Text>拍照</Text></Pressable><Pressable onPress={() => void chooseImage("LIBRARY")} style={styles.imageMenuBtn}><Text>从相册选择</Text></Pressable></View> : null}
        {/* Composer — 图片 / 业务卡片 / 文本 */}
        <View style={styles.composer}>
          <Pressable accessibilityLabel="添加图片" onPress={() => setImageMenuOpen((open) => !open)} disabled={sending || !convId} style={styles.imageBtn}><Text style={styles.imageBtnText}>＋</Text></Pressable>
          <Pressable onPress={() => void openActivityPicker()} disabled={sending || !convId} style={[styles.cardBtn, (!convId || sending) && styles.cardBtnDisabled]}>
            <Text style={styles.cardBtnText}>活动</Text>
          </Pressable>
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
            disabled={(!draft.trim() && !selectedImage) || sending || !convId}
            onPress={() => void (selectedImage ? sendImage() : send())}
            style={[styles.sendBtn, ((!draft.trim() && !selectedImage) || sending || !convId) && styles.sendBtnDisabled]}
          >
            <Text style={styles.sendBtnText}>{sending ? "..." : "发送"}</Text>
          </Pressable>
        </View>
        </View>
      </View>
      {/* R17.x: activity picker sheet. 点击“活动”按钮后
          弹出, 从 server listActivities() 选真活动, 作为
          proxyObject 发出. 取消 / 点外部 = 取消. */}
      {activityPickerOpen ? (
        <Pressable accessibilityLabel="关闭活动选择" onPress={() => setActivityPickerOpen(false)} style={styles.pickerScrim}>
          <Pressable onPress={() => undefined} style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>选一个活动</Text>
            <Text style={styles.pickerSub}>选中的活动会作为代理卡片发到对话</Text>
            {activityPickerError ? <Text style={styles.pickerError}>{activityPickerError}</Text> : null}
            {activityOptions === undefined ? <ActivityIndicator color={color.magenta} /> : activityOptions.length === 0 ? <Text style={styles.pickerSub}>本周暂无开放活动。</Text> : (
              <ScrollView style={styles.pickerList}>
                {activityOptions.map((option) => (
                  <Pressable key={option.id} onPress={() => void sendActivityProxy(option.id)} style={styles.pickerItem}>
                    <Text style={styles.pickerItemTitle}>{option.title}</Text>
                    <Text style={styles.pickerItemSub}>{option.subtitle}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable onPress={() => setActivityPickerOpen(false)} style={styles.pickerCancel}>
              <Text style={styles.pickerCancelText}>取消</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      ) : null}
    </SwipeBackShell>
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
  messageImage: { borderRadius: 11, height: 180, marginBottom: 6, width: 220 },

  systemMsg: {
    alignSelf: "center",
    backgroundColor: "#E8E3EE",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  systemMsgText: { color: color.muted, fontSize: 11 },

  protectionRow: { alignItems: "center", backgroundColor: color.white, borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  chip: { backgroundColor: "#F4F1F6", borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  chipActive: { backgroundColor: "#EEE3FF", borderColor: color.proxyPurple },
  chipText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  chipTextActive: { color: "#5822A4" },
  hint: { color: color.muted, fontSize: 11, marginLeft: "auto" },

  composerShell: { backgroundColor: color.white, borderTopColor: color.line, borderTopWidth: 1, paddingHorizontal: 12, paddingTop: 8 },
  composer: {
    alignItems: "center",
    backgroundColor: color.white,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 4
  },
  imageBtn: { alignItems:"center", backgroundColor:"#F4F1F6", borderRadius:14, height:40, justifyContent:"center", width:40 },
  imageBtnText: { color:color.ink, fontSize:24, lineHeight:26 },
  imagePreviewRow: { alignItems:"center", backgroundColor:"#F8F5FA", borderRadius:12, flexDirection:"row", gap:9, marginBottom:7, padding:7 },
  imagePreview: { borderRadius:8, height:52, width:52 },
  imagePreviewText: { color:color.ink, flex:1, fontSize:11 },
  imageRemove: { color:color.muted, fontSize:24, paddingHorizontal:8 },
  imageMenu: { flexDirection:"row", gap:8, marginBottom:7 },
  imageMenuBtn: { backgroundColor:"#F4F1F6", borderColor:color.line, borderRadius:10, borderWidth:1, flex:1, padding:10 },
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
  sendBtnText: { color: color.white, fontSize: 11, fontWeight: "700" },
  cardBtn: { backgroundColor: "#fff4da", borderWidth: 1, borderColor: "#e8e3da", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  cardBtnDisabled: { opacity: 0.5 },
  cardBtnText: { fontSize: 11, fontWeight: "700", color: "#795817" },
  v1Wrap: { maxWidth: "80%", marginVertical: 2 },
  v1Own: { alignSelf: "flex-end" },
  v1Other: { alignSelf: "flex-start" },
  // R17.x: activity picker sheet. 贴底部弹出, scrim 点击关闭.
  pickerScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: "#FFF8EC", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: "70%" },
  pickerTitle: { fontSize: 14, fontWeight: "800", color: "#2C2235", marginBottom: 4 },
  pickerSub: { fontSize: 11, color: "#6E6478", marginBottom: 8 },
  pickerError: { fontSize: 11, color: "#A11A4F", marginBottom: 8 },
  pickerList: { maxHeight: 320 },
  pickerItem: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: "rgba(60,40,90,0.08)" },
  pickerItemTitle: { fontSize: 13, fontWeight: "700", color: "#2C2235" },
  pickerItemSub: { fontSize: 11, color: "#6E6478", marginTop: 2 },
  pickerCancel: { marginTop: 12, alignSelf: "center", paddingVertical: 8, paddingHorizontal: 24 },
  pickerCancelText: { fontSize: 13, fontWeight: "600", color: "#795817" },
});
