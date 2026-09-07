// Messaging Home — 对齐 Lotus COMPLETE v8 单文件版
// 1:1 还原 v8 的 homeHead/homeTabs/folderRow/dialogs+convos + Requests(Mặc Kệ) 入口
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SwipeBackShell } from "../architecture/swipe-back";
import { FolderManager, type FolderV1 } from "../components/folder-manager";
import { IdentitySwitcher } from "../components/identity-switcher";
import { ProxyIcon } from "../components/proxy-icon";
import { color, shadows } from "../theme";
import type { ConversationClient, ConversationInboxItem } from "../conversation-client";

type HomePanel = "dialogs" | "convos";
type Folder = "all" | "friends" | "activity" | "invite";

// v8 原型 mock 已删除（R36.x MOCK-001）：Dialog 只走 server
// listConversations()，空收件箱显示诚实空态，不再展示假会话。
type Dialog = { id: string; conversationId?: string; initial: string; name: string; badge?: string; preview: string; time: string; unread?: string; warm?: boolean; blue?: boolean; dark?: boolean; online?: boolean; folder: Folder; type?: string };
// R15.74: CONVOS 走 server GROUP | SUPPORT filter（DM 在 dialogs tab）。

const FOLDER_LABEL: Record<Folder, string> = { all: "全部", friends: "朋友", activity: "活动", invite: "邀约" };

