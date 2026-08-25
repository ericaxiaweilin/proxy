// 根级「消息」：按 R15 原型实现为「聊天 + 好友」完整模块，而非只有会话列表。
// R15.10 §161：添加好友 5 种入口统一在 Messages → 添加好友，不在 My
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ProxyIcon } from "../components/proxy-icon";
import { color, shadows } from "../theme";
import { FriendCrmSurface } from "./friend-crm";

type MessageTab = "CHAT" | "FRIENDS";
type ComposerMode = "ADD_FRIEND" | "CREATE_GROUP" | undefined;

const FRIENDS = [
  { initial: "M", name: "Mai", context: "河内 · 摄影 / 城市同行", relation: "好友 · 共同好友 2" },
  { initial: "A", name: "An", context: "河内 · 本地生活", relation: "好友 · 合作过 1 次" },
  { initial: "L", name: "Luna", context: "河内 · 活动 / 摄影", relation: "好友 · 最近认识" },
  { initial: "K", name: "Khoa", context: "河内 · 中文 / 商务沟通", relation: "好友 · 同城" }
] as const;

const THREADS = [
  { initial: "L", name: "Linh", context: "人物", preview: "周六下午有时间，可以聊一下。", time: "18:42", unread: "2", dark: false },
  { initial: "B", name: "Bonsaidon", context: "订单", preview: "地点改到西湖这边，可以吗？", time: "17:18", unread: "1", dark: true },
  { initial: "M", name: "Mai", context: "好友", preview: "好的，到时候联系你。", time: "昨天", unread: "", dark: false },
  { initial: "○", name: "西湖摄影散步", context: "活动", preview: "Luna：我也会带相机过去。", time: "昨天", unread: "5", dark: false }
] as const;

