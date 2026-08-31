// Messaging Home — 对齐 Lotus COMPLETE v8 单文件版
// 1:1 还原 v8 的 homeHead/homeTabs/folderRow/dialogs+convos + Requests(Mặc Kệ) 入口
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { IdentitySwitcher } from "../components/identity-switcher";
import { ProxyIcon } from "../components/proxy-icon";
import { color, shadows } from "../theme";

type HomePanel = "dialogs" | "convos";
type Folder = "all" | "friends" | "activity" | "invite";

// v8 原型 mock — 与 HTML 1:1，去掉后端依赖先保证视觉对齐
type Dialog = { id: string; initial: string; name: string; badge?: string; preview: string; time: string; unread?: string; warm?: boolean; blue?: boolean; dark?: boolean; online?: boolean; folder: Folder };
const DIALOGS_PINNED: Dialog[] = [
  { id: "linh", initial: "L", name: "Linh", badge: "同行 · 已接受", preview: "你：好，那我们 16:00 在西湖见。", time: "07:02", unread: "2", warm: true, online: true, folder: "friends" as Folder },
  { id: "sunday", initial: "SC", name: "Sunday Coffee Walk", badge: "活动群", preview: "Minh：我把路线放到 Convo 里了。", time: "06:51", unread: "6", dark: true, folder: "activity" as Folder },
] as const;

const DIALOGS_RECENT: Dialog[] = [
  { id: "maikhanh", initial: "MK", name: "Mai Khanh", preview: "[图片] 这家店就在你刚才发的位置旁边。", time: "周六", unread: "1", blue: true, folder: "friends" as Folder },
  { id: "tuan", initial: "T", name: "Tuan", preview: "同行已完成 · 等待双方评价", time: "周五", unread: "", folder: "activity" as Folder },
  { id: "proxy", initial: "P", name: "Proxy", preview: "你的礼品券已到账。", time: "周四", unread: "", dark: true, folder: "invite" as Folder },
] as const;

const CONVOS = [
  { id: "westlake", name: "西湖碰面", parent: "Sunday Coffee Walk · 3 人", preview: "Linh：好，我 16:00 在入口等你。", foot: "起点：16:00 左右可以…", time: "07:01", unread: "5" },
  { id: "route", name: "周末路线", parent: "Sunday Coffee Walk · 7 人", preview: "Ha：我把第二条路线也发进来了。", foot: "起点：投票结束后去哪里？", time: "昨天", unread: "" },
] as const;

const FOLDER_LABEL: Record<Folder, string> = { all: "全部", friends: "朋友", activity: "活动", invite: "邀约" };

