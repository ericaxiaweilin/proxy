// 个人轻 CRM — 好友不是消息列表的子集，而是独立的个人关系资产。
// 接线 /Users/thanhhuyennguyen/Downloads/proxy_add_friend_detail.html 的 5 种加好友 + 轻 CRM 详情
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ProxyIcon } from "../components/proxy-icon";
import type { FriendView, RelationshipClient } from "../relationship-client";
import { color, shadows } from "../theme";

type FriendSource = "QR" | "INVITE" | "CONTACTS" | "SOCIAL" | "SEARCH";
type FriendStatus = "FRIEND" | "PENDING" | "BLOCKED";

interface CrmFriend {
  id: string;
  name: string;
  initial: string;
  proxyId: string;
  city: string;
  source: FriendSource;
  sourceLabel: string;
  relation: string;
  tags: string[];
  note: string;
  commonFriends: number;
  lastInteraction: string;
  status: FriendStatus;
  createdAt: string;
}

const CRM_FRIENDS: CrmFriend[] = [
  { id: "mai", name: "Mai", initial: "M", proxyId: "PX-482167", city: "河内", source: "QR", sourceLabel: "通过 Proxy Personal QR · 2 小时前", relation: "好友 · 共同好友 2", tags: ["摄影", "城市同行"], note: "城市同行合作过一次，准时可靠", commonFriends: 2, lastInteraction: "昨天 · 聊天", status: "FRIEND", createdAt: "2026-06-12" },
  { id: "an", name: "An", initial: "A", proxyId: "PX-937201", city: "河内", source: "CONTACTS", sourceLabel: "通讯录匹配 · 同城", relation: "好友 · 合作过 1 次", tags: ["本地生活"], note: "", commonFriends: 1, lastInteraction: "3 天前 · 活动报名", status: "FRIEND", createdAt: "2026-07-02" },
  { id: "luna", name: "Luna", initial: "L", proxyId: "PX-118492", city: "河内", source: "SOCIAL", sourceLabel: "Instagram · @luna.daily", relation: "好友 · 最近认识", tags: ["活动", "摄影"], note: "西湖摄影散步认识", commonFriends: 0, lastInteraction: "1 周前 · 动态互动", status: "FRIEND", createdAt: "2026-08-10" },
  { id: "khoa", name: "Khoa", initial: "K", proxyId: "PX-552018", city: "河内", source: "SEARCH", sourceLabel: "通过 Proxy 搜索 · 昵称", relation: "好友 · 同城", tags: ["中文", "商务沟通"], note: "", commonFriends: 3, lastInteraction: "2 周前 · 订单", status: "FRIEND", createdAt: "2026-05-20" },
];

// 修复：好友关系不再用独立 mock（David/Kevin/Amy/Ming），统一使用已有好友数据 CRM_FRIENDS
// 以 CRM_FRIENDS 为唯一数据源，附加 CRM 状态，避免信息页与关系页数据不一致
const ADV_CRM_FRIENDS: Array<CrmFriend & { crmStatus: "WARM" | "FOLLOW" | "MET" | "NEW"; actionLabel: string; actionSub: string }> = CRM_FRIENDS.map((f) => {
  const enrich: Record<string, { crmStatus: "WARM" | "FOLLOW" | "MET" | "NEW"; actionLabel: string; actionSub: string; note: string; lastInteraction: string }> = {
    mai: { crmStatus: "WARM", actionLabel: "发咖啡券", actionSub: "暖关系", note: f.note || "城市同行合作过一次，准时可靠", lastInteraction: "最近已回复 · 7 天持续互动" },
    an: { crmStatus: "MET", actionLabel: "发体验邀约", actionSub: "已见面", note: f.note || "已见过一次，偏好本地生活", lastInteraction: "已见面" },
    luna: { crmStatus: "FOLLOW", actionLabel: "继续聊天", actionSub: "待跟进", note: f.note || "西湖摄影散步认识", lastInteraction: "加好友后未激活" },
    khoa: { crmStatus: "FOLLOW", actionLabel: "发欢迎消息", actionSub: "新关系", note: f.note || "同城好友，需要建立第一轮互动", lastInteraction: "新添加" },
  };
  const e = enrich[f.id] ?? { crmStatus: "NEW" as const, actionLabel: "发消息", actionSub: "新关系", note: f.note, lastInteraction: f.lastInteraction };
  return { ...f, ...e };
});

const PENDING_REQUESTS: Array<{ name: string; initial: string; source: string; time: string }> = [
  { name: "Mai Linh", initial: "ML", source: "通过 Proxy ID 搜索找到你", time: "2 小时前" },
  { name: "Duc Tran", initial: "DT", source: "共同好友 3 人 · 昨天", time: "昨天" },
];

const CONTACT_MATCHES: Array<{ name: string; initial: string; sub: string }> = [
  { name: "Minh Nguyen", initial: "MN", sub: "通讯录 · 共同好友 2 人" },
  { name: "Lan Anh", initial: "LA", sub: "通讯录 · 同城" },
  { name: "Hoang Tran", initial: "HT", sub: "通讯录 · 已使用 Proxy" },
];

const SOCIAL_MATCHES: Array<{ name: string; initial: string; sub: string }> = [
  { name: "Quynh N.", initial: "QN", sub: "Instagram · @quynh.daily" },
  { name: "An Tran", initial: "AT", sub: "Instagram · @an.tran" },
];

type AddFriendSheet = "SCAN" | "INVITE" | "CONTACTS" | "SOCIAL" | "SEARCH" | "REQUESTS" | undefined;
type CrmView = "LIST" | "ADD_FRIEND" | "DETAIL";

