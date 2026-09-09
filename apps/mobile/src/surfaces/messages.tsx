// Messaging Home — 对齐 Lotus COMPLETE v8 单文件版
// 1:1 还原 v8 的 homeHead/homeTabs/folderRow/dialogs+convos + Requests(Mặc Kệ) 入口
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState, Modal, PanResponder, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, type ImageSourcePropType } from "react-native";
import { Image } from "expo-image";
import { Directory, File, Paths } from "expo-file-system";
import { SwipeBackShell } from "../architecture/swipe-back";
import { IdentitySwitcher } from "../components/identity-switcher";
import { parseCommandResult } from "../login-client";
import { ProxyIcon } from "../components/proxy-icon";
import { color, shadows } from "../theme";
import type { ConversationClient, ConversationInboxItem } from "../conversation-client";
import type { PlatformAIAccount } from "../ai-account-client";
import { BUNDLED_AI_COMPANIONS } from "../ai-companion-catalog";
import { dedupeInboxDialogs } from "../conversation-inbox-model";
import type { ProfileClient } from "../profile-client";
import { aiAccountPhoto } from "../ai-persona-presentation";

type HomePanel = "dialogs" | "convos" | "folders";
type Folder = "all" | "friends" | "activity" | "invite";

// v8 原型 mock 已删除（R36.x MOCK-001）：Dialog 只走 server
// listConversations()，空收件箱显示诚实空态，不再展示假会话。
type Dialog = { id: string; conversationId?: string; aiAccount?: PlatformAIAccount; avatarSource?: number | { uri: string }; initial: string; name: string; badge?: string; preview: string; time: string; unread?: string; warm?: boolean; blue?: boolean; dark?: boolean; online?: boolean; folder: Folder; type?: string };
// R15.74: CONVOS 走 server GROUP | SUPPORT filter（DM 在 dialogs tab）。

const FOLDER_LABEL: Record<Folder, string> = { all: "全部", friends: "朋友", activity: "活动", invite: "邀约" };

// 文件夹媒体浏览器（微信式）：照片/视频格子 + 发送人，按日期分组。
// 数据来自各会话真实消息体（IMAGE/VIDEO + mediaRef），不是会话列表。
// 文件暂无协议类型，不设假入口。
export type FolderMediaKind = "IMAGE" | "VIDEO";
export interface FolderMediaItem {
  id: string;
  kind: FolderMediaKind;
  uri: string;
  sender: string;
  conversationId: string;
  conversationName: string;
  timestampMs: number;
  timeText: string;
}
function dayBucket(timestampMs: number): "今天" | "昨天" | "更早" {
  if (!timestampMs) return "更早";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (timestampMs >= startToday) return "今天";
  if (timestampMs >= startToday - 86_400_000) return "昨天";
  return "更早";
}