export function MessagesSurface({
  onOpenConversation,
  onOpenRequests,
  onOpenContacts,
  bottomNavVisible,
  displayIdentityClient,
  activeIdentityId,
  onSwitchIdentity,
}: {
  onOpenConversation: (author: string) => void;
  onOpenRequests?: () => void;
  onOpenContacts?: () => void;
  onChromeVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
  initialTab?: "CHAT" | "FRIENDS";
  displayIdentityClient?: import("../display-identity-client").DisplayIdentityClient;
  activeIdentityId?: string;
  onSwitchIdentity?: (id: string) => void;
}): React.JSX.Element {
  const [panel, setPanel] = useState<HomePanel>("dialogs");
  const [folder, setFolder] = useState<Folder>("all");
  const [search, setSearch] = useState("");

  const filteredPinned = useMemo(() => filterByFolder(DIALOGS_PINNED, folder, search), [folder, search]);
  const filteredRecent = useMemo(() => filterByFolder(DIALOGS_RECENT, folder, search), [folder, search]);

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
            <Pressable accessibilityLabel="搜索" style={styles.icon}>
              <ProxyIcon color={color.ink} name="search" size={20} />
            </Pressable>
            <Pressable accessibilityLabel="存储" style={styles.icon}>
              <ProxyIcon color={color.ink} name="infoCircle" size={20} />
            </Pressable>
            <Pressable accessibilityLabel="通知" style={styles.iconBell}>
              <ProxyIcon color={color.ink} name="infoCircle" size={20} />
              <View style={styles.bellDot} />
            </Pressable>
            <Pressable accessibilityLabel="新聊天" onPress={onOpenContacts} style={styles.icon}>
              <ProxyIcon color={color.ink} name="plus" size={18} />
            </Pressable>
          </View>
        </View>

        <Pressable onPress={onOpenContacts} style={styles.searchBox}>
          <ProxyIcon color="#9a968f" name="search" size={17} />
          <Text style={styles.searchPlaceholder}>搜索聊天、联系人和消息</Text>
        </Pressable>

        <View style={styles.homeTabs}>
          <Pressable onPress={() => setPanel("dialogs")} style={[styles.homeTab, panel === "dialogs" && styles.homeTabActive]}>
            <Text style={[styles.homeTabText, panel === "dialogs" && styles.homeTabTextActive]}>对话</Text>
            <View style={[styles.countBadge, panel !== "dialogs" && styles.countBadgeMuted]}>
              <Text style={styles.countBadgeText}>3</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => setPanel("convos")} style={[styles.homeTab, panel === "convos" && styles.homeTabActive]}>
            <Text style={[styles.homeTabText, panel === "convos" && styles.homeTabTextActive]}>Convo</Text>
            <View style={[styles.countBadge, panel !== "convos" && styles.countBadgeMuted]}>
              <Text style={styles.countBadgeText}>5</Text>
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

      {/* search (fallback) */}
      {search.length > 0 ? (
        <View style={styles.inlineSearch}>
          <TextInput value={search} onChangeText={setSearch} placeholder="搜索" placeholderTextColor="#9a968f" style={styles.inlineSearchInput} />
          <Pressable onPress={() => setSearch("")} style={styles.inlineClear}>
            <Text style={styles.inlineClearText}>清除</Text>
          </Pressable>
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
                  <Pressable key={d.id} onPress={() => onOpenConversation(d.name)} style={styles.dialog}>
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
            {filteredRecent.length > 0 ? (
              filteredRecent.map((d) => (
                <Pressable key={d.id} onPress={() => onOpenConversation(d.name)} style={styles.dialog}>
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
              <Text style={styles.empty}>无匹配对话</Text>
            )}

            {/* 请求入口 — Mặc Kệ */}
            <Pressable onPress={onOpenRequests} style={styles.dialog}>
              <View style={[styles.avatar]}><Text style={styles.avatarText}>?</Text></View>
              <View style={styles.dialogMain}>
                <View style={styles.dialogTop}><Text style={styles.dialogName}>消息请求</Text></View>
                <Text style={styles.preview}>2 条陌生消息 · 默认静音</Text>
              </View>
              <View style={styles.dialogSide}><Text style={styles.time}>查看</Text></View>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.sectionLabel}>关注的 Convo</Text>
            {CONVOS.map((c) => (
              <Pressable key={c.id} onPress={() => onOpenConversation(c.name)} style={styles.convoCard}>
                <View style={styles.convoHead}>
                  <View style={styles.convoMark}><ProxyIcon color="#fff" name="chat" size={16} /></View>
                  <View style={styles.convoCopy}>
                    <Text style={styles.convoName}>{c.name}</Text>
                    <Text style={styles.convoParent}>{c.parent}</Text>
                  </View>
                  {c.unread ? <View style={styles.unread}><Text style={styles.unreadText}>{c.unread}</Text></View> : null}
                </View>
                <Text style={styles.convoPreview} numberOfLines={1}>{c.preview}</Text>
                <View style={styles.convoFoot}><Text style={styles.convoFootText}>{c.foot}</Text><Text style={styles.convoFootTime}>{c.time}</Text></View>
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
  searchPlaceholder: { fontSize: 13.5, color: "#9a968f" },
  homeTabs: { flexDirection: "row", gap: 25, borderBottomWidth: 1, borderBottomColor: "#e8e3da" },
  homeTab: { height: 42, flexDirection: "row", alignItems: "center", paddingHorizontal: 1, borderBottomWidth: 2, borderBottomColor: "transparent" },
  homeTabActive: { borderBottomColor: "#11110f" },
  homeTabText: { fontSize: 13, fontWeight: "600", color: "#8a867f" },
  homeTabTextActive: { color: "#11110f", fontWeight: "700" },
  countBadge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: "#11110f", alignItems: "center", justifyContent: "center", marginLeft: 4 },
  countBadgeMuted: { backgroundColor: "#e8e3da" },
  countBadgeText: { fontSize: 9, fontWeight: "700", color: "#fff" },
  folderRowWrap: { borderBottomWidth: 1, borderBottomColor: "#e8e3da", backgroundColor: "#fffefa" },
  folderRow: { flexDirection: "row", gap: 7, paddingHorizontal: 16, paddingVertical: 10, alignItems: "center" },
  folderChip: { height: 29, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 15, paddingHorizontal: 11, justifyContent: "center", backgroundColor: "transparent" },
  folderChipActive: { backgroundColor: "#11110f", borderColor: "#11110f" },
  folderChipText: { fontSize: 10.5, fontWeight: "600", color: "#77736c" },
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
  badgeText: { fontSize: 10, fontWeight: "700", color: "#795817" },
  preview: { marginTop: 4, fontSize: 13, color: "#7d7972" },
  dialogSide: { alignItems: "flex-end", minWidth: 40 },
  time: { fontSize: 10.5, color: "#aaa69e" },
  unread: { marginTop: 7, minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, backgroundColor: "#11110f", alignItems: "center", justifyContent: "center" },
  unreadText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  empty: { textAlign: "center", paddingVertical: 24, fontSize: 12, color: "#aaa69e" },
  convoCard: { marginHorizontal: 14, marginTop: 10, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 15, padding: 12, backgroundColor: "#fffefa" },
  convoHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  convoMark: { width: 36, height: 36, borderRadius: 11, backgroundColor: "#11110f", alignItems: "center", justifyContent: "center" },
  convoCopy: { flex: 1, minWidth: 0 },
  convoName: { fontSize: 13.5, fontWeight: "700", color: "#11110f" },
  convoParent: { fontSize: 10.5, color: "#8d8982", marginTop: 2 },
  convoPreview: { marginTop: 9, fontSize: 12.5, lineHeight: 18, color: "#68645e" },
  convoFoot: { flexDirection: "row", alignItems: "center", marginTop: 9 },
  convoFootText: { flex: 1, fontSize: 10, color: "#99958d" },
  convoFootTime: { fontSize: 10, fontWeight: "700", color: "#54514b" },
});