export function FriendCrmSurface({ relationship, onOpenConversation, onBack, initialView = "LIST" }: { relationship?: RelationshipClient | undefined; onOpenConversation: (author: string) => void; onBack: () => void; initialView?: CrmView }): React.JSX.Element {
  const [view, setView] = useState<CrmView>(initialView);
  const [sheet, setSheet] = useState<AddFriendSheet>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CrmFriend | undefined>();
  const [contactsAllowed, setContactsAllowed] = useState(false);
  const [proxySearch, setProxySearch] = useState("");
  const [proxySearchDone, setProxySearchDone] = useState(false);
  const [sentIds, setSentIds] = useState<Record<string, boolean>>({});
  // R18.x FRIEND-001: replace the hardcoded PENDING_REQUESTS
  // and CRM_FRIENDS with server-fetched lists. The mock
  // constants are kept as a fallback when the
  // RelationshipClient is absent (offline / pre-auth).
  const [requests, setRequests] = useState<Array<{ name: string; initial: string; source: string; time: string; userId?: string }>>(PENDING_REQUESTS);
  const [serverFriends, setServerFriends] = useState<{ active: FriendView[]; pending: FriendView[] }>({ active: [], pending: [] });
  const [friendsError, setFriendsError] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState("");
  const [crmTab, setCrmTab] = useState<"ALL" | "WARM" | "FOLLOW" | "MET">("ALL");

  const reload = useCallback(async () => {
    if (!relationship) return;
    setFriendsError(undefined);
    try {
      const payload = await relationship.listMyFriendships();
      setServerFriends(payload);
      // Project the server incoming pending list onto the
      // requests array so the add-friend sheet's 接受/忽略
      // actions line up with the server-side rows.
      setRequests(
        payload.pending
          .filter((f) => f.direction === "INCOMING")
          .map((f) => ({ name: f.displayName || f.userId, initial: (f.displayName || f.userId).slice(0, 1).toUpperCase(), source: "Proxy 好友请求", time: "刚刚", userId: f.userId })),
      );
    } catch (error) {
      setFriendsError(error instanceof Error ? error.message : String(error));
    }
  }, [relationship]);
  useEffect(() => { void reload(); }, [reload]);

  // Project server `active` rows onto the CrmFriend shape
  // so the existing list / detail rendering can stay
  // identical. Each server friend becomes a CrmFriend
  // with synthetic tags + note; the userId is the only
  // field the new accept / ignore / block buttons need.
  const projectedServerFriends: CrmFriend[] = useMemo(() => {
    return serverFriends.active.map((f) => {
      const name = f.displayName || f.userId;
      return {
        id: f.userId,
        name,
        initial: name.slice(0, 1).toUpperCase() || "?",
        proxyId: f.userId,
        city: f.city || "",
        source: "QR" as FriendSource,
        sourceLabel: f.city ? `好友 · ${f.city}` : "好友",
        relation: `好友 · ${f.since.slice(0, 10)}`,
        tags: [],
        note: "",
        commonFriends: 0,
        lastInteraction: f.since.slice(0, 10),
        status: "FRIEND" as FriendStatus,
        createdAt: f.since.slice(0, 10),
      };
    });
  }, [serverFriends]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Prefer server-fetched friends when the RelationshipClient
    // is wired; fall back to the historical mock for offline.
    const base = projectedServerFriends.length > 0 ? projectedServerFriends : CRM_FRIENDS;
    if (!q) return base;
    return base.filter((f) => `${f.name}${f.proxyId}${f.city}${f.tags.join("")}${f.note}`.toLowerCase().includes(q));
  }, [search, projectedServerFriends]);

  const filteredAdv = useMemo(() => {
    if (crmTab === "ALL") return ADV_CRM_FRIENDS;
    return ADV_CRM_FRIENDS.filter((f) => f.crmStatus === crmTab);
  }, [crmTab]);

  const visibleAdv = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredAdv;
    return filteredAdv.filter((f) => `${f.name}${f.note}${f.actionLabel}`.toLowerCase().includes(q));
  }, [search, filteredAdv]);

  function showToast(text: string): void {
    setToast(text);
    setTimeout(() => setToast(""), 1700);
  }

  function openDetail(friend: CrmFriend): void {
    setSelected(friend);
    setView("DETAIL");
  }

  // LIST => 轻 CRM 列表（不是消息列表）
  if (view === "DETAIL" && selected) {
    return <FriendDetail friend={selected} onBack={() => setView("LIST")} onOpenConversation={onOpenConversation} showToast={showToast} toast={toast} />;
  }

  if (view === "ADD_FRIEND") {
    // 当从 Messages 进入时，initialView=ADD_FRIEND，此时返回应直回 Messages，而非先到 CRM LIST
    const handleBack = (): void => {
      if (initialView === "ADD_FRIEND") onBack();
      else setView("LIST");
    };
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Pressable onPress={handleBack} style={styles.backRow}><Text style={styles.backText}>{initialView === "ADD_FRIEND" ? "‹ 返回消息" : "‹ 返回好友"}</Text></Pressable>
        <Text style={styles.title}>添加好友</Text>
        <Text style={styles.sub}>通过二维码、邀请、通讯录、社媒或 Proxy 搜索找到你认识的人。</Text>

        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>选择添加方式</Text><Text style={styles.sectionNote}>5 种方式</Text></View>
        <View style={styles.methodGrid}>
          <Pressable onPress={() => setSheet("SCAN")} style={styles.method}><View style={styles.methodIcon}><ProxyIcon color={color.proxyPurple} name="qrGrid" size={20} /></View><Text style={styles.methodStrong}>扫码添加</Text><Text style={styles.methodSpan}>扫描对方的 Proxy Personal QR</Text></Pressable>
          <Pressable onPress={() => setSheet("INVITE")} style={styles.method}><View style={styles.methodIcon}><ProxyIcon color={color.proxyPurple} name="arrowUpRight" size={20} /></View><Text style={styles.methodStrong}>邀请好友</Text><Text style={styles.methodSpan}>发送链接或你的个人二维码</Text></Pressable>
          <Pressable onPress={() => setSheet("CONTACTS")} style={styles.method}><View style={styles.methodIcon}><ProxyIcon color={color.proxyPurple} name="user" size={20} /></View><Text style={styles.methodStrong}>通讯录</Text><Text style={styles.methodSpan}>授权后只匹配可能认识的人</Text></Pressable>
          <Pressable onPress={() => setSheet("SOCIAL")} style={styles.method}><View style={styles.methodIcon}><ProxyIcon color={color.proxyPurple} name="spark" size={20} /></View><Text style={styles.methodStrong}>社媒好友</Text><Text style={styles.methodSpan}>TikTok / Instagram / Facebook / Zalo</Text></Pressable>
          <Pressable onPress={() => setSheet("SEARCH")} style={styles.methodFull}><View style={styles.methodIcon}><ProxyIcon color={color.proxyPurple} name="search" size={20} /></View><View style={styles.methodFullCopy}><Text style={styles.methodStrong}>搜索 Proxy</Text><Text style={styles.methodSpan}>昵称、Proxy ID 或手机号</Text></View><Text style={styles.chev}>›</Text></Pressable>
        </View>

        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>好友请求</Text><Text style={styles.sectionNote}>需要你确认</Text></View>
        <Pressable onPress={() => setSheet("REQUESTS")} style={styles.pendingCard}><View style={styles.pendingIcon}><Text style={styles.pendingIconText}>♡</Text></View><View style={styles.pendingMain}><Text style={styles.pendingStrong}>{requests.length} 个待处理请求</Text><Text style={styles.pendingSub}>查看谁想添加你为好友</Text></View><View style={styles.badge}><Text style={styles.badgeText}>{requests.length}</Text></View></Pressable>

        <View style={styles.privacy}><View style={styles.privacyIcon}><Text style={styles.privacyIconText}>i</Text></View><View style={styles.privacyCopy}><Text style={styles.privacyStrong}>关系不会自动导入</Text><Text style={styles.privacyP}>通讯录或外部社媒只用于发现“可能认识”的人。成为 Proxy 好友前，仍需要发送好友请求并由对方确认。</Text></View></View>

        {/* Sheets */}
        <CrmSheet open={sheet === "SCAN"} onClose={() => setSheet(undefined)} title="扫码添加好友" sub="将对方的 Proxy Personal QR 放入框内。识别后仍需发送好友请求。">
          <View style={styles.scanner}><View style={styles.scanFrame} /><Text style={styles.scannerNote}>对准二维码即可识别</Text></View>
          <View style={styles.actions}><Pressable style={styles.btn}><Text style={styles.btnText}>从相册选择</Text></Pressable><Pressable onPress={() => { setSheet("SEARCH"); setProxySearch("PX-937201"); setProxySearchDone(true); }} style={[styles.btn, styles.btnPrimary]}><Text style={styles.btnPrimaryText}>模拟识别</Text></Pressable></View>
        </CrmSheet>

        <CrmSheet open={sheet === "INVITE"} onClose={() => setSheet(undefined)} title="邀请好友" sub="分享你的邀请链接或个人二维码。对方注册/打开 Proxy 后可向你发送好友请求。">
          <View style={styles.qrbox}><View style={styles.fakeQr}><Text style={styles.fakeQrP}>P</Text></View></View>
          <View style={styles.qrName}><Text style={styles.qrNameStrong}>Huyen Nguyen</Text><Text style={styles.qrNameSub}>Proxy ID · PX-827491</Text></View>
          <View style={styles.inviteLink}><Text style={styles.inviteLinkText}>proxy.app/invite/PX-827491</Text><Pressable onPress={() => showToast("邀请链接已复制")} style={styles.copyBtn}><Text style={styles.copyBtnText}>复制</Text></Pressable></View>
          <View style={styles.actions}><Pressable style={styles.btn}><Text style={styles.btnText}>保存二维码</Text></Pressable><Pressable style={[styles.btn, styles.btnPrimary]}><Text style={styles.btnPrimaryText}>系统分享</Text></Pressable></View>
        </CrmSheet>

        <CrmSheet open={sheet === "CONTACTS"} onClose={() => setSheet(undefined)} title="通讯录匹配" sub="Proxy 不会自动添加你的通讯录联系人。授权后只显示可能已经使用 Proxy 的人。">
          {!contactsAllowed ? (
            <View style={styles.permission}><View style={styles.permissionIcon}><ProxyIcon color={color.proxyPurple} name="user" size={24} /></View><Text style={styles.permissionStrong}>允许访问通讯录</Text><Text style={styles.permissionP}>只用于匹配可能认识的人，不会将你的完整通讯录公开给其他用户。</Text><Pressable onPress={() => setContactsAllowed(true)} style={[styles.btn, styles.btnPrimary, { marginTop: 12 }]}><Text style={styles.btnPrimaryText}>允许并查找</Text></Pressable></View>
          ) : (
            <View>
              <View style={styles.sectionHead}><Text style={styles.sectionTitle}>可能认识的人</Text><Text style={styles.sectionNote}>{CONTACT_MATCHES.length} 人</Text></View>
              {CONTACT_MATCHES.map((p) => (
                <View key={p.name} style={styles.personRow}><View style={styles.avatarSmall}><Text style={styles.avatarSmallText}>{p.initial}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{p.name}</Text><Text style={styles.personSub}>{p.sub}</Text></View><Pressable onPress={() => { setSentIds((m) => ({ ...m, [p.name]: true })); showToast("好友请求已发送"); }} style={[styles.addBtn, sentIds[p.name] && styles.addBtnSent]}><Text style={[styles.addBtnText, sentIds[p.name] && styles.addBtnTextSent]}>{sentIds[p.name] ? "已发送" : "添加"}</Text></Pressable></View>
              ))}
            </View>
          )}
        </CrmSheet>

        <CrmSheet open={sheet === "SOCIAL"} onClose={() => setSheet(undefined)} title="从社媒发现好友" sub="选择你愿意授权的平台。Proxy 只返回可能认识的人，不会自动导入社交关系。">
          {[
            ["TK", "TikTok", "查找可能认识的 Proxy 用户"],
            ["IG", "Instagram", "查找可能认识的 Proxy 用户"],
            ["FB", "Facebook", "查找可能认识的 Proxy 用户"],
            ["Z", "Zalo", "用于越南本地好友发现"],
          ].map(([icon, name]) => (
            <View key={name} style={styles.socialOption}><View style={styles.socialIcon}><Text style={styles.socialIconText}>{icon}</Text></View><View style={styles.socialCopy}><Text style={styles.socialName}>{name}</Text><Text style={styles.socialSub}>{(icon === "Z" ? "用于越南本地好友发现" : "查找可能认识的 Proxy 用户")}</Text></View><Pressable style={styles.connectBtn}><Text style={styles.connectText}>关联</Text></Pressable></View>
          ))}
          <View style={[styles.sectionHead, { marginTop: 16 }]}><Text style={styles.sectionTitle}>Instagram 匹配</Text><Text style={styles.sectionNote}>{SOCIAL_MATCHES.length} 人</Text></View>
          {SOCIAL_MATCHES.map((p) => (
            <View key={p.name} style={styles.personRow}><View style={styles.avatarSmall}><Text style={styles.avatarSmallText}>{p.initial}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{p.name}</Text><Text style={styles.personSub}>{p.sub}</Text></View><Pressable onPress={() => { setSentIds((m) => ({ ...m, [p.name]: true })); showToast("好友请求已发送"); }} style={[styles.addBtn, sentIds[p.name] && styles.addBtnSent]}><Text style={[styles.addBtnText, sentIds[p.name] && styles.addBtnTextSent]}>{sentIds[p.name] ? "已发送" : "添加"}</Text></Pressable></View>
          ))}
        </CrmSheet>

        <CrmSheet open={sheet === "SEARCH"} onClose={() => setSheet(undefined)} title="搜索 Proxy" sub="支持昵称、Proxy ID 或手机号。手机号只在对方允许被手机号搜索时可找到。">
          <View style={styles.searchLine}><TextInput value={proxySearch} onChangeText={setProxySearch} placeholder="昵称 / Proxy ID / 手机号" placeholderTextColor={color.muted} style={styles.searchInput} /><Pressable onPress={() => { if (!proxySearch.trim()) { showToast("请输入搜索信息"); return; } setProxySearchDone(true); }} style={styles.searchBtn}><Text style={styles.searchBtnText}>搜索</Text></Pressable></View>
          {!proxySearchDone ? <View style={styles.resultEmpty}><Text style={styles.resultEmptyText}>输入信息开始搜索</Text></View> : <View>{[{ name: "Huyen Le", initial: "HL", sub: "Proxy ID · PX-482167 · Hanoi" }, { name: "Huy Nguyen", initial: "HN", sub: "共同好友 1 人 · Ho Chi Minh City" }].map((p) => (
            <View key={p.name} style={styles.personRow}><View style={styles.avatarSmall}><Text style={styles.avatarSmallText}>{p.initial}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{p.name}</Text><Text style={styles.personSub}>{p.sub}</Text></View><Pressable onPress={() => { setSentIds((m) => ({ ...m, [p.name]: true })); showToast("好友请求已发送"); }} style={[styles.addBtn, sentIds[p.name] && styles.addBtnSent]}><Text style={[styles.addBtnText, sentIds[p.name] && styles.addBtnTextSent]}>{sentIds[p.name] ? "已发送" : "添加"}</Text></Pressable></View>
          ))}</View>}
        </CrmSheet>

        <CrmSheet open={sheet === "REQUESTS"} onClose={() => setSheet(undefined)} title="好友请求" sub="只有你接受后，双方才会成为 Proxy 好友。">
          {requests.map((r) => (
            <View key={`${r.userId ?? r.name}`} style={styles.requestRow}><View style={styles.avatarSmall}><Text style={styles.avatarSmallText}>{r.initial}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{r.name}</Text><Text style={styles.personSub}>{r.source} · {r.time}</Text><View style={styles.requestActions}><Pressable disabled={!r.userId || !relationship} onPress={async () => { if (!r.userId || !relationship) return; try { await relationship.acceptFriendRequest(r.userId); showToast("已成为好友"); void reload(); } catch (error) { showToast(error instanceof Error ? error.message : "接受失败"); } }} style={[styles.btn, styles.btnPrimary, { flex: 1 }]}><Text style={styles.btnPrimaryText}>接受</Text></Pressable><Pressable disabled={!r.userId || !relationship} onPress={async () => { if (!r.userId || !relationship) return; try { await relationship.ignoreFriendRequest(r.userId); showToast("已忽略请求"); void reload(); } catch (error) { showToast(error instanceof Error ? error.message : "忽略失败"); } }} style={[styles.btn, { flex: 1 }]}><Text style={styles.btnText}>忽略</Text></Pressable></View></View></View>
          ))}
          {!requests.length ? <Text style={styles.resultEmptyText}>暂无待处理请求</Text> : null}
        </CrmSheet>

        {toast ? <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}
      </ScrollView>
    );
  }

  // 默认 LIST 视图：轻 CRM 关系图 — 参考原型“好友关系 关系状态、互动与下一步动作”
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.backRow}><Text style={styles.backText}>‹ 返回我的</Text></Pressable>
      <Text style={styles.title}>好友关系</Text>
      <Text style={styles.sub}>关系状态、互动与下一步动作</Text>

      <View style={styles.metricGrid}>
        <View style={styles.metricCard}><Text style={styles.metricValue}>{ADV_CRM_FRIENDS.length}</Text><Text style={styles.metricLabel}>好友关系</Text></View>
        <View style={[styles.metricCard, styles.metricCardActive]}><Text style={styles.metricValue}>{ADV_CRM_FRIENDS.filter((f) => f.crmStatus === "WARM").length}</Text><Text style={styles.metricLabel}>暖关系</Text></View>
        <View style={styles.metricCard}><Text style={styles.metricValue}>{ADV_CRM_FRIENDS.filter((f) => f.crmStatus === "FOLLOW").length}</Text><Text style={styles.metricLabel}>待跟进</Text></View>
        <View style={styles.metricCard}><Text style={styles.metricValue}>{ADV_CRM_FRIENDS.filter((f) => f.crmStatus === "MET").length}</Text><Text style={styles.metricLabel}>已见面</Text></View>
      </View>

      <View style={styles.insightCard}>
        <View style={styles.insightHead}><Text style={styles.insightTitle}>Advanced Insight</Text><View style={styles.insightBadge}><Text style={styles.insightBadgeText}>Pro</Text></View></View>
        <Text style={styles.insightSub}>For active users / Creator value analysis</Text>
        <View style={styles.insightRows}>
          <View style={styles.insightRow}><Text style={styles.insightRowLabel}>Home Visits</Text><Text style={styles.insightRowDots}>•••</Text></View>
          <View style={styles.insightRow}><Text style={styles.insightRowLabel}>Repeat Visitors</Text><Text style={styles.insightRowDots}>•••</Text></View>
          <View style={styles.insightRow}><Text style={styles.insightRowLabel}>Visit → DM</Text><Text style={styles.insightRowDots}>•••</Text></View>
          <View style={styles.insightRow}><Text style={styles.insightRowLabel}>Relation → Voucher</Text><Text style={styles.insightRowDots}>•••</Text></View>
        </View>
        <Text style={styles.insightFoot}>Advanced insights by subscription / Creator status</Text>
        <Pressable onPress={() => showToast("原型查看（演示）")} style={styles.insightBtn}><Text style={styles.insightBtnText}>View Prototype</Text></Pressable>
      </View>

      <View style={styles.recommendCard}>
        <View style={styles.recommendHead}><Text style={styles.recommendTitle}>推荐动作</Text><Text style={styles.recommendSub}>今天最值得先处理的关系</Text></View>
        <View style={styles.recommendPriority}><View style={styles.priorityDot} /><Text style={styles.priorityText}>高优先级 · {ADV_CRM_FRIENDS[0]?.name ?? "Mai"} · 发咖啡券</Text></View>
        <Text style={styles.recommendDesc}>最近已回复，且过去7天有持续互动，适合低成本转线下。</Text>
        <View style={styles.recommendActions}><Pressable onPress={() => showToast("查看详情")} style={styles.recommendBtn}><Text style={styles.recommendBtnText}>查看</Text></Pressable><Pressable onPress={() => showToast("咖啡券已发送（演示）")} style={[styles.recommendBtn, styles.recommendBtnPrimary]}><Text style={styles.recommendBtnPrimaryText}>发礼券</Text></Pressable><Pressable onPress={() => onOpenConversation(ADV_CRM_FRIENDS[0]?.name ?? "Mai")} style={styles.recommendBtn}><Text style={styles.recommendBtnText}>发消息</Text></Pressable></View>
        <View style={styles.contextBuilder}><Text style={styles.contextTitle}>语境构建建议</Text><Text style={styles.contextSub}>用户可选，不自动替用户发送</Text><Text style={styles.contextTag}>可选 · 建议风格：自然、轻松、先场景后邀约</Text><Text style={styles.contextDesc}>从咖啡或摄影共同兴趣切入，再自然推进礼券或活动邀请。</Text><View style={styles.contextChips}><View style={styles.contextChipActive}><Text style={styles.contextChipActiveText}>轻松</Text></View><View style={styles.contextChip}><Text style={styles.contextChipText}>朋友式</Text></View><View style={styles.contextChip}><Text style={styles.contextChipText}>直接</Text></View><View style={styles.contextChip}><Text style={styles.contextChipText}>商务</Text></View></View></View>
      </View>

      <View style={styles.assistantCard}>
        <Text style={styles.assistantTitle}>智能关系助手</Text>
        <Text style={styles.assistantSub}>自动整理 Proxy 内部关系事件；消息内容理解独立授权</Text>
        <View style={styles.assistantRow}><View><Text style={styles.assistantLabel}>内部互动事件整理</Text><Text style={styles.assistantDesc}>基于 Proxy 内部事件</Text></View><View style={styles.toggleOn}><Text style={styles.toggleOnText}>开启</Text></View></View>
        <View style={styles.assistantRow}><View><Text style={styles.assistantLabel}>消息内容理解</Text><Text style={styles.assistantDesc}>需独立授权</Text></View><View style={styles.toggleOff}><Text style={styles.toggleOffText}>关闭</Text></View></View>
        <View style={styles.assistantRow}><View><Text style={styles.assistantLabel}>主动分享的社媒账号自动保存</Text><Text style={styles.assistantDesc}>确认后保存</Text></View><Pressable onPress={() => showToast("已开启自动保存")} style={styles.toggleOn}><Text style={styles.toggleOnText}>开启</Text></Pressable></View>
        <Text style={styles.assistantFoot}>数据来源仅限 Proxy 内部事件、用户授权绑定、双方主动分享的信息。</Text>
      </View>

      <View style={styles.searchRow}><TextInput value={search} onChangeText={setSearch} placeholder="搜索好友、备注、互动…" placeholderTextColor={color.muted} style={styles.searchInputFull} /><View style={styles.searchBtnIcon}><ProxyIcon color={color.white} name="search" size={18} /></View></View>

      <View style={styles.filterTabs}>
        <Pressable onPress={() => setCrmTab("ALL")} style={[styles.filterTab, crmTab === "ALL" && styles.filterTabActive]}><Text style={[styles.filterTabText, crmTab === "ALL" && styles.filterTabTextActive]}>全部</Text></Pressable>
        <Pressable onPress={() => setCrmTab("WARM")} style={[styles.filterTab, crmTab === "WARM" && styles.filterTabActive]}><Text style={[styles.filterTabText, crmTab === "WARM" && styles.filterTabTextActive]}>暖关系</Text></Pressable>
        <Pressable onPress={() => setCrmTab("FOLLOW")} style={[styles.filterTab, crmTab === "FOLLOW" && styles.filterTabActive]}><Text style={[styles.filterTabText, crmTab === "FOLLOW" && styles.filterTabTextActive]}>待跟进</Text></Pressable>
        <Pressable onPress={() => setCrmTab("MET")} style={[styles.filterTab, crmTab === "MET" && styles.filterTabActive]}><Text style={[styles.filterTabText, crmTab === "MET" && styles.filterTabTextActive]}>已见面</Text></Pressable>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>好友列表</Text><Text style={styles.sectionNote}>{visibleAdv.length} 人</Text></View>
        {visibleAdv.map((friend, idx) => (
          <Pressable key={friend.id} onPress={() => openDetail({ ...friend, relation: friend.actionSub } as CrmFriend)} style={[styles.friendRow, idx > 0 && styles.friendRowLine]}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{friend.initial}</Text></View>
            <View style={styles.friendCopy}><Text style={styles.friendName}>{friend.name}</Text><Text style={styles.friendContext}>{friend.note}</Text><View style={styles.tagRow}><View style={styles.tag}><Text style={styles.tagText}>{friend.actionSub}</Text></View></View></View>
            <Pressable onPress={() => { if (friend.actionLabel.includes("礼券") || friend.actionLabel.includes("咖啡")) showToast("咖啡券已发送"); else if (friend.actionLabel.includes("体验")) showToast("体验邀约已发送"); else onOpenConversation(friend.name); }} style={styles.listActionBtn}><Text style={styles.listActionBtnText}>{friend.actionLabel}</Text></Pressable>
          </Pressable>
        ))}
        {!visibleAdv.length ? <Text style={styles.emptyResult}>没有匹配的好友</Text> : null}
      </View>

      <View style={styles.privacy}><View style={styles.privacyIcon}><Text style={styles.privacyIconText}>i</Text></View><View style={styles.privacyCopy}><Text style={styles.privacyStrong}>数据边界</Text><Text style={styles.privacyP}>全部数据来自 Proxy 内部事件与你主动分享的信息，不会自动读取聊天内容或社媒私信。</Text></View></View>

      {toast ? <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}
    </ScrollView>
  );
}

