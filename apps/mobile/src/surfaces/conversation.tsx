// Conversation Surface：会话页面（PRD v1.2 §14 通知 · 消息 · 任务沟通中心）。
// 基于 Feed 的"聊一下"入口进入的会话界面。
// 接入模型底座：SendMessage 后服务端调用 modelStack.Complete() 生成 AI 回复。
// R36.1 Lotus 对话视觉：cluster 气泡 / 对象基线 / 安全条 / 表情包 Drawer。
// 设计引用：docs/design/references/Proxy_Messaging_R36_1_Secure_Stickers.html
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Image, Keyboard, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import * as ImagePicker from "expo-image-picker";
// CONVO-ATTACH-001: v57 顶层 getAssetsAsync 是只会 throw 的占位实现
//（见 image-export.ts 开头，真机验证过）—— 列表走新 API Query/Asset。
import { AssetField, MediaType, Query, requestPermissionsAsync } from "expo-media-library";
import { ProxySwitch, ProxyLoading } from "../components/proxy-foundation";
import { useVideoPlayer, VideoView } from "expo-video";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SwipeBackShell } from "../architecture/swipe-back";
import { readServerTemporaryUI, ServerTemporaryForm, type ServerTemporaryUI } from "../components/server-temporary-form";
import type { ConversationClient, ConversationInboxItem, ProtectionOverride } from "../conversation-client";
import type { ActivityClient } from "../activity-client";
import type { MediaClient, UploadableImage } from "../media-client";
import type { ModerationClient } from "../moderation-client";
import { ReportSheet } from "../components/report-sheet";
import { attachScreenshotReporter } from "../lib/screenshot-protection";
import { useKeyboardSafeInset } from "../components/use-keyboard-safe-inset";
import { MessageRenderer, type MessageV1 } from "../components/message-renderer";
import { decodeMeetupLocation, meetupDirectionsUrls, meetupMapsUrls, meetupPointFromLocation, type DecodedMeetup, type MeetupPoint } from "../meetup-share";
// CONTACT-CARD-001: 名片解析用 profile-qr 那份**唯一实现** —— 二维码和消息里
// 的名片是同一串 vCard，绝不允许这里再写一份解析器。
import { buildContactCard, parseContactCard, type ParsedContactCard } from "../profile-qr";
import { QrZoomOverlay } from "../components/qr-zoom-overlay";
import type { ProfileClient } from "../profile-client";
import type { RelationshipClient } from "../relationship-client";
import { LocationPickerSheet, type AnyLocation, DEFAULT_LOCATION } from "../components/location-picker-sheet";
import type { PlatformAIAccount } from "../ai-account-client";
import { aiAccountPhoto } from "../ai-persona-presentation";
import { VoiceToolButton } from "../components/VoiceToolButton";
import { ProxyIcon } from "../components/proxy-icon";

// Lotus 纸面 palette（R36.1 设计稿 :root）。不碰共享 theme，只在本页使用。
const lotus = {
  paper: "#fffdf8",
  ink: "#11110f",
  muted: "#8d8880",
  faint: "#aaa59d",
  line: "#e5e0d7",
  soft: "#f3f0ea",
  accent: "#f2ad29",
  goldink: "#8a651b",
  goldbg: "#fff8e8",
  goldline: "#ead39a",
  goldtext: "#795814",
  out: "#f0f5f5",
  outLine: "#dce8e8",
  check: "#6f9fa1",
  green: "#2d725d",
};

type Burn = "off" | "10s" | "1m" | "1h" | "24h" | "7d";
const BURN_TTL: Record<Burn, number> = { off: 0, "10s": 10, "1m": 60, "1h": 3600, "24h": 86400, "7d": 604800 };
const BURN_LABEL: Record<Burn, string> = { off: "关闭", "10s": "10 秒", "1m": "1 分钟", "1h": "1 小时", "24h": "24 小时", "7d": "7 天" };
const BURN_SHORT: Record<Burn, string> = { off: "", "10s": "10s", "1m": "1m", "1h": "1h", "24h": "24h", "7d": "7d" };
const BURN_OPTIONS: Burn[] = ["off", "10s", "1m", "1h", "24h", "7d"];

// OpenMoji 贴纸（设计稿 8 张）。RN 不渲染远端 SVG，这里用 emoji 字形大字渲染，
// 离线可用；code 保留用于未来切本地/远端位图资源。
const STICKERS: { code: string; emoji: string; name: string }[] = [
  { code: "1F602", emoji: "😂", name: "笑哭" },
  { code: "1F970", emoji: "🥰", name: "开心" },
  { code: "1F60E", emoji: "😎", name: "酷" },
  { code: "1F44D", emoji: "👍", name: "赞" },
  { code: "1F525", emoji: "🔥", name: "火" },
  { code: "1F389", emoji: "🎉", name: "庆祝" },
  { code: "1F914", emoji: "🤔", name: "想想" },
  { code: "1F64C", emoji: "🙌", name: "开心" },
];
const MENU_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

function isSingleEmoji(body: string): boolean {
  const chars = [...body.trim()];
  return chars.length > 0 && chars.length <= 2 && /\p{Extended_Pictographic}/u.test(body);
}

interface Message {
  id: string;
  sender: string;
  body: string;
  time: string;
  isOwn: boolean;
  isAI?: boolean;
  imageUri?: string;
  imageSource?: number | { uri: string };
  videoUri?: string;
  audioUri?: string;
  // MEETUP-SHARE-001: LOCATION 消息解出的坐标（解不出就不带，冒泡原文）。
  location?: DecodedMeetup;
  // CONTACT-CARD-001: CONTACT 消息解出的名片。body 里装的是标准 vCard，
  // 和二维码里编的是**同一串** —— 所以相机扫到的和对话里收到的走同一个解析器。
  // 解不出（不是 Proxy 名片 / 内容损坏）就不带，body 留原文：不猜不藏，
  // 与 LOCATION 解不出时同一个口径。
  contact?: ParsedContactCard;
  /** 名片原文（vCard）。气泡只显示「人能读的那一行」，但放大成码要靠这一串。 */
  contactVcard?: string;
  v1?: MessageV1;
  stickerCode?: string;
  stickerName?: string;
  replySender?: string;
  replyBody?: string;
  secureMeta?: string;
  isDivider?: boolean;
}

interface Cluster {
  key: string;
  isOwn: boolean;
  isAI: boolean;
  sender: string;
  messages: Message[];
}

/**
 * CONTACT-CARD-001：名片面板里可选的一张卡。
 *
 * `vcard` 是**编码后的整串**（`buildContactCard` 的产物），消息里发的、放大层画成
 * 码的都是这一串 —— 不另外传 name/handle 让各层自己拼，拼就会拼歪。
 */
export type ContactCardOption = {
  key: string;
  /** 卡片标题：我的名片 / 好友的展示名。 */
  name: string;
  /** 卡片副标题：@handle（个人）或店名（店铺）。App 搜得到的就是这一串。 */
  caption: string;
  vcard: string;
};