// 本机隐藏的会话（左滑删除）：服务端没有删会话接口，删除 = 本机可见性，
// 服务端保留审计（与“清空本机显示”同口径）。落盘持久化，重进/重启不回来。
const hiddenChatsDir = new Directory(Paths.document, "proxy-hidden-chats");
const hiddenChatsFile = new File(hiddenChatsDir, "hidden-v1.json");
function readHiddenChatIds(): string[] {
  try {
    if (!hiddenChatsFile.exists) return [];
    const raw: unknown = hiddenChatsFile.json();
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeHiddenChatIds(ids: ReadonlyArray<string>): void {
  try {
    hiddenChatsDir.create({ idempotent: true, intermediates: true });
    hiddenChatsFile.write(JSON.stringify(ids));
  } catch {
    // 持久化失败不打断删除（本会话内照样隐藏）。
  }
}

const SWIPE_DELETE_W = 84;
const SWIPE_CONFIRM_W = 168;
// 松手/被抢走时的结算阈值：轻滑 24px 即展开，不必过半，更不会中途收回。
const SWIPE_OPEN_DX = 24;

// 左滑删除行：无手势库，用 PanResponder 实现。横滑 dx 主导才接管，
// 竖滑留给列表；点按（无位移）不受影响。删除两段确认，防误触。
function SwipeableRow({ onDelete, children }: { onDelete: () => void; children: React.ReactNode }): React.JSX.Element {
  const tx = useRef(new Animated.Value(0)).current;
  const startX = useRef(0);
  const lastDx = useRef(0);
  const openW = useRef(0);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);
  confirmingRef.current = confirming;
  const snapTo = useCallback((w: number) => {
    openW.current = w;
    setOpen(w > 0);
    Animated.spring(tx, { toValue: -w, useNativeDriver: true, tension: 320, friction: 32 }).start();
  }, [tx]);
  const close = useCallback(() => { setConfirming(false); snapTo(0); }, [snapTo]);
  useEffect(() => {
    // 确认态切换时按钮区变宽，已展开就跟到新宽度。
    if (open) snapTo(confirmingRef.current ? SWIPE_CONFIRM_W : SWIPE_DELETE_W);
  }, [confirming, open, snapTo]);
  function settle(dx: number, vx: number): void {
    const w = confirmingRef.current ? SWIPE_CONFIRM_W : SWIPE_DELETE_W;
    const wasOpen = openW.current > 0;
    let target = 0;
    if (!wasOpen && (dx < -SWIPE_OPEN_DX || vx < -0.4)) target = w;
    else if (wasOpen && (dx > SWIPE_OPEN_DX || vx > 0.4)) target = 0;
    else if (wasOpen) target = w;
    if (target === 0) setConfirming(false);
    snapTo(target);
  }
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > Math.abs(gs.dy) && Math.abs(gs.dx) > 8,
    onPanResponderGrant: () => { startX.current = -openW.current; lastDx.current = 0; },
    onPanResponderMove: (_, gs) => {
      lastDx.current = gs.dx;
      const w = confirmingRef.current ? SWIPE_CONFIRM_W : SWIPE_DELETE_W;
      tx.setValue(Math.min(0, Math.max(-w, startX.current + gs.dx)));
    },
    onPanResponderRelease: (_, gs) => settle(gs.dx, gs.vx),
    // 被父列表抢走手势（竖飘）也不中途收回：按最后位移同样结算。
    onPanResponderTerminate: () => settle(lastDx.current, 0),
  })).current;
  return (
    <View>
      <View style={[styles.swipeBehind, { width: confirming ? SWIPE_CONFIRM_W : SWIPE_DELETE_W }]}>
        {!confirming ? (
          <Pressable onPress={() => setConfirming(true)} style={styles.swipeDelete} accessibilityLabel="删除对话">
            <Text style={styles.swipeDeleteText}>删除</Text>
          </Pressable>
        ) : (
          <>
            <Pressable onPress={close} style={styles.swipeCancel} accessibilityLabel="取消删除">
              <Text style={styles.swipeCancelText}>取消</Text>
            </Pressable>
            <Pressable onPress={onDelete} style={styles.swipeDelete} accessibilityLabel="确认删除对话">
              <Text style={styles.swipeDeleteText}>确认删除</Text>
            </Pressable>
          </>
        )}
      </View>
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: tx }] }}>
        {open ? <Pressable accessibilityLabel="收起删除" onPress={close} style={StyleSheet.absoluteFill} /> : null}
        {children}
      </Animated.View>
    </View>
  );
}