function FriendDetail({ friend, onBack, onOpenConversation, showToast, toast }: { friend: CrmFriend; onBack: () => void; onOpenConversation: (a: string) => void; showToast: (t: string) => void; toast: string }): React.JSX.Element {
  const [note, setNote] = useState(friend.note);
  const [tags, setTags] = useState<string[]>(friend.tags);
  const [newTag, setNewTag] = useState("");
  function addTag(): void {
    const t = newTag.trim();
    if (!t || tags.includes(t)) return;
    setTags((prev) => [...prev, t]);
    setNewTag("");
    showToast("标签已添加");
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.backRow}><Text style={styles.backText}>‹ 返回好友</Text></Pressable>

      <View style={styles.detailHead}><View style={styles.avatarLarge}><Text style={styles.avatarLargeText}>{friend.initial}</Text></View><View style={styles.detailHeadCopy}><Text style={styles.detailName}>{friend.name}</Text><Text style={styles.detailProxyId}>{friend.proxyId} · {friend.city} · 已验证</Text><View style={styles.tagRow}>{tags.map((t) => <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>)}</View></View></View>

      <View style={styles.actionRow}><Pressable onPress={() => onOpenConversation(friend.name)} style={[styles.actionBtn, styles.actionBtnPrimary]}><Text style={styles.actionBtnPrimaryText}>发消息</Text></Pressable><Pressable onPress={() => showToast("主页已打开")} style={styles.actionBtn}><Text style={styles.actionBtnText}>查看主页</Text></Pressable></View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>关系信息</Text><Text style={styles.sectionNote}>轻 CRM</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvLabel}>来源</Text><Text style={styles.kvValue}>{friend.sourceLabel}</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvLabel}>认识时间</Text><Text style={styles.kvValue}>{friend.createdAt}</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvLabel}>共同好友</Text><Text style={styles.kvValue}>{friend.commonFriends} 人</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvLabel}>最近互动</Text><Text style={styles.kvValue}>{friend.lastInteraction}</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvLabel}>关系状态</Text><View style={styles.statusPill}><Text style={styles.statusPillText}>{friend.status === "FRIEND" ? "已是好友" : friend.status}</Text></View></View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>标签</Text><Text style={styles.sectionNote}>用于筛选与回顾</Text></View>
        <View style={styles.tagRow}>{tags.map((t) => <Pressable key={t} onPress={() => setTags((prev) => prev.filter((x) => x !== t))} style={styles.tagEditable}><Text style={styles.tagText}>{t} ×</Text></Pressable>)}{!tags.length ? <Text style={styles.emptyInline}>暂无标签</Text> : null}</View>
        <View style={styles.tagAddRow}><TextInput value={newTag} onChangeText={setNewTag} placeholder="新增标签，如：摄影" placeholderTextColor={color.muted} style={styles.tagInput} /><Pressable onPress={addTag} style={styles.tagAddBtn}><Text style={styles.tagAddBtnText}>添加</Text></Pressable></View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>备注</Text><Text style={styles.sectionNote}>仅自己可见</Text></View>
        <TextInput value={note} onChangeText={setNote} placeholder="写下你对这位好友的备注…" placeholderTextColor={color.muted} multiline style={styles.noteInput} />
        <Pressable onPress={() => showToast("备注已保存")} style={[styles.btn, styles.btnPrimary, { marginTop: 10 }]}><Text style={styles.btnPrimaryText}>保存备注</Text></Pressable>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>互动记录</Text><Text style={styles.sectionNote}>最近 3 条</Text></View>
        <View style={styles.timelineRow}><View style={styles.timelineDot} /><View style={styles.timelineCopy}><Text style={styles.timelineTitle}>聊天 · 昨天</Text><Text style={styles.timelineSub}>“好的，到时候联系你。”</Text></View></View>
        <View style={styles.timelineRow}><View style={styles.timelineDot} /><View style={styles.timelineCopy}><Text style={styles.timelineTitle}>活动报名 · 3 天前</Text><Text style={styles.timelineSub}>一起报名了「西湖摄影散步」</Text></View></View>
        <View style={styles.timelineRow}><View style={styles.timelineDot} /><View style={styles.timelineCopy}><Text style={styles.timelineTitle}>添加好友 · {friend.createdAt}</Text><Text style={styles.timelineSub}>{friend.sourceLabel}</Text></View></View>
      </View>

      <View style={styles.dangerRow}><Pressable onPress={() => showToast("已移除好友（演示）")} style={styles.dangerBtn}><Text style={styles.dangerBtnText}>移除好友</Text></Pressable><Pressable onPress={() => showToast("已拉黑（演示）")} style={styles.dangerBtn}><Text style={styles.dangerBtnText}>拉黑</Text></Pressable></View>

      {toast ? <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}
    </ScrollView>
  );
}