export function MessagesSurface({
  onOpenConversation,
  onOpenRequests,
  onOpenContacts,
  bottomNavVisible,
  displayIdentityClient,
  activeIdentityId,
  onSwitchIdentity,
  conversationClient,
}: {
  onOpenConversation: (author: string, conversationId?: string) => void;
  onOpenRequests?: () => void;
  onOpenContacts?: () => void;
  onChromeVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
  initialTab?: "CHAT" | "FRIENDS";
  displayIdentityClient?: import("../display-identity-client").DisplayIdentityClient;
  activeIdentityId?: string;
  onSwitchIdentity?: (id: string) => void;
  conversationClient?: ConversationClient;
}): React.JSX.Element {
  const [panel, setPanel] = useState<HomePanel>("dialogs");
  const [folder, setFolder] = useState<Folder>("all");
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<TextInput>(null);
  const [subView, setSubView] = useState<"home" | "requests" | "contacts" | "person">("home");
  const [personName, setPersonName] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [folders, setFolders] = useState<FolderV1[]>([]);

  const [serverDialogs, setServerDialogs] = useState<Dialog[]>();
  const [inboxError, setInboxError] = useState(false);

  useEffect(() => {
    if (!conversationClient) return;
    let cancelled = false;
    conversationClient.listConversations().then((items) => {
      if (cancelled) return;
      setServerDialogs(items.map(toDialog));
      setInboxError(false);
    }).catch(() => {
      if (!cancelled) setInboxError(true);
    });
    return () => { cancelled = true; };
  }, [conversationClient]);

  const inboxLoaded = serverDialogs !== undefined || inboxError;
  const pinnedSource: Dialog[] = [];
  const recentSource = serverDialogs ?? [];
  // R15.74: Convo tab (panel="convos") — 从 serverDialogs 拿 GROUP/SUPPORT conversation
  //   之前 (Phase 1) 走写死 CONVOS mock — 跟 server listConversations 不接.
  const groupDialogs = useMemo(
    () => (serverDialogs ?? []).filter((d) => {
      // 上一行 toDialog 已把 conversation.conversationType 透出到 type 字段 (见下).
      // 没 type 字段时 fallback 视为 DM 不显示在 Convo 标签.
      const t = (d as unknown as { type?: string }).type;
      return t === "GROUP" || t === "SUPPORT";
    }),
    [serverDialogs]
  );

  const filteredPinned = useMemo(() => filterByFolder(pinnedSource, folder, search), [pinnedSource, folder, search]);
  const filteredRecent = useMemo(() => filterByFolder(recentSource, folder, search), [recentSource, folder, search]);

  const openRequests = () => {
    if (onOpenRequests) onOpenRequests();
    else setSubView("requests");
  };
  const openPerson = (name: string) => {
    setPersonName(name);
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
    const CONTACTS: Array<{ name: string; username: string; note: string; meta: string; warm?: boolean; blue?: boolean; online?: boolean }> = [];
    const filtered = CONTACTS.filter((c) => !contactSearch || `${c.name}${c.username}`.toLowerCase().includes(contactSearch.toLowerCase()));
    return (
      <SwipeBackShell onExit={() => setSubView("home")}>
        <View style={styles.app}>
          <View style={styles.safe} />
          <View style={styles.topbar}>
            <Pressable onPress={() => setSubView("home")} style={styles.icon}><Text style={styles.backText}>‹</Text></Pressable>
            <View style={styles.centerTitle}><Text style={styles.centerMain}>新聊天</Text><Text style={styles.centerSub}>联系人 / Username</Text></View>
            <Pressable style={styles.icon}><ProxyIcon color={color.ink} name="plus" size={18} /></Pressable>
          </View>
          <View style={styles.contactHeadSearch}>
            <ProxyIcon color="#97938b" name="search" size={17} />
            <TextInput value={contactSearch} onChangeText={setContactSearch} placeholder="姓名、手机号或 Username" placeholderTextColor="#9a968f" style={styles.contactInput} />
          </View>
          <ScrollView style={{ flex: 1 }}>
            <Text style={styles.contactSection}>已在 Proxy</Text>
            {filtered.length === 0 ? <Text style={styles.empty}>暂无联系人</Text> : null}
            {filtered.map((c) => (
              <Pressable key={c.name} onPress={() => openPerson(c.name)} style={styles.contactRow}>
                <View style={[styles.avatar, c.warm && styles.avatarWarm, c.blue && styles.avatarBlue]}><Text style={styles.avatarText}>{c.name.slice(0, 1)}</Text>{c.online ? <View style={styles.online} /> : null}</View>
                <View style={{ flex: 1 }}><Text style={styles.contactName}>{c.name} <Text style={styles.usernameBadge}>{c.username}</Text></Text><Text style={styles.contactMeta}>{c.note}</Text><Text style={styles.contactMeta}>{c.meta}</Text></View>
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
            <Pressable style={styles.icon}><Text style={styles.ellipsis}>⋯</Text></Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={styles.personHero}><View style={[styles.avatar, styles.avatarWarm, { width: 70, height: 70, borderRadius: 35, alignSelf: "center" }]}><Text style={[styles.avatarText, { fontSize: 18 }]}>{personName.slice(0, 1)}</Text></View><Text style={styles.personName}>{personName}</Text><Text style={styles.personUser}>@{personName.toLowerCase()}.ng · 在线</Text></View>
          <View style={styles.personActions}>
            <Pressable onPress={() => onOpenConversation(personName)} style={styles.personAction}><View style={styles.personActionIcon}><ProxyIcon color={color.ink} name="chat" size={18} /></View><Text style={styles.personActionText}>消息</Text></Pressable>
            <Pressable style={styles.personAction}><View style={styles.personActionIcon}><ProxyIcon color={color.ink} name="infoCircle" size={18} /></View><Text style={styles.personActionText}>资料</Text></Pressable>
            <Pressable style={styles.personAction}><View style={styles.personActionIcon}><Text style={{ fontSize: 12 }}>🔗</Text></View><Text style={styles.personActionText}>分享</Text></Pressable>
            <Pressable style={styles.personAction}><View style={styles.personActionIcon}><Text style={{ fontSize: 12 }}>⋯</Text></View><Text style={styles.personActionText}>更多</Text></Pressable>
          </View>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <View style={styles.aliasCard}><Text style={styles.aliasLabel}>别名</Text><Text style={styles.aliasValue}>{personName} · 西湖</Text></View>
            <View style={styles.aliasCard}><Text style={styles.aliasLabel}>Username</Text><Text style={styles.aliasValue}>@{personName.toLowerCase()}.ng</Text></View>
            <View style={styles.aliasCard}><Text style={styles.aliasLabel}>手机号</Text><Text style={styles.privateValue}>08•• ••• 721 · 仅你可见</Text></View>
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
            <View style={styles.icon} />
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
        </View>
      </View>

      {/* folderRow — v8 */}
      <View style={styles.folderRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.folderRow}>
          {(Object.keys(FOLDER_LABEL) as Folder[]).map((f) => (
            <Pressable key={f} onPress={() => setFolder(f)} style={[styles.folderChip, folder === f && styles.folderChipActive]}>
              <Text style={[styles.folderChipText, folder === f && styles.folderChipTextActive]}>{FOLDER_LABEL[f]}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityLabel="添加文件夹" style={styles.folderAdd}>
            <Text style={styles.folderAddText}>＋</Text>
          </Pressable>
        </ScrollView>
      </View>

      <FolderManager
        folders={folders}
        onCreate={(name) => setFolders((prev) => [...prev, { id: `f_${Date.now()}`, name, dialogIds: [] }])}
        onMove={(folderId, dialogId) => setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, dialogIds: [...f.dialogIds, dialogId] } : f)))}
      />

      {/* body */}
      <ScrollView style={styles.homeBody} contentContainerStyle={{ paddingBottom: bottomNavVisible === false ? 16 : 96 }}>
        {panel === "dialogs" ? (
          <>
            {filteredPinned.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>置顶</Text>
                {filteredPinned.map((d) => (
                  <Pressable key={d.id} onPress={() => onOpenConversation(d.name, d.conversationId)} style={styles.dialog}>
                    <View style={[styles.avatar, (d as Dialog).warm && styles.avatarWarm, (d as Dialog).blue && styles.avatarBlue, (d as Dialog).dark && styles.avatarDark]}>
                      <Text style={[styles.avatarText, (d as Dialog).dark && styles.avatarTextDark]}>{d.initial}</Text>
                      {(d as Dialog).online ? <View style={styles.online} /> : null}
                    </View>
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
                ))}
              </>
            ) : null}

            <Text style={styles.sectionLabel}>最近</Text>
            {!inboxLoaded ? (
              <Text style={styles.empty}>加载中…</Text>
            ) : filteredRecent.length > 0 ? (
              filteredRecent.map((d) => (
                <Pressable key={d.id} onPress={() => onOpenConversation(d.name, d.conversationId)} style={styles.dialog}>
                  <View style={[styles.avatar, (d as Dialog).warm && styles.avatarWarm, (d as Dialog).blue && styles.avatarBlue, (d as Dialog).dark && styles.avatarDark]}>
                    <Text style={[styles.avatarText, (d as Dialog).dark && styles.avatarTextDark]}>{d.initial}</Text>
                  </View>
                  <View style={styles.dialogMain}>
                    <View style={styles.dialogTop}><Text style={styles.dialogName}>{d.name}</Text></View>
                    <Text style={styles.preview} numberOfLines={1}>{d.preview}</Text>
                  </View>
                  <View style={styles.dialogSide}>
                    <Text style={styles.time}>{d.time}</Text>
                    {d.unread ? <View style={styles.unread}><Text style={styles.unreadText}>{d.unread}</Text></View> : null}
                  </View>
                </Pressable>
              ))
            ) : (
              <Text style={styles.empty}>还没有对话 — 从动态或市场开始聊一下</Text>
            )}
          </>
        ) : (
          <>
            <Text style={styles.sectionLabel}>关注的 Convo</Text>
            {groupDialogs.length === 0 ? (
              <Text style={styles.preview}>还没有群组对话</Text>
            ) : null}
            {groupDialogs.map((c) => (
              <Pressable key={c.id} onPress={() => onOpenConversation(c.name, c.conversationId)} style={styles.convoCard}>
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
            ))}
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

function toDialog(item: ConversationInboxItem): Dialog {
  const latest = item.latestMessage;
  const snapshotName = item.counterpartySnapshot?.displayName?.trim();
  const name = snapshotName || item.counterpartyId || "对话";
  const preview = latest
    ? latest.messageType === "IMAGE" ? "[图片]" : latest.messageType === "VIDEO" ? "[视频]" : latest.body?.trim() || "新消息"
    : "暂无消息";
  const timestamp = latest?.createdAt || item.conversation.lastMessageAt;
  const parsed = new Date(timestamp);
  const time = Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return {
    id: item.conversation.conversationId,
    conversationId: item.conversation.conversationId,
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
  folderAdd: { width: 32, height: 29, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  folderAddText: { fontSize: 15, color: "#777" },
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
  ellipsis: { fontSize: 18, color: "#88847c", width: 38, textAlign: "center" },
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
  usernameBadge: { fontSize: 11, fontWeight: "600", color: "#737068", backgroundColor: "#f6f3ee", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  contactMeta: { fontSize: 11, color: "#aaa69e", marginTop: 2 },
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
  privateValue: { fontSize: 11, color: "#8d8981" },
});