export function MessagesSurface({
  onOpenConversation,
  onOpenRequests,
  onOpenContacts,
  bottomNavVisible,
  displayIdentityClient,
  activeIdentityId,
  onSwitchIdentity,
  conversationClient,
  profileClient,
  apiBaseUrl,
}: {
  onOpenConversation: (author: string, conversationId?: string, aiAccount?: PlatformAIAccount, avatarSource?: number | { uri: string }) => void;
  onOpenRequests?: () => void;
  onOpenContacts?: () => void;
  onChromeVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
  initialTab?: "CHAT" | "FRIENDS";
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
  const searchInputRef = useRef<TextInput>(null);
  const [subView, setSubView] = useState<"home" | "requests" | "contacts" | "person">("home");
  const [personName, setPersonName] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  // 文件夹页类型筛选：全部/照片/视频。
  const [folderKind, setFolderKind] = useState<"all" | FolderMediaKind>("all");
  // 文件夹媒体：首次进文件夹页时扫描各会话消息体；失败整页重试。
  const [folderMedia, setFolderMedia] = useState<FolderMediaItem[] | undefined>(undefined);
  const [folderMediaError, setFolderMediaError] = useState(false);
  const [folderMediaNonce, setFolderMediaNonce] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const folderScannedRef = useRef(false);
  const visibleDialogsRef = useRef<Dialog[]>([]);


  const [serverDialogs, setServerDialogs] = useState<Dialog[]>();
  const [inboxError, setInboxError] = useState(false);
  // 左滑删除的本机隐藏集：落盘，服务端刷新回来也照样过滤。
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set(readHiddenChatIds()));
  const hideDialog = useCallback((id: string) => {
    setHiddenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      writeHiddenChatIds([...next]);
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
    () => (serverDialogs ?? []).filter((d) => !hiddenIds.has(d.id)),
    [serverDialogs, hiddenIds]
  );
  visibleDialogsRef.current = visibleDialogs;
  const pinnedSource: Dialog[] = [];
  const recentSource = visibleDialogs;
  // R15.74: Convo tab (panel="convos") — 从 serverDialogs 拿 GROUP/SUPPORT conversation
  //   之前 (Phase 1) 走写死 CONVOS mock — 跟 server listConversations 不接.
  const groupDialogs = useMemo(
    () => visibleDialogs.filter((d) => {
      // 上一行 toDialog 已把 conversation.conversationType 透出到 type 字段 (见下).
      // 没 type 字段时 fallback 视为 DM 不显示在 Convo 标签.
      const t = (d as unknown as { type?: string }).type;
      return t === "GROUP" || t === "SUPPORT";
    }),
    [visibleDialogs]
  );
  useEffect(() => {
    if (panel !== "folders" || !conversationClient || folderScannedRef.current) return;
    if (!inboxLoaded) return;
    folderScannedRef.current = true;
    let cancelled = false;
    setFolderMedia(undefined);
    setFolderMediaError(false);
    void (async () => {
      const settled = await Promise.allSettled(visibleDialogsRef.current.map(async (dialog) => {
        if (!dialog.conversationId) return [];
        const raw = await conversationClient.listMessages(dialog.conversationId);
        const parsed = parseCommandResult(raw);
        const body = parsed?.operationRef ? JSON.parse(parsed.operationRef) as { messages?: Array<Record<string, unknown>>; actorId?: string } : undefined;
        const rows = Array.isArray(body?.messages) ? body.messages : [];
        const out: FolderMediaItem[] = [];
        for (const row of rows) {
          const kind = row.messageType === "IMAGE" ? "IMAGE" : row.messageType === "VIDEO" ? "VIDEO" : undefined;
          if (!kind || typeof row.mediaRef !== "string" || !row.mediaRef) continue;
          const created = new Date(String(row.createdAt ?? Date.now())).getTime();
          const timestampMs = Number.isFinite(created) ? created : 0;
          const senderSnapshot = row.senderSnapshot as { displayName?: string } | undefined;
          out.push({
            id: String(row.messageId ?? `${dialog.id}-${out.length}`),
            kind,
            uri: `${conversationClient.baseUrl}/v1/media/${kind === "IMAGE" ? "thumb" : "play"}/${encodeURIComponent(row.mediaRef)}`,
            sender: row.senderId === body?.actorId ? "你" : (senderSnapshot?.displayName || dialog.name),
            conversationId: dialog.id,
            conversationName: dialog.name,
            timestampMs,
            timeText: timestampMs ? new Date(timestampMs).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "",
          });
        }
        return out;
      }));
      if (cancelled) return;
      const failed = settled.filter((r) => r.status === "rejected").length;
      const items = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      items.sort((a, b) => b.timestampMs - a.timestampMs);
      // 全部会话都失败才算失败；部分失败只展示拉到的（图片墙不因个别会话空白）。
      if (items.length === 0 && failed > 0) setFolderMediaError(true);
      else setFolderMedia(items);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, conversationClient, inboxLoaded, folderMediaNonce]);

  const filteredPinned = useMemo(() => filterByFolder(pinnedSource, folder, search), [pinnedSource, folder, search]);
  const filteredRecent = useMemo(() => filterByFolder(recentSource, folder, search), [recentSource, folder, search]);

  const openRequests = () => {
    if (onOpenRequests) onOpenRequests();
    else setSubView("requests");
  };
  const openContacts = () => {
    if (onOpenContacts) onOpenContacts();
    else setSubView("contacts");
  };
  // 联系人详情带上会话上下文：名字 + 最近消息 + 会话 id，
  // “消息”按钮直达该会话，不断链；在线/username/手机号之前是现编的，已去掉。
  const [personCtx, setPersonCtx] = useState<{ name: string; preview?: string | undefined; time?: string | undefined; conversationId?: string | undefined; aiAccount?: PlatformAIAccount; avatarSource?: number | { uri: string } }>({ name: "" });
  const openPerson = (contact: { name: string; preview?: string | undefined; time?: string | undefined; conversationId?: string | undefined; aiAccount?: PlatformAIAccount; avatarSource?: number | { uri: string } }) => {
    setPersonCtx(contact);
    setPersonName(contact.name);
    setSubView("person");
  };

  if (subView === "requests") {
    return (
      <SwipeBackShell onExit={() => setSubView("home")}>
        <View style={styles.app}>
          <View style={styles.safe} />
          <View style={styles.topbar}>
            <Pressable onPress={() => setSubView("home")} style={styles.icon}><Text style={styles.backText}>‹</Text></Pressable>
            <View style={styles.centerTitle}><Text style={styles.centerMain}>陌生消息</Text><Text style={styles.centerSub}>Mặc Kệ</Text></View>
            <View style={{ width: 38 }} />
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
            <Text style={styles.requestIntro}>陌生人的消息自动进入 Mặc Kệ，不打扰正常 Dialog。回复或移到关注后，才进入正常消息流。</Text>
            <View style={styles.mackeBanner}>
              <Text style={styles.mackeIcon}>💬</Text>
              <View style={{ flex: 1 }}><Text style={styles.mackeTitle}>默认静音</Text><Text style={styles.mackeMeta}>这里的消息不推送通知。你可以回复、移到关注，或把普通 Dialog 反向移进来。</Text></View>
            </View>
            <Text style={styles.empty}>暂无陌生消息</Text>
          </ScrollView>
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
            <Pressable onPress={() => setSubView("home")} style={styles.icon}><Text style={styles.backText}>‹</Text></Pressable>
            <View style={styles.centerTitle}><Text style={styles.centerMain}>新聊天</Text><Text style={styles.centerSub}>联系人 / Username</Text></View>
            <View style={styles.icon} />
          </View>
          <View style={styles.contactHeadSearch}>
            <ProxyIcon color="#97938b" name="search" size={17} />
            <TextInput value={contactSearch} onChangeText={setContactSearch} placeholder="姓名或最近消息" placeholderTextColor="#9a968f" style={styles.contactInput} />
          </View>
          <ScrollView style={{ flex: 1 }}>
            <Text style={styles.contactSection}>已在 Proxy · 来自你的收件箱</Text>
            {filtered.length === 0 ? <Text style={styles.empty}>{serverDialogs === undefined ? "加载中…" : "暂无联系人"}</Text> : null}
            {filtered.map((c) => (
              <Pressable key={`${c.name}-${c.conversationId ?? ""}`} onPress={() => openPerson(c)} style={styles.contactRow}>
                {c.avatarSource ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`avatar:contact:${c.conversationId ?? c.name}`} source={c.avatarSource} style={styles.avatar} transition={0} /> : <View style={styles.avatar}><Text style={styles.avatarText}>{c.name.slice(0, 1)}</Text></View>}
                <View style={{ flex: 1 }}><Text style={styles.contactName}>{c.name}</Text><Text style={styles.contactMeta}>{c.preview}</Text><Text style={styles.contactMeta}>{c.time}</Text></View>
                <Text style={styles.contactAction}>聊天 ›</Text>
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
            <Pressable onPress={() => setSubView("contacts")} style={styles.icon}><Text style={styles.backText}>‹</Text></Pressable>
            <View style={styles.centerTitle}><Text style={styles.centerMain}>联系人</Text></View>
            <View style={styles.icon} />
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={styles.personHero}>{personCtx.avatarSource ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`avatar:person:${personCtx.conversationId ?? personName}`} source={personCtx.avatarSource} style={[styles.avatar, { width: 70, height: 70, borderRadius: 35, alignSelf: "center" }]} transition={0} /> : <View style={[styles.avatar, styles.avatarWarm, { width: 70, height: 70, borderRadius: 35, alignSelf: "center" }]}><Text style={[styles.avatarText, { fontSize: 18 }]}>{personName.slice(0, 1)}</Text></View>}<Text style={styles.personName}>{personName}</Text><Text style={styles.personUser}>{personCtx.time ? `最近消息 · ${personCtx.time}` : "Proxy 联系人"}</Text></View>
          <View style={styles.personActions}>
            <Pressable onPress={() => onOpenConversation(personName, personCtx.conversationId, personCtx.aiAccount, personCtx.avatarSource)} style={styles.personAction}><View style={styles.personActionIcon}><ProxyIcon color={color.ink} name="chat" size={18} /></View><Text style={styles.personActionText}>消息</Text></Pressable>
            <Pressable onPress={() => void Share.share({ message: `Proxy 联系人：${personName}（本地通讯录）` })} style={styles.personAction} accessibilityLabel="分享联系人"><View style={styles.personActionIcon}><Text style={{ fontSize: 12 }}>🔗</Text></View><Text style={styles.personActionText}>分享</Text></Pressable>
          </View>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {personCtx.preview ? <View style={styles.aliasCard}><Text style={styles.aliasLabel}>最近消息</Text><Text style={styles.aliasValue} numberOfLines={2}>{personCtx.preview}</Text></View> : null}
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
          <Text style={styles.homeTitleText}>信息</Text>
          <View style={styles.homeActions}>
            <Pressable accessibilityLabel="搜索" onPress={() => searchInputRef.current?.focus()} style={styles.icon}>
              <ProxyIcon color={color.ink} name="search" size={20} />
            </Pressable>
              <Pressable accessibilityLabel="消息请求" onPress={openRequests} style={styles.iconBell}>
                <ProxyIcon color={color.ink} name="mail" size={20} />
              </Pressable>
            <Pressable accessibilityLabel="新聊天" onPress={openContacts} style={styles.icon}>
              <ProxyIcon color={color.ink} name="chat" size={20} />
            </Pressable>
          </View>
        </View>

        <View style={styles.searchBox}>
          <ProxyIcon color="#9a968f" name="search" size={17} />
          <TextInput
            ref={searchInputRef}
            value={search}
            onChangeText={setSearch}
            placeholder="搜索聊天、联系人和消息"
            placeholderTextColor="#9a968f"
            returnKeyType="search"
            style={styles.searchInput}
          />
          {search ? <Pressable accessibilityLabel="清除搜索" onPress={() => setSearch("")}><Text style={styles.inlineClearText}>清除</Text></Pressable> : null}
        </View>

        {/* 对话/Convo/文件夹三页签并列 */}
        <View style={styles.homeTabs}>
          <Pressable onPress={() => setPanel("dialogs")} style={[styles.homeTab, panel === "dialogs" && styles.homeTabActive]}>
            <Text style={[styles.homeTabText, panel === "dialogs" && styles.homeTabTextActive]}>对话</Text>
            <View style={[styles.countBadge, panel !== "dialogs" && styles.countBadgeMuted]}>
              <Text style={styles.countBadgeText}>{filteredRecent.length}</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => setPanel("convos")} style={[styles.homeTab, panel === "convos" && styles.homeTabActive]}>
            <Text style={[styles.homeTabText, panel === "convos" && styles.homeTabTextActive]}>Convo</Text>
            <View style={[styles.countBadge, panel !== "convos" && styles.countBadgeMuted]}>
              <Text style={styles.countBadgeText}>{groupDialogs.length}</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => setPanel("folders")} style={[styles.homeTab, panel === "folders" && styles.homeTabActive]} accessibilityLabel="文件夹">
            <Text style={[styles.homeTabText, panel === "folders" && styles.homeTabTextActive]}>文件夹</Text>
            <View style={[styles.countBadge, panel !== "folders" && styles.countBadgeMuted]}>
              <Text style={styles.countBadgeText}>{visibleDialogs.length}</Text>
            </View>
          </Pressable>
        </View>
      </View>

      {/* 系统筛选 chips：只对对话列表有意义，Convo/文件夹页不展示 */}
      {panel === "dialogs" ? (
      <View style={styles.folderRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.folderRow}>
          {(Object.keys(FOLDER_LABEL) as Folder[]).map((f) => (
            <Pressable key={f} onPress={() => setFolder(f)} style={[styles.folderChip, folder === f && styles.folderChipActive]}>
              <Text style={[styles.folderChipText, folder === f && styles.folderChipTextActive]}>{FOLDER_LABEL[f]}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      ) : null}

      {/* body */}
      <ScrollView style={styles.homeBody} contentContainerStyle={{ paddingBottom: bottomNavVisible === false ? 16 : 96 }}>
        {panel === "dialogs" ? (
          <>
            {filteredPinned.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>置顶</Text>
                {filteredPinned.map((d) => (
                  <SwipeableRow key={d.id} onDelete={() => hideDialog(d.id)}>
                  <Pressable onPress={() => onOpenConversation(d.name, d.conversationId, d.aiAccount, d.avatarSource)} style={styles.dialog}>
                    {d.avatarSource ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`avatar:dialog:${d.conversationId ?? d.id}`} source={d.avatarSource} style={styles.avatar} transition={0} /> : <View style={[styles.avatar, (d as Dialog).warm && styles.avatarWarm, (d as Dialog).blue && styles.avatarBlue, (d as Dialog).dark && styles.avatarDark]}>
                      <Text style={[styles.avatarText, (d as Dialog).dark && styles.avatarTextDark]}>{d.initial}</Text>
                      {(d as Dialog).online ? <View style={styles.online} /> : null}
                    </View>}
                    <View style={styles.dialogMain}>
                      <View style={styles.dialogTop}>
                        <Text style={styles.dialogName} numberOfLines={1}>{d.name}</Text>
                        {d.badge ? <View style={styles.badge}><Text style={styles.badgeText}>{d.badge}</Text></View> : null}
                      </View>
                      <Text style={styles.preview} numberOfLines={1}>{d.preview}</Text>
                    </View>
                    <View style={styles.dialogSide}>
                      <Text style={styles.time}>{d.time}</Text>
                      {d.unread ? <View style={styles.unread}><Text style={styles.unreadText}>{d.unread}</Text></View> : null}
                    </View>
                  </Pressable>
                  </SwipeableRow>
                ))}
              </>
            ) : null}

            {!inboxLoaded ? (
              <Text style={styles.empty}>加载中…</Text>
            ) : filteredRecent.length > 0 ? (
              filteredRecent.map((d) => (
                <SwipeableRow key={d.id} onDelete={() => hideDialog(d.id)}>
                <Pressable onPress={() => onOpenConversation(d.name, d.conversationId, d.aiAccount, d.avatarSource)} style={styles.dialog}>
                  {d.avatarSource ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`avatar:recent:${d.conversationId ?? d.id}`} source={d.avatarSource} style={styles.avatar} transition={0} /> : <View style={[styles.avatar, (d as Dialog).warm && styles.avatarWarm, (d as Dialog).blue && styles.avatarBlue, (d as Dialog).dark && styles.avatarDark]}>
                    <Text style={[styles.avatarText, (d as Dialog).dark && styles.avatarTextDark]}>{d.initial}</Text>
                  </View>}
                  <View style={styles.dialogMain}>
                    <View style={styles.dialogTop}><Text style={styles.dialogName}>{d.name}</Text></View>
                    <Text style={styles.preview} numberOfLines={1}>{d.preview}</Text>
                  </View>
                    <View style={styles.dialogSide}>
                      <Text style={styles.time}>{d.time}</Text>
                      {d.unread ? <View style={styles.unread}><Text style={styles.unreadText}>{d.unread}</Text></View> : null}
                    </View>
                  </Pressable>
                  </SwipeableRow>
                ))
            ) : (
              <Text style={styles.empty}>还没有对话 — 从动态或市场开始聊一下</Text>
            )}
          </>
        ) : panel === "convos" ? (
          <>
            <Text style={styles.sectionLabel}>关注的 Convo</Text>
            {groupDialogs.length === 0 ? (
              <Text style={styles.preview}>还没有群组对话</Text>
            ) : null}
            {groupDialogs.map((c) => (
              <SwipeableRow key={c.id} onDelete={() => hideDialog(c.id)}>
              <Pressable onPress={() => onOpenConversation(c.name, c.conversationId)} style={styles.convoCard}>
                <View style={styles.convoHead}>
                  <View style={styles.convoMark}><ProxyIcon color="#fff" name="chat" size={16} /></View>
                  <View style={styles.convoCopy}>
                    <Text style={styles.convoName}>{c.name}</Text>
                    <Text style={styles.convoParent}>{c.badge ?? "群组"}</Text>
                  </View>
                  {c.unread ? <View style={styles.unread}><Text style={styles.unreadText}>{c.unread}</Text></View> : null}
                </View>
                <Text style={styles.convoPreview} numberOfLines={1}>{c.preview}</Text>
                <View style={styles.convoFoot}><Text style={styles.convoFootText}>{c.time}</Text></View>
              </Pressable>
              </SwipeableRow>
            ))}
          </>
        ) : (
          <>
            {/* 类型筛选：照片/视频取各会话真实消息体；文件暂无协议类型，不设假入口 */}
            <View style={styles.folderRowWrap}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.folderRow}>
                {([["all", "全部"], ["IMAGE", "照片"], ["VIDEO", "视频"]] as const).map(([id, label]) => (
                  <Pressable key={id} onPress={() => { setFolderKind(id); setViewerIndex(null); }} style={[styles.folderChip, folderKind === id && styles.folderChipActive]} accessibilityLabel={`只看${label}`}>
                    <Text style={[styles.folderChipText, folderKind === id && styles.folderChipTextActive]}>{label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            {(() => {
              if (folderMedia === undefined && !folderMediaError) {
                return <Text style={styles.empty}>正在整理照片和视频…</Text>;
              }
              if (folderMediaError || folderMedia === undefined) {
                return (
                  <>
                    <Text style={styles.empty}>媒体加载失败，请检查连接后重试</Text>
                    <Pressable
                      onPress={() => { folderScannedRef.current = false; setFolderMediaError(false); setFolderMediaNonce((n) => n + 1); }}
                      style={[styles.folderChip, { alignSelf: "center", marginTop: 8 }]}
                      accessibilityLabel="重新整理"
                    >
                      <Text style={styles.folderChipText}>重新整理</Text>
                    </Pressable>
                  </>
                );
              }
              const typed = folderKind === "all" ? folderMedia : folderMedia.filter((m) => m.kind === folderKind);
              const kindLabel = folderKind === "IMAGE" ? "照片" : folderKind === "VIDEO" ? "视频" : "照片和视频";
              if (typed.length === 0) {
                return <Text style={styles.empty}>{folderMedia.length === 0 ? "会话里还没有照片和视频" : `没有${kindLabel}，看看其他类型`}</Text>;
              }
              const buckets: Array<{ title: "今天" | "昨天" | "更早"; items: FolderMediaItem[] }> = (["今天", "昨天", "更早"] as const)
                .map((title) => ({ title, items: typed.filter((m) => dayBucket(m.timestampMs) === title) }))
                .filter((g) => g.items.length > 0);
              const photos = typed.filter((m) => m.kind === "IMAGE");
              const viewing = viewerIndex !== null ? photos[viewerIndex] : undefined;
              return (
                <>
                  {buckets.map((group) => (
                    <View key={group.title}>
                      <Text style={styles.sectionLabel}>{group.title}</Text>
                      <View style={styles.mediaGrid}>
                        {group.items.map((m) => (
                          <View key={m.id} style={styles.mediaCell}>
                            {m.kind === "IMAGE" ? (
                              <Pressable
                                onPress={() => {
                                  const at = photos.findIndex((p) => p.id === m.id);
                                  if (at >= 0) setViewerIndex(at);
                                }}
                                accessibilityLabel={`查看${m.sender}的照片`}
                              >
                                <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`media:${m.id}`} source={{ uri: m.uri }} style={styles.mediaThumb} transition={0} />
                              </Pressable>
                            ) : (
                              <Pressable
                                onPress={() => onOpenConversation(m.conversationName, m.conversationId)}
                                style={styles.mediaVideo}
                                accessibilityLabel={`去看${m.sender}的视频`}
                              >
                                <Text style={styles.mediaPlay}>▶</Text>
                              </Pressable>
                            )}
                            <Text style={styles.mediaSender} numberOfLines={1}>{m.sender}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                  {viewing ? (
                    <Modal transparent animationType="fade" visible onRequestClose={() => setViewerIndex(null)}>
                      <View style={styles.viewerRoot}>
                        <Image cachePolicy="memory-disk" contentFit="contain" recyclingKey={`media:viewer:${viewing.id}`} source={{ uri: viewing.uri }} style={styles.viewerImage} transition={0} />
                        <Text style={styles.viewerCaption} numberOfLines={1}>{viewing.sender} · {viewing.conversationName} · {viewing.timeText}</Text>
                        <View style={styles.viewerBar}>
                          <Pressable
                            disabled={viewerIndex === 0}
                            onPress={() => setViewerIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
                            style={styles.viewerNav}
                            accessibilityLabel="上一张"
                          >
                            <Text style={styles.viewerNavText}>‹</Text>
                          </Pressable>
                          <Pressable onPress={() => setViewerIndex(null)} style={styles.viewerNav} accessibilityLabel="关闭查看">
                            <Text style={styles.viewerNavText}>×</Text>
                          </Pressable>
                          <Pressable
                            disabled={viewerIndex === null || viewerIndex >= photos.length - 1}
                            onPress={() => setViewerIndex((i) => (i !== null && i < photos.length - 1 ? i + 1 : i))}
                            style={styles.viewerNav}
                            accessibilityLabel="下一张"
                          >
                            <Text style={styles.viewerNavText}>›</Text>
                          </Pressable>
                        </View>
                      </View>
                    </Modal>
                  ) : null}
                </>
              );
            })()}
          </>
        )}
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
    || (aiAccountNumber !== undefined && account.accountId.match(/^ai_account_0*(\d+)$/)?.[1] === aiAccountNumber));
  const name = aiAccount?.displayName || snapshotName || (item.counterpartyId === "proxy_ai" ? "Proxy AI" : item.counterpartyId) || "对话";
  const avatarRef = item.counterpartySnapshot?.avatarRef?.trim();
  const avatarSource = aiAccount ? aiAccountPhoto(aiAccount) : avatarRef ? resolveAvatarSource(avatarRef, apiBaseUrl) : undefined;
  const preview = latest
    ? latest.messageType === "IMAGE" ? "[图片]" : latest.messageType === "VIDEO" ? "[视频]" : latest.body?.trim() || "新消息"
    : "暂无消息";
  const timestamp = latest?.createdAt || item.conversation.lastMessageAt;
  const parsed = new Date(timestamp);
  const time = Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return {
    id: item.conversation.conversationId,
    conversationId: item.conversation.conversationId,
    ...(aiAccount ? { aiAccount } : {}),
    ...(avatarSource ? { avatarSource } : {}),
    initial: name.slice(0, 2).toUpperCase(),
    name,
    preview,
    time,
    badge: item.conversation.originType,
    // R15.74: 透出 conversationType 给 Convo tab filter (GROUP/SUPPORT)
    type: item.conversation.conversationType,
    folder: item.conversation.originType === "ACTIVITY" ? "activity" : item.conversation.originType === "PROFILE" ? "friends" : "all",
  };
}

function resolveAvatarSource(ref: string, apiBaseUrl?: string): { uri: string } {
  if (/^(?:https?:|file:)/.test(ref)) return { uri: ref };
  if (ref.startsWith("/")) return { uri: `${apiBaseUrl ?? ""}${ref}` };
  return { uri: `${apiBaseUrl ?? ""}/v1/media/thumb/${encodeURIComponent(ref)}` };
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
  online: { position: "absolute", right: 1, bottom: 1, width: 11, height: 11, borderRadius: 5.5, backgroundColor: "#111", borderWidth: 2, borderColor: "#fffdf8" },
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
  // 文件夹媒体墙：3 列照片格 + 发送人 + 日期分组 + 全屏查看。
  mediaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingBottom: 4 },
  mediaCell: { width: "31%", marginBottom: 10 },
  mediaThumb: { aspectRatio: 1, borderRadius: 12, width: "100%", backgroundColor: "#f1eee8" },
  mediaVideo: { aspectRatio: 1, borderRadius: 12, width: "100%", backgroundColor: "#11110f", alignItems: "center", justifyContent: "center" },
  mediaPlay: { color: "#fff", fontSize: 22, fontWeight: "800" },
  mediaSender: { fontSize: 11, color: "#77736c", marginTop: 4 },
  viewerRoot: { flex: 1, backgroundColor: "rgba(10,9,12,0.96)", justifyContent: "center", paddingHorizontal: 12 },
  viewerImage: { width: "100%", height: "70%" },
  viewerCaption: { color: "#d8d4cf", fontSize: 12, marginTop: 10, textAlign: "center" },
  viewerBar: { flexDirection: "row", justifyContent: "space-around", marginTop: 14 },
  viewerNav: { paddingHorizontal: 22, paddingVertical: 10 },
  viewerNavText: { color: "#fff", fontSize: 26, fontWeight: "800" },
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
  swipeCancel: { alignItems: "center", backgroundColor: "#8d8981", justifyContent: "center", paddingHorizontal: 14 },
  swipeCancelText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  contactAction: { fontSize: 11, fontWeight: "700", color: "#6e6962" },
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