function CrmSheet({ open, onClose, title, sub, children }: { open: boolean; onClose: () => void; title: string; sub: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
      <Pressable onPress={onClose} style={styles.sheetOverlay}><Pressable onPress={() => undefined} style={styles.sheet}><View style={styles.sheetGrab} /><View style={styles.sheetHead}><Text style={styles.sheetTitle}>{title}</Text><Pressable onPress={onClose}><Text style={styles.sheetClose}>×</Text></Pressable></View><Text style={styles.sheetSub}>{sub}</Text>{children}</Pressable></Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 16, paddingTop: 10 },
  backRow: { paddingVertical: 6 },
  backText: { color: color.magenta, fontSize: 14, fontWeight: "800" },
  title: { color: color.ink, fontSize: 26, fontWeight: "900", lineHeight: 34, marginTop: 6 },
  sub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginBottom: 8, marginTop: 18 },
  sectionTitle: { color: color.ink, fontSize: 13, fontWeight: "900" },
  sectionNote: { color: color.muted, fontSize: 11 },
  methodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  method: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, minHeight: 136, padding: 14, width: "48.2%", ...shadows.card },
  methodFull: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, marginTop: 2, padding: 12, width: "100%", ...shadows.card },
  methodFullCopy: { flex: 1 },
  methodIcon: { alignItems: "center", backgroundColor: color.proxyPurpleSoft, borderRadius: 11, height: 36, justifyContent: "center", width: 36 },
  methodStrong: { color: color.ink, fontSize: 13, fontWeight: "900", marginTop: 12 },
  methodSpan: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  chev: { color: color.muted, fontSize: 18 },
  pendingCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 8, padding: 12, ...shadows.card },
  pendingIcon: { alignItems: "center", backgroundColor: color.proxyPurpleSoft, borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  pendingIconText: { color: color.proxyPurple, fontSize: 16, fontWeight: "900" },
  pendingMain: { flex: 1 },
  pendingStrong: { color: color.ink, fontSize: 13, fontWeight: "800" },
  pendingSub: { color: color.muted, fontSize: 11, marginTop: 3 },
  badge: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 11, height: 20, justifyContent: "center", minWidth: 20, paddingHorizontal: 6 },
  badgeText: { color: color.white, fontSize: 11, fontWeight: "900" },
  privacy: { backgroundColor: color.violetSoftBg, borderRadius: 14, flexDirection: "row", gap: 10, marginTop: 12, padding: 12 },
  privacyIcon: { alignItems: "center", backgroundColor: color.white, borderRadius: 9, height: 28, justifyContent: "center", width: 28 },
  privacyIconText: { color: color.proxyPurple, fontSize: 12, fontWeight: "900" },
  privacyCopy: { flex: 1 },
  privacyStrong: { color: color.ink, fontSize: 11, fontWeight: "800" },
  privacyP: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  headRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  addFriendBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 10, flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  addFriendBtnText: { color: color.white, fontSize: 12, fontWeight: "900" },
  crmAddCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 12, padding: 12, ...shadows.card },
  crmAddIcon: { alignItems: "center", backgroundColor: color.proxyPurpleSoft, borderRadius: 11, height: 36, justifyContent: "center", width: 36 },
  crmAddCopy: { flex: 1 },
  crmAddTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  crmAddSub: { color: color.muted, fontSize: 11, marginTop: 3 },
  searchRow: { flexDirection: "row", gap: 7, marginTop: 12 },
  searchInputFull: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, color: color.ink, flex: 1, fontSize: 13, paddingHorizontal: 12, paddingVertical: 10 },
  searchBtnIcon: { alignItems: "center", backgroundColor: color.ink, borderRadius: 12, height: 40, justifyContent: "center", width: 42 },
  sectionCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginTop: 12, overflow: "hidden", padding: 12, ...shadows.card },
  friendRow: { alignItems: "center", flexDirection: "row", gap: 10, paddingVertical: 10 },
  friendRowLine: { borderTopColor: color.line, borderTopWidth: 1 },
  avatar: { alignItems: "center", backgroundColor: "#F1E8FF", borderRadius: 12, height: 42, justifyContent: "center", width: 42 },
  avatarText: { color: color.ink, fontSize: 12, fontWeight: "900" },
  friendCopy: { flex: 1 },
  friendName: { color: color.ink, fontSize: 13, fontWeight: "800" },
  friendProxyId: { color: color.muted, fontSize: 11, fontWeight: "700" },
  friendContext: { color: color.muted, fontSize: 11, marginTop: 2 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 5 },
  tag: { backgroundColor: color.proxyPurpleSoft, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  tagText: { color: "#5B2CB5", fontSize: 11, fontWeight: "800" },
  sourceMini: { color: "#9B92A3", fontSize: 11, marginTop: 4 },
  emptyResult: { color: color.muted, fontSize: 11, padding: 16, textAlign: "center" },
  detailHead: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 12, padding: 14, ...shadows.card },
  avatarLarge: { alignItems: "center", backgroundColor: "#F1E8FF", borderRadius: 16, height: 56, justifyContent: "center", width: 56 },
  avatarLargeText: { color: color.ink, fontSize: 16, fontWeight: "900" },
  detailHeadCopy: { flex: 1 },
  detailName: { color: color.ink, fontSize: 16, fontWeight: "900" },
  detailProxyId: { color: color.muted, fontSize: 11, marginTop: 3 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  actionBtn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: 11 },
  actionBtnPrimary: { backgroundColor: color.ink, borderColor: color.ink },
  actionBtnText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  actionBtnPrimaryText: { color: color.white, fontSize: 13, fontWeight: "900" },
  kvRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  kvLabel: { color: color.muted, fontSize: 11, fontWeight: "700" },
  kvValue: { color: color.ink, fontSize: 11, fontWeight: "800", maxWidth: 220, textAlign: "right" },
  statusPill: { backgroundColor: "#EAF9F0", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText: { color: "#187A48", fontSize: 11, fontWeight: "800" },
  tagEditable: { backgroundColor: color.proxyPurpleSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  emptyInline: { color: color.muted, fontSize: 11 },
  tagAddRow: { flexDirection: "row", gap: 7, marginTop: 10 },
  tagInput: { backgroundColor: color.chipNeutralBg, borderColor: color.line, borderRadius: 10, borderWidth: 1, flex: 1, fontSize: 12, paddingHorizontal: 10, paddingVertical: 8 },
  tagAddBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 10, justifyContent: "center", paddingHorizontal: 14 },
  tagAddBtnText: { color: color.white, fontSize: 12, fontWeight: "800" },
  noteInput: { backgroundColor: color.chipNeutralBg, borderColor: color.line, borderRadius: 10, borderWidth: 1, color: color.ink, fontSize: 12, minHeight: 72, padding: 10, textAlignVertical: "top" },
  timelineRow: { alignItems: "flex-start", flexDirection: "row", gap: 10, paddingVertical: 8 },
  timelineDot: { backgroundColor: color.proxyPurple, borderRadius: 5, height: 8, marginTop: 6, width: 8 },
  timelineCopy: { flex: 1 },
  timelineTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  timelineSub: { color: color.muted, fontSize: 11, marginTop: 3 },
  dangerRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  dangerBtn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, flex: 1, paddingVertical: 10 },
  dangerBtnText: { color: color.error, fontSize: 12, fontWeight: "800" },
  sheetOverlay: { alignItems: "flex-end", backgroundColor: "rgba(17,13,21,0.38)", flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: color.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: "90%", padding: 16, width: "100%" },
  sheetGrab: { alignSelf: "center", backgroundColor: "#DDD6E3", borderRadius: 999, height: 4, width: 36 },
  sheetHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  sheetTitle: { color: color.ink, fontSize: 15, fontWeight: "900" },
  sheetClose: { color: color.muted, fontSize: 20, paddingHorizontal: 6 },
  sheetSub: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  scanner: { alignItems: "center", backgroundColor: "#111", borderRadius: 18, height: 260, justifyContent: "center", marginTop: 12, overflow: "hidden" },
  scanFrame: { borderColor: "rgba(255,255,255,0.85)", borderRadius: 18, borderWidth: 2, height: 170, width: 170 },
  scannerNote: { bottom: 18, color: "#D6D1D8", fontSize: 11, position: "absolute" },
  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  btn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: 10 },
  btnPrimary: { backgroundColor: color.ink, borderColor: color.ink },
  btnText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  btnPrimaryText: { color: color.white, fontSize: 11, fontWeight: "900" },
  qrbox: { alignItems: "center", marginTop: 12 },
  fakeQr: { alignItems: "center", backgroundColor: "#EEEAF1", borderRadius: 12, height: 120, justifyContent: "center", width: 120 },
  fakeQrP: { backgroundColor: color.white, borderRadius: 10, color: color.ink, fontSize: 18, fontWeight: "900", overflow: "hidden", paddingHorizontal: 12, paddingVertical: 8 },
  qrName: { alignItems: "center", marginTop: 10 },
  qrNameStrong: { color: color.ink, fontSize: 14, fontWeight: "900" },
  qrNameSub: { color: color.muted, fontSize: 11, marginTop: 3 },
  inviteLink: { alignItems: "center", backgroundColor: "#FAFAFA", borderColor: color.line, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, marginTop: 12, padding: 10 },
  inviteLinkText: { color: "#6D6672", flex: 1, fontSize: 11 },
  copyBtn: { backgroundColor: color.ink, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  copyBtnText: { color: color.white, fontSize: 11, fontWeight: "900" },
  permission: { alignItems: "center", backgroundColor: "#FAF9FB", borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 12, padding: 14 },
  permissionIcon: { alignItems: "center", backgroundColor: color.proxyPurpleSoft, borderRadius: 14, height: 48, justifyContent: "center", width: 48 },
  permissionStrong: { color: color.ink, fontSize: 13, fontWeight: "900", marginTop: 8 },
  permissionP: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 6, textAlign: "center" },
  personRow: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 10, paddingVertical: 10 },
  personCopy: { flex: 1 },
  personName: { color: color.ink, fontSize: 12, fontWeight: "800" },
  personSub: { color: color.muted, fontSize: 11, marginTop: 3 },
  avatarSmall: { alignItems: "center", backgroundColor: "#F1E8FF", borderRadius: 11, height: 40, justifyContent: "center", width: 40 },
  avatarSmallText: { color: color.ink, fontSize: 11, fontWeight: "900" },
  addBtn: { backgroundColor: color.ink, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  addBtnSent: { backgroundColor: "#F0EDF2" },
  addBtnText: { color: color.white, fontSize: 11, fontWeight: "900" },
  addBtnTextSent: { color: "#8C8592" },
  socialOption: { alignItems: "center", borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 8, padding: 10 },
  socialIcon: { alignItems: "center", backgroundColor: color.proxyPurpleSoft, borderRadius: 11, height: 38, justifyContent: "center", width: 38 },
  socialIconText: { color: color.proxyPurple, fontSize: 11, fontWeight: "900" },
  socialCopy: { flex: 1 },
  socialName: { color: color.ink, fontSize: 12, fontWeight: "800" },
  socialSub: { color: color.muted, fontSize: 11, marginTop: 3 },
  connectBtn: { backgroundColor: color.white, borderColor: color.line, borderRadius: 9, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  connectText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  searchLine: { flexDirection: "row", gap: 7, marginTop: 12 },
  searchInput: { backgroundColor: "#FAFAFA", borderColor: color.line, borderRadius: 11, borderWidth: 1, color: color.ink, flex: 1, fontSize: 11, paddingHorizontal: 10, paddingVertical: 10 },
  searchBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 11, justifyContent: "center", paddingHorizontal: 14 },
  searchBtnText: { color: color.white, fontSize: 11, fontWeight: "900" },
  resultEmpty: { alignItems: "center", borderColor: "#D9D2DD", borderRadius: 12, borderStyle: "dashed", borderWidth: 1, marginTop: 12, padding: 16 },
  resultEmptyText: { color: color.muted, fontSize: 11 },
  requestRow: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 10, paddingVertical: 12 },
  requestActions: { flexDirection: "row", gap: 7, marginTop: 8 },
  // 高级 CRM 原型新增样式
  metricGrid: { flexDirection: "row", gap: 8, marginTop: 12 },
  metricCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 12, ...shadows.card },
  metricCardActive: { backgroundColor: "#FFF0F6", borderColor: "#FFCFE0" },
  metricValue: { color: color.ink, fontSize: 20, fontWeight: "900" },
  metricLabel: { color: color.muted, fontSize: 11, marginTop: 4 },
  insightCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginTop: 12, padding: 12, ...shadows.card },
  insightHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  insightTitle: { color: color.ink, fontSize: 13, fontWeight: "900" },
  insightBadge: { backgroundColor: "#F1E8FF", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  insightBadgeText: { color: "#6B3ACF", fontSize: 11, fontWeight: "800" },
  insightSub: { color: color.muted, fontSize: 11, marginTop: 4 },
  insightRows: { marginTop: 10 },
  insightRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  insightRowLabel: { color: color.ink, fontSize: 11, fontWeight: "700" },
  insightRowDots: { color: color.muted, fontSize: 11, letterSpacing: 2 },
  insightFoot: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 8 },
  insightBtn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, marginTop: 8, paddingVertical: 8 },
  insightBtnText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  recommendCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginTop: 12, padding: 12, ...shadows.card },
  recommendHead: { flexDirection: "row", justifyContent: "space-between" },
  recommendTitle: { color: color.ink, fontSize: 13, fontWeight: "900" },
  recommendSub: { color: color.muted, fontSize: 11 },
  recommendPriority: { alignItems: "center", flexDirection: "row", gap: 6, marginTop: 10 },
  priorityDot: { backgroundColor: "#FF3B30", borderRadius: 4, height: 8, width: 8 },
  priorityText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  recommendDesc: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  recommendActions: { flexDirection: "row", gap: 7, marginTop: 10 },
  recommendBtn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 9, borderWidth: 1, flex: 1, paddingVertical: 8 },
  recommendBtnPrimary: { backgroundColor: color.ink, borderColor: color.ink },
  recommendBtnText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  recommendBtnPrimaryText: { color: color.white, fontSize: 11, fontWeight: "900" },
  contextBuilder: { backgroundColor: "#F7F3FA", borderRadius: 12, marginTop: 10, padding: 10 },
  contextTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  contextSub: { color: color.muted, fontSize: 11, marginTop: 3 },
  contextTag: { backgroundColor: color.white, borderRadius: 999, color: "#6B3ACF", fontSize: 11, fontWeight: "700", marginTop: 6, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3 },
  contextDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 6 },
  contextChips: { flexDirection: "row", gap: 6, marginTop: 8 },
  contextChip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  contextChipActive: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  contextChipText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  contextChipActiveText: { color: color.white, fontSize: 11, fontWeight: "800" },
  assistantCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginTop: 12, padding: 12, ...shadows.card },
  assistantTitle: { color: color.ink, fontSize: 13, fontWeight: "900" },
  assistantSub: { color: color.muted, fontSize: 11, marginTop: 4 },
  assistantRow: { alignItems: "center", borderColor: color.line, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingTop: 10 },
  assistantLabel: { color: color.ink, fontSize: 11, fontWeight: "800" },
  assistantDesc: { color: color.muted, fontSize: 11, marginTop: 2 },
  toggleOn: { backgroundColor: "#E6F7ED", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  toggleOnText: { color: "#0A7A42", fontSize: 11, fontWeight: "800" },
  toggleOff: { backgroundColor: "#F1EDF3", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  toggleOffText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  assistantFoot: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 10 },
  filterTabs: { flexDirection: "row", gap: 7, marginTop: 12 },
  filterTab: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, flex: 1, paddingVertical: 7, alignItems: "center" },
  filterTabActive: { backgroundColor: color.ink, borderColor: color.ink },
  filterTabText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  filterTabTextActive: { color: color.white },
  listActionBtn: { backgroundColor: color.ink, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  listActionBtnText: { color: color.white, fontSize: 11, fontWeight: "800" },
  toast: { alignSelf: "center", backgroundColor: color.ink, borderRadius: 999, bottom: 18, paddingHorizontal: 14, paddingVertical: 8, position: "absolute" },
  toastText: { color: color.white, fontSize: 11, fontWeight: "800" },
});