export function ConversationSurface({
  author,
  conversationClient,
  activityClient,
  mediaClient,
  moderationClient,
  conversationId: initialConvId,
  aiAccount,
  peerAvatarSource,
  initialDraft,
  ensureSession,
  onBack,
  convoId: initialConvoId,
  convoTitle,
}: {
  author: string;
  conversationClient: ConversationClient;
  activityClient: ActivityClient;
  mediaClient: MediaClient;
  // COMP-REPORT-002: 举报入口。法律文件 §38 承诺可举报八类目标，
  // 会话里这条对应 MESSAGE —— 招嫖揽客、人身威胁都发生在聊天中。
  moderationClient: ModerationClient;
  conversationId?: string;
  aiAccount?: PlatformAIAccount;
  peerAvatarSource?: number | { uri: string };
  initialDraft?: string;
  ensureSession?: () => Promise<void>;
  onBack: () => void;
  // Lotus v1 Convo 分支模式：只读/只写该分支，seed 置顶展示。
  convoId?: string | undefined;
  convoTitle?: string | undefined;
  // CONTACT-CARD-001：发名片要两样东西 —— 我自己的名片（profile），
  // 以及「把某个好友的名片发出去」时的好友列表（relationship）。
  // 两个都可选：接不进来只是发不了名片，其它功能照常（不是整屏降级）。
  profileClient?: ProfileClient | undefined;
  relationship?: RelationshipClient | undefined;
}): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [sending, setSending] = useState(false);
  const [convId, setConvId] = useState<string | undefined>(initialConvId);
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [loading, setLoading] = useState(!initialConvId);
  const [error, setError] = useState<string | undefined>();
  const [temporaryUI, setTemporaryUI] = useState<ServerTemporaryUI>();
  // R36.1 安全会话：burn 计时 + 禁止转发。默认保持既有保护姿态（禁止转发开）。
  const [burn, setBurn] = useState<Burn>("off");
  const [noForward, setNoForward] = useState(true);
  const [secureSheetOpen, setSecureSheetOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  // CONVO-ATTACH-001: 自建相册（Lotus 式）—— 点相机图标直进，首格拍摄，
  // 后面是最新照片。系统相册一次只能做一件事（选图 XOR 拍照），合并不了，
  // 所以这里自己摆一排缩略图 + 复用 chooseImage("CAMERA") 那条真链路。
  const [albumOpen, setAlbumOpen] = useState(false);
  const [albumAssets, setAlbumAssets] = useState<Array<{ uri: string; width: number; height: number }>>([]);
  const [menuMessage, setMenuMessage] = useState<Message | null>(null);
  // COMP-REPORT-002: 举报「这条消息」。招嫖揽客 / 人身威胁 / 涉未成年人
  // 都发生在聊天里，用户必须能在这里报上来。
  const [reportFor, setReportFor] = useState<Message | null>(null);
  // 当前分支：props 带进来（从 Convo 页打开）或屏内创建。null = 主线。
  const [activeConvo, setActiveConvo] = useState<{ id: string; title: string } | null>(
    initialConvoId ? { id: initialConvoId, title: convoTitle ?? "支线" } : null
  );
  // 分支 seed 上下文卡（服务端随分支列表下发，不混入气泡流）。
  const [seedMsg, setSeedMsg] = useState<{ sender: string; body: string } | null>(null);
  const [creatingConvo, setCreatingConvo] = useState(false);
  // 转发目标选择：拉收件箱、调 ForwardMessage，全程有加载/错误态。
  const [forwardFor, setForwardFor] = useState<Message | null>(null);
  const [forwardInbox, setForwardInbox] = useState<ConversationInboxItem[] | undefined>(undefined);
  const [forwardBusy, setForwardBusy] = useState(false);
  const [forwardError, setForwardError] = useState<string | undefined>(undefined);
  const [reactions, setReactions] = useState<Record<string, string[]>>({});
  const [replyTo, setReplyTo] = useState<{ id: string; sender: string; body: string } | null>(null);
  const [pinned, setPinned] = useState<{ id: string; body: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const keyboardInset = useKeyboardSafeInset();
  const [selectedImage, setSelectedImage] = useState<UploadableImage>();
  const [selectedVideo, setSelectedVideo] = useState<UploadableImage & { durationMs?: number }>();
  const [selectedAudio, setSelectedAudio] = useState<{ uri:string; durationMs:number }>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>();
  // R17.x: 活动 proxy 选中面板状态。点"活动"按钮不再
  // 发 hardcoded "act_westlake" — 弹 picker, 让用户从 server
  // 真实活动里选, 然后发真 ID。防"聊天发活动"不等同于
  // “活动页有这个活动” 的两路径。
  const [activityPickerOpen, setActivityPickerOpen] = useState(false);
  const [activityOptions, setActivityOptions] = useState<{ id: string; title: string; subtitle: string }[] | undefined>(undefined);
  const [activityPickerError, setActivityPickerError] = useState<string | undefined>(undefined);
  // MEETUP-SHARE-001 seg4: 会话内发位置直接复用 LocationPickerSheet（成熟组件：
  // 真地图 MapCanvas + 拖拽限 3KM + 复制/Google 打开 + 历史收藏），不再自写确认页。
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  // CONTACT-CARD-001: 名片选择面板（＋ 面板第一项）+ 收到/发出的名片点开看码。
  // 放大层直接复用全 App 共用的 QrZoomOverlay —— 不再自己搭一个 Modal。
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const [cardOptions, setCardOptions] = useState<ContactCardOption[] | undefined>(undefined);
  const [cardPickerError, setCardPickerError] = useState<string | undefined>(undefined);
  const [cardBusy, setCardBusy] = useState(false);
  const [contactZoom, setContactZoom] = useState<{ vcard: string; caption: string; title: string } | undefined>(undefined);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  // Keep live-sync hydration from replacing an optimistic bubble while the
  // command is waiting on an AI completion in the same HTTP response.
  const sendingRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleMessages = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return query ? messages.filter((message) => `${message.sender} ${message.body}`.toLocaleLowerCase().includes(query)) : messages;
  }, [messages, searchQuery]);

  // 同一发送者连续消息组成 cluster（R36.1 设计稿规则）。
  const clusters = useMemo<Cluster[]>(() => {
    const out: Cluster[] = [];
    for (const msg of visibleMessages) {
      if (msg.v1) {
        out.push({ key: `v1:${msg.id}`, isOwn: msg.isOwn, isAI: msg.isAI ?? false, sender: msg.sender, messages: [msg] });
        continue;
      }
      const last = out[out.length - 1];
      if (last && last.messages.length > 0 && !msg.v1 && last.messages[0] && !last.messages[0].v1
        && last.isOwn === msg.isOwn && last.sender === msg.sender && (last.isAI ?? false) === (msg.isAI ?? false)) {
        last.messages.push(msg);
      } else {
        out.push({ key: `c:${msg.id}`, isOwn: msg.isOwn, isAI: msg.isAI ?? false, sender: msg.sender, messages: [msg] });
      }
    }
    return out;
  }, [visibleMessages]);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1200);
  }, []);

  const closeSheets = useCallback(() => {
    setMenuMessage(null);
    setSecureSheetOpen(false);
    setAttachOpen(false);
    setActivityPickerOpen(false);
    setLocationSheetOpen(false);
    setConversationMenuOpen(false);
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

  const hydrateMessages = useCallback((result: Record<string, unknown>): void => {
    const payload = parseOperationRef(result);
    const rows = Array.isArray(payload?.messages) ? payload.messages as Array<Record<string, unknown>> : [];
    const actorId = typeof payload?.actorId === "string" ? payload.actorId : undefined;
    const seed = payload?.seed as Record<string, unknown> | undefined;
    if (seed && typeof seed === "object") {
      const seedBody = String(seed.body ?? (seed.messageType === "IMAGE" ? "[图片]" : seed.messageType === "VIDEO" ? "[视频]" : seed.messageType === "LOCATION" ? "[位置]" : ""));
      const seedSender = seed.senderId === actorId ? "你" : String((seed.senderSnapshot as Record<string, unknown> | undefined)?.displayName ?? aiAccount?.displayName ?? "对方");
      setSeedMsg(seedBody ? { sender: seedSender, body: seedBody } : null);
    } else {
      setSeedMsg(null);
    }
    setMessages(rows.map((row) => {
      // MEETUP-SHARE-001: LOCATION 行解坐标。解得出 → body 只留标签（卡片另 shows 坐标），
      // 解不出 → body 留原文（不猜不藏，收到什么看什么）。
      const rawBody = String(row.body ?? (row.messageType === "IMAGE" ? "[图片]" : row.messageType === "VIDEO" ? "[视频]" : row.messageType === "LOCATION" ? "[位置]" : row.messageType === "CONTACT" ? "[名片]" : ""));
      const location = row.messageType === "LOCATION" && typeof row.body === "string" ? decodeMeetupLocation(row.body) : undefined;
      // CONTACT-CARD-001: 认得出 → 画卡片；认不出 → body 留原文（不猜不藏）。
      const contact = row.messageType === "CONTACT" && typeof row.body === "string" ? parseContactCard(row.body) : undefined;
      return {
        id: String(row.messageId ?? `message_${Date.now()}`),
        sender: row.senderId === actorId ? "你" : String((row.senderSnapshot as Record<string, unknown> | undefined)?.displayName ?? aiAccount?.displayName ?? "对方"),
        // 名片的 body 只留「人能读的那一行」（@handle 或店名），vCard 原文不进气泡 ——
        // 那串 BEGIN:VCARD 是给机器看的，塞进气泡就是噪音。
        body: location ? (location.label ?? "") : contact ? (contact.handle ? `@${contact.handle}` : contact.name) : rawBody,
        time: new Date(String(row.createdAt ?? Date.now())).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        isOwn: row.senderId === actorId,
        isAI: Boolean(aiAccount && row.senderId !== actorId),
        isDivider: row.messageType === "SYSTEM_CONTEXT" && row.senderId === "SYSTEM",
        ...(row.messageType === "IMAGE" && typeof row.mediaRef === "string"
          ? { imageUri: `${conversationClient.baseUrl}/v1/media/thumb/${encodeURIComponent(row.mediaRef)}` }
          : {}),
        ...(row.messageType === "VIDEO" && typeof row.mediaRef === "string"
          ? { videoUri: `${conversationClient.baseUrl}/v1/media/play/${encodeURIComponent(row.mediaRef)}` }
          : {}),
        ...(row.messageType === "AUDIO" && typeof row.mediaRef === "string"
          ? { audioUri: `${conversationClient.baseUrl}/v1/media/play/${encodeURIComponent(row.mediaRef)}` }
          : {}),
        ...(location ? { location } : {}),
        ...(contact ? { contact, contactVcard: String(row.body ?? "") } : {}),
      };
    }));
    setError(undefined);
  }, [aiAccount, conversationClient.baseUrl, parseOperationRef]);

  // Human-to-human DM live sync. The API remains the source of truth; while
  // this screen is foregrounded we refresh every 3s, pause in background, and
  // refresh immediately on resume. This gives two-device QA deterministic
  // delivery without pretending the current HTTP command API is a WebSocket.
  useEffect(() => {
    if (!convId) return;
    let cancelled = false;
    let foreground = AppState.currentState === "active";
    let firstLoad = true;
    const refresh = async (): Promise<void> => {
      if (!foreground || sendingRef.current) return;
      try {
        const result = await conversationClient.listMessages(convId, activeConvo?.id);
        if (!cancelled) hydrateMessages(result);
        // UNREAD-PIPELINE-001: 首次拉成功后标已读（只标一次，不跟着 3 秒轮询
        // 一起写 —— 轮询里写等于每个用户每 3 秒写一次 cursor，而且用户正看着
        // 进来的新消息会被立刻灭掉。失败静默，下次打开重试。
        if (firstLoad) void conversationClient.markDialogRead(convId).catch(() => undefined);
      } catch {
        if (!cancelled && firstLoad) setError("历史消息加载失败，请重试");
      } finally {
        if (!cancelled && firstLoad) setLoading(false);
        firstLoad = false;
      }
    };
    setLoading(true);
    void refresh();
    const timer = setInterval(() => void refresh(), 3_000);
    const appState = AppState.addEventListener("change", (state) => {
      foreground = state === "active";
      if (foreground) void refresh();
    });
    return () => { cancelled = true; clearInterval(timer); appState.remove(); };
  }, [convId, activeConvo, conversationClient, hydrateMessages]);

  // 挂载时创建会话
  useEffect(() => {
    if (convId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        await ensureSession?.();
        const result = await conversationClient.startConversation(aiAccount ? {
          originType: "PROFILE", originId: aiAccount.accountId, participantId: aiAccount.accountId,
          firstMessage: "", assistantMode: `AI_PERSONA:${aiAccount.personaId}`
        } : {
          originType: "POST", originId: "feed_post_001", participantId: "user_proxy_ai",
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
            sender: aiAccount?.displayName ?? "Proxy AI",
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
  }, [convId, author, aiAccount, conversationClient, ensureSession, parseOperationRef, connectAttempt]);

  const buildProtection = useCallback((): ProtectionOverride | undefined => {
    if (burn === "off" && noForward) return undefined;
    const o: ProtectionOverride = {};
    if (burn !== "off") {
      o.viewLimit = 1;
      o.ttlSeconds = BURN_TTL[burn];
    }
    o.forwardable = !noForward;
    return o;
  }, [burn, noForward]);

  const secureMetaForSend = useCallback((): string | undefined => {
    if (burn === "off") return undefined;
    return `🔥 ${BURN_SHORT[burn]}${noForward ? " · 禁转发" : ""}`;
  }, [burn, noForward]);

  // R17.x: open activity picker. 拉 server 真实活动列表, 让
  // 用户选一个. (不完成这步, 发送活动 proxy 会被拒 — 硬
  // 编码 "act_westlake" 是不存在的活动, “我的活动”页也不能
  // 看到这个活动.)
  async function openActivityPicker(): Promise<void> {
    if (sending || !convId) return;
    setActivityPickerError(undefined);
    setAttachOpen(false);
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
      await conversationClient.sendProxyObject(convId, proxyForService, activeConvo?.id);
    } catch (e: unknown) {
      // 活动卡片发送失败同样撤回气泡，不留假成功。
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      setError(e instanceof Error ? e.message : "发送活动卡片失败");
    } finally {
      setSending(false);
    }
  }

  // MEETUP-SHARE-001 seg4: 选点页结果 → 发 LOCATION。PRESET 这类无坐标结果
  // 直接拒掉并指路“地图选点”，不拿城市中心冒充。
  async function sendLocationFromPicker(next: AnyLocation): Promise<void> {
    const point = meetupPointFromLocation(next);
    if (!point) {
      setError("这个地点没有坐标，用“地图选点”定一个点再发");
      return;
    }
    await sendLocation(point);
  }

  // MEETUP-SHARE-001 seg3: 发位置。乐观气泡 + 失败撤回（与活动卡片同口径，
  // 不留假成功）。非法坐标由 sendLocationMessage 抛错，同样走撤回。
  async function sendLocation(point: MeetupPoint): Promise<void> {
    if (sending || !convId) return;
    setSending(true);
    setLocationSheetOpen(false);
    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      sender: "你",
      body: point.label ?? "",
      time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      isOwn: true,
      location: { lat: point.lat, lng: point.lng, ...(point.label ? { label: point.label } : {}) },
    };
    setMessages((prev) => [...prev, userMsg]);
    try {
      await conversationClient.sendLocationMessage(convId, point, buildProtection(), undefined, activeConvo?.id);
    } catch (e: unknown) {
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      setError(e instanceof Error ? e.message : "发送位置失败");
    } finally {
      setSending(false);
    }
  }

  async function send(preparedText?: string, temporaryUIResponseId?: string, sticker?: { code: string; emoji: string; name: string }): Promise<void> {
    const text = (preparedText ?? draft).trim();
    if (!text || sending || !convId) return;
    sendingRef.current = true;
    setSending(true);
    const secureMeta = secureMetaForSend();
    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      sender: "你",
      body: text,
      time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      isOwn: true,
      ...(sticker ? { stickerCode: sticker.code, stickerName: sticker.name } : {}),
      ...(replyTo ? { replySender: replyTo.sender, replyBody: replyTo.body } : {}),
      ...(secureMeta ? { secureMeta } : {}),
    };
    const userText = text;
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setReplyTo(null);
    setStickerOpen(false);
    setTemporaryUI(undefined);

    try {
      // Yield one frame before starting the potentially slow model request so
      // the user's own message is painted immediately on the device.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const result = await conversationClient.sendMessage(convId, userText, aiAccount ? `AI_PERSONA:${aiAccount.personaId}` : undefined, temporaryUIResponseId, undefined, buildProtection(), undefined, undefined, activeConvo?.id);
      // 解析 AI 回复
      const payload = parseOperationRef(result);
      setTemporaryUI(readServerTemporaryUI(payload?.temporaryUI));
      const aiMsg = payload?.aiMessage as Record<string, unknown> | undefined;
      if (aiMsg) {
        const reply: Message = {
          id: (aiMsg.messageId as string) || `ai_${Date.now()}`,
          sender: aiAccount?.displayName ?? "Proxy AI",
          body: (aiMsg.body as string) || "",
          time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
          isOwn: false,
          isAI: true
        };
        setMessages((prev) => [...prev, reply]);
      }
      if (aiAccount && /(?:照片|自拍|相片|photo|selfie)/i.test(userText)) {
        setMessages((prev) => [...prev, {
          id: `ai_photo_${Date.now()}`,
          sender: aiAccount.displayName,
          body: "这是我现在的主页照片。",
          time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
          isOwn: false,
          isAI: true,
          imageSource: aiAccountPhoto(aiAccount),
        }]);
      }
      if (payload?.assistantStatus === "FAILED") setError("模型服务暂时不可用，消息已保留");
      if (payload?.assistantStatus === "UNAVAILABLE") setError("模型服务未配置，消息已保留");
    } catch (e: unknown) {
      // 发送失败：撤回乐观气泡、恢复草稿并提示，不留假成功。
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      setDraft(userText);
      setError(e instanceof Error ? e.message : "发送失败，请重试");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function sendSticker(item: { code: string; emoji: string; name: string }): Promise<void> {
    if (sending || !convId || blocked) return;
    await send(item.emoji, undefined, item);
  }

  async function chooseImage(source: "CAMERA" | "LIBRARY"): Promise<void> {
    setAttachOpen(false);
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
    setSelectedVideo(undefined);
  }

  // CONVO-ATTACH-001: 点相机图标直进相册。最近 24 张 + 首格拍摄 —— 选图进
  // 已有的预览＋发送链（setSelectedImage → sendImage），拍摄复用 chooseImage
  // 的真链路（权限/取图/报错都在那一边）。空相册也开，开着给拍第一张。
  async function openAlbum(): Promise<void> {
    setStickerOpen(false);
    setAttachOpen(false);
    setError(undefined);
    const permission = await requestPermissionsAsync();
    if (!permission.granted) {
      setError("请允许 Proxy 读取照片");
      return;
    }
    try {
      const found = await new Query()
        .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
        .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
        .limit(24)
        .exe();
      const thumbs = await Promise.all(found.map(async (a) => {
        try {
          const [uri, shape] = await Promise.all([a.getUri(), a.getShape()]);
          if (!uri) return undefined;
          return { uri, width: shape?.width ?? 0, height: shape?.height ?? 0 };
        } catch {
          return undefined; // 云端没下好的图不占位，有几张摆几张
        }
      }));
      setAlbumAssets(thumbs.filter((t): t is { uri: string; width: number; height: number } => t !== undefined));
      setAlbumOpen(true);
    } catch {
      setError("相册打不开，请重试");
    }
  }

  async function chooseVideo(): Promise<void> {
    setAttachOpen(false);
    setError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("请允许 Proxy 读取视频");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], quality: 0.8, selectionLimit: 1 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    setSelectedVideo({ uri: asset.uri, width: asset.width, height: asset.height, ...(asset.duration != null ? { durationMs: asset.duration } : {}), ...(asset.fileName ? { fileName: asset.fileName } : {}), ...(asset.mimeType ? { mimeType: asset.mimeType } : {}) });
    setSelectedImage(undefined);
  }

  async function sendImage(): Promise<void> {
    if (!selectedImage || !convId || sending) return;
    setSending(true);
    setError(undefined);
    setUploadProgress(0);
    try {
      const uploaded = await mediaClient.uploadImage(selectedImage, { onProgress: setUploadProgress });
      const result = await conversationClient.sendImageMessage(convId, uploaded.mediaAssetId, draft, buildProtection(), aiAccount ? `AI_PERSONA:${aiAccount.personaId}` : undefined, activeConvo?.id);
      const secureMeta = secureMetaForSend();
      setMessages((current) => [...current, { id:`image_${Date.now()}`, sender:"你", body:draft.trim(), time:new Date().toLocaleTimeString("zh-CN", {hour:"2-digit", minute:"2-digit"}), isOwn:true, imageUri:selectedImage.uri, ...(secureMeta ? { secureMeta } : {}) }]);
      const payload = parseOperationRef(result);
      const aiMsg = payload?.aiMessage as Record<string, unknown> | undefined;
      if (aiMsg) setMessages((current) => [...current, { id: String(aiMsg.messageId ?? `ai_${Date.now()}`), sender: aiAccount?.displayName ?? "Proxy AI", body: String(aiMsg.body ?? ""), time: new Date().toLocaleTimeString("zh-CN", {hour:"2-digit", minute:"2-digit"}), isOwn:false, isAI:true }]);
      setDraft("");
      setSelectedImage(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片发送失败，请重试");
    } finally {
      setUploadProgress(undefined);
      setSending(false);
    }
  }

  async function sendVideo(): Promise<void> {
    if (!selectedVideo || !convId || sending) return;
    setSending(true);
    setError(undefined);
    setUploadProgress(0);
    try {
      const uploaded = await mediaClient.uploadMedia({ ...selectedVideo, mediaType:"VIDEO", defaultMime:"video/mp4" }, { onProgress:setUploadProgress });
      const result = await conversationClient.sendVideoMessage(convId, uploaded.mediaAssetId, draft, buildProtection(), aiAccount ? `AI_PERSONA:${aiAccount.personaId}` : undefined, activeConvo?.id);
      const secureMeta = secureMetaForSend();
      setMessages((current) => [...current, { id:`video_${Date.now()}`, sender:"你", body:draft.trim(), time:new Date().toLocaleTimeString("zh-CN", {hour:"2-digit", minute:"2-digit"}), isOwn:true, videoUri:selectedVideo.uri, ...(secureMeta ? { secureMeta } : {}) }]);
      const payload = parseOperationRef(result);
      const aiMsg = payload?.aiMessage as Record<string, unknown> | undefined;
      if (aiMsg) setMessages((current) => [...current, { id:String(aiMsg.messageId ?? `ai_${Date.now()}`), sender:aiAccount?.displayName ?? "Proxy AI", body:String(aiMsg.body ?? ""), time: new Date().toLocaleTimeString("zh-CN", {hour:"2-digit", minute:"2-digit"}), isOwn:false, isAI:true }]);
      setDraft("");
      setSelectedVideo(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "视频发送失败，请重试");
    } finally {
      setUploadProgress(undefined);
      setSending(false);
    }
  }

  // CONTACT-CARD-001: 把 picker 里选中的名片发出去。走 conversationClient
  // 现成的 sendContactMessage（CONTACT 类型，空 body 本地先挡），本地气泡复用
  // 收到 CONTACT 时同一套解码（parseContactCard → contact/contactVcard）。
  async function sendContactCard(option: ContactCardOption): Promise<void> {
    if (cardBusy || !convId || blocked) return;
    setCardBusy(true);
    setError(undefined);
    try {
      const contact = parseContactCard(option.vcard);
      await conversationClient.sendContactMessage(convId, option.vcard, buildProtection(), aiAccount ? `AI_PERSONA:${aiAccount.personaId}` : undefined, activeConvo?.id);
      const secureMeta = secureMetaForSend();
      setMessages((current) => [...current, { id: `contact_${Date.now()}`, sender: "你", body: contact ? (contact.handle ? `@${contact.handle}` : contact.name) : option.name, time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }), isOwn: true, ...(contact ? { contact, contactVcard: option.vcard } : {}), ...(secureMeta ? { secureMeta } : {}) }]);
      setCardPickerOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "名片发送失败，请重试");
    } finally {
      setCardBusy(false);
    }
  }

  async function sendAudio(): Promise<void> {
    if (!selectedAudio || !convId || sending) return;
    setSending(true);
    setError(undefined);
    setUploadProgress(0);
    try {
      const uploaded = await mediaClient.uploadMedia({ uri:selectedAudio.uri, width:0, height:0, durationMs:selectedAudio.durationMs, mediaType:"AUDIO", defaultMime:"audio/m4a" }, { onProgress:setUploadProgress });
      await conversationClient.sendAudioMessage(convId, uploaded.mediaAssetId, buildProtection(), aiAccount ? `AI_PERSONA:${aiAccount.personaId}` : undefined, activeConvo?.id);
      const secureMeta = secureMetaForSend();
      setMessages((current) => [...current, { id:`audio_${Date.now()}`, sender:"你", body:"", time:new Date().toLocaleTimeString("zh-CN", {hour:"2-digit", minute:"2-digit"}), isOwn:true, audioUri:selectedAudio.uri, ...(secureMeta ? { secureMeta } : {}) }]);
      setSelectedAudio(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "语音发送失败，请重试");
    } finally {
      setUploadProgress(undefined);
      setSending(false);
    }
  }

  async function deleteOwnMessage(messageId: string): Promise<void> {
    setError(undefined);
    try {
      await conversationClient.deleteMessage(messageId);
      setMessages((current) => current.filter((message) => message.id !== messageId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败，请重试");
    }
  }

  async function openForwardSheet(target: Message): Promise<void> {
    setForwardFor(target);
    setForwardInbox(undefined);
    setForwardError(undefined);
    try {
      const items = await conversationClient.listConversations();
      setForwardInbox(items.filter((item) => item.conversation.conversationId !== convId));
    } catch (e: unknown) {
      setForwardError(e instanceof Error ? e.message : "会话列表加载失败");
    }
  }

  async function forwardTo(targetConversationId: string): Promise<void> {
    if (!forwardFor || forwardBusy) return;
    setForwardBusy(true);
    setForwardError(undefined);
    try {
      await conversationClient.forwardMessage(forwardFor.id, targetConversationId);
      setForwardFor(null);
      showToast("已转发");
    } catch (e: unknown) {
      setForwardError(e instanceof Error ? e.message : "转发失败，请重试");
    } finally {
      setForwardBusy(false);
    }
  }

  function toggleReaction(messageId: string, emoji: string): void {    setReactions((prev) => {
      const current = prev[messageId] ?? [];
      const next = current.includes(emoji) ? current.filter((e) => e !== emoji) : [...current, emoji];
      if (next.length === 0) {
        const rest = { ...prev };
        delete rest[messageId];
        return rest;
      }
      return { ...prev, [messageId]: next };
    });
  }

  const menuMsg = menuMessage;
  const menuReactions = menuMsg ? reactions[menuMsg.id] ?? [] : [];
  const secureOn = burn !== "off";
  const canSend = (!!draft.trim() || !!selectedImage || !!selectedVideo || !!selectedAudio) && !sending && !!convId && !blocked;

  function peerAvatar(message: Message): React.JSX.Element | null {
    if (message.isOwn) return null;
    if (aiAccount) {
      return <ExpoImage accessibilityLabel={`${aiAccount.displayName}头像`} cachePolicy="memory-disk" contentFit="cover" recyclingKey={`avatar:ai:${aiAccount.accountId ?? aiAccount.displayName}`} source={aiAccountPhoto(aiAccount)} style={styles.avatarMini} transition={0} />;
    }
    if (peerAvatarSource) return <ExpoImage accessibilityLabel={`${author}头像`} cachePolicy="memory-disk" contentFit="cover" recyclingKey={`avatar:peer:${convId ?? author}`} source={peerAvatarSource} style={styles.avatarMini} transition={0} />;
    return (
      <View style={styles.avatarFallback}>
        <Text style={styles.avatarFallbackText}>{(message.sender || author || "对").slice(0, 1)}</Text>
      </View>
    );
  }

  function renderBubbleContent(message: Message): React.JSX.Element {
    if (message.isDivider) {
      return <View style={styles.homeDivider}><View style={styles.homeDividerLine} /><Text style={styles.homeDividerText}>{message.body}</Text><View style={styles.homeDividerLine} /></View>;
    }
    // 贴纸：单 emoji 文本按大表情渲染（OpenMoji 字形直出，离线可用）。
    const stickerEmoji = message.stickerCode
      ? (STICKERS.find((s) => s.code === message.stickerCode)?.emoji ?? message.body)
      : (!message.imageUri && !message.videoUri && !message.audioUri && !message.location && !message.contact && isSingleEmoji(message.body) ? message.body : undefined);
    if (stickerEmoji && !message.imageUri && !message.videoUri && !message.audioUri && !message.location && !message.contact) {
      return (
        <View style={styles.stickerMessage}>
          <Text style={styles.stickerGlyph}>{stickerEmoji}</Text>
          <Text style={styles.stickerMsgMeta}>{message.time}{message.secureMeta ? ` ${message.secureMeta}` : ""}</Text>
        </View>
      );
    }
    return (
      <View style={[styles.bubble, message.isOwn ? styles.bubbleMe : styles.bubblePeer]}>
        {message.replySender ? (
          <View style={styles.replyInside}>
            <Text style={styles.replyInsideName}>回复 {message.replySender}</Text>
            <Text numberOfLines={2} style={styles.replyInsideBody}>{message.replyBody ?? ""}</Text>
          </View>
        ) : null}
        {message.imageUri || message.imageSource ? <ExpoImage accessibilityLabel="聊天图片" cachePolicy="memory-disk" contentFit="cover" recyclingKey={`chat:image:${message.id}`} source={message.imageSource ?? { uri:message.imageUri ?? "" }} style={styles.messageImage} transition={0} /> : null}
        {message.videoUri ? <ChatVideo uri={message.videoUri} /> : null}
        {message.audioUri ? <ChatAudio uri={message.audioUri} /> : null}
        {message.location ? (
          <View style={styles.locationCard}>
            <Text style={styles.locationTitle}>📍 {message.location.label ?? "位置共享"}</Text>
            <Text style={styles.locationCoord}>{message.location.lat.toFixed(5)}, {message.location.lng.toFixed(5)}</Text>
            {/* MEETUP-NAV-001: 查看是图钉（认地方），导航是路线（走过去）。
                iOS 进 Apple Maps、Android 进 Google Maps —— 两家各自的官方
                directions scheme，免 key 免依赖，打不开明说。 */}
            <View style={styles.locationActionRow}>
              <Pressable
                accessibilityLabel="查看位置"
                onPress={() => {
                  const urls = meetupMapsUrls(message.location!);
                  if (!urls) {
                    setError("这个位置打不开，坐标无效");
                    return;
                  }
                  const url = Platform.OS === "ios" ? urls.apple : urls.google;
                  void Linking.openURL(url).catch(() => setError("打不开地图应用，请重试"));
                }}
                style={styles.locationOpen}
              >
                <Text style={styles.locationOpenText}>查看</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="导航去这里"
                onPress={() => {
                  const urls = meetupDirectionsUrls(message.location!);
                  if (!urls) {
                    setError("这个位置打不开，坐标无效");
                    return;
                  }
                  const url = Platform.OS === "ios" ? urls.apple : urls.google;
                  void Linking.openURL(url).catch(() => setError("打不开导航，请重试"));
                }}
                style={[styles.locationOpen, styles.locationNav]}
              >
                <Text style={styles.locationNavText}>导航去这里 ›</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {message.contact ? (
          <Pressable
            accessibilityLabel={`名片 ${message.contact.name}`}
            onPress={() => {
              // 收不到原文就不放大：画一张空码比不弹更糟（用户会以为扫不出来是自己的问题）。
              if (!message.contactVcard) {
                setError("这张名片内容不完整，无法展示二维码");
                return;
              }
              setContactZoom({
                vcard: message.contactVcard,
                caption: message.contact?.handle ? `@${message.contact.handle}` : (message.contact?.name ?? ""),
                title: `${message.contact?.name ?? ""} 的名片`,
              });
            }}
            style={styles.contactCard}
          >
            <View style={styles.contactBadge}>
              <Text style={styles.contactBadgeText}>{message.contact.name.slice(0, 1)}</Text>
            </View>
            <View style={styles.contactCopy}>
              <Text numberOfLines={1} style={styles.contactName}>{message.contact.name}</Text>
              <Text numberOfLines={1} style={styles.contactHandle}>
                {message.contact.handle ? `@${message.contact.handle}` : "店铺名片"}
              </Text>
            </View>
            <Text style={styles.contactCta}>二维码 ›</Text>
          </Pressable>
        ) : null}
        {message.body.trim() ? <Text style={styles.bubbleText}>{message.body}</Text> : null}
        <View style={styles.bubbleMetaRow}>
          {message.secureMeta ? <Text style={styles.secureMeta}>{message.secureMeta}</Text> : null}
          <Text style={styles.timeInline}>{message.time}</Text>
        </View>
      </View>
    );
  }

  return (
    <SwipeBackShell onExit={activeConvo ? () => setActiveConvo(null) : onBack}>
      <View style={[styles.root, keyboardInset > 0 && { paddingBottom: keyboardInset }]}>
        {/* R36.1 顶栏：返回 / 对方 / 安全盾 / 头像；分支内返回先回主线 */}
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={activeConvo ? "返回主线" : "返回"}
            onPress={() => { if (activeConvo) setActiveConvo(null); else onBack(); }}
            style={styles.backBtn}
          >
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <View style={styles.headerInfo}>
            <Text style={styles.headerName}>{activeConvo ? `支线 · ${activeConvo.title}` : author}</Text>
            <Text style={styles.headerStatus}>{aiAccount ? `AI 虚拟 · ${aiAccount.role}` : convId ? "已连接" : "连接中..."}</Text>
          </View>
          <Pressable
            accessibilityLabel={secureOn ? "安全对话已开启" : "安全对话设置"}
            onPress={() => { setStickerOpen(false); setSecureSheetOpen(true); }}
            style={[styles.secureBtn, secureOn && styles.secureBtnActive]}
          >
            <Text style={[styles.secureBtnText, secureOn && styles.secureBtnTextActive]}>🛡</Text>
          </Pressable>
          {aiAccount || peerAvatarSource ? (
            <ExpoImage accessibilityLabel={`${aiAccount?.displayName ?? author}头像`} cachePolicy="memory-disk" contentFit="cover" recyclingKey={`avatar:top:${aiAccount?.accountId ?? convId ?? author}`} source={aiAccount ? aiAccountPhoto(aiAccount) : peerAvatarSource!} style={styles.topAvatar} transition={0} />
          ) : (
            <View style={styles.topAvatarFallback}>
              <Text style={styles.topAvatarFallbackText}>{(author || "对").slice(0, 1)}</Text>
            </View>
          )}
          <Pressable accessibilityLabel="会话设置" onPress={() => setConversationMenuOpen((value) => !value)} style={styles.headerAction}>
            <Text style={styles.headerActionText}>•••</Text>
          </Pressable>
        </View>

        {pinned ? (
          <View style={styles.pinStrip}>
            <Text style={styles.pinGlyph}>⌁</Text>
            <Text numberOfLines={1} style={styles.pinCopy}>置顶：{pinned.body}</Text>
            <Pressable accessibilityLabel="取消置顶" onPress={() => setPinned(null)} style={styles.pinClose}>
              <Text style={styles.pinCloseText}>×</Text>
            </Pressable>
          </View>
        ) : null}

        {searchOpen ? <View style={styles.chatSearch}><TextInput autoFocus onChangeText={setSearchQuery} placeholder="搜索此对话" placeholderTextColor={lotus.muted} style={styles.chatSearchInput} value={searchQuery} /><Text style={styles.searchCount}>{visibleMessages.length} 条</Text><Pressable onPress={() => { setSearchOpen(false); setSearchQuery(""); }}><Text style={styles.searchClose}>取消</Text></Pressable></View> : null}
        {conversationMenuOpen ? <View style={styles.conversationMenu}>
          <Pressable onPress={() => { setSearchOpen(true); setConversationMenuOpen(false); }} style={styles.menuRow}><Text style={styles.menuRowText}>搜索对话</Text></Pressable>
          <Pressable onPress={() => { setMessages([]); setConversationMenuOpen(false); }} style={styles.menuRow}><Text style={styles.menuRowText}>清空本机显示</Text></Pressable>
          <Pressable onPress={() => void (async () => { if (!convId) return; try { await conversationClient.setConversationBlocked(convId, !blocked); setBlocked((value) => !value); } catch { setError("屏蔽状态更新失败"); } finally { setConversationMenuOpen(false); } })()} style={styles.menuRow}><Text style={[styles.menuRowText, styles.menuDanger]}>{blocked ? "解除屏蔽" : "屏蔽此会话"}</Text></Pressable>
          <Text style={styles.menuHint}>屏蔽状态会保存到服务端；屏蔽后不可继续发送消息。</Text>
        </View> : null}

        {activeConvo && seedMsg ? (
          <View style={styles.seedCard} accessibilityLabel="支线来源消息">
            <Text style={styles.seedLabel}>支线源自 · {seedMsg.sender}</Text>
            <Text style={styles.seedBody} numberOfLines={2}>{seedMsg.body}</Text>
          </View>
        ) : null}

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={styles.messageList}
          contentContainerStyle={styles.messageContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {loading ? <Text style={styles.systemEvent}>正在创建会话...</Text> : null}
          {aiAccount && !loading ? <Text style={styles.systemEvent}>AI 虚拟女孩 · 陪伴聊天与内容创作，不是平台业务助手，也没有现实身体。</Text> : null}
          {error ? (
            <View style={styles.systemEventWrap}>
              <Text style={styles.systemEvent}>{error}</Text>
              {!convId && !loading ? <Pressable onPress={() => { setError(undefined); setLoading(true); setConnectAttempt((value) => value + 1); }} style={styles.retryButton}><Text style={styles.retryButtonText}>重新连接</Text></Pressable> : null}
            </View>
          ) : null}
          {blocked ? <Text style={styles.systemEvent}>此会话已在本机屏蔽，可从右上角解除。</Text> : null}
          {visibleMessages.length > 0 ? <Text style={styles.dayDivider}>今天</Text> : null}
          {blocked ? null : clusters.map((cluster) => {
            const first = cluster.messages[0];
            if (!first) return null;
            if (first.isDivider) return <View key={cluster.key}>{renderBubbleContent(first)}</View>;
            if (first.v1) {
              return (
                <View key={cluster.key} style={[styles.v1Wrap, cluster.isOwn ? styles.v1Own : styles.v1Other]}>
                  {!cluster.isOwn && <Text style={styles.clusterSender}>{cluster.sender}</Text>}
                  <MessageRenderer message={first.v1} />
                  <Text style={styles.v1Time}>{first.time}</Text>
                </View>
              );
            }
            return (
              <View key={cluster.key} style={styles.cluster}>
                {cluster.messages.map((msg, index) => {
                  const isFirst = index === 0;
                  const isLast = index === cluster.messages.length - 1;
                  const itemReactions = reactions[msg.id] ?? [];
                  return (
                    <View key={msg.id} style={[styles.msgRow, msg.isOwn ? styles.msgRowMe : styles.msgRowPeer]}>
                      {!msg.isOwn ? (
                        <View style={styles.avatarSlot}>{isLast ? peerAvatar(msg) : null}</View>
                      ) : null}
                      <View style={[styles.stack, msg.isOwn && styles.stackMe]}>
                        {!msg.isOwn && isFirst ? <Text style={styles.clusterSender}>{cluster.sender}</Text> : null}
                        <Pressable
                          accessibilityHint={msg.isOwn ? "长按管理消息" : "长按管理消息"}
                          onLongPress={() => setMenuMessage(msg)}
                          delayLongPress={420}
                          style={[
                            styles.bubbleHit,
                            msg.isOwn
                              ? [styles.bubbleAlignMe, isFirst ? styles.firstMe : null, isLast ? styles.lastMe : null]
                              : [styles.bubbleAlignPeer, isFirst ? styles.firstPeer : null, isLast ? styles.lastPeer : null],
                          ]}
                        >
                          {renderBubbleContent(msg)}
                        </Pressable>
                        {itemReactions.length > 0 ? (
                          <View style={styles.reactionChip}>
                            <Text style={styles.reactionChipText}>{itemReactions.join("")} {itemReactions.length}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}
          {sending && aiAccount ? <View style={styles.aiTypingRow}><ActivityIndicator color={lotus.goldtext} size="small" /><Text style={styles.aiTypingText}>{aiAccount.displayName} 正在回复…</Text></View> : null}
          {temporaryUI ? <ServerTemporaryForm disabled={sending} onSubmit={(summary) => void send(`我的补充信息：${summary}`, temporaryUI.id)} spec={temporaryUI} /> : null}
        </ScrollView>

        {/* R36.1 安全条：burn 开启时显示 */}
        {secureOn ? (
          <View style={styles.secureStrip}>
            <Text style={styles.secureStripText}>🔥 阅后 {BURN_LABEL[burn]} 消失{noForward ? " · 禁止转发" : ""}</Text>
          </View>
        ) : null}

        {/* R36.1 回复预览 */}
        {replyTo ? (
          <View style={styles.replyPreview}>
            <View style={styles.replyLine} />
            <View style={styles.replyCopy}>
              <Text style={styles.replyCopyName}>回复 {replyTo.sender}</Text>
              <Text numberOfLines={1} style={styles.replyCopyBody}>{replyTo.body}</Text>
            </View>
            <Pressable accessibilityLabel="取消回复" onPress={() => setReplyTo(null)} style={styles.replyClose}>
              <Text style={styles.replyCloseText}>×</Text>
            </Pressable>
          </View>
        ) : null}

        {/* R36.1 表情包 Drawer（OpenMoji 字形直出） */}
        {stickerOpen ? (
          <View style={styles.stickerDrawer}>
            <View style={styles.stickerHead}>
              <Text style={styles.stickerHeadTitle}>表情包</Text>
              <Text style={styles.stickerHeadSub}>OpenMoji</Text>
            </View>
            <View style={styles.stickerGrid}>
              {STICKERS.map((item) => (
                <Pressable key={item.code} accessibilityLabel={`发送表情 ${item.name}`} disabled={sending || !convId || blocked} onPress={() => void sendSticker(item)} style={styles.stickerItem}>
                  <Text style={styles.stickerItemGlyph}>{item.emoji}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.stickerCredit}>OpenMoji · CC BY-SA 4.0</Text>
          </View>
        ) : null}

        {/* Footer remains in normal layout; root padding follows the keyboard. */}
        <View style={[styles.composerShell, { paddingBottom: keyboardInset > 0 ? 10 : Math.max(insets.bottom, 16) }]}>
          {selectedImage ? <View style={styles.imagePreviewRow}><Image source={{uri:selectedImage.uri}} style={styles.imagePreview} /><Text numberOfLines={1} style={styles.imagePreviewText}>{uploadProgress === undefined ? (selectedImage.fileName ?? "已选择图片") : `上传 ${Math.round(uploadProgress * 100)}%`}</Text><Pressable accessibilityLabel="移除图片" onPress={() => setSelectedImage(undefined)}><Text style={styles.imageRemove}>×</Text></Pressable></View> : null}
          {selectedVideo ? <View style={styles.imagePreviewRow}><Text style={styles.videoPreviewIcon}>▶</Text><Text numberOfLines={1} style={styles.imagePreviewText}>{uploadProgress === undefined ? (selectedVideo.fileName ?? "已选择视频") : `上传 ${Math.round(uploadProgress * 100)}%`}</Text><Pressable accessibilityLabel="移除视频" onPress={() => setSelectedVideo(undefined)}><Text style={styles.imageRemove}>×</Text></Pressable></View> : null}
          {selectedAudio ? <View style={styles.imagePreviewRow}><Text style={styles.videoPreviewIcon}>♪</Text><Text numberOfLines={1} style={styles.imagePreviewText}>{uploadProgress === undefined ? `语音 ${Math.max(1, Math.round(selectedAudio.durationMs / 1000))} 秒` : `上传 ${Math.round(uploadProgress * 100)}%`}</Text><Pressable accessibilityLabel="移除语音" onPress={() => setSelectedAudio(undefined)}><Text style={styles.imageRemove}>×</Text></Pressable></View> : null}
          {/* Composer — R36.1：+ / 输入 pill（贴纸·相机内置）/ mic-or-send */}
          <View style={styles.composer}>
            <Pressable accessibilityLabel="添加附件" onPress={() => { setStickerOpen(false); setAttachOpen((open) => !open); }} disabled={sending || !convId} style={styles.attachBtn}>
              <Text style={styles.attachBtnText}>＋</Text>
            </Pressable>
            <View style={styles.inputWrap}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={convId ? (aiAccount ? `和${aiAccount.displayName}聊聊…` : "消息") : "连接中..."}
                placeholderTextColor={lotus.muted}
                style={styles.composerInput}
                multiline
                editable={!!convId && !sending}
              />
              <Pressable accessibilityLabel="表情包" onPress={() => { setAttachOpen(false); setStickerOpen((open) => !open); }} disabled={sending || !convId} style={styles.inlineTool}>
                <Text style={styles.inlineToolText}>☺</Text>
              </Pressable>
              {/* CONVO-ATTACH-001: 相机图标点下去直接就是相册（Lotus 式）—— 首格拍摄，
                  后面是最新照片。拍照也不经＋面板：相册首格就是拍摄。 */}
              <Pressable accessibilityLabel="相册" onPress={() => void openAlbum()} disabled={sending || !convId} style={styles.inlineTool}>
                <ProxyIcon color={lotus.ink} name="camera" size={24} />
              </Pressable>
            </View>
            {canSend || sending ? (
              <Pressable
                accessibilityLabel="发送"
                disabled={!canSend}
                onPress={() => void (selectedAudio ? sendAudio() : selectedVideo ? sendVideo() : selectedImage ? sendImage() : send())}
                style={[styles.sendCircle, !canSend && styles.sendCircleDisabled]}
              >
                <Text style={styles.sendCircleText}>{sending ? "…" : "↑"}</Text>
              </Pressable>
            ) : (
              <View style={styles.micSlot}>
                <VoiceToolButton disabled={sending || !convId || blocked} onDone={(recording) => { setSelectedAudio(recording); setSelectedImage(undefined); setSelectedVideo(undefined); }} />
              </View>
            )}
          </View>
        </View>
      </View>

      {/* 附件 sheet：名片 / 视频 / 活动 / 位置。
          CONVO-ATTACH-001：照片和拍照**都不在这里** —— 都在输入框的相机图标上，
          点图标直进相册（首格就是拍摄）。以前＋ 弹出来要点两次才到照片。 */}
      {attachOpen ? (
        <Pressable accessibilityLabel="关闭附件选择" onPress={() => setAttachOpen(false)} style={styles.scrim}>
          <Pressable onPress={() => undefined} style={styles.bottomSheet}>
            <View style={styles.sheetGrab} />
            <Pressable accessibilityLabel="发送名片" onPress={() => { setAttachOpen(false); setCardPickerOpen(true); }} style={styles.sheetItem}><Text style={styles.sheetItemText}>名片</Text></Pressable>
            <Pressable onPress={() => void chooseVideo()} style={styles.sheetItem}><Text style={styles.sheetItemText}>视频</Text></Pressable>
            {!aiAccount ? <Pressable onPress={() => void openActivityPicker()} style={styles.sheetItem}><Text style={styles.sheetItemText}>Proxy 活动</Text></Pressable> : null}
            {!aiAccount ? <Pressable accessibilityLabel="发送位置" onPress={() => { setAttachOpen(false); setLocationSheetOpen(true); }} style={styles.sheetItem}><Text style={styles.sheetItemText}>📍 位置</Text></Pressable> : null}
          </Pressable>
        </Pressable>
      ) : null}

      {/* CONVO-ATTACH-001: 自建相册 —— 首格拍摄，后面最新照片。选图进已有
          的预览＋发送链，拍摄复用 chooseImage("CAMERA")。空相册也开，
          开着给拍第一张；关掉走 scrim，和别的 sheet 一个手势。 */}
      {albumOpen ? (
        <Pressable accessibilityLabel="关闭相册选择" onPress={() => setAlbumOpen(false)} style={styles.scrim}>
          <Pressable onPress={() => undefined} style={styles.bottomSheet}>
            <View style={styles.sheetGrab} />
            <ScrollView contentContainerStyle={styles.albumGrid}>
              <Pressable accessibilityLabel="拍摄" onPress={() => { setAlbumOpen(false); void chooseImage("CAMERA"); }} style={styles.albumTile}>
                <ProxyIcon color={lotus.ink} name="camera" size={26} />
                <Text style={styles.albumTileText}>拍摄</Text>
              </Pressable>
              {albumAssets.map((a) => (
                <Pressable key={a.uri} accessibilityLabel="选择这张照片" onPress={() => { setSelectedImage({ uri: a.uri, width: a.width, height: a.height }); setSelectedVideo(undefined); setAlbumOpen(false); }} style={styles.albumTile}>
                  <ExpoImage accessibilityLabel="相册照片" cachePolicy="memory-disk" contentFit="cover" recyclingKey={`album:${a.uri}`} source={{ uri: a.uri }} style={styles.albumThumb} transition={0} />
                </Pressable>
              ))}
            </ScrollView>
            {albumAssets.length === 0 ? <Text style={styles.albumEmpty}>相册是空的，先拍一张吧</Text> : null}
          </Pressable>
        </Pressable>
      ) : null}

      {/* R17.x: activity picker sheet. 从 server listActivities() 选真活动 */}
      {activityPickerOpen ? (
        <Pressable accessibilityLabel="关闭活动选择" onPress={() => setActivityPickerOpen(false)} style={styles.scrim}>
          <Pressable onPress={() => undefined} style={styles.bottomSheet}>
            <View style={styles.sheetGrab} />
            <Text style={styles.pickerTitle}>选一个活动</Text>
            <Text style={styles.pickerSub}>选中的活动会作为代理卡片发到对话</Text>
            {activityPickerError ? <Text style={styles.pickerError}>{activityPickerError}</Text> : null}
            {activityOptions === undefined ? <ActivityIndicator color={lotus.goldtext} /> : activityOptions.length === 0 ? <Text style={styles.pickerSub}>本周暂无开放活动。</Text> : (
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

      {/* MEETUP-SHARE-001 seg4: 复用 LocationPickerSheet 发位置。
          地图选点 / 拖拽限 3KM / 复制地址 / Google 打开 / 历史收藏全是现成的；
          只有带真坐标的结果才发，无坐标（预设地点）fail-closed 并指路。 */}
      {locationSheetOpen ? (
        <LocationPickerSheet
          open={locationSheetOpen}
          current={DEFAULT_LOCATION}
          baseUrl={conversationClient.baseUrl}
          onSelect={(next) => void sendLocationFromPicker(next)}
          onClose={() => setLocationSheetOpen(false)}
        />
      ) : null}

      {/* CONTACT-CARD-001: 选一张名片发进对话。
          第一张永远是「我的名片」，下面是服务端好友里**能解析出 handle** 的那些 ——
          handle 不在好友列表里时宁可不列（见 loadCardOptions），绝不发一张扫了
          落不到人的卡。 */}
      {cardPickerOpen ? (
        <Pressable accessibilityLabel="关闭名片选择" onPress={() => setCardPickerOpen(false)} style={styles.scrim}>
          <Pressable onPress={() => undefined} style={styles.bottomSheet}>
            <View style={styles.sheetGrab} />
            <Text style={styles.pickerTitle}>发一张名片</Text>
            <Text style={styles.pickerSub}>对方可以直接存下，也可以点开用相机扫</Text>
            {cardPickerError ? <Text style={styles.pickerError}>{cardPickerError}</Text> : null}
            {cardOptions === undefined ? <ActivityIndicator color={lotus.goldtext} /> : cardOptions.length === 0 ? <Text style={styles.pickerSub}>还没有可用的名片。</Text> : (
              <ScrollView style={styles.pickerList}>
                {cardOptions.map((option) => (
                  <Pressable key={option.key} accessibilityLabel={`发送 ${option.name} 的名片`} disabled={cardBusy} onPress={() => void sendContactCard(option)} style={styles.pickerItem}>
                    <Text style={styles.pickerItemTitle}>{option.name}</Text>
                    <Text style={styles.pickerItemSub}>{option.caption}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable onPress={() => setCardPickerOpen(false)} style={styles.pickerCancel}>
              <Text style={styles.pickerCancelText}>取消</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      ) : null}

      {/* CONTACT-CARD-001: 名片点开就是一张码。复用全 App 共用的 QrZoomOverlay
          （进层拉满亮度、退出还原都现成），不自己再搭一个 Modal。 */}
      {contactZoom ? (
        <QrZoomOverlay
          visible
          onClose={() => setContactZoom(undefined)}
          value={contactZoom.vcard}
          caption={contactZoom.caption}
          title={contactZoom.title}
          hint="把屏幕朝向对方即可扫描；也可以存成图片转发给第三个人。"
        />
      ) : null}

      {/* 长按菜单：reactions + 回复 / 创建 Convo / 转发 / 置顶 / 删除 */}
      {menuMsg ? (
        <Pressable accessibilityLabel="关闭消息菜单" onPress={() => setMenuMessage(null)} style={styles.scrim}>
          <Pressable onPress={() => undefined} style={styles.bottomSheet}>
            <View style={styles.sheetGrab} />
            <View style={styles.reactionsRow}>
              {MENU_REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  accessibilityLabel={`回应 ${emoji}`}
                  onPress={() => { toggleReaction(menuMsg.id, emoji); setMenuMessage(null); showToast(`已回应 ${emoji}`); }}
                  style={[styles.reactionBtn, menuReactions.includes(emoji) && styles.reactionBtnActive]}
                >
                  <Text style={styles.reactionBtnText}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => { const target = menuMsg; setMenuMessage(null); setReplyTo({ id: target.id, sender: target.sender, body: target.body.slice(0, 60) }); }}
              style={styles.sheetItem}
            >
              <Text style={styles.sheetItemText}>回复</Text><Text style={styles.sheetItemHint}>↩</Text>
            </Pressable>
            <Pressable
              disabled={creatingConvo}
              onPress={() => {
                const target = menuMsg;
                if (!target || creatingConvo) return;
                setMenuMessage(null);
                setCreatingConvo(true);
                void conversationClient.createConvo(target.id).then((convo) => {
                  setActiveConvo({ id: convo.id, title: convo.title });
                  showToast("已创建支线");
                }).catch((error: unknown) => {
                  const reason = error instanceof Error ? error.message : "";
                  showToast(/principal|session|signed|sign in|auth|401|403/i.test(reason) ? "请先登录后再操作。" : "创建支线失败，请重试。");
                }).finally(() => setCreatingConvo(false));
              }}
              style={styles.sheetItem}
              accessibilityLabel="从这条消息创建支线讨论"
            >
              <Text style={styles.sheetItemText}>{creatingConvo ? "创建中…" : "创建 Convo"}</Text><Text style={styles.sheetItemHint}>›</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const target = menuMsg;
                setMenuMessage(null);
                if (noForward) {
                  showToast("此安全会话禁止转发");
                  return;
                }
                openForwardSheet(target);
              }}
              style={styles.sheetItem}
            >
              <Text style={[styles.sheetItemText, noForward && styles.sheetItemDisabled]}>转发</Text><Text style={styles.sheetItemHint}>›</Text>
            </Pressable>
            <Pressable
              onPress={() => { const target = menuMsg; setMenuMessage(null); setPinned({ id: target.id, body: target.body.slice(0, 40) }); showToast("已置顶"); }}
              style={styles.sheetItem}
            >
              <Text style={styles.sheetItemText}>置顶</Text><Text style={styles.sheetItemHint}>›</Text>
            </Pressable>
            <Pressable
              onPress={() => { const target = menuMsg; setMenuMessage(null); setReportFor(target); }}
              style={styles.sheetItem}
              accessibilityLabel="举报这条消息"
            >
              <Text style={styles.sheetItemText}>举报</Text><Text style={styles.sheetItemHint}>›</Text>
            </Pressable>
            {menuMsg.isOwn ? (
              <Pressable onPress={() => { const target = menuMsg; setMenuMessage(null); void deleteOwnMessage(target.id); }} style={styles.sheetItem}>
                <Text style={[styles.sheetItemText, styles.menuDanger]}>删除</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      ) : null}

      {/* COMP-REPORT-002: 举报这条消息。原因清单与各入口共用 ReportSheet，
          理由排序（SOLICITATION / MINOR_SAFETY 在最前）也在那里统一维护。 */}
      {reportFor ? (
        <ReportSheet
          moderation={moderationClient}
          targetType="MESSAGE"
          targetId={reportFor.id}
          title="举报这条消息"
          {...(reportFor.body ? { subtitle: reportFor.body.slice(0, 40) } : {})}
          onClose={() => setReportFor(null)}
          onDone={() => { setReportFor(null); showToast("举报已提交，平台将按审核流程处理。"); }}
        />
      ) : null}

      {/* 转发目标选择：真调 ForwardMessage，有加载/空态/错误态 */}
      {forwardFor ? (
        <Pressable accessibilityLabel="关闭转发选择" onPress={() => { if (!forwardBusy) setForwardFor(null); }} style={styles.scrim}>
          <Pressable onPress={() => undefined} style={styles.bottomSheet}>
            <View style={styles.sheetGrab} />
            <Text style={styles.sheetItemText}>转发给…</Text>
            <Text style={styles.sheetItemHint} numberOfLines={1}>{forwardFor.body.slice(0, 40)}</Text>
            {forwardInbox === undefined && !forwardError ? <ProxyLoading tone="muted" style={{ marginVertical: 12 }} /> : null}
            {forwardError ? <Text style={styles.menuDanger}>{forwardError}</Text> : null}
            {(forwardInbox ?? []).map((item) => {
              const targetId = item.conversation.conversationId;
              const name = item.counterpartySnapshot?.displayName ?? item.counterpartyId ?? targetId.slice(0, 8);
              return (
                <Pressable
                  key={targetId}
                  disabled={forwardBusy}
                  onPress={() => void forwardTo(targetId)}
                  style={styles.sheetItem}
                >
                  <Text style={styles.sheetItemText} numberOfLines={1}>{name}</Text>
                  <Text style={styles.sheetItemHint}>{forwardBusy ? "…" : "›"}</Text>
                </Pressable>
              );
            })}
            {forwardInbox !== undefined && forwardInbox.length === 0 && !forwardError ? (
              <Text style={styles.sheetItemHint}>没有可转发的会话</Text>
            ) : null}
          </Pressable>
        </Pressable>
      ) : null}

      {/* R36.1 安全设置 sheet */}
      {secureSheetOpen ? (
        <Pressable accessibilityLabel="关闭安全设置" onPress={() => setSecureSheetOpen(false)} style={styles.scrim}>
          <Pressable onPress={() => undefined} style={styles.bottomSheet}>
            <View style={styles.sheetGrab} />
            <View style={styles.secureHead}>
              <View>
                <Text style={styles.secureHeadTitle}>安全对话</Text>
                <Text style={styles.secureHeadSub}>只影响这个会话</Text>
              </View>
              <Pressable accessibilityLabel="关闭" onPress={() => setSecureSheetOpen(false)} style={styles.sheetClose}>
                <Text style={styles.sheetCloseText}>×</Text>
              </Pressable>
            </View>
            <Text style={styles.secureCopyTitle}>阅后即焚</Text>
            <Text style={styles.secureCopySub}>对方阅读后开始计时；历史普通消息不受影响</Text>
            <View style={styles.timerGrid}>
              {BURN_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setBurn(option)}
                  style={[styles.timerOpt, burn === option && styles.timerOptActive]}
                >
                  <Text style={[styles.timerOptText, burn === option && styles.timerOptTextActive]}>{BURN_LABEL[option]}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.secureCopyTitle}>禁止转发</Text>
                <Text style={styles.secureCopySub}>开启后，这个会话里的消息不能通过 Proxy 转发</Text>
              </View>
              <ProxySwitch accessibilityLabel="禁止转发开关" onChange={setNoForward} value={noForward} />
            </View>
            <Text style={styles.secureNote}>阅后即焚用阅读计数加过期时间执行；禁止转发由服务端拒绝转发请求。此会话已开启截屏上报。</Text>
          </Pressable>
        </Pressable>
      ) : null}

      {toast ? (
        <View pointerEvents="none" style={styles.toastWrap}>
          <Text style={styles.toast}>{toast}</Text>
        </View>
      ) : null}
    </SwipeBackShell>
  );
}

function ChatVideo({ uri }: { uri: string }): React.JSX.Element {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.muted = false;
  });
  return <VideoView accessibilityLabel="聊天视频" contentFit="cover" fullscreenOptions={{ enable:true }} nativeControls player={player} style={styles.messageVideo} />;
}

function ChatAudio({ uri }: { uri: string }): React.JSX.Element {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const player = createAudioPlayer({ uri });
    playerRef.current = player;
    const subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) setPlaying(false);
    });
    return () => { subscription.remove(); player.remove(); playerRef.current = null; };
  }, [uri]);
  return (
    <Pressable accessibilityLabel={playing ? "暂停语音" : "播放语音"} onPress={() => { const player = playerRef.current; if (!player) return; if (playing) player.pause(); else player.play(); setPlaying(!playing); }} style={styles.audioMessage}>
      <View style={styles.audioPlayBtn}><Text style={styles.audioPlayGlyph}>{playing ? "❚❚" : "▶"}</Text></View>
      <Text style={styles.audioWave}>▂▅▃▇▄▆▂▅▃▄</Text>
      <Text style={styles.audioLabel}>语音</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: lotus.paper, flex: 1 },

  // 顶栏
  header: { alignItems: "center", backgroundColor: lotus.paper, borderBottomColor: lotus.line, borderBottomWidth: 1, flexDirection: "row", gap: 4, paddingHorizontal: 8, paddingVertical: 9 },
  backBtn: { alignItems: "center", height: 36, justifyContent: "center", width: 36 },
  backText: { color: lotus.ink, fontSize: 26, lineHeight: 28 },
  headerInfo: { alignItems: "center", flex: 1 },
  headerName: { color: lotus.ink, fontSize: 13, fontWeight: "800", lineHeight: 15 },
  headerStatus: { color: lotus.muted, fontSize: 11, marginTop: 3 },
  secureBtn: { alignItems: "center", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  secureBtnActive: { backgroundColor: lotus.ink },
  secureBtnText: { fontSize: 17 },
  secureBtnTextActive: { color: "#ffffff" },
  topAvatar: { borderColor: lotus.line, borderRadius: 15, borderWidth: 1, height: 29, width: 29 },
  topAvatarFallback: { alignItems: "center", backgroundColor: lotus.soft, borderColor: lotus.line, borderRadius: 15, borderWidth: 1, height: 29, justifyContent: "center", width: 29 },
  topAvatarFallbackText: { color: lotus.ink, fontSize: 13, fontWeight: "800" },
  headerAction: { alignItems: "center", height: 36, justifyContent: "center", width: 30 },
  headerActionText: { color: lotus.ink, fontSize: 15, fontWeight: "800" },

  // 置顶条
  pinStrip: { alignItems: "center", backgroundColor: "#fffefa", borderBottomColor: lotus.line, borderBottomWidth: 1, flexDirection: "row", gap: 7, paddingHorizontal: 11, paddingVertical: 8 },
  pinGlyph: { color: lotus.muted, fontSize: 11 },
  pinCopy: { color: lotus.muted, flex: 1, fontSize: 11 },
  pinClose: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
  pinCloseText: { color: lotus.faint, fontSize: 16 },

  // 搜索与会话菜单
  chatSearch: { alignItems: "center", backgroundColor: lotus.paper, borderBottomColor: lotus.line, borderBottomWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  chatSearchInput: { backgroundColor: lotus.soft, borderRadius: 12, color: lotus.ink, flex: 1, fontSize: 13, height: 36, paddingHorizontal: 11 },
  searchCount: { color: lotus.muted, fontSize: 11 },
  searchClose: { color: lotus.goldtext, fontSize: 12, fontWeight: "800" },
  conversationMenu: { backgroundColor: lotus.paper, borderBottomColor: lotus.line, borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 4 },
  menuRow: { borderBottomColor: lotus.line, borderBottomWidth: 1, paddingVertical: 11 },
  menuRowText: { color: lotus.ink, fontSize: 13, fontWeight: "700" },
  menuDanger: { color: "#a94b41" },
  menuHint: { color: lotus.muted, fontSize: 11, lineHeight: 15, paddingVertical: 8 },
  seedCard: { backgroundColor: "#F4EFFA", borderColor: "#DDD2EE", borderRadius: 12, borderWidth: 1, marginHorizontal: 14, marginTop: 8, padding: 10 },
  seedLabel: { color: "#6B3ACF", fontSize: 11, fontWeight: "800" },
  seedBody: { color: lotus.ink, fontSize: 12, lineHeight: 17, marginTop: 4 },

  // 消息区
  messageList: { flex: 1 },
  messageContent: { paddingBottom: 20, paddingHorizontal: 10, paddingTop: 12 },
  dayDivider: { color: lotus.faint, fontSize: 11, marginBottom: 15, marginTop: 4, textAlign: "center" },
  systemEvent: { color: "#9a958d", fontSize: 11, lineHeight: 15, marginVertical: 12, paddingHorizontal: 40, textAlign: "center" },
  systemEventWrap: { alignItems: "center", marginVertical: 12 },
  aiTypingRow: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 7, marginBottom: 11, marginLeft: 30, marginTop: 2 },
  aiTypingText: { color: lotus.muted, fontSize: 11 },
  retryButton: { backgroundColor: lotus.ink, borderRadius: 10, marginTop: 8, paddingHorizontal: 14, paddingVertical: 8 },
  retryButtonText: { color: "#ffffff", fontSize: 11, fontWeight: "800" },

  cluster: { marginBottom: 11 },
  homeDivider: { alignItems: "center", flexDirection: "row", gap: 8, marginVertical: 10, paddingHorizontal: 8 },
  homeDividerLine: { backgroundColor: lotus.line, flex: 1, height: StyleSheet.hairlineWidth },
  homeDividerText: { color: lotus.faint, fontSize: 11, fontWeight: "600" },
  msgRow: { alignItems: "flex-end", flexDirection: "row", gap: 6, marginVertical: 1 },
  msgRowMe: { justifyContent: "flex-end", paddingLeft: 52 },
  msgRowPeer: { paddingRight: 52 },
  avatarSlot: { flexBasis: 24, width: 24 },
  avatarMini: { borderRadius: 12, height: 24, width: 24 },
  avatarFallback: { alignItems: "center", backgroundColor: lotus.soft, borderRadius: 12, height: 24, justifyContent: "center", width: 24 },
  avatarFallbackText: { color: lotus.ink, fontSize: 11, fontWeight: "800" },
  stack: { alignItems: "flex-start", flexShrink: 1 },
  stackMe: { alignItems: "flex-end" },
  clusterSender: { color: lotus.muted, fontSize: 11, fontWeight: "700", marginBottom: 3, marginLeft: 2 },
  bubbleHit: { maxWidth: "100%" },
  bubbleAlignMe: { alignItems: "flex-end" },
  bubbleAlignPeer: { alignItems: "flex-start" },
  firstPeer: {},
  lastPeer: {},
  firstMe: {},
  lastMe: {},
  bubble: { backgroundColor: "#ffffff", borderColor: lotus.line, borderRadius: 14, borderWidth: 1, maxWidth: 274, paddingBottom: 6, paddingHorizontal: 10, paddingTop: 7 },
  bubbleMe: { backgroundColor: lotus.out, borderColor: lotus.outLine },
  bubblePeer: {},
  bubbleText: { color: lotus.ink, fontSize: 13, lineHeight: 18 },
  bubbleMetaRow: { alignItems: "center", flexDirection: "row", justifyContent: "flex-end", marginTop: 5 },
  secureMeta: { color: "#966a19", fontSize: 11, marginRight: 4 },
  timeInline: { color: lotus.faint, fontSize: 11, lineHeight: 14 },
  replyInside: { borderLeftColor: lotus.accent, borderLeftWidth: 2, marginBottom: 6, paddingLeft: 7 },
  replyInsideName: { color: lotus.goldink, fontSize: 11, fontWeight: "800", marginBottom: 1 },
  replyInsideBody: { color: "#777777", fontSize: 11, lineHeight: 15 },
  reactionChip: { backgroundColor: "#ffffff", borderColor: lotus.line, borderRadius: 10, borderWidth: 1, marginTop: 2, paddingHorizontal: 5, paddingVertical: 2 },
  reactionChipText: { fontSize: 11 },
  messageImage: { borderRadius: 9, height: 180, marginBottom: 6, width: 220 },
  messageVideo: { borderRadius: 9, height: 180, marginBottom: 6, width: 220 },
  // MEETUP-SHARE-001: 位置卡（label + 坐标 + 外链入口，与图片同宽）。
  // CONTACT-CARD-001: 名片气泡。宽度和位置卡对齐（220），点开是二维码 ——
  // 收到别人转来的名片，第一件事往往是「把这个人也给第三个人」，所以那张码
  // 必须一点就出来，而不是让用户另找入口。
  contactCard: { alignItems: "center", backgroundColor: "#fff", borderColor: lotus.line, borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 9, marginBottom: 6, padding: 10, width: 220 },
  contactBadge: { alignItems: "center", backgroundColor: lotus.soft, borderRadius: 16, height: 32, justifyContent: "center", width: 32 },
  contactBadgeText: { color: lotus.goldtext, fontSize: 14, fontWeight: "700" },
  contactCopy: { flex: 1 },
  contactName: { color: lotus.ink, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  contactHandle: { color: lotus.muted, fontSize: 11, marginTop: 1 },
  contactCta: { color: lotus.goldtext, fontSize: 11, fontWeight: "700" },
  locationCard: { backgroundColor: "#f6f3ee", borderRadius: 9, marginBottom: 6, padding: 10, width: 220 },
  locationTitle: { color: lotus.ink, fontSize: 13, fontWeight: "800", lineHeight: 18 },
  locationCoord: { color: lotus.muted, fontSize: 11, marginTop: 2 },
  locationOpen: { marginTop: 8, alignSelf: "flex-start", backgroundColor: "#ffffff", borderColor: lotus.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  locationOpenText: { color: lotus.ink, fontSize: 12, fontWeight: "800" },
  locationActionRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  // 导航是主动作：墨底白字（与发送按钮同语言）；查看是次动作：白底墨字。
  locationNav: { backgroundColor: lotus.ink, borderColor: lotus.ink },
  locationNavText: { color: "#ffffff", fontSize: 12, fontWeight: "800" },

  // 语音条（Lotus 录音对象基线）
  audioMessage: { alignItems: "center", flexDirection: "row", gap: 8, minWidth: 180, paddingVertical: 6 },
  audioPlayBtn: { alignItems: "center", backgroundColor: lotus.ink, borderRadius: 14, height: 28, justifyContent: "center", width: 28 },
  audioPlayGlyph: { color: "#ffffff", fontSize: 11 },
  audioWave: { color: "#bbb6ae", flex: 1, fontSize: 14, letterSpacing: 2 },
  audioLabel: { color: lotus.muted, fontSize: 11 },

  // 贴纸消息
  stickerMessage: { alignItems: "flex-end", minWidth: 112, padding: 2 },
  stickerGlyph: { fontSize: 96, lineHeight: 104 },
  stickerMsgMeta: { color: lotus.faint, fontSize: 11, marginTop: 1 },

  // v1 代理对象（MessageRenderer 保持原样，只收边距）
  v1Wrap: { marginVertical: 2, maxWidth: "80%" },
  v1Own: { alignSelf: "flex-end" },
  v1Other: { alignSelf: "flex-start" },
  v1Time: { color: lotus.faint, fontSize: 11, marginTop: 3, textAlign: "right" },

  // 安全条 / 回复预览
  secureStrip: { alignItems: "center", backgroundColor: lotus.goldbg, borderTopColor: lotus.goldline, borderTopWidth: 1, flexDirection: "row", justifyContent: "center", paddingVertical: 6 },
  secureStripText: { color: lotus.goldtext, fontSize: 11, fontWeight: "700" },
  replyPreview: { alignItems: "center", backgroundColor: lotus.paper, borderTopColor: lotus.line, borderTopWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 7 },
  replyLine: { backgroundColor: lotus.accent, borderRadius: 1, height: 27, width: 2 },
  replyCopy: { flex: 1 },
  replyCopyName: { color: lotus.goldink, fontSize: 11, fontWeight: "800" },
  replyCopyBody: { color: "#777777", fontSize: 11, marginTop: 2 },
  replyClose: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
  replyCloseText: { color: "#999999", fontSize: 18 },

  // 表情包 Drawer
  stickerDrawer: { backgroundColor: lotus.paper, borderTopColor: lotus.line, borderTopWidth: 1 },
  stickerHead: { alignItems: "center", borderBottomColor: lotus.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 11, paddingVertical: 9 },
  stickerHeadTitle: { fontSize: 11, fontWeight: "800" },
  stickerHeadSub: { color: "#999999", fontSize: 11 },
  stickerGrid: { flexDirection: "row", flexWrap: "wrap", padding: 5 },
  stickerItem: { alignItems: "center", height: 66, justifyContent: "center", width: "25%" },
  stickerItemGlyph: { fontSize: 42 },
  stickerCredit: { color: lotus.faint, fontSize: 11, paddingBottom: 8, paddingHorizontal: 11, textAlign: "right" },

  // 输入区
  composerShell: { backgroundColor: lotus.paper, borderTopColor: lotus.line, borderTopWidth: 1, paddingHorizontal: 7, paddingTop: 7 },
  composer: { alignItems: "flex-end", flexDirection: "row", gap: 4, paddingBottom: 2 },
  attachBtn: { alignItems: "center", height: 36, justifyContent: "center", width: 34 },
  attachBtnText: { color: "#87827a", fontSize: 22, lineHeight: 24 },
  inputWrap: { alignItems: "flex-end", backgroundColor: "#ffffff", borderColor: lotus.line, borderRadius: 19, borderWidth: 1, flex: 1, flexDirection: "row", minHeight: 38, paddingLeft: 10 },
  composerInput: { color: lotus.ink, flex: 1, fontSize: 13, lineHeight: 18, maxHeight: 78, paddingBottom: 8, paddingTop: 9 },
  inlineTool: { alignItems: "center", height: 36, justifyContent: "center", width: 30 },
  inlineToolText: { color: lotus.muted, fontSize: 18 },
  micSlot: { alignItems: "center", height: 36, justifyContent: "center", width: 34 },
  sendCircle: { alignItems: "center", backgroundColor: lotus.ink, borderRadius: 17, height: 34, justifyContent: "center", marginBottom: 1, width: 34 },
  sendCircleDisabled: { opacity: 0.4 },
  sendCircleText: { color: "#ffffff", fontSize: 17, fontWeight: "800" },
  imagePreviewRow: { alignItems: "center", backgroundColor: lotus.soft, borderRadius: 12, flexDirection: "row", gap: 9, marginBottom: 7, marginHorizontal: 5, padding: 7 },
  imagePreview: { borderRadius: 8, height: 52, width: 52 },
  videoPreviewIcon: { backgroundColor: lotus.ink, borderRadius: 8, color: "#ffffff", fontSize: 18, overflow: "hidden", paddingHorizontal: 18, paddingVertical: 15 },
  imagePreviewText: { color: lotus.ink, flex: 1, fontSize: 11 },
  imageRemove: { color: lotus.muted, fontSize: 24, paddingHorizontal: 8 },

  // 底部 sheet 通用
  scrim: { backgroundColor: "rgba(17,17,15,0.16)", bottom: 0, justifyContent: "flex-end", left: 0, position: "absolute", right: 0, top: 0 },
  bottomSheet: { backgroundColor: lotus.paper, borderColor: lotus.line, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderWidth: 1, margin: 8, paddingBottom: 12, paddingHorizontal: 11, paddingTop: 10 },
  sheetGrab: { alignSelf: "center", backgroundColor: "#d5d0c8", borderRadius: 2, height: 3, marginBottom: 9, width: 32 },
  sheetItem: { alignItems: "center", borderTopColor: lotus.line, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 44, paddingVertical: 6 },
  albumGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 4, paddingTop: 2 }, albumTile: { alignItems: "center", aspectRatio: 1, backgroundColor: lotus.soft, borderRadius: 10, justifyContent: "center", width: "23%" }, albumTileText: { color: lotus.muted, fontSize: 11, fontWeight: "700", marginTop: 4 }, albumThumb: { borderRadius: 10, height: "100%", width: "100%" }, albumEmpty: { color: lotus.muted, fontSize: 12, marginTop: 8, textAlign: "center" },
  sheetItemText: { color: lotus.ink, fontSize: 12, fontWeight: "700" },
  sheetItemHint: { color: "#888888", fontSize: 11 },
  sheetItemDisabled: { color: "#b8b3ab" },
  sheetClose: { alignItems: "center", height: 28, justifyContent: "center", width: 28 },
  sheetCloseText: { color: "#8c877f", fontSize: 20 },
  reactionsRow: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 9, paddingHorizontal: 3, paddingTop: 4 },
  reactionBtn: { alignItems: "center", borderRadius: 20, height: 40, justifyContent: "center", width: 40 },
  reactionBtnActive: { backgroundColor: lotus.soft },
  reactionBtnText: { fontSize: 24 },

  // 活动 picker
  pickerTitle: { color: lotus.ink, fontSize: 14, fontWeight: "800", marginBottom: 4 },
  pickerSub: { color: lotus.muted, fontSize: 11, marginBottom: 8 },
  pickerError: { color: "#A11A4F", fontSize: 11, marginBottom: 8 },
  pickerList: { maxHeight: 320 },
  pickerItem: { borderBottomColor: "rgba(60,40,90,0.08)", borderBottomWidth: 1, paddingHorizontal: 4, paddingVertical: 10 },
  pickerItemTitle: { color: lotus.ink, fontSize: 13, fontWeight: "700" },
  pickerItemSub: { color: lotus.muted, fontSize: 11, marginTop: 2 },
  pickerCancel: { alignSelf: "center", marginTop: 12, paddingHorizontal: 24, paddingVertical: 8 },
  pickerCancelText: { color: lotus.goldtext, fontSize: 13, fontWeight: "600" },

  // 安全 sheet
  secureHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  secureHeadTitle: { color: lotus.ink, fontSize: 13, fontWeight: "800" },
  secureHeadSub: { color: "#999999", fontSize: 11, marginTop: 2 },
  secureCopyTitle: { color: lotus.ink, fontSize: 11, fontWeight: "800" },
  secureCopySub: { color: lotus.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  timerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 5, paddingVertical: 9 },
  timerOpt: { alignItems: "center", backgroundColor: "#ffffff", borderColor: lotus.line, borderWidth: 1, height: 31, justifyContent: "center", width: "23.5%" },
  timerOptActive: { backgroundColor: lotus.ink, borderColor: lotus.ink },
  timerOptText: { fontSize: 11 },
  timerOptTextActive: { color: "#ffffff" },
  settingRow: { alignItems: "center", borderTopColor: lotus.line, borderTopWidth: 1, flexDirection: "row", gap: 12, justifyContent: "space-between", paddingVertical: 12 },
  settingCopy: { flex: 1 },
  secureNote: { borderTopColor: lotus.line, borderTopWidth: 1, color: lotus.muted, fontSize: 11, lineHeight: 15, paddingTop: 8 },

  // toast
  toastWrap: { alignItems: "center", bottom: 90, left: 0, position: "absolute", right: 0 },
  toast: { backgroundColor: lotus.ink, borderRadius: 8, color: "#ffffff", fontSize: 11, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 7 },
});
