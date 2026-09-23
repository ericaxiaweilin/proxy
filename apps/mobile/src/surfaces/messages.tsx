// Messaging Home — 对齐 Lotus COMPLETE v8 单文件版
// 1:1 还原 v8 的 homeHead/homeTabs/folderRow/dialogs+convos + Requests(Mặc Kệ) 入口
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState, NativeScrollEvent, NativeSyntheticEvent, PanResponder, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View, type ImageSourcePropType } from "react-native";
import { usePullToRefresh } from "../components/pull-to-refresh";
import { Image } from "expo-image";
import { Directory, File, Paths } from "expo-file-system";
import { SwipeBackShell } from "../architecture/swipe-back";
import { useScrollChrome } from "../shell/scroll-chrome";
import { IdentitySwitcher } from "../components/identity-switcher";
import { parseCommandResult } from "../login-client";
import { ProxyIcon } from "../components/proxy-icon";
import { color, shadows } from "../theme";
import type { ConversationClient, ConversationInboxItem } from "../conversation-client";
import type { PlatformAIAccount } from "../ai-account-client";
import { BUNDLED_AI_COMPANIONS } from "../ai-companion-catalog";
import { dedupeInboxDialogs } from "../conversation-inbox-model";
import type { ProfileClient } from "../profile-client";
import type { RelationshipClient } from "../relationship-client";
import { FriendCrmSurface } from "./friend-crm";
import { meetupPreview } from "../meetup-share";
import { aiAccountPhoto } from "../ai-persona-presentation";
import { parseHiddenChatIds, parseHiddenChatTimes, shouldResurfaceHidden } from "../local-snapshot";
import { OTTER_LOGO } from "../media/asset-sources";

// MSG-GROUPS-TAB-001: 第二个页签以前叫"Convo"（消息支线/message branch，见
// conversation.tsx 的"创建 Convo"长按项），列的却是 GROUP/SUPPORT 会话——
// 名字和内容对不上，而且"Convo"这个词本身就是办公协作software的说法，这是
// 聊天 app 不是办公软件。现在这一页只做一件事：群组对话，如实叫"群组"。
type HomePanel = "dialogs" | "groups";
type Folder = "all" | "friends" | "activity" | "invite";

// v8 原型 mock 已删除（R36.x MOCK-001）：Dialog 只走 server
// listConversations()，空收件箱显示诚实空态，不再展示假会话。
type Dialog = { id: string; conversationId?: string; aiAccount?: PlatformAIAccount; avatarSource?: number | { uri: string }; initial: string; name: string; badge?: string; preview: string; time: string; unread?: string; warm?: boolean; blue?: boolean; dark?: boolean; folder: Folder; type?: string; peerUserId?: string; lastActivityMs: number; isRoom?: boolean };

const ASSISTANT_LOGO = OTTER_LOGO;

// 收件箱 5 秒轮询每次重跑 toDialog，aiAccountPhoto() 和手拼的 {uri} 每次
// 都是新对象 —— 行头像当新图重载，肉眼就是 AI 行每几秒闪一下。
// 按账号缓存 source 身份，换头像版本才换身份。
const aiAvatarSourceCache = new Map<string, number | { uri: string }>();
function cachedAiAccountPhoto(account: PlatformAIAccount): number | { uri: string } {
  const key = `${account.accountId}:${account.avatarVersion ?? 1}:${account.avatarPath}:${account.avatarMediaAssetId ?? ""}`;
  const hit = aiAvatarSourceCache.get(key);
  if (hit !== undefined) return hit;
  const source = aiAccountPhoto(account);
  aiAvatarSourceCache.set(key, source);
  return source;
}
const FOLDER_LABEL: Record<Folder, string> = { all: "全部", friends: "朋友", activity: "活动", invite: "邀约" };

// 本机隐藏的会话（左滑删除）：服务端没有删会话接口，删除 = 本机可见性，
// 服务端保留审计（与“清空本机显示”同口径）。落盘持久化，重进/重启不回来。
const hiddenChatsDir = new Directory(Paths.document, "proxy-hidden-chats");
const hiddenChatsFile = new File(hiddenChatsDir, "hidden-v1.json");
/**
 * SYNC-FS-001: File.json() 是异步的，同步读永远拿到 Promise。
 * 本函数为唯一读入口（await）。解析见 local-snapshot（单测覆盖）。
 */
export async function readHiddenChatIdsAsync(): Promise<string[]> {
  try {
    if (!hiddenChatsFile.exists) return [];
    return parseHiddenChatIds(await hiddenChatsFile.json());
  } catch {
    return [];
  }
}
function writeHiddenChatIds(record: Record<string, number>): void {
  try {
    hiddenChatsDir.create({ idempotent: true, intermediates: true });
    hiddenChatsFile.write(JSON.stringify(record));
  } catch {
    // 持久化失败不打断删除（本会话内照样隐藏）。
  }
}

const SWIPE_DELETE_W = 84;
// 松手/被抢走时的结算阈值：轻滑 24px 即展开，不必过半，更不会中途收回。
const SWIPE_OPEN_DX = 24;