export function MessagesSurface({ onOpenConversation }: { onOpenConversation: (author: string) => void }): React.JSX.Element {
  const [tab, setTab] = useState<MessageTab>("FRIENDS");
  const [composer, setComposer] = useState<ComposerMode>();
  const [search, setSearch] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestState, setRequestState] = useState<"PENDING" | "ACCEPTED" | "IGNORED">("PENDING");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  // 轻 CRM：好友点击进入 CRM 详情，而非直接发消息（在 My 的关系图已为纯 CRM，Messages 的 Friends 仅做快捷入口）
  const [crmFriend, setCrmFriend] = useState<(typeof FRIENDS)[number] | undefined>();
  // R15.10 添加好友 5 种方式归属 Messages，由 FriendCrmSurface 的 ADD_FRIEND 复用 HTML 原型
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const visibleFriends = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return keyword ? FRIENDS.filter((friend) => `${friend.name}${friend.context}${friend.relation}`.toLowerCase().includes(keyword)) : FRIENDS;
  }, [search]);

  function chooseComposer(next: Exclude<ComposerMode, undefined>): void {
    setComposer(next);
    setNotice("");
  }

  function toggleMember(name: string): void {
    setSelectedMembers((current) => current.includes(name) ? current.filter((member) => member !== name) : [...current, name]);
  }

  if (addFriendOpen) {
    return (
      <View style={styles.root}>
        <FriendCrmSurface initialView="ADD_FRIEND" onBack={() => setAddFriendOpen(false)} onOpenConversation={onOpenConversation} />
      </View>
    );
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <View>
          <Text style={styles.title}>消息</Text>
          <Text style={styles.sub}>私聊 · 群聊 · 好友</Text>
        </View>
        <View style={styles.headActions}>
          <Pressable accessibilityLabel="通知" style={styles.iconButton}>
            <ProxyIcon color={color.ink} name="infoCircle" size={24} />
            <View style={styles.noticeDot} />
          </Pressable>
          <Pressable accessibilityLabel="创建消息" style={styles.iconButton} onPress={() => chooseComposer("CREATE_GROUP")}>
            <ProxyIcon color={color.ink} name="plus" size={17} />
          </Pressable>
        </View>
      </View>

      <View style={styles.tabs}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === "CHAT" }} onPress={() => setTab("CHAT")} style={[styles.tab, tab === "CHAT" && styles.tabActive]}>
          <Text style={[styles.tabText, tab === "CHAT" && styles.tabActiveText]}>聊天</Text>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === "FRIENDS" }} onPress={() => setTab("FRIENDS")} style={[styles.tab, tab === "FRIENDS" && styles.tabActive]}>
          <Text style={[styles.tabText, tab === "FRIENDS" && styles.tabActiveText]}>好友</Text>
        </Pressable>
      </View>

      {tab === "CHAT" ? (
        <ChatList onOpenConversation={onOpenConversation} />
      ) : (
        <>
          <View style={styles.quickRow}>
            <Pressable accessibilityLabel="添加好友" onPress={() => setAddFriendOpen(true)} style={styles.quickCard}>
              <ProxyIcon color={color.proxyPurple} name="plus" size={26} />
              <Text style={styles.quickTitle}>添加好友</Text>
              <Text style={styles.quickSub}>二维码、邀请、通讯录、社媒或 Proxy 搜索 · 5 种方式</Text>
            </Pressable>
            <Pressable accessibilityLabel="创建群聊" onPress={() => chooseComposer("CREATE_GROUP")} style={styles.quickCard}>
              <ProxyIcon color={color.proxyPurple} name="chat" size={26} />
              <Text style={styles.quickTitle}>创建群聊</Text>
              <Text style={styles.quickSub}>最多 50 人 · 满了以后再考虑扩容</Text>
            </Pressable>
          </View>

          {composer ? (
            <ComposerCard
              mode={composer}
              notice={notice}
              selectedMembers={selectedMembers}
              onClose={() => setComposer(undefined)}
              onCreate={() => {
                setNotice(`群聊已创建 · 当前 ${selectedMembers.length || 1} / 50 人`);
                setSelectedMembers([]);
              }}
              onSendRequest={() => setNotice("好友请求已发送；对方接受后才会成为 Proxy 好友。")}
              onToggleMember={toggleMember}
            />
          ) : null}

          <View style={styles.sectionCard}>
            <Pressable accessibilityLabel="查看好友请求" onPress={() => setRequestOpen((open) => !open)} style={styles.friendRequestRow}>
              <View style={[styles.avatar, styles.avatarSoft]}><ProxyIcon color="#6131B5" name="heart" size={17} /></View>
              <View style={styles.threadCopy}><Text style={styles.threadName}>好友请求</Text><Text style={styles.preview}>2 个待处理</Text></View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            {requestOpen ? (
              <View style={styles.requestDetail}>
                <Text style={styles.requestName}>Nhi 想添加你为好友</Text>
                <Text style={styles.requestSub}>河内 · 咖啡 / 设计</Text>
                {requestState === "PENDING" ? (
                  <View style={styles.requestButtons}>
                    <Pressable onPress={() => setRequestState("IGNORED")} style={styles.mutedButton}><Text style={styles.mutedButtonText}>忽略</Text></Pressable>
                    <Pressable onPress={() => setRequestState("ACCEPTED")} style={styles.acceptButton}><Text style={styles.acceptButtonText}>接受</Text></Pressable>
                  </View>
                ) : <Text style={styles.requestDone}>{requestState === "ACCEPTED" ? "已接受 Nhi 的好友请求" : "已忽略此好友请求"}</Text>}
              </View>
            ) : null}
          </View>

          <View style={styles.searchRow}>
            <TextInput value={search} onChangeText={setSearch} placeholder="搜索好友、能力、城市…" placeholderTextColor="#918896" style={styles.searchInput} />
            <View style={styles.searchButton}><ProxyIcon color={color.white} name="search" size={24} /></View>
          </View>

          {crmFriend ? (
            <View style={styles.sectionCard}>
              <Pressable onPress={() => setCrmFriend(undefined)} style={styles.crmBack}><Text style={styles.crmBackText}>‹ 返回好友列表</Text></Pressable>
              <View style={styles.crmHead}><View style={styles.avatarLarge}><Text style={styles.avatarLargeText}>{crmFriend.initial}</Text></View><View style={styles.crmHeadCopy}><Text style={styles.crmName}>{crmFriend.name}</Text><Text style={styles.crmContext}>{crmFriend.context} · {crmFriend.relation}</Text></View></View>
              <View style={styles.crmKv}><Text style={styles.crmKvLabel}>来源</Text><Text style={styles.crmKvValue}>{crmFriend.relation}</Text></View>
              <View style={styles.crmKv}><Text style={styles.crmKvLabel}>备注</Text><Text style={styles.crmKvValue}>仅自己可见 · 点击编辑</Text></View>
              <View style={styles.crmActions}><Pressable onPress={() => onOpenConversation(crmFriend.name)} style={styles.crmActionPrimary}><Text style={styles.crmActionPrimaryText}>发消息</Text></Pressable><Pressable onPress={() => setCrmFriend(undefined)} style={styles.crmAction}><Text style={styles.crmActionText}>查看轻 CRM 详情</Text></Pressable></View>
              <Text style={styles.crmHint}>轻 CRM：标签、备注、来源与互动记录在「我的 → 好友与关系」中统一管理，此处仅做快捷入口。</Text>
            </View>
          ) : (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHead}><Text style={styles.sectionTitle}>好友</Text><Text style={styles.sectionCount}>{FRIENDS.length} 人 · 轻 CRM</Text></View>
              {visibleFriends.map((friend, index) => (
                <Pressable key={friend.name} accessibilityLabel={`查看 ${friend.name} 的轻 CRM`} onPress={() => setCrmFriend(friend)} style={[styles.friendRow, index > 0 && styles.friendRowLine]}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{friend.initial}</Text></View>
                  <View style={styles.threadCopy}><Text style={styles.threadName}>{friend.name}</Text><Text style={styles.preview}>{friend.context}</Text><Text style={styles.relationship}>{friend.relation}</Text></View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))}
              {!visibleFriends.length ? <Text style={styles.emptyResult}>没有匹配的好友</Text> : null}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function ComposerCard({ mode, notice, selectedMembers, onClose, onCreate, onSendRequest, onToggleMember }: {
  mode: Exclude<ComposerMode, undefined>;
  notice: string;
  selectedMembers: string[];
  onClose: () => void;
  onCreate: () => void;
  onSendRequest: () => void;
  onToggleMember: (name: string) => void;
}): React.JSX.Element {
  const isFriend = mode === "ADD_FRIEND";
  return (
    <View style={styles.composerCard}>
      <View style={styles.composerHead}><Text style={styles.composerTitle}>{isFriend ? "添加好友" : "创建群聊"}</Text><Pressable onPress={onClose}><Text style={styles.closeText}>收起</Text></Pressable></View>
      {isFriend ? <TextInput placeholder="搜索昵称、Proxy ID、手机号" placeholderTextColor="#918896" style={styles.composerInput} /> : (
        <View style={styles.memberList}>{FRIENDS.map((friend) => {
          const picked = selectedMembers.includes(friend.name);
          return <Pressable key={friend.name} onPress={() => onToggleMember(friend.name)} style={[styles.memberChip, picked && styles.memberChipPicked]}><Text style={[styles.memberChipText, picked && styles.memberChipTextPicked]}>{picked ? "✓ " : ""}{friend.name}</Text></Pressable>;
        })}</View>
      )}
      <Pressable onPress={isFriend ? onSendRequest : onCreate} style={styles.actionButton}><Text style={styles.actionButtonText}>{isFriend ? "发送好友请求" : `创建群聊${selectedMembers.length ? ` (${selectedMembers.length})` : ""}`}</Text></Pressable>
      {notice ? <Text style={styles.composerNotice}>{notice}</Text> : null}
    </View>
  );
}

function ChatList({ onOpenConversation }: { onOpenConversation: (author: string) => void }): React.JSX.Element {
  return <View style={styles.chatSection}>
    <Pressable accessibilityLabel="消息请求" style={styles.thread}>
      <View style={[styles.avatar, styles.avatarSoft]}><Text style={styles.avatarText}>?</Text></View>
      <View style={styles.threadCopy}><Text style={styles.threadName}>消息请求</Text><Text style={styles.preview}>2 个陌生人消息 · 先看再决定</Text></View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
    {THREADS.map((thread, index) => (
      <Pressable key={thread.name} accessibilityLabel={`打开与 ${thread.name} 的会话`} onPress={() => onOpenConversation(thread.name)} style={[styles.thread, index === THREADS.length - 1 && styles.threadLast]}>
        <View style={[styles.avatar, thread.dark && styles.avatarDark]}><Text style={[styles.avatarText, thread.dark && styles.avatarTextDark]}>{thread.initial}</Text></View>
        <View style={styles.threadCopy}>
          <View style={styles.threadTop}><Text style={styles.threadName}>{thread.name}</Text><Text style={styles.context}>{thread.context}</Text></View>
          <Text numberOfLines={1} style={styles.preview}>{thread.preview}</Text>
        </View>
        <View style={styles.threadMeta}><Text style={styles.time}>{thread.time}</Text>{thread.unread ? <View style={styles.unread}><Text style={styles.unreadText}>{thread.unread}</Text></View> : null}</View>
      </Pressable>
    ))}
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 20, paddingHorizontal: 16, paddingTop: 10 },
  head: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  title: { color: color.ink, fontSize: 28, fontWeight: "900", lineHeight: 34 },
  sub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  headActions: { flexDirection: "row", gap: 6, marginTop: 4 },
  iconButton: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 11, borderWidth: 1, height: 32, justifyContent: "center", position: "relative", width: 32, ...shadows.card },
  noticeDot: { backgroundColor: color.magenta, borderColor: color.white, borderRadius: 5, borderWidth: 1.5, height: 9, position: "absolute", right: -2, top: -2, width: 9 },
  tabs: { backgroundColor: "#F1EDF3", borderRadius: 13, flexDirection: "row", marginTop: 12, padding: 3 },
  tab: { alignItems: "center", borderRadius: 10, flex: 1, paddingVertical: 8 },
  tabActive: { backgroundColor: color.white, ...shadows.card },
  tabText: { color: color.muted, fontSize: 14, fontWeight: "800", lineHeight: 18 },
  tabActiveText: { color: color.ink, fontWeight: "900" },
  quickRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  quickCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flex: 1, minHeight: 126, padding: 12, ...shadows.card },
  quickMark: { height: 31 },
  quickTitle: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21, marginTop: 5 },
  quickSub: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 5 },
  composerCard: { backgroundColor: "#F6F1FA", borderColor: "#E4D8EF", borderRadius: 16, borderWidth: 1, marginTop: 10, padding: 12 },
  composerHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  composerTitle: { color: color.ink, fontSize: 15, fontWeight: "900", lineHeight: 21 },
  closeText: { color: color.magenta, fontSize: 11, fontWeight: "800" },
  composerInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, color: color.ink, fontSize: 14, marginTop: 9, paddingHorizontal: 10, paddingVertical: 9 },
  memberList: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  memberChip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6 },
  memberChipPicked: { backgroundColor: "#EEE3FF", borderColor: color.proxyPurple },
  memberChipText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  memberChipTextPicked: { color: "#5822A4" },
  actionButton: { alignItems: "center", backgroundColor: color.ink, borderRadius: 10, marginTop: 9, paddingVertical: 9 },
  actionButtonText: { color: color.white, fontSize: 14, fontWeight: "900" },
  composerNotice: { color: "#5D278F", fontSize: 11, lineHeight: 15, marginTop: 8 },
  sectionCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, marginTop: 12, overflow: "hidden", ...shadows.card },
  friendRequestRow: { alignItems: "center", flexDirection: "row", gap: 9, padding: 12 },
  requestDetail: { borderTopColor: color.line, borderTopWidth: 1, padding: 12 },
  requestName: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  requestSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  requestButtons: { flexDirection: "row", gap: 7, marginTop: 9 },
  mutedButton: { alignItems: "center", backgroundColor: "#F4F1F6", borderRadius: 8, flex: 1, paddingVertical: 7 },
  mutedButtonText: { color: color.muted, fontSize: 14, fontWeight: "800" },
  acceptButton: { alignItems: "center", backgroundColor: color.ink, borderRadius: 8, flex: 1, paddingVertical: 7 },
  acceptButtonText: { color: color.white, fontSize: 14, fontWeight: "800" },
  requestDone: { color: "#4B6C12", fontSize: 11, fontWeight: "800", marginTop: 7 },
  searchRow: { flexDirection: "row", gap: 7, marginTop: 12 },
  searchInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, color: color.ink, flex: 1, fontSize: 14, paddingHorizontal: 12, paddingVertical: 9 },
  searchButton: { alignItems: "center", backgroundColor: color.ink, borderRadius: 14, height: 38, justifyContent: "center", width: 42 },
  sectionHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 12 },
  sectionTitle: { color: color.ink, fontSize: 17, fontWeight: "900", lineHeight: 24 },
  sectionCount: { color: color.muted, fontSize: 11, lineHeight: 15 },
  friendRow: { alignItems: "center", flexDirection: "row", gap: 9, marginHorizontal: 12, paddingVertical: 12 },
  friendRowLine: { borderTopColor: color.line, borderTopWidth: 1 },
  relationship: { alignSelf: "flex-start", backgroundColor: "#F0E8FF", borderRadius: 999, color: "#6332B8", fontSize: 11, fontWeight: "800", marginTop: 5, overflow: "hidden", paddingHorizontal: 6, paddingVertical: 3 },
  emptyResult: { color: color.muted, fontSize: 11, padding: 18, textAlign: "center" },
  crmBack: { paddingHorizontal: 12, paddingTop: 12 },
  crmBackText: { color: color.magenta, fontSize: 12, fontWeight: "800" },
  crmHead: { alignItems: "center", flexDirection: "row", gap: 10, padding: 12 },
  avatarLarge: { alignItems: "center", backgroundColor: "#F1E8FF", borderRadius: 14, height: 48, justifyContent: "center", width: 48 },
  avatarLargeText: { color: color.ink, fontSize: 13, fontWeight: "900" },
  crmHeadCopy: { flex: 1 },
  crmName: { color: color.ink, fontSize: 15, fontWeight: "900" },
  crmContext: { color: color.muted, fontSize: 11, marginTop: 3 },
  crmKv: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 7 },
  crmKvLabel: { color: color.muted, fontSize: 11, fontWeight: "700" },
  crmKvValue: { color: color.ink, fontSize: 11, fontWeight: "800" },
  crmActions: { flexDirection: "row", gap: 7, padding: 12 },
  crmAction: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, flex: 1, paddingVertical: 9 },
  crmActionPrimary: { alignItems: "center", backgroundColor: color.ink, borderRadius: 10, flex: 1, paddingVertical: 9 },
  crmActionText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  crmActionPrimaryText: { color: color.white, fontSize: 12, fontWeight: "900" },
  crmHint: { color: color.muted, fontSize: 11, lineHeight: 15, padding: 12, paddingTop: 0 },
  // R15 .r160Section：聊天列表是一张完整圆角卡片，不是贴边的无框表格。
  chatSection: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 17,
    borderWidth: 1,
    marginTop: 10,
    overflow: "hidden",
    paddingHorizontal: 12,
    ...shadows.card
  },
  thread: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 9, paddingVertical: 11 },
  threadLast: { borderBottomWidth: 0 },
  avatar: { alignItems: "center", backgroundColor: "#F1E8FF", borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  avatarSoft: { backgroundColor: "#F5F1F8" },
  avatarDark: { backgroundColor: color.ink },
  avatarText: { color: color.ink, fontSize: 12, fontWeight: "900" },
  avatarTextDark: { color: color.white },
  threadCopy: { flex: 1, minWidth: 0 },
  threadTop: { alignItems: "center", flexDirection: "row", gap: 5 },
  threadName: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  context: { backgroundColor: "#F1EDF3", borderRadius: 999, color: "#756A7B", fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 5, paddingVertical: 2 },
  preview: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  threadMeta: { alignItems: "flex-end", gap: 4 },
  time: { color: color.muted, fontSize: 11 },
  unread: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 8, height: 16, justifyContent: "center", minWidth: 16, paddingHorizontal: 4 },
  unreadText: { color: color.white, fontSize: 11, fontWeight: "900" },
  chevron: { color: "#A59EAA", fontSize: 16 }
});