// 左滑删除行：无手势库，用 PanResponder 实现。横滑 dx 主导才接管，
// 竖滑留给列表；点按（无位移）不受影响。
// SWIPE-DELETE-SIMPLIFY-001: 以前这里是两段确认——滑开先看到删除按钮，
// 点一下变宽成"取消"和第二个动作按钮，还要再点一次才真的触发。防的是
// "误触"，但滑动本身
// 已经要求横向拖动超过 SWIPE_OPEN_DX 才会展开，这已经是一次刻意动作；而
// hideDialog 本来就不是真删除（见 visibleDialogs 那条注释："dismiss 当前
// 视图，来新动态即回"），把它当成需要二次确认的破坏性操作，比它实际的
// 可逆程度更谨慎。滑开这一下已经是唯一必要的确认；不想删就照常右滑收起
// 或点别处收起——两条路都还在，不需要专门一个"取消"按钮来做同一件事。
// SWIPE-CRASH-001: 拖动这一段本来想让 base+dragX 都走 useNativeDriver:true，
// 靠原生侧直接接手逐帧更新，不经 JS bridge。实测不成立——PanResponder.js
// 内部对 onPanResponderMove 就是直接 config.onPanResponderMove(event, gs)
// 当函数调用；useNativeDriver:true 时 Animated.event(...) 返回的不是函数，
// 是 AnimatedEvent 实例本身（专门给 onScroll 这类原生 prop 用，靠 UIManager
// 识别对象类型走原生直连），PanResponder 认不出这个对象，一滑就抛
// "Object is not a function"。项目没装 react-native-gesture-handler/
// reanimated，PanResponder 的手势识别和逐帧回调本身就在 JS 线程，绕不开——
// 只能退回 useNativeDriver:false，让 Animated.event 返回真正可调用的
// handler；这一路径下的 setValue 仍比手算 clamp 再赋值轻（不触发 React
// re-render），先保证不崩、再谈顺不顺。
function SwipeableRow({ onDelete, children, edgeInset = 0, topInset = 0, cornerRadius = 0 }: { onDelete: () => void; children: React.ReactNode; edgeInset?: number; topInset?: number; cornerRadius?: number }): React.JSX.Element {
  const base = useRef(new Animated.Value(0)).current;
  const dragX = useRef(new Animated.Value(0)).current;
  const combined = useRef(Animated.add(base, dragX)).current;
  const clampedX = useMemo(
    () => combined.interpolate({ inputRange: [-SWIPE_DELETE_W, 0], outputRange: [-SWIPE_DELETE_W, 0], extrapolate: "clamp" }),
    [combined]
  );
  const openW = useRef(0);
  const [open, setOpen] = useState(false);
  const snapTo = useCallback((w: number) => {
    openW.current = w;
    setOpen(w > 0);
    dragX.setValue(0);
    Animated.spring(base, { toValue: -w, useNativeDriver: false, tension: 320, friction: 32 }).start();
  }, [base, dragX]);
  const close = useCallback(() => snapTo(0), [snapTo]);
  function settle(dx: number, vx: number): void {
    const wasOpen = openW.current > 0;
    let target = 0;
    if (!wasOpen && (dx < -SWIPE_OPEN_DX || vx < -0.4)) target = SWIPE_DELETE_W;
    else if (wasOpen && (dx > SWIPE_OPEN_DX || vx > 0.4)) target = 0;
    else if (wasOpen) target = SWIPE_DELETE_W;
    snapTo(target);
  }
  const panMove = useRef(Animated.event([null, { dx: dragX }], { useNativeDriver: false })).current;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > Math.abs(gs.dy) && Math.abs(gs.dx) > 8,
    onPanResponderGrant: () => {
      // 抓手瞬间把"静止位置"钉在当前展开状态，这次手势的位移从 0 起算——
      // 这一步是 setValue，只在抓手那一刻发生一次，不是逐帧成本。
      base.setValue(-openW.current);
      dragX.setValue(0);
    },
    onPanResponderMove: panMove,
    onPanResponderRelease: (_, gs) => settle(gs.dx, gs.vx),
    // 被父列表抢走手势（竖飘）也不中途收回：按最后位移同样结算。
    onPanResponderTerminate: (_, gs) => settle(gs.dx, 0),
  })).current;
  return (
    <View>
      {/* SWIPE-EDGE-INSET-001: 这块红底是绝对定位、贴着最外层容器右边+顶到顶——
          对 styles.dialog（无 margin/圆角，撑满行宽）没问题，但 styles.convoCard
          有 marginHorizontal:14/marginTop:10/borderRadius:15：只挪 right 还留两个
          洞——(1) 卡片顶部往下缩进 10px 才开始画，缩进区没被卡片盖住红底就露出来；
          (2) 卡片圆角处红底是直角，圆角切掉的那一小块三角形也会露出来。
          topInset 补第一个洞，cornerRadius 补第二个——两个都跟卡片抄同一组数字。 */}
      <View style={[styles.swipeBehind, { width: SWIPE_DELETE_W, right: edgeInset, top: topInset }]}>
        {/* 圆角要画在真正有背景色的按钮上——外层 swipeBehind 是透明定位壳，
            没有背景，给它加圆角什么都不会发生（没东西可裁）。 */}
        <Pressable onPress={onDelete} style={[styles.swipeDelete, { borderTopRightRadius: cornerRadius, borderBottomRightRadius: cornerRadius }]} accessibilityLabel="删除对话">
          <Text selectable style={styles.swipeDeleteText}>删除</Text>
        </Pressable>
      </View>
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: clampedX }] }}>
        {open ? <Pressable accessibilityLabel="收起删除" onPress={close} style={StyleSheet.absoluteFill} /> : null}
        {children}
      </Animated.View>
    </View>
  );
}

// TAB-SWITCH-JANK-001: 模块级缓存——切 tab 是 remount，有缓存就同步渲染（毫秒级），
// 后台 5s 刷新照常；冷启动（undefined）才显示“加载中…”。
let cachedServerDialogs: Dialog[] | undefined;

export function MessagesSurface({
  onOpenConversation,
  onOpenRoom,
  onOpenContacts,
  onChromeVisibilityChange,
  bottomNavVisible,
  displayIdentityClient,
  activeIdentityId,
  onSwitchIdentity,
  conversationClient,
  profileClient,
  apiBaseUrl,
  relationship,
  viewer,
}: {
  onOpenConversation: (author: string, conversationId?: string, aiAccount?: PlatformAIAccount, avatarSource?: number | { uri: string }, peerUserId?: string) => void;
  // ROOM-CREATE-001: 房间（GROUP + roomScene）走专门的房间聊天页（场景banner/
  // 成员条/见面邀约），不是通用 ConversationSurface——那边不认识见面邀约卡片，
  // 会把它画成一个空气泡。
  onOpenRoom?: (conversationId: string) => void;
  onOpenContacts?: () => void;
  // MSG-SCAN-SHORTCUT-001: 消息模块加好友现在只剩顶栏"扫码"这一条路——
  // "+"号连着的方式选择页（邀请/通讯录/社媒/搜索）已经摘掉，本人的二维码
  // 已经够用，不需要到处都能申请加好友。relationship 仍要传：扫码识别出人
  // 之后真的发好友请求要靠它。
  relationship?: RelationshipClient | undefined;
  viewer?: { name: string; handle: string } | undefined;
  onChromeVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
  // 这里曾声明过一个 "CHAT" | "FRIENDS" 的初始 tab：app-shell 一直在传，本组件
  // 从来没读过。而且它的词表和本页的 panel 模型（对话 / 群组）对不上 ——
  // 不是「没接」，是「接不上」，所以删掉而不是补线。真正区分「在聊天里 / 在消息
  // 列表」的是 shell 的 messageChat 状态（它会换成 ConversationSurface 渲染），
  // 不是这个 prop。已删。
  displayIdentityClient?: import("../display-identity-client").DisplayIdentityClient;
  activeIdentityId?: string;
  onSwitchIdentity?: (id: string) => void;
  conversationClient?: ConversationClient;
  profileClient?: ProfileClient;
  apiBaseUrl?: string;
}): React.JSX.Element {
  const [panel, setPanel] = useState<HomePanel>("dialogs");
  const [folder, setFolder] = useState<Folder>("all");
  const [search, setSearch] = useState("");
  // MSG-HEADER-SLIM-001: 搜索平时不占地方，点了图标才展开输入框——跟动态
  // tab 的搜索交互（feed.tsx 的 searchOpen）是同一套模式。
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const [subView, setSubView] = useState<"home" | "contacts" | "person" | "newGroup">("home");
  const [personName, setPersonName] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  // MSG-SCAN-SHORTCUT-001: 顶栏"扫码"直接进相机，内嵌同一个 FriendCrmSurface，
  // 只带一个 scanOnly 初始 sheet——"+"号方式选择页已经从消息模块摘掉。
  const [scanShortcut, setScanShortcut] = useState(false);
  // GROUP-CREATE-001: 建群候选人跟「新聊天」同一个诚实数据源（收件箱里
  // 真聊过天的人），排除 AI（AI 小美/助手拉进群没有语义）。选中的是对方
  // userId（后端 participantIds 要的就是这个），不是 conversationId。
  const [groupSelected, setGroupSelected] = useState<ReadonlySet<string>>(new Set());
  const [groupMessage, setGroupMessage] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState("");


  const [serverDialogs, setServerDialogs] = useState<Dialog[] | undefined>(cachedServerDialogs);
  const [inboxError, setInboxError] = useState(false);
  // 坏图回落：thumb 404（幽灵 id 拼出来的 user_ 地址、不可见头像）时 expo Image
  // 只会画空白 —— 必须回落首字母，行头像永远不能空白。
  const [brokenAvatarIds, setBrokenAvatarIds] = useState<ReadonlySet<string>>(new Set());
  function markAvatarBroken(id: string): void {
    setBrokenAvatarIds((current) => (current.has(id) ? current : new Set(current).add(id)));
  }

  // 与动态 / 首页 / 市场同一套滑动显隐（上滑藏、下滑/回顶显，阈值 -18/+28）。
  // SCROLL-CHROME-001: 改用共享控制器。原先这里的本地副本会和自己造成的布局变化
  // 互相激励 —— 隐藏 chrome 会让 Header 卸载、底部留白 96→16，内容变矮导致偏移被
  // 钳制，钳制又产生负 delta 事件，于是 chrome 再次显示……列表滑到底部被弹回、
  // logo 一显一隐闪循环。控制器在状态切换后短暂忽略滚动事件来打断这个回路。
  const onInboxScroll = useScrollChrome(onChromeVisibilityChange);
  // 左滑删除 = dismiss 当前视图，来新动态即回（block 才彻底删除）。
  // 隐藏集记时刻（id → 藏起毫秒）：某行的最后动态晚于藏起时刻就不再藏。
  // v1 老文件是纯 id 数组，读到就按升级时刻迁移（之前藏的、之后没新动态的
  // 继续藏着；有新动态的浮出来 —— 升级前藏的其动态全是旧的，不会炸出一堆）。
  // SYNC-FS-001: 读盘异步，mount 时 hydration 并与会话内状态合并。
  const [hiddenIds, setHiddenIds] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let record: Record<string, number> = {};
      try {
        if (!hiddenChatsFile.exists) return;
        const raw = await hiddenChatsFile.json();
        // 纯数组 = v1 老形状：整体按现在迁移。
        if (Array.isArray(raw)) {
          const now = Date.now();
          for (const id of parseHiddenChatIds(raw)) record[id] = now;
          if (Object.keys(record).length > 0) writeHiddenChatIds(record);
        } else {
          record = parseHiddenChatTimes(raw);
        }
      } catch { return; }
      if (cancelled || Object.keys(record).length === 0) return;
      setHiddenIds((prev) => {
        const merged = { ...record, ...prev };
        return Object.keys(merged).length === Object.keys(prev).length ? prev : merged;
      });
    })();
    return () => { cancelled = true; };
  }, []);
  const hideDialog = useCallback((id: string) => {
    setHiddenIds((prev) => {
      if (prev[id] !== undefined) return prev;
      const next = { ...prev, [id]: Date.now() };
      writeHiddenChatIds(next);
      return next;
    });
  }, []);

  const refreshInbox = useCallback(async (): Promise<void> => {
    if (!conversationClient) return;
    try {
      const items = dedupeInboxDialogs(await conversationClient.listConversations());
      const enriched = await Promise.all(items.map(async (item) => {
        if (!profileClient || !item.counterpartyId || item.counterpartySnapshot?.avatarRef || /^ai_account_/.test(item.counterpartyId)) return item;
        try {
          const peer = await profileClient.getProfile(item.counterpartyId);
          return { ...item, counterpartySnapshot: { displayName: peer.name, avatarRef: peer.avatarPath } };
        } catch { return item; }
      }));
      setServerDialogs(enriched.map((item) => toDialog(item, apiBaseUrl)));
      setInboxError(false);
    } catch {
      setInboxError(true);
    }
  }, [apiBaseUrl, conversationClient, profileClient]);
  // PULL-REFRESH-001: 下拉立刻重拉收件箱（不用等 5 秒轮询）。
  const inboxPull = usePullToRefresh(refreshInbox);

  useEffect(() => {
    if (!conversationClient) return;
    let foreground = AppState.currentState === "active";
    void refreshInbox();
    const timer = setInterval(() => { if (foreground) void refreshInbox(); }, 5_000);
    const appState = AppState.addEventListener("change", (state) => {
      foreground = state === "active";
      if (foreground) void refreshInbox();
    });
    return () => { clearInterval(timer); appState.remove(); };
  }, [conversationClient, refreshInbox]);

  const inboxLoaded = serverDialogs !== undefined || inboxError;
  const visibleDialogs = useMemo(
    // 滑删只 dismiss 藏起时刻之前的东西：该行最后动态晚于藏起时刻（对方又说话了，
    // 包括自己这边发出去的）就浮出来。block 才彻底，见 setConversationBlocked。
    () => (serverDialogs ?? []).filter((d) => hiddenIds[d.id] === undefined || shouldResurfaceHidden(hiddenIds[d.id], d.lastActivityMs)),
    [serverDialogs, hiddenIds]
  );
  // PIN-DEAD-CODE-001: 之前这里有一段"置顶"UI 和一个永远是 [] 的
  // pinnedSource，从来没有任何地方能把一条对话标成置顶——没有 pin/unpin
  // 操作、没有真人可触发的入口。conversation 包里确实有 IsPinned 字段和
  // 一个 Pin 结构体，但那是内部用来挂 read cursor 的 Dialog 记录，没有
  // CRUD 方法、没有接进任何 command，跟这里想要的"用户置顶会话"完全是
  // 两回事。真正做置顶需要新的后端能力（谁能置顶、限几条、怎么持久化），
  // 不是这个函数能顺手编出来的；先把这段永远不会渲染的死 UI 删掉，
  // 不留一个看起来存在、实际打不开的入口。
  const recentSource = visibleDialogs;
  // MSG-GROUPS-TAB-001: 第二个页签只展示真的 GROUP/SUPPORT 会话（toDialog
  // 已把 conversation.conversationType 透出到 type 字段），没 type 字段时
  // fallback 视为 DM 不显示。
  const groupDialogs = useMemo(
    () => visibleDialogs.filter((d) => {
      const t = (d as unknown as { type?: string }).type;
      return t === "GROUP" || t === "SUPPORT";
    }),
    [visibleDialogs]
  );

  const filteredRecent = useMemo(() => filterByFolder(recentSource, folder, search), [recentSource, folder, search]);

  const openContacts = () => {
    if (onOpenContacts) onOpenContacts();
    else setSubView("contacts");
  };
  // GROUP-CREATE-001: 候选人 = 收件箱里聊过天的真人，去掉 AI（小美是「用户」但
  // 拉真人群没有语义，助手更不该在群里）。跟「contacts」用同一个诚实数据源。
  const groupCandidates = useMemo(
    () => visibleDialogs.filter((d) => !d.aiAccount && d.peerUserId && d.peerUserId !== "proxy_ai" && d.peerUserId !== "user_proxy_ai"),
    [visibleDialogs]
  );
  const toggleGroupMember = (id: string): void => {
    setGroupSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // GROUP-CREATE-001: 后端 resolveStartParticipants 要求 GROUP ≥3 人（含创建者），
  // 所以这里至少选 2 个人；首条消息必填 —— 不生一个空对话出来，跟真开一次聊天
  // 同口径（发第一条消息才算「开始」）。
  const canCreateGroup = groupSelected.size >= 2 && groupMessage.trim() !== "" && !groupBusy;
  const createGroup = async (): Promise<void> => {
    if (!conversationClient || !canCreateGroup) return;
    setGroupBusy(true);
    setGroupError("");
    try {
      const result = await conversationClient.startConversation({
        originType: "HOME",
        originId: "group",
        conversationType: "GROUP",
        participantIds: Array.from(groupSelected),
        firstMessage: groupMessage.trim(),
      });
      const parsed = parseCommandResult(result);
      const body = parsed?.operationRef ? JSON.parse(parsed.operationRef) as { conversationId?: string } : undefined;
      if (typeof body?.conversationId !== "string") throw new Error("create group response malformed");
      const memberNames = groupCandidates.filter((c) => groupSelected.has(c.peerUserId as string)).map((c) => c.name);
      const groupName = `群聊 · ${[viewer?.name, ...memberNames].filter(Boolean).join("、")}`;
      void refreshInbox();
      setSubView("home");
      setGroupSelected(new Set());
      setGroupMessage("");
      onOpenConversation(groupName, body.conversationId);
    } catch (error) {
      setGroupError(error instanceof Error && /authenticated principal|real sign-in|signed out/i.test(error.message) ? "建群失败：请登录后重试" : "建群失败，请稍后重试");
    } finally {
      setGroupBusy(false);
    }
  };

  // 联系人详情带上会话上下文：名字 + 最近消息 + 会话 id，
  // “消息”按钮直达该会话，不断链；在线/username/手机号之前是现编的，已去掉。
  const [personCtx, setPersonCtx] = useState<{ name: string; preview?: string | undefined; time?: string | undefined; conversationId?: string | undefined; aiAccount?: PlatformAIAccount; avatarSource?: number | { uri: string } }>({ name: "" });
  const openPerson = (contact: { name: string; preview?: string | undefined; time?: string | undefined; conversationId?: string | undefined; aiAccount?: PlatformAIAccount; avatarSource?: number | { uri: string } }) => {
    setPersonCtx(contact);
    setPersonName(contact.name);
    setSubView("person");
  };

  // MSG-SCAN-SHORTCUT-001: 顶栏"扫码"直接进相机，不经过方式选择页——
  // scanOnly=true 让扫码 sheet 一关就直接退出本表面，绝不落在方式选择页上。
  if (scanShortcut) {
    return (
      <FriendCrmSurface
        relationship={relationship}
        profileClient={profileClient}
        initialView="ADD_FRIEND"
        initialSheet="SCAN"
        scanOnly
        addFriendBackLabel="‹ 返回"
        viewer={viewer}
        onBack={() => setScanShortcut(false)}
        onOpenConversation={(author) => { setScanShortcut(false); onOpenConversation(author); }}
      />
    );
  }

  if (subView === "newGroup") {
    return (
      <SwipeBackShell onExit={() => setSubView("home")}>
        <View style={styles.app}>
          <View style={styles.safe} />
          <View style={styles.topbar}>
            <Pressable onPress={() => setSubView("home")} style={styles.icon}><Text selectable style={styles.backText}>‹</Text></Pressable>
            <View style={styles.centerTitle}><Text selectable style={styles.centerMain}>建群</Text><Text selectable style={styles.centerSub}>选至少 2 人 · 收件箱里聊过天的人</Text></View>
            <View style={styles.icon} />
          </View>
          <ScrollView style={{ flex: 1 }}>
            <Text selectable style={styles.contactSection}>{groupCandidates.length === 0 ? "还没有可建群的联系人" : `选择成员 · 已选 ${groupSelected.size}`}</Text>
            {groupCandidates.length === 0 ? <Text selectable style={styles.empty}>先在「新聊天」里跟人聊上，才能把他们拉进群</Text> : null}
            {groupCandidates.map((c) => {
              const id = c.peerUserId as string;
              const on = groupSelected.has(id);
              return (
                <Pressable key={id} onPress={() => toggleGroupMember(id)} style={styles.contactRow}>
                  {c.avatarSource && !brokenAvatarIds.has(c.id) ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`avatar:group:${c.id}`} source={c.avatarSource} style={styles.avatar} transition={0} onError={() => markAvatarBroken(c.id)} /> : <View style={styles.avatar}><Text selectable style={styles.avatarText}>{c.name.slice(0, 1)}</Text></View>}
                  <View style={{ flex: 1 }}><Text selectable style={styles.contactName}>{c.name}</Text></View>
                  <View style={[styles.groupCheck, on && styles.groupCheckOn]}>{on ? <Text selectable style={styles.groupCheckMark}>✓</Text> : null}</View>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.groupComposeBar}>
            {groupError ? <Text selectable style={styles.groupError}>{groupError}</Text> : null}
            <View style={styles.groupComposeRow}>
              <TextInput
                value={groupMessage}
                onChangeText={setGroupMessage}
                placeholder="群聊的第一条消息"
                placeholderTextColor="#9a968f"
                style={styles.groupComposeInput}
                multiline
              />
              <Pressable
                accessibilityLabel="创建群聊"
                disabled={!canCreateGroup}
                onPress={() => void createGroup()}
                style={[styles.groupCreateBtn, !canCreateGroup && styles.groupCreateBtnOff]}
              >
                <Text selectable style={styles.groupCreateBtnText}>{groupBusy ? "创建中…" : "创建"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </SwipeBackShell>
    );
  }

  if (subView === "contacts") {
    // 联系人 = 收件箱里真实聊过天的人（名字/最近消息/时间都来自服务端），
    // 没有独立通讯录接口，不编造 username/在线状态/手机号。
    // 已左滑删除的会话不同步到联系人。
    const CONTACTS = visibleDialogs.map((d) => ({
      name: d.name,
      preview: d.preview,
      time: d.time,
      conversationId: d.conversationId,
      ...(d.aiAccount ? { aiAccount: d.aiAccount } : {}),
      ...(d.avatarSource ? { avatarSource: d.avatarSource } : {}),
    }));
    const filtered = CONTACTS.filter((c) => !contactSearch || `${c.name}${c.preview}`.toLowerCase().includes(contactSearch.toLowerCase()));
    return (
      <SwipeBackShell onExit={() => setSubView("home")}>
        <View style={styles.app}>
          <View style={styles.safe} />
          <View style={styles.topbar}>
            <Pressable onPress={() => setSubView("home")} style={styles.icon}><Text selectable style={styles.backText}>‹</Text></Pressable>
            {/* CONTACT-SEARCH-COPY-001: 副标题正压在这个搜索框上方，必须和它搜得到的东西一致。
                这一页只搜「姓名 + 最近一条消息」（见下方 filtered），CONTACTS 里根本没有 username
                —— 见本段开头注释「不编造 username」。写「/ Username」等于让用户在框里输 @handle
                却永远搜不到。找还没聊过的人走顶栏"扫码"，这一页只搜已经在收件箱里的人。 */}
            <View style={styles.centerTitle}><Text selectable style={styles.centerMain}>新聊天</Text><Text selectable style={styles.centerSub}>联系人 · 姓名或最近消息</Text></View>
            <View style={styles.icon} />
          </View>
          <View style={styles.contactHeadSearch}>
            <ProxyIcon color="#97938b" name="search" size={17} />
            <TextInput value={contactSearch} onChangeText={setContactSearch} placeholder="姓名或最近消息" placeholderTextColor="#9a968f" style={styles.contactInput} />
          </View>
          <ScrollView style={{ flex: 1 }}>
            <Text selectable style={styles.contactSection}>已在 Proxy · 来自你的收件箱</Text>
            {filtered.length === 0 ? <Text selectable style={styles.empty}>{serverDialogs === undefined ? "加载中…" : "暂无联系人"}</Text> : null}
            {filtered.map((c) => (
              <Pressable key={`${c.name}-${c.conversationId ?? ""}`} onPress={() => openPerson(c)} style={styles.contactRow}>
                {c.avatarSource && !brokenAvatarIds.has(c.conversationId ?? c.name) ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`avatar:contact:${c.conversationId ?? c.name}`} source={c.avatarSource} style={styles.avatar} transition={0} onError={() => markAvatarBroken(c.conversationId ?? c.name)} /> : <View style={styles.avatar}><Text selectable style={styles.avatarText}>{c.name.slice(0, 1)}</Text></View>}
                <View style={{ flex: 1 }}><Text selectable style={styles.contactName}>{c.name}</Text><Text selectable style={styles.contactMeta}>{c.preview}</Text><Text selectable style={styles.contactMeta}>{c.time}</Text></View>
                <Text selectable style={styles.contactAction}>聊天 ›</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </SwipeBackShell>
    );
  }

  if (subView === "person") {
    return (
      <SwipeBackShell onExit={() => setSubView("contacts")}>
        <View style={styles.app}>
          <View style={styles.safe} />
          <View style={styles.topbar}>
            <Pressable onPress={() => setSubView("contacts")} style={styles.icon}><Text selectable style={styles.backText}>‹</Text></Pressable>
            <View style={styles.centerTitle}><Text selectable style={styles.centerMain}>联系人</Text></View>
            <View style={styles.icon} />
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={styles.personHero}>{personCtx.avatarSource && !brokenAvatarIds.has(personCtx.conversationId ?? personName) ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`avatar:person:${personCtx.conversationId ?? personName}`} source={personCtx.avatarSource} style={[styles.avatar, { width: 70, height: 70, borderRadius: 35, alignSelf: "center" }]} transition={0} onError={() => markAvatarBroken(personCtx.conversationId ?? personName)} /> : <View style={[styles.avatar, styles.avatarWarm, { width: 70, height: 70, borderRadius: 35, alignSelf: "center" }]}><Text selectable style={[styles.avatarText, { fontSize: 18 }]}>{personName.slice(0, 1)}</Text></View>}<Text selectable style={styles.personName}>{personName}</Text><Text selectable style={styles.personUser}>{personCtx.time ? `最近消息 · ${personCtx.time}` : "Proxy 联系人"}</Text></View>
          <View style={styles.personActions}>
            <Pressable onPress={() => onOpenConversation(personName, personCtx.conversationId, personCtx.aiAccount, personCtx.avatarSource)} style={styles.personAction}><View style={styles.personActionIcon}><ProxyIcon color={color.ink} name="chat" size={18} /></View><Text selectable style={styles.personActionText}>消息</Text></Pressable>
            <Pressable onPress={() => void Share.share({ message: `Proxy 联系人：${personName}（本地通讯录）` })} style={styles.personAction} accessibilityLabel="分享联系人"><View style={styles.personActionIcon}><Text selectable style={{ fontSize: 12 }}>🔗</Text></View><Text selectable style={styles.personActionText}>分享</Text></Pressable>
          </View>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {personCtx.preview ? <View style={styles.aliasCard}><Text selectable style={styles.aliasLabel}>最近消息</Text><Text selectable style={styles.aliasValue} numberOfLines={2}>{personCtx.preview}</Text></View> : null}
          </View>
        </ScrollView>
        </View>
      </SwipeBackShell>
    );
  }

  return (
    <View style={styles.app}>
      {/* safe */}
      <View style={styles.safe} />
      {/* identity switcher (lotus §1) — 可选 */}
      {displayIdentityClient && onSwitchIdentity ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
          <IdentitySwitcher client={displayIdentityClient} activeId={activeIdentityId as string | undefined} onSwitch={onSwitchIdentity} />
        </View>
      ) : null}

      {/* homeHead — v8 */}
      <View style={styles.homeHead}>
        <View style={styles.homeTitle}>
          <Text selectable style={styles.homeTitleText}>信息</Text>
          <View style={styles.homeActions}>
            {/* MSG-HEADER-SLIM-001: 顶栏按钮太多——"消息请求"指向一个从没接过
                真数据的死屏幕（陌生消息=Mặc Kệ，唯一状态是"暂无陌生消息"，
                也没有真的"陌生人"标记字段），直接删掉这个死入口；搜索从
                "常驻图标+常驻输入框"两件东西收成一个可展开的图标，跟动态 tab
                同一套交互；换来的位置放三个真需求：群组、扫码、新聊天。
                GROUP-CREATE-001: "群组"入口——后端 StartConversation 早就支持
                conversationType=GROUP + participantIds（≥3 人），之前光有列表
                没有创建入口，点不出一个新群。
                MSG-SCAN-SHORTCUT-001: "+"号（连着邀请/通讯录/社媒/搜索那一整页
                方式选择）已经摘掉——本人的二维码已经够用，不需要到处都能
                申请加好友；"扫码"是消息模块唯一保留的加好友路径。 */}
            <Pressable
              accessibilityLabel={searchOpen ? "关闭搜索" : "搜索"}
              onPress={() => {
                // 关闭时把搜索词也清掉——不然框收起来了，列表还按着旧词过滤，
                // 用户看不出"为什么少了几条"。
                if (searchOpen) { setSearchOpen(false); setSearch(""); } else setSearchOpen(true);
              }}
              style={styles.icon}
            >
              <ProxyIcon color={color.ink} name="search" size={20} />
            </Pressable>
            <Pressable accessibilityLabel="建群" onPress={() => setSubView("newGroup")} style={styles.icon}>
              <ProxyIcon color={color.ink} name="group" size={20} />
            </Pressable>
            <Pressable accessibilityLabel="扫码" onPress={() => setScanShortcut(true)} style={styles.icon}>
              <ProxyIcon color={color.ink} name="scan" size={20} />
            </Pressable>
            <Pressable accessibilityLabel="新聊天" onPress={openContacts} style={styles.icon}>
              <ProxyIcon color={color.ink} name="chat" size={20} />
            </Pressable>
          </View>
        </View>

        {searchOpen ? (
          <View style={styles.searchBox}>
            <ProxyIcon color="#9a968f" name="search" size={17} />
            <TextInput
              autoFocus
              ref={searchInputRef}
              value={search}
              onChangeText={setSearch}
              placeholder="搜索聊天名称和最近消息"
              placeholderTextColor="#9a968f"
              returnKeyType="search"
              style={styles.searchInput}
            />
            {search ? <Pressable accessibilityLabel="清除搜索" onPress={() => setSearch("")}><Text selectable style={styles.inlineClearText}>清除</Text></Pressable> : null}
          </View>
        ) : null}

        {/* 对话/群组两页签并列。MSG-GROUPS-TAB-001: 摘掉了"文件夹"（自建
            文件夹 + 媒体墙，没意义的组织负担）和"Convo"这个名字（消息支线，
            办公协作software的说法，这是聊天 app 不是办公软件）——第二个
            页签现在如实叫"群组"，只列真的群聊。 */}
        <View style={styles.homeTabs}>
          <Pressable onPress={() => setPanel("dialogs")} style={[styles.homeTab, panel === "dialogs" && styles.homeTabActive]}>
            <Text selectable style={[styles.homeTabText, panel === "dialogs" && styles.homeTabTextActive]}>对话</Text>
            <View style={[styles.countBadge, panel !== "dialogs" && styles.countBadgeMuted]}>
              <Text selectable style={styles.countBadgeText}>{filteredRecent.length}</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => setPanel("groups")} style={[styles.homeTab, panel === "groups" && styles.homeTabActive]}>
            <Text selectable style={[styles.homeTabText, panel === "groups" && styles.homeTabTextActive]}>群组</Text>
            <View style={[styles.countBadge, panel !== "groups" && styles.countBadgeMuted]}>
              <Text selectable style={styles.countBadgeText}>{groupDialogs.length}</Text>
            </View>
          </Pressable>
        </View>
      </View>

      {/* 系统筛选 chips：只对对话列表有意义，群组页不展示 */}
      {panel === "dialogs" ? (
      <View style={styles.folderRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.folderRow}>
          {(Object.keys(FOLDER_LABEL) as Folder[]).map((f) => (
            <Pressable key={f} onPress={() => setFolder(f)} style={[styles.folderChip, folder === f && styles.folderChipActive]}>
              <Text selectable style={[styles.folderChipText, folder === f && styles.folderChipTextActive]}>{FOLDER_LABEL[f]}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      ) : null}

      {/* body */}
      <ScrollView refreshControl={<RefreshControl refreshing={inboxPull.refreshing} onRefresh={inboxPull.onRefresh} />} style={styles.homeBody} contentContainerStyle={{ paddingBottom: bottomNavVisible === false ? 16 : 96 }} onScroll={onInboxScroll} scrollEventThrottle={16}>
        {panel === "dialogs" ? (
          <>
            {!inboxLoaded ? (
              <Text selectable style={styles.empty}>加载中…</Text>
            ) : filteredRecent.length > 0 ? (
              filteredRecent.map((d) => (
                <SwipeableRow key={d.id} onDelete={() => hideDialog(d.id)}>
                <Pressable onPress={() => { if (d.isRoom && d.conversationId && onOpenRoom) onOpenRoom(d.conversationId); else onOpenConversation(d.name, d.conversationId, d.aiAccount, d.avatarSource, d.peerUserId); }} style={styles.dialog}>
                  {d.avatarSource && !brokenAvatarIds.has(d.id) ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`avatar:recent:${d.conversationId ?? d.id}`} source={d.avatarSource} style={styles.avatar} transition={0} onError={() => markAvatarBroken(d.id)} /> : <View style={[styles.avatar, (d as Dialog).warm && styles.avatarWarm, (d as Dialog).blue && styles.avatarBlue, (d as Dialog).dark && styles.avatarDark]}>
                    <Text selectable style={[styles.avatarText, (d as Dialog).dark && styles.avatarTextDark]}>{d.initial}</Text>
                  </View>}
                  <View style={styles.dialogMain}>
                    <View style={styles.dialogTop}><Text selectable style={styles.dialogName}>{d.name}</Text></View>
                    <Text selectable style={styles.preview} numberOfLines={1}>{d.preview}</Text>
                  </View>
                    <View style={styles.dialogSide}>
                      <Text selectable style={styles.time}>{d.time}</Text>
                      {d.unread ? <View style={styles.unread}><Text selectable style={styles.unreadText}>{d.unread}</Text></View> : null}
                    </View>
                  </Pressable>
                  </SwipeableRow>
                ))
            ) : inboxError ? (
              // CONVO-INBOX-SWALLOW-001: 这一格以前只有一个分支，加载失败和真的
              // 没有会话共用同一句文案 —— 失败被渲染成「还没有对话」。
              <Text selectable style={styles.empty}>会话列表没读出来 —— 这不是「还没有对话」。5 秒后自动重试</Text>
            ) : (
              <Text selectable style={styles.empty}>还没有对话 — 从动态或市场开始聊一下</Text>
            )}
          </>
        ) : panel === "groups" ? (
          <>
            {/* MSG-GROUPS-TAB-001: 群组页 —— 只列服务端真群聊（GROUP/SUPPORT），
                点行直接进群聊会话。以前这里叫 Convo 又列支线又列群组，
                还拿「＋ 文件夹」当组织负担；现在支线只在对话里长按消息开。 */}
            {groupDialogs.length === 0 ? (
              <Text selectable style={styles.preview}>还没有群组对话 —— 建群后会出现在这里</Text>
            ) : null}
            {groupDialogs.map((c) => (
              <SwipeableRow key={c.id} onDelete={() => hideDialog(c.id)} edgeInset={14} topInset={10} cornerRadius={15}>
              <Pressable onPress={() => { if (c.isRoom && c.conversationId && onOpenRoom) onOpenRoom(c.conversationId); else onOpenConversation(c.name, c.conversationId); }} style={styles.convoCard} accessibilityLabel={`打开群组 ${c.name}`}>
                <View style={styles.convoHead}>
                  <View style={styles.convoMark}><ProxyIcon color="#fff" name="group" size={18} /></View>
                  <View style={styles.convoCopy}>
                    <Text selectable style={styles.convoName}>{c.name}</Text>
                    <Text selectable style={styles.convoParent}>{c.badge ?? "群组"}</Text>
                  </View>
                  {c.unread ? <View style={styles.unread}><Text selectable style={styles.unreadText}>{c.unread}</Text></View> : null}
                </View>
                <Text selectable style={styles.convoPreview} numberOfLines={1}>{c.preview}</Text>
                <View style={styles.convoFoot}>
                  <Text selectable style={styles.convoFootText}>{c.time}</Text>
                </View>
              </Pressable>
              </SwipeableRow>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function filterByFolder<T extends { folder: Folder; name: string; preview: string }>(arr: readonly T[], folder: Folder, search: string): T[] {
  const kw = search.trim().toLowerCase();
  return arr.filter((it) => {
    if (folder !== "all" && it.folder !== folder) return false;
    if (!kw) return true;
    return `${it.name} ${it.preview}`.toLowerCase().includes(kw);
  });
}

function toDialog(item: ConversationInboxItem, apiBaseUrl?: string): Dialog {
  const latest = item.latestMessage;
  const snapshotName = item.counterpartySnapshot?.displayName?.trim();
  const aiAccountNumber = item.counterpartyId?.match(/^ai_account_0*(\d+)$/)?.[1];
  const aiAccount = BUNDLED_AI_COMPANIONS.find((account) => account.accountId === item.counterpartyId
    || account.personaId === item.counterpartyId
    || (aiAccountNumber !== undefined && account.accountId.match(/^ai_account_0*(\d+)$/)?.[1] === aiAccountNumber));
  // ASSISTANT-THREAD-001: 助手有且仅有一个（proxy_ai canonical，服务端归一；
  // 老 user_proxy_ai 串本地也认成同一个）。ai 小美是用户，不在这里。
  const isAssistantPeer = item.counterpartyId === "proxy_ai" || item.counterpartyId === "user_proxy_ai";
  // GROUP-CREATE-001: GROUP 的 counterpartyId/Snapshot 只是"某一个非本人成员"
  // （服务端 listConversations 里第一个匹配到的，会随最新发言人变化），拿来
  // 当群名字等于把一个 3 人群显示成跟其中一个人的私聊。参与者总数是诚实的，
  // 名字用它拼，不编成员名单（客户端这里没有其他成员的 displayName）。
  const isGroup = item.conversation.conversationType === "GROUP";
  // ROOM-CREATE-001: 有 roomScene 就是「创建房间」建的房间，用房间名而不是
  // 泛泛的「群聊 · N 人」——列表里能认出哪个是哪个房间。
  const roomName = item.conversation.roomScene?.roomName?.trim();
  const isRoom = roomName !== undefined && roomName !== "";
  const name = isRoom ? roomName : isGroup ? `群聊 · ${item.conversation.participants.length} 人` : aiAccount?.displayName || snapshotName || (isAssistantPeer ? "AI助手" : item.counterpartyId) || "对话";
  const avatarRef = item.counterpartySnapshot?.avatarRef?.trim();
  // ASSISTANT-THREAD-001: 助手有且仅有一个（服务端已归一），行头像就是 logo。
  // 真人没解析出可用地址就不设 —— 以前兜底拼 user_<id> 的 thumb 全是 404，
  // 每行白发一个坏请求不说，expo 还只画空白。未知直接首字母。
  // 群头像同理：不拿"某个成员的照片"充当群像，宁可回落首字母。
  const avatarSource = isGroup ? undefined : aiAccount ? cachedAiAccountPhoto(aiAccount) : isAssistantPeer ? ASSISTANT_LOGO : resolveAvatarSource(avatarRef ?? "", apiBaseUrl);
  // MEETUP-SHARE-001: LOCATION 预览显示 [位置]（解不出才回落原文，不猜）。
  const preview = latest
    ? latest.messageType === "IMAGE" ? "[图片]" : latest.messageType === "VIDEO" ? "[视频]" : latest.messageType === "LOCATION" ? ((meetupPreview(latest.body ?? "") ?? latest.body?.trim()) || "新消息") : latest.body?.trim() || "新消息"
    : "暂无消息";
  // AI-MANAGE-013：「每次确认」下 AI 替你起草了回复、等你确认 —— 列表上就要看得出来，不然草稿永远躺着没人发。
  const previewText = item.standInDraftPending ? `[AI 草稿待你确认] ${preview}` : preview;
  const timestamp = latest?.createdAt || item.conversation.lastMessageAt;
  const parsed = new Date(timestamp);
  const time = Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  // 滑删对比用：最后动态毫秒（解不出按 0 计 —— 证不出有新动态就继续藏着，
  // 不把"不知道"当成"有更新"）。
  const lastActivity = new Date(item.conversation.lastMessageAt ?? 0);
  const lastActivityMs = Number.isNaN(lastActivity.getTime()) ? 0 : lastActivity.getTime();
  return {
    id: item.conversation.conversationId,
    conversationId: item.conversation.conversationId,
    ...(aiAccount ? { aiAccount } : {}),
    ...(avatarSource ? { avatarSource } : {}),
    // CONVO-AVATAR-PROFILE-001: 对方 userId 透给对话窗口，头像可点进主页。
    // AI 账号走 AI 主页入口；助手也透 id（窗口里认出 id 就不可点，因为没有主页）。
    ...(item.counterpartyId && !aiAccount && !isGroup ? { peerUserId: item.counterpartyId } : {}),
    initial: name.slice(0, 2).toUpperCase(),
    name,
    preview: previewText,
    lastActivityMs,
    time,
    badge: isGroup ? "群组" : item.conversation.originType,
    // UNREAD-PIPELINE-001: 未读徽标终于有真数据。>0 才挂 —— 0 和缺席都不画，
    // 不把“没有”画成“0 条未读”凑数。
    ...(item.unreadCount !== undefined && item.unreadCount > 0 ? { unread: String(item.unreadCount) } : {}),
    // R15.74: 透出 conversationType 给 Convo tab filter (GROUP/SUPPORT)
    type: item.conversation.conversationType,
    ...(isRoom ? { isRoom: true } : {}),
    folder: item.conversation.originType === "ACTIVITY" ? "activity" : item.conversation.originType === "PROFILE" ? "friends" : "all",
  };
}

// 服务端头像引用归一：http(s)/file 原样用；/ 开头拼 base；assets/<id>
// （profile avatar_path、AI persona 写真）转 thumb 真地址；avatar- 开头是
// 本机副本文件名、空串及其他格式认不出 —— 返回 undefined 交给首字母回落，
// 绝不拼个 404 出来（之前裸 assets/ 直接当 URL，Linh/Minh 行永远空白）。
function resolveAvatarSource(ref: string, apiBaseUrl?: string): { uri: string } | undefined {
  const trimmed = ref.trim();
  if (!trimmed) return undefined;
  if (/^(?:https?:|file:)/.test(trimmed)) return { uri: trimmed };
  if (trimmed.startsWith("/")) return { uri: `${apiBaseUrl ?? ""}${trimmed}` };
  const assetId = trimmed.startsWith("assets/") ? trimmed.slice("assets/".length).trim() : "";
  if (!assetId || assetId.startsWith("avatar-")) return undefined;
  return { uri: `${apiBaseUrl ?? ""}/v1/media/thumb/${encodeURIComponent(assetId)}` };
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: "#fffdf8" },
  safe: { height: 13, backgroundColor: "#fffdf8" },
  homeHead: { paddingHorizontal: 16, paddingTop: 3, backgroundColor: "#fffdf8" },
  homeTitle: { height: 48, flexDirection: "row", alignItems: "center" },
  homeTitleText: { fontSize: 30, fontWeight: "700", letterSpacing: -1.1, color: "#11110f" },
  homeActions: { marginLeft: "auto", flexDirection: "row", gap: 2 },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  iconBell: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", position: "relative" },
  bellDot: { position: "absolute", right: 6, top: 6, width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#f2ad29", borderWidth: 1, borderColor: "#fffdf8" },
  searchBox: { height: 38, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 12, backgroundColor: "#f6f3ee", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, marginTop: 5, marginBottom: 13 },
  searchInput: { flex: 1, fontSize: 13.5, color: "#11110f", paddingVertical: 0 },
  homeTabs: { flexDirection: "row", gap: 25, borderBottomWidth: 1, borderBottomColor: "#e8e3da" },
  homeTab: { height: 42, flexDirection: "row", alignItems: "center", paddingHorizontal: 1, borderBottomWidth: 2, borderBottomColor: "transparent" },
  homeTabActive: { borderBottomColor: "#11110f" },
  homeTabText: { fontSize: 13, fontWeight: "600", color: "#8a867f" },
  homeTabTextActive: { color: "#11110f", fontWeight: "700" },
  countBadge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: "#11110f", alignItems: "center", justifyContent: "center", marginLeft: 4 },
  countBadgeMuted: { backgroundColor: "#e8e3da" },
  countBadgeText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  folderRowWrap: { borderBottomWidth: 1, borderBottomColor: "#e8e3da", backgroundColor: "#fffefa" },
  folderRow: { flexDirection: "row", gap: 7, paddingHorizontal: 16, paddingVertical: 10, alignItems: "center" },
  folderChip: { height: 29, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 15, paddingHorizontal: 11, justifyContent: "center", backgroundColor: "transparent" },
  folderChipActive: { backgroundColor: "#11110f", borderColor: "#11110f" },
  folderChipText: { fontSize: 11, fontWeight: "600", color: "#77736c" },
  folderChipTextActive: { color: "#fff" },
  inlineSearch: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#fffefa", borderBottomWidth: 1, borderBottomColor: "#e8e3da" },
  inlineSearchInput: { flex: 1, height: 34, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 12, backgroundColor: "#fff", paddingHorizontal: 11, fontSize: 13 },
  inlineClear: { paddingHorizontal: 8, paddingVertical: 6 },
  inlineClearText: { fontSize: 11, fontWeight: "700", color: "#f2ad29" },
  homeBody: { flex: 1, backgroundColor: "#f1eee8" },
  sectionLabel: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 7, fontSize: 11, fontWeight: "700", color: "#9b978f", letterSpacing: 0.3 },
  dialog: { flexDirection: "row", gap: 11, paddingHorizontal: 16, paddingVertical: 11, alignItems: "center", backgroundColor: "#fffdf8", borderBottomWidth: 1, borderBottomColor: "#e8e3da" },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#e6e1d8", alignItems: "center", justifyContent: "center", position: "relative" },
  avatarWarm: { backgroundColor: "#f0c55f" },
  avatarBlue: { backgroundColor: "#dce9ea" },
  avatarDark: { backgroundColor: "#181715" },
  avatarText: { fontSize: 14, fontWeight: "700", color: "#11110f" },
  avatarTextDark: { color: "#fff" },
  dialogMain: { flex: 1, minWidth: 0 },
  dialogTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  dialogName: { fontSize: 14.5, fontWeight: "700", color: "#11110f" },
  badge: { height: 19, borderRadius: 10, paddingHorizontal: 7, backgroundColor: "#fff4da", justifyContent: "center" },
  badgeText: { fontSize: 11, fontWeight: "700", color: "#795817" },
  preview: { marginTop: 4, fontSize: 13, color: "#7d7972" },
  dialogSide: { alignItems: "flex-end", minWidth: 40 },
  time: { fontSize: 11, color: "#aaa69e" },
  unread: { marginTop: 7, minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, backgroundColor: "#11110f", alignItems: "center", justifyContent: "center" },
  unreadText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  empty: { textAlign: "center", paddingVertical: 24, fontSize: 12, color: "#aaa69e" },
  convoCard: { marginHorizontal: 14, marginTop: 10, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 15, padding: 12, backgroundColor: "#fffefa" },
  convoHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  convoMark: { width: 36, height: 36, borderRadius: 11, backgroundColor: "#11110f", alignItems: "center", justifyContent: "center" },
  convoCopy: { flex: 1, minWidth: 0 },
  convoName: { fontSize: 13.5, fontWeight: "700", color: "#11110f" },
  convoParent: { fontSize: 11, color: "#8d8982", marginTop: 2 },
  convoPreview: { marginTop: 9, fontSize: 12.5, lineHeight: 18, color: "#68645e" },
  convoFoot: { flexDirection: "row", alignItems: "center", marginTop: 9 },
  convoFootText: { flex: 1, fontSize: 11, color: "#99958d" },
  convoFootTime: { fontSize: 11, fontWeight: "700", color: "#54514b" },
  topbar: { height: 58, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "#e8e3da", backgroundColor: "rgba(255,253,248,0.98)" },
  centerTitle: { flex: 1, alignItems: "center" },
  centerMain: { fontSize: 14, fontWeight: "700", color: "#11110f" },
  centerSub: { fontSize: 11, color: "#8d8982", marginTop: 2 },
  backText: { fontSize: 22, color: "#11110f", textAlign: "center", width: 38 },
  requestIntro: { paddingHorizontal: 16, paddingTop: 15, paddingBottom: 8, fontSize: 11.5, lineHeight: 18, color: "#77736c" },
  mackeBanner: { marginHorizontal: 14, marginTop: 10, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 14, padding: 11, backgroundColor: "#fff9eb", flexDirection: "row", gap: 9, alignItems: "flex-start" },
  mackeIcon: { fontSize: 18 },
  mackeTitle: { fontSize: 11.5, fontWeight: "700", color: "#654e1e" },
  mackeMeta: { fontSize: 11, lineHeight: 15, color: "#8c8065", marginTop: 2 },
  requestCard: { marginHorizontal: 14, marginTop: 10, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 16, padding: 13, backgroundColor: "#fffefa" },
  requestTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  requestMsg: { fontSize: 13, lineHeight: 19, color: "#48453f", marginVertical: 11 },
  btnRow: { flexDirection: "row", gap: 8 },
  btn: { height: 34, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 18, paddingHorizontal: 14, justifyContent: "center", backgroundColor: "transparent" },
  btnPrimary: { backgroundColor: "#11110f", borderColor: "#11110f" },
  btnPrimaryText: { fontSize: 11.5, fontWeight: "700", color: "#fff", textAlign: "center" },
  btnText: { fontSize: 11.5, fontWeight: "700", color: "#11110f", textAlign: "center" },
  contactHeadSearch: { marginHorizontal: 14, marginTop: 8, height: 39, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 12, backgroundColor: "#f6f3ee", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11 },
  contactInput: { flex: 1, fontSize: 12.5, color: "#11110f" },
  contactSection: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, fontSize: 11, fontWeight: "700", color: "#9b978f", letterSpacing: 0.3 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 15, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#e8e3da", backgroundColor: "#fffdf8" },
  contactName: { fontSize: 13, fontWeight: "700", color: "#11110f" },
  contactMeta: { fontSize: 11, color: "#aaa69e", marginTop: 2 },
  // 左滑删除：behind 贴右全高，front 滑开露出；两段确认防误触。
  swipeBehind: { alignItems: "stretch", bottom: 0, flexDirection: "row", justifyContent: "flex-end", position: "absolute", right: 0, top: 0 },
  swipeDelete: { alignItems: "center", backgroundColor: "#D93B3B", justifyContent: "center", paddingHorizontal: 16 },
  swipeDeleteText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  contactAction: { fontSize: 11, fontWeight: "700", color: "#6e6962" },
  // GROUP-CREATE-001
  groupCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: "#d8d2c6", alignItems: "center", justifyContent: "center" },
  groupCheckOn: { backgroundColor: "#11110f", borderColor: "#11110f" },
  groupCheckMark: { color: "#fffdf8", fontSize: 12, fontWeight: "700" },
  groupComposeBar: { borderTopWidth: 1, borderTopColor: "#e8e3da", backgroundColor: "#fffdf8", paddingHorizontal: 14, paddingTop: 8, paddingBottom: 16 },
  groupError: { fontSize: 11, color: "#c0392b", marginBottom: 6 },
  groupComposeRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  groupComposeInput: { flex: 1, maxHeight: 90, fontSize: 13, color: "#11110f", borderWidth: 1, borderColor: "#e8e3da", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#f6f3ee" },
  groupCreateBtn: { height: 38, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#11110f", alignItems: "center", justifyContent: "center" },
  groupCreateBtnOff: { backgroundColor: "#d8d2c6" },
  groupCreateBtnText: { color: "#fffdf8", fontSize: 12.5, fontWeight: "700" },
  personHero: { alignItems: "center", paddingTop: 18, paddingBottom: 12 },
  personName: { fontSize: 17, fontWeight: "700", color: "#11110f", marginTop: 9 },
  personUser: { fontSize: 11, color: "#8f8b83", marginTop: 3 },
  personActions: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#e8e3da" },
  personAction: { alignItems: "center", gap: 5 },
  personActionIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: "#f6f3ee", alignItems: "center", justifyContent: "center" },
  personActionText: { fontSize: 11, fontWeight: "600", color: "#11110f" },
  aliasCard: { borderWidth: 1, borderColor: "#e8e3da", borderRadius: 14, padding: 11, backgroundColor: "#fffefa" },
  aliasLabel: { fontSize: 11, color: "#9a968e", marginBottom: 4 },
  aliasValue: { fontSize: 11.5, fontWeight: "600", color: "#11110f" },
});
