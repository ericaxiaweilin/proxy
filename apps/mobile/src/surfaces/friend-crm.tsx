// 个人轻 CRM — 好友不是消息列表的子集，而是独立的个人关系资产。
// 接线 /Users/thanhhuyennguyen/Downloads/proxy_add_friend_detail.html 的 5 种加好友 + 轻 CRM 详情
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { CameraView, scanFromURLAsync, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { captureRef } from "react-native-view-shot";
import { buildContactCard, parseScannedQr, scannedCaption } from "../profile-qr";
import type { ScannedQr } from "../profile-qr";
import { ProxyQrCode } from "../components/proxy-qr-code";
import { QrZoomOverlay } from "../components/qr-zoom-overlay";
import { describeError, saveImageToAlbum } from "../image-export";
import { ProxyIcon } from "../components/proxy-icon";
import type { ProfileClient, ProfileWire } from "../profile-client";
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
  // 服务端好友才有：RelationshipClient.listMyFriendships 的 userId。
  // 有它才能调 blockFriend；演示数据没有，危险操作保持禁用。
  userId?: string | undefined;
}

const CRM_FRIENDS: CrmFriend[] = [
  { id: "mai", name: "Mai", initial: "M", proxyId: "PX-482167", city: "河内", source: "QR", sourceLabel: "通过 Proxy Personal QR · 2 小时前", relation: "好友 · 共同好友 2", tags: ["摄影", "城市同行"], note: "城市同行合作过一次，准时可靠", commonFriends: 2, lastInteraction: "昨天 · 聊天", status: "FRIEND", createdAt: "2026-06-12" },
  { id: "an", name: "An", initial: "A", proxyId: "PX-937201", city: "河内", source: "CONTACTS", sourceLabel: "通讯录匹配 · 同城", relation: "好友 · 合作过 1 次", tags: ["本地生活"], note: "", commonFriends: 1, lastInteraction: "3 天前 · 活动报名", status: "FRIEND", createdAt: "2026-07-02" },
  { id: "luna", name: "Luna", initial: "L", proxyId: "PX-118492", city: "河内", source: "SOCIAL", sourceLabel: "Instagram · @luna.daily", relation: "好友 · 最近认识", tags: ["活动", "摄影"], note: "西湖摄影散步认识", commonFriends: 0, lastInteraction: "1 周前 · 动态互动", status: "FRIEND", createdAt: "2026-08-10" },
  { id: "khoa", name: "Khoa", initial: "K", proxyId: "PX-552018", city: "河内", source: "SEARCH", sourceLabel: "通过 Proxy 搜索 · 昵称", relation: "好友 · 同城", tags: ["中文", "商务沟通"], note: "", commonFriends: 3, lastInteraction: "2 周前 · 订单", status: "FRIEND", createdAt: "2026-05-20" },
];

// 修复：好友关系不再用独立 mock（David/Kevin/Amy/Ming），统一使用已有好友数据 CRM_FRIENDS
// 以 CRM_FRIENDS 为唯一数据源，附加 CRM 状态，避免信息页与关系页数据不一致
// 本机演示可变：接受请求/拉黑会增删 localFriends，enrich 成函数以便跟随变化。
function enrichFriends(friends: CrmFriend[]): Array<CrmFriend & { crmStatus: "WARM" | "FOLLOW" | "MET" | "NEW"; actionLabel: string; actionSub: string }> {
  return friends.map((f) => {
    const enrich: Record<string, { crmStatus: "WARM" | "FOLLOW" | "MET" | "NEW"; actionLabel: string; actionSub: string; note: string; lastInteraction: string }> = {
      mai: { crmStatus: "WARM", actionLabel: "发咖啡券", actionSub: "暖关系", note: f.note || "城市同行合作过一次，准时可靠", lastInteraction: "最近已回复 · 7 天持续互动" },
      an: { crmStatus: "MET", actionLabel: "发体验邀约", actionSub: "已见面", note: f.note || "已见过一次，偏好本地生活", lastInteraction: "已见面" },
      luna: { crmStatus: "FOLLOW", actionLabel: "继续聊天", actionSub: "待跟进", note: f.note || "西湖摄影散步认识", lastInteraction: "加好友后未激活" },
      khoa: { crmStatus: "FOLLOW", actionLabel: "发欢迎消息", actionSub: "新关系", note: f.note || "同城好友，需要建立第一轮互动", lastInteraction: "新添加" },
    };
    const e = enrich[f.id] ?? { crmStatus: "NEW" as const, actionLabel: "发消息", actionSub: "新关系", note: f.note, lastInteraction: f.lastInteraction };
    return { ...f, ...e };
  });
}

const PENDING_REQUESTS: Array<{ name: string; initial: string; source: string; time: string; userId: string }> = [
  { name: "Mai Linh", initial: "ML", source: "通过 Proxy ID 搜索找到你", time: "2 小时前", userId: "demo:mai-linh" },
  { name: "Duc Tran", initial: "DT", source: "共同好友 3 人 · 昨天", time: "昨天", userId: "demo:duc-tran" },
];

// 本机演示匹配人：无服务端搜索/匹配接口，添加走本地状态机
// （已发送→接受/忽略→进列表），与服务端行共用同一套 UI 与 handler
// 形状，专门用来跑通流程、暴露问题。
const CONTACT_MATCHES: Array<{ name: string; initial: string; sub: string }> = [
  { name: "Minh Nguyen", initial: "MN", sub: "通讯录 · 共同好友 2 人" },
  { name: "Lan Anh", initial: "LA", sub: "通讯录 · 同城" },
  { name: "Hoang Tran", initial: "HT", sub: "通讯录 · 已使用 Proxy" },
];

const SOCIAL_MATCHES: Array<{ name: string; initial: string; sub: string }> = [
  { name: "Quynh N.", initial: "QN", sub: "Instagram · @quynh.daily" },
  { name: "An Tran", initial: "AT", sub: "Instagram · @an.tran" },
];

// PROFILE-SEARCH-001: a two-row hardcoded result array used to live here, and
// the 「搜索 Proxy」 box rendered it for EVERY query — so the input was
// decoration and the results were always the same two people, carrying
// fabricated "PX-" ids that are not even the handle format the rest of the app
// uses. It is deleted rather than kept as a fallback: a fallback that silently
// shows invented people is worse than an honest "no results". Search now goes
// to SearchProfiles on the server.
//
// The deleted constant's name and those fake ids are deliberately NOT written
// out in this file — scripts/check-regression-contracts.sh greps this file for
// them, and a comment mentioning them would satisfy the grep and make the
// tripwire useless. See the PROFILE-SEARCH-001 block there for the details.

type AddFriendSheet = "SCAN" | "INVITE" | "CONTACTS" | "SOCIAL" | "SEARCH" | "REQUESTS" | undefined;
type CrmView = "LIST" | "ADD_FRIEND" | "DETAIL";

export function FriendCrmSurface({ relationship, onOpenConversation, onBack, initialView = "LIST", viewer, onOpenVouchers, profileClient, addFriendBackLabel }: {
  relationship?: RelationshipClient | undefined;
  onOpenConversation: (author: string) => void;
  onBack: () => void;
  initialView?: CrmView;
  // 本人身份（调用方传 profileDraft）：邀请名片不再编造他人的名字和 ID。
  viewer?: { name: string; handle: string } | undefined;
  // 跳券表面：推荐动作“发礼券”走真实券流程，不再弹演示 toast。
  onOpenVouchers?: (() => void) | undefined;
  // HANDLE-LOOKUP-001: 扫码/邀请链接解析出的 handle 要靠它落到真人。
  // 没有它就只能停在「识别出来了但查不到」——那是半截，所以调用方要传。
  profileClient?: ProfileClient | undefined;
  // ADD-FRIEND-FROM-MESSAGES-001: initialView="ADD_FRIEND" 时返回按钮的文案。
  // 本组件不知道 onBack 会把用户带到哪，所以不能自己猜 —— 调用方说去哪就写哪。
  addFriendBackLabel?: string | undefined;
}): React.JSX.Element {
  const [view, setView] = useState<CrmView>(initialView);
  const [sheet, setSheet] = useState<AddFriendSheet>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CrmFriend | undefined>();
  const [contactsAllowed, setContactsAllowed] = useState(false);
  const [proxySearch, setProxySearch] = useState("");
  // PROFILE-SEARCH-001: 全站搜索。六种状态分开，尤其是「查无此人」和
  // 「搜索失败」不能长得一样 —— 前者要用户换个词，后者要用户重试，
  // 合并成一句会让用户对着一个永远不会成功的搜索反复点。
  const [searchState, setSearchState] = useState<"idle" | "busy" | "found" | "empty" | "failed" | "no-client" | "too-short">("idle");
  const [searchResults, setSearchResults] = useState<ProfileWire[]>([]);
  const [searchAdded, setSearchAdded] = useState<Record<string, boolean>>({});
  // 本机演示状态机：无服务端搜索/匹配接口，添加→已发送、请求接受/忽略、
  // 拉黑移除全部在本地流转，与服务端行走同一套 UI，保证每个按钮可点、
  // 每次点按都有可验证的状态变化。
  const [sentIds, setSentIds] = useState<Record<string, boolean>>({});
  const [localFriends, setLocalFriends] = useState<CrmFriend[]>(CRM_FRIENDS);
  // 社媒账号自动保存开关：本地展示态，点按真实翻转（以前只弹 toast，开关不动）。
  const [autoSaveSocial, setAutoSaveSocial] = useState(true);
  // R18.x FRIEND-001: replace the hardcoded PENDING_REQUESTS
  // and CRM_FRIENDS with server-fetched lists. The mock
  // constants are kept as a fallback when the
  // RelationshipClient is absent (offline / pre-auth).
  const [requests, setRequests] = useState<Array<{ name: string; initial: string; source: string; time: string; userId: string }>>(PENDING_REQUESTS);
  const [serverFriends, setServerFriends] = useState<{ active: FriendView[]; pending: FriendView[] }>({ active: [], pending: [] });
  const [friendsError, setFriendsError] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState("");
  const [crmTab, setCrmTab] = useState<"ALL" | "WARM" | "FOLLOW" | "MET">("ALL");
  const [inviteCopied, setInviteCopied] = useState(false);
  // PROFILE-QR-004：邀请二维码的存图锚点。以前这处只有「复制链接 / 系统分享」，
  // 想发给好友只能发一段文字，存不下图。
  const inviteShotRef = useRef<View>(null);
  // 放大层：和「我的二维码」页共用同一个组件，不再各页自己搭 Modal。
  const [inviteZoomOpen, setInviteZoomOpen] = useState(false);
  const inviteZoomShotRef = useRef<View>(null);
  const [inviteQrNotice, setInviteQrNotice] = useState<string | undefined>(undefined);
  // PROFILE-QR-003: 扫码识别三态 —— undefined 还没试 / null 识别失败 / ScannedQr 成功。
  // 相机扫描（expo-camera）与剪贴板共用 parseScannedQr，落在同一状态机。
  const [scanned, setScanned] = useState<ScannedQr | null>();
  const [scanError, setScanError] = useState("");
  // 相机权限（PROFILE-QR-003）：granted 前显示授权按钮，拒绝后显示明确文案。
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  // HANDLE-LOOKUP-001: 识别出 handle 之后要落到**人**。五种结果五种文案 ——
  // 查到 / 没这个人 / 查询失败 / 没有登录态 / 这是店铺名片，谁也不许长得像谁：
  // 把「查不到」显示成「查询失败」会让人一直重试，把「没登录」显示成
  // 「查不到」会让人以为码坏了，把「店铺名片」显示成「查无此人」会让人以为店关了。
  const [scanLookup, setScanLookup] = useState<"found" | "missing" | "failed" | "no-client" | "store">();
  const [scanMatch, setScanMatch] = useState<ProfileWire>();
  const [scanBusy, setScanBusy] = useState(false);
  // 相机每帧可能触发多次 barcode 事件：ref 锁住重复解析（state 更新是异步的）。
  const scanBusyRef = useRef(false);
  const [scanAddSent, setScanAddSent] = useState(false);
  // ADD-FRIEND-SEND-BUSY-001: 发送请求没有忙态时，弱网下点添加会长时间停在
  // “添加”上 —— 看起来像没反应，还能重复点造成重复发送。用锁 + 文案盖住全程。
  const [scanAddBusy, setScanAddBusy] = useState(false);

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

  // ADD-FRIEND-NEXT-001: 我发出的请求必须可查。reload() 以前只把 INCOMING 投影到
  // requests，OUTGOING 没有任何渲染面 —— 点了添加变“已发送”即终点。通过后的开聊
  // 走 LIST 已有的 onOpenConversation，这里只展示等待态，不加动作按钮
  // （服务端无撤回命令，不编）。
  const outgoingRequests = useMemo(() => {
    return serverFriends.pending
      .filter((f) => f.direction === "OUTGOING")
      .map((f) => {
        const name = f.displayName || f.userId;
        return {
          userId: f.userId,
          name,
          initial: name.slice(0, 1).toUpperCase() || "?",
          sub: `${f.city ? `${f.city} · ` : ""}${f.since.slice(0, 10)} · 等待对方通过`,
        };
      });
  }, [serverFriends]);

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
        userId: f.userId,
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

  // 本机演示列表由 localFriends 派生：接受请求会加人，拉黑会减人。
  // 必须放在 filteredAdv/visibleAdv 之前声明（memo 按顺序执行）。
  const advFriends = useMemo(() => enrichFriends(localFriends), [localFriends]);

  const filteredAdv = useMemo(() => {
    if (crmTab === "ALL") return advFriends;
    return advFriends.filter((f) => f.crmStatus === crmTab);
  }, [crmTab, advFriends]);

  const visibleAdv = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredAdv;
    return filteredAdv.filter((f) => `${f.name}${f.note}${f.actionLabel}`.toLowerCase().includes(q));
  }, [search, filteredAdv]);

  function showToast(text: string): void {
    setToast(text);
    setTimeout(() => setToast(""), 1700);
  }

  // 复制邀请文本（@handle）：成功给出可见确认，失败也说人话而不是静默无响应。
  async function copyInviteText(text: string): Promise<void> {
    try {
      await Clipboard.setStringAsync(text);
      setInviteCopied(true);
    } catch {
      showToast("复制失败，请长按 @handle 手动复制。");
    }
  }
  // PROFILE-QR-004：邀请码存图。和「我的二维码」页同一套失败文案口径 ——
  // 没权限说没权限，失败说失败，不静默。
  // 返回提示文案而不是自己弹，是因为两个入口的出口不同：邀请卡用 toast，放大层用行内提示。
  async function saveInviteQrToAlbum(shot: { current: View | null } = inviteShotRef): Promise<string> {
    try {
      const uri = await captureRef(shot, { format: "png", quality: 1 });
      const result = await saveImageToAlbum(uri);
      if (result.ok) return "二维码已保存到相册。";
      return result.code === "permission" ? "需要相册权限才能保存二维码。" : `保存失败：${result.reason}`;
    } catch (err) {
      return `保存失败：${describeError(err)}`;
    }
  }
  async function saveInviteQrFromSheet(): Promise<void> {
    showToast(await saveInviteQrToAlbum(inviteShotRef));
  }
  async function saveInviteQrFromZoom(): Promise<void> {
    setInviteQrNotice(await saveInviteQrToAlbum(inviteZoomShotRef));
  }

  // PROFILE-QR-002：邀请码里编的是一张**标准 vCard 名片**（姓名 + @handle），
  // 不再是拼出来的邀请链接。那个域名不是我们的（挂在 Spaceship 上**待售**），
  // 扫出来只是把对方送到卖域名的落地页；而名片是成熟标准，任何手机的相机
  // 扫到都能「存联系人」，不需要域名。码下面展示 / 复制的才是**搜得到的那串**（@handle）。
  // 这里刻意**不写出**那个域名：本文件被 gate 的「不许再拼链接」反向钉盯着，
  // 写进注释会让钉在正确的树上误报。完整的实测记录在 `../profile-qr.ts` 文件头。
  const inviteCard = viewer ? buildContactCard({ name: viewer.name, handle: viewer.handle }) : null;
  const inviteCaption = viewer ? `@${viewer.handle.replace(/^@+/, "")}` : "";

  // 好友请求失败说人话：英文技术错不上屏，会话类问题提示登录。
  function requestErrorMessage(error: unknown, fallback: string): string {
    const msg = error instanceof Error ? error.message : "";
    if (/principal|session|signed|sign in|auth|401|403/i.test(msg)) return "请先登录后再操作。";
    if (!msg || /[a-z_]+\.[a-z_]+/i.test(msg)) return fallback;
    return msg;
  }

  // 发礼券走真实券流程；调用方没接券表面时诚实说明，不伪造“已发送”。
  function sendVoucher(): void {
    if (onOpenVouchers) onOpenVouchers();
    else showToast("礼券请到“券”页面创建，这里不代发。");
  }

  // 本机演示请求：接受→进本地好友列表，忽略→移除，立即生效。
  function acceptDemoRequest(userId: string): void {
    const target = requests.find((r) => r.userId === userId);
    if (!target) return;
    setLocalFriends((prev) => {
      if (prev.some((f) => f.id === userId)) return prev;
      return [...prev, {
        id: userId, name: target.name, initial: target.initial,
        proxyId: userId, city: "河内", source: "SEARCH" as FriendSource,
        sourceLabel: target.source, relation: "好友 · 刚刚接受",
        tags: [], note: "", commonFriends: 0,
        lastInteraction: "刚刚 · 通过好友请求", status: "FRIEND" as FriendStatus,
        createdAt: "2026-09-08",
      }];
    });
    setRequests((prev) => prev.filter((r) => r.userId !== userId));
    showToast("已成为好友");
  }

  function ignoreDemoRequest(userId: string): void {
    setRequests((prev) => prev.filter((r) => r.userId !== userId));
    showToast("已忽略请求");
  }

  // 本机演示拉黑：立即从本地列表移除并返回列表。
  function removeDemoFriend(id: string): void {
    setLocalFriends((prev) => prev.filter((f) => f.id !== id));
    setSelected(undefined);
    setView("LIST");
    showToast("已拉黑");
  }

  // PROFILE-QR-003: 从剪贴板识别二维码内容。
  //
  // 旧实现是假识别：点一下就把写死的演示号 PX-937201 填进搜索框，假装扫到了人。
  // 现在走真解析，并且三种失败说三句不同的话 —— 读不到剪贴板 / 剪贴板是空的 /
  // 不是 Proxy 名片，绝不合并成一句含糊的「识别失败」：
  //   · 不是 Proxy 名片的内容一律 fail-closed（扫什么码都给反应等于帮钓鱼码做跳转）；
  //   · 解析不出结果时返回 null，UI 必须说人话，不许静默吞掉。
  async function scanFromClipboard(): Promise<void> {
    setScanned(undefined);
    setScanError("");
    let text = "";
    try {
      text = await Clipboard.getStringAsync();
    } catch {
      setScanned(null);
      setScanError("读取剪贴板失败 —— 请重新复制对方的二维码内容后重试。");
      return;
    }
    if (!text.trim()) {
      setScanned(null);
      setScanError("剪贴板里没有内容 —— 先复制对方分享的 Proxy 名片文本（vCard）。");
      return;
    }
    await handleScannedCode(text);
  }

  // PROFILE-QR-007：从相册选一张图识别。走 expo-camera 的标准入口
  // `scanFromURLAsync`，不自己写解码 —— 相机扫码、相册选图、剪贴板三条路
  // 最后都落到同一个 handleScannedCode。
  async function scanFromLibrary(): Promise<void> {
    setScanned(undefined);
    setScanError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setScanned(null);
      setScanError("需要相册权限才能从相册选图识别 —— 请在系统设置里允许 Proxy 访问照片。");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, selectionLimit: 1 });
    if (picked.canceled) return; // 用户自己取消，不是失败，不报错。
    const uri = picked.assets[0]?.uri;
    if (!uri) {
      setScanned(null);
      setScanError("这张图读不出来，换一张试试。");
      return;
    }
    let found: string[] = [];
    try {
      const results = await scanFromURLAsync(uri, ["qr"]);
      found = results.map((r) => r.data).filter((d): d is string => typeof d === "string" && d.length > 0);
    } catch (error) {
      setScanned(null);
      setScanError(`识别这张图失败：${describeError(error)}`);
      return;
    }
    if (found.length === 0) {
      // 「图里没有二维码」和「二维码不是 Proxy 的」是两件事，分开说。
      setScanned(null);
      setScanError("这张图里没有找到二维码 —— 换一张裁掉多余背景的图再试。");
      return;
    }
    await handleScannedCode(found[0]!);
  }

  // PROFILE-QR-003：相机 / 相册 / 剪贴板共用同一解析/落人状态机。
  // 相机每帧可能触发多次，扫码成功一次后锁住，避免重复查人。
  async function handleScannedCode(raw: string): Promise<void> {
    if (scanBusyRef.current || scanned) return;
    // scanBusyRef 必须真的置 true，否则这把锁是死的：相机每帧都回调
    // onBarcodeScanned，而 `scanned` 是 state、要等一次渲染才生效 ——
    // 同一 tick 里的后续帧全部能穿过这个判断，同一个人被查 N 次。
    scanBusyRef.current = true;
    try {
      setScanned(undefined);
      setScanError("");
      const parsed = parseScannedQr(raw);
      if (!parsed) {
        setScanned(null);
        setScanError("这不是 Proxy 名片。只识别 Proxy 生成的 vCard 名片（相机/相册/剪贴板都行），其他内容不会被跳转。");
        return;
      }
      setScanned(parsed);
      await lookupScannedPerson(parsed);
    } finally {
      // 失败 / 不是二维码也要解锁，否则扫错一次就永久卡住扫不动了。
      scanBusyRef.current = false;
    }
  }

  // HANDLE-LOOKUP-001: 把识别出的 handle 落到真人（服务端按 handle 唯一解析）。
  //
  // PROFILE-QR-007：店铺名片里没有 handle，只有店铺 id —— 这个流程是「加好友」，
  // 所以店铺名片必须**单独说一句**（"这是店铺名片"），不能悄悄当成「查无此人」。
  // 三种结局三个屏，是这一屏从第一天起的规矩。
  async function lookupScannedPerson(parsed: ScannedQr): Promise<void> {
    setScanMatch(undefined);
    setScanLookup(undefined);
    setScanAddSent(false);
    setScanAddBusy(false);
    if (parsed.kind === "store") {
      setScanLookup("store");
      return;
    }
    if (!profileClient) {
      setScanLookup("no-client");
      return;
    }
    setScanBusy(true);
    try {
      const person = await profileClient.getProfileByHandle(parsed.handle);
      setScanMatch(person);
      setScanLookup("found");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // 服务端把「没这个人」（PROFILE_NOT_FOUND）和「查询失败」分得很清楚，
      // 这里必须原样分开，不能合并成一句「查询失败」。
      setScanLookup(message.includes("profile_not_found") ? "missing" : "failed");
    } finally {
      setScanBusy(false);
    }
  }

  // 扫到人之后走真实的好友请求，不假装「已添加」。
  // ADD-FRIEND-SEND-BUSY-001: 三个无响应缺口一起补 —— 在途锁住防重发、
  // 按钮给“发送中…”忙态、没登录态直说不静默。失败走 finally 解锁，
  // 成功由 scanAddSent 接管禁用，锁不会卡死。
  async function addScannedPerson(): Promise<void> {
    if (!scanMatch) return;
    if (!relationship) {
      showToast("登录后才能发送好友请求。");
      return;
    }
    if (scanAddBusy || scanAddSent) return;
    setScanAddBusy(true);
    try {
      await relationship.sendFriendRequest(scanMatch.userAccountId);
      setScanAddSent(true);
      void reload();
    } catch (error) {
      showToast(requestErrorMessage(error, "好友请求没有发送成功，请稍后重试。"));
    } finally {
      setScanAddBusy(false);
    }
  }

  // PROFILE-SEARCH-001: 全站搜索。以前的「搜索」只是把写死的两行演示结果
  // 显示出来 —— 搜什么都是同两个人，输入框纯装饰。（那两行已删除；常量名不
  // 在这里写出来，门禁会 grep 这个文件找它。）
  //
  // 最少 2 个字符，按**码点**数（不是 UTF-16 长度，也不是字节）：一个汉字
  // 是 1 个码点、3 个字节，用字节数会把单字查询放过去，然后返回大半张用户表。
  // 服务端同样按 rune 拒绝，这里先拦一道只是为了不白跑一次网络。
  async function runProxySearch(): Promise<void> {
    const query = proxySearch.trim();
    if ([...query].length < 2) {
      setSearchResults([]);
      setSearchState("too-short");
      return;
    }
    if (!profileClient) {
      setSearchResults([]);
      setSearchState("no-client");
      return;
    }
    setSearchState("busy");
    try {
      const found = await profileClient.searchProfiles(query);
      setSearchResults(found);
      // 空数组是**答案**，不是错误。这里绝不能把 length === 0 当异常。
      setSearchState(found.length ? "found" : "empty");
    } catch {
      setSearchResults([]);
      setSearchState("failed");
    }
  }

  // 搜到自己时不给「添加」按钮 —— 服务端会用 FRIEND_SELF_FORBIDDEN 拒绝，
  // 留一个必然失败的按钮只会让用户以为是自己点错了。
  function isSelfProfile(person: ProfileWire): boolean {
    if (!viewer?.handle) return false;
    const norm = (h: string): string => h.trim().replace(/^@+/, "").toLowerCase();
    return norm(viewer.handle) === norm(person.handle);
  }

  async function addSearchResult(person: ProfileWire): Promise<void> {
    if (!relationship) {
      showToast("登录后才能发送好友请求。");
      return;
    }
    try {
      await relationship.sendFriendRequest(person.userAccountId);
      setSearchAdded((m) => ({ ...m, [person.userAccountId]: true }));
      void reload();
    } catch (error) {
      showToast(requestErrorMessage(error, "好友请求没有发送成功，请稍后重试。"));
    }
  }

  function openDetail(friend: CrmFriend): void {
    setSelected(friend);
    setView("DETAIL");
  }

  // LIST => 轻 CRM 列表（不是消息列表）
  if (view === "DETAIL" && selected) {
    return (
      <FriendDetail
        friend={selected}
        relationship={relationship}
        onBack={() => { setSelected(undefined); setView("LIST"); void reload(); }}
        onOpenConversation={onOpenConversation}
        onOpenVouchers={onOpenVouchers}
        onRemoveDemo={removeDemoFriend}
        showToast={showToast}
        toast={toast}
      />
    );
  }

  if (view === "ADD_FRIEND") {
    // ADD-FRIEND-FROM-MESSAGES-001: 直接以 ADD_FRIEND 挂载时，返回就是离开本
    // 表面 —— 去哪由调用方决定，标签也必须由调用方给。以前这里从 initialView
    // 猜一个目的地文案，而 Me 入口的 onBack 其实是回「我的」，标签在撒谎。
    // 同一个 directEntry 同时驱动行为和标签，两者不可能再对不上。
    const directEntry = initialView === "ADD_FRIEND";
    const handleBack = (): void => {
      if (directEntry) onBack();
      else setView("LIST");
    };
    const backText = directEntry ? (addFriendBackLabel ?? "‹ 返回") : "‹ 返回好友";
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Pressable onPress={handleBack} style={styles.backRow}><Text style={styles.backText}>{backText}</Text></Pressable>
        <Text style={styles.title}>添加好友</Text>
        <Text style={styles.sub}>通过二维码、邀请、通讯录、社媒或 Proxy 搜索找到你认识的人。</Text>

        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>选择添加方式</Text><Text style={styles.sectionNote}>5 种方式</Text></View>
        <View style={styles.methodGrid}>
          <Pressable onPress={() => setSheet("SCAN")} style={styles.method}><View style={styles.methodIcon}><ProxyIcon color={color.proxyPurple} name="qrGrid" size={20} /></View><Text style={styles.methodStrong}>扫码添加</Text><Text style={styles.methodSpan}>扫描对方的 Proxy Personal QR</Text></Pressable>
          <Pressable onPress={() => setSheet("INVITE")} style={styles.method}><View style={styles.methodIcon}><ProxyIcon color={color.proxyPurple} name="arrowUpRight" size={20} /></View><Text style={styles.methodStrong}>邀请好友</Text><Text style={styles.methodSpan}>发送链接或你的个人二维码</Text></Pressable>
          <Pressable onPress={() => setSheet("CONTACTS")} style={styles.method}><View style={styles.methodIcon}><ProxyIcon color={color.proxyPurple} name="user" size={20} /></View><Text style={styles.methodStrong}>通讯录</Text><Text style={styles.methodSpan}>授权后只匹配可能认识的人</Text></Pressable>
          <Pressable onPress={() => setSheet("SOCIAL")} style={styles.method}><View style={styles.methodIcon}><ProxyIcon color={color.proxyPurple} name="spark" size={20} /></View><Text style={styles.methodStrong}>社媒好友</Text><Text style={styles.methodSpan}>TikTok / Instagram / Facebook / Zalo</Text></Pressable>
          {/* ADD-FRIEND-PHONE-COPY-001: 这一行原本把手机号也列成可搜项，但它打开的
              SEARCH sheet 自己写着「手机号暂不可搜 —— 还没有『允许被手机号搜到』这个
              授权开关」。同一屏自相矛盾：方式列表说能搜手机号，点进去说搜不了。
              手机号搜索落地（授权开关 + 后端）之前，这一行只报昵称与 Proxy ID，
              与 sheet 和输入框 placeholder 保持一致。 */}
          <Pressable onPress={() => setSheet("SEARCH")} style={styles.methodFull}><View style={styles.methodIcon}><ProxyIcon color={color.proxyPurple} name="search" size={20} /></View><View style={styles.methodFullCopy}><Text style={styles.methodStrong}>搜索 Proxy</Text><Text style={styles.methodSpan}>昵称或 Proxy ID</Text></View><Text style={styles.chev}>›</Text></Pressable>
        </View>

        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>好友请求</Text><Text style={styles.sectionNote}>需要你确认</Text></View>
        <Pressable onPress={() => setSheet("REQUESTS")} style={styles.pendingCard}><View style={styles.pendingIcon}><Text style={styles.pendingIconText}>♡</Text></View><View style={styles.pendingMain}><Text style={styles.pendingStrong}>{requests.length} 个待处理请求</Text><Text style={styles.pendingSub}>查看谁想添加你为好友</Text></View><View style={styles.badge}><Text style={styles.badgeText}>{requests.length}</Text></View></Pressable>

        <View style={styles.privacy}><View style={styles.privacyIcon}><Text style={styles.privacyIconText}>i</Text></View><View style={styles.privacyCopy}><Text style={styles.privacyStrong}>关系不会自动导入</Text><Text style={styles.privacyP}>通讯录或外部社媒只用于发现“可能认识”的人。成为 Proxy 好友前，仍需要发送好友请求并由对方确认。</Text></View></View>

        {/* Sheets */}
        <CrmSheet open={sheet === "SCAN"} onClose={() => { setSheet(undefined); setScanned(undefined); setScanError(""); scanBusyRef.current = false; }} title="扫码添加好友" sub="对准对方的 Proxy 个人二维码，或从相册选图、从剪贴板识别名片文本，识别成功后再去添加。">
          {cameraPermission?.granted ? (
            <View style={styles.cameraWrap}>
              <CameraView
                style={styles.cameraView}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={(result) => { void handleScannedCode(result.data); }}
              />
              <View style={styles.scanFrame} />
              <Text style={styles.scannerNote}>对准二维码即可识别</Text>
            </View>
          ) : (
            <View style={styles.scanner}>
              <View style={styles.scanFrame} />
              <Text style={styles.scannerNote}>{cameraPermission ? "需要相机权限才能扫码" : "相机权限未决定"}</Text>
              {!cameraPermission?.granted ? (
                <Pressable onPress={() => void requestCameraPermission()} style={[styles.btn, styles.btnPrimary]}><Text style={styles.btnPrimaryText}>允许使用相机</Text></Pressable>
              ) : null}
            </View>
          )}
          {/* 相册和剪贴板都是「没相机 / 相机不好使」时的正路，不能只当兜底。 */}
          <View style={styles.actions}>
            <Pressable onPress={() => void scanFromLibrary()} style={[styles.btn, styles.btnPrimary]} accessibilityLabel="从相册选取图片识别"><Text style={styles.btnPrimaryText}>从相册选取</Text></Pressable>
            <Pressable onPress={() => void scanFromClipboard()} style={[styles.btn, styles.btnGhost]} accessibilityLabel="从剪贴板识别"><Text style={styles.btnGhostText}>从剪贴板识别</Text></Pressable>
          </View>
          {scanned ? (
            <View style={styles.scanHit}>
              <Text style={styles.scanHitTitle}>已识别{scanned.kind === "store" ? "店铺名片" : "个人名片"}{scanned.name ? ` · ${scanned.name}` : ""}</Text>
              <Text style={styles.scanHitSub}>{scannedCaption(scanned)}</Text>
              {scanBusy ? <Text style={styles.scanHitNote}>正在查找这个人…</Text> : null}
              {scanLookup === "found" && scanMatch ? (
                <View style={styles.scanPerson}>
                  <View style={styles.avatarSmall}><Text style={styles.avatarSmallText}>{(scanMatch.name || "?").slice(0, 1)}</Text></View>
                  <View style={styles.personCopy}><Text style={styles.personName}>{scanMatch.name}</Text><Text style={styles.personSub}>@{scanMatch.handle}{scanMatch.city ? ` · ${scanMatch.city}` : ""}</Text></View>
                  <Pressable disabled={scanAddSent || scanAddBusy || !relationship} onPress={() => void addScannedPerson()} style={[styles.addBtn, (scanAddSent || scanAddBusy) && styles.addBtnSent]}><Text style={[styles.addBtnText, (scanAddSent || scanAddBusy) && styles.addBtnTextSent]}>{scanAddSent ? "已发送" : scanAddBusy ? "发送中…" : "添加"}</Text></Pressable>
                </View>
              ) : null}
              {/* ADD-FRIEND-NEXT-001: “已发送”不是终点。对方通过后出现在好友列表走
                  LIST 已有的 onOpenConversation，这里只给下一步指路 + 内跳 REQUESTS，
                  不新增 prop、不碰邀请/解析/相机段。 */}
              {scanLookup === "found" && scanAddSent ? (
                <View>
                  <Text style={styles.scanHitNote}>对方通过后会出现在好友列表，可直接开聊</Text>
                  <Pressable onPress={() => setSheet("REQUESTS")} style={[styles.btn, styles.btnGhost, { marginTop: 8 }]} accessibilityLabel="看看我发出的请求"><Text style={styles.btnGhostText}>看看我发出的请求</Text></Pressable>
                </View>
              ) : null}
              {scanLookup === "found" && !relationship ? <Text style={styles.scanHitNote}>登录后才能发送好友请求。</Text> : null}
              {scanLookup === "missing" ? <Text style={styles.scanError}>这张名片指向的人不存在 —— 可能已注销，或者名片被改过。</Text> : null}
              {scanLookup === "failed" ? <Text style={styles.scanError}>查询失败，请稍后重试。</Text> : null}
              {scanLookup === "no-client" ? <Text style={styles.scanHitNote}>识别到了 @{scanned.kind === "person" ? scanned.handle : ""}，但当前没有登录态，查不到这个人。</Text> : null}
              {/* 不能指路到扫码人自己的商家页：他**不是**这家店的老板，指过去等于指错人。
                  App 里现在也没有给顾客看的店铺页（只有商家自己那个「线上店铺」管理面），
                  所以这里只说清楚「这不是个人名片」。
                  （这个注释刻意不写出那条指路原文 —— 测试对这条文案有反向钉，
                  写在注释里会让钉在正确的树上误报。） */}
              {scanLookup === "store" ? <Text style={styles.scanHitNote}>这是「{scanned.name}」的店铺名片，不是个人名片 —— 加好友要扫对方个人的二维码。App 目前不支持用店铺名片加好友。</Text> : null}
            </View>
          ) : null}
          {scanned === null && scanError ? <Text style={styles.scanError}>{scanError}</Text> : null}
        </CrmSheet>

        <CrmSheet open={sheet === "INVITE"} onClose={() => { setSheet(undefined); setInviteCopied(false); }} title="邀请好友" sub="把你的名片发给对方。扫到就能存进通讯录；在 App 里搜你的 @handle 也能找到你。">
          {viewer && inviteCard ? (
            <>
              <View style={styles.qrName}><Text style={styles.qrNameStrong}>{viewer.name}</Text><Text style={styles.qrNameSub}>Proxy ID · {inviteCaption}</Text></View>
              <View ref={inviteShotRef} collapsable={false} style={styles.inviteQrWrap}>
                <Pressable accessibilityLabel="放大邀请二维码" accessibilityRole="button" onPress={() => { setInviteQrNotice(undefined); setInviteZoomOpen(true); }}>
                  <ProxyQrCode size={168} value={inviteCard} />
                </Pressable>
              </View>
              <View style={styles.inviteLink}><Text selectable style={styles.inviteLinkText}>{inviteCaption}</Text></View>
              <View style={styles.actions}>
                <Pressable onPress={() => void copyInviteText(inviteCaption)} style={[styles.btn, styles.btnGhost]} accessibilityLabel="复制 Proxy ID"><Text style={styles.btnGhostText}>复制 @handle</Text></Pressable>
                <Pressable onPress={() => void saveInviteQrFromSheet()} style={[styles.btn, styles.btnGhost]} accessibilityLabel="保存邀请二维码到相册"><Text style={styles.btnGhostText}>保存到相册</Text></Pressable>
                <Pressable onPress={() => void Share.share({ message: `加我 Proxy：在 App 里搜 ${inviteCaption}，或者扫我的名片二维码。` })} style={[styles.btn, styles.btnPrimary]} accessibilityLabel="系统分享邀请"><Text style={styles.btnPrimaryText}>系统分享</Text></Pressable>
              </View>
              {inviteCopied ? <Text style={styles.inviteCopiedNote}>已复制 {inviteCaption} —— 让对方在 Proxy 里搜它就能找到你。</Text> : null}
            </>
          ) : (
            <View style={styles.qrName}><Text style={styles.qrNameSub}>{viewer ? "先设置你的 Proxy ID，才能生成邀请名片。" : "登录后显示你的邀请名片"}</Text></View>
          )}
        </CrmSheet>

        <QrZoomOverlay
          actions={
            inviteCard
              ? [
                  { label: "复制 @handle", onPress: () => void copyInviteText(inviteCaption) },
                  { label: "保存到相册", onPress: () => void saveInviteQrFromZoom(), primary: true },
                ]
              : []
          }
          caption={inviteCaption}
          hint="把屏幕朝向对方即可扫描；扫出来是一张标准 vCard 名片，存进通讯录即可。"
          notice={inviteQrNotice}
          onClose={() => setInviteZoomOpen(false)}
          shotRef={inviteZoomShotRef}
          title={viewer ? `${viewer.name} 的邀请二维码` : "邀请二维码"}
          value={inviteCard ?? ""}
          visible={inviteZoomOpen}
        />

        <CrmSheet open={sheet === "CONTACTS"} onClose={() => setSheet(undefined)} title="通讯录匹配" sub="Proxy 不会自动添加你的通讯录联系人。下面是本机演示匹配，添加后按钮变已发送，仅本机流转。">
          {!contactsAllowed ? (
            <View style={styles.permission}><View style={styles.permissionIcon}><ProxyIcon color={color.proxyPurple} name="user" size={24} /></View><Text style={styles.permissionStrong}>允许访问通讯录</Text><Text style={styles.permissionP}>只用于匹配可能认识的人，不会将你的完整通讯录公开给其他用户。</Text><Pressable onPress={() => setContactsAllowed(true)} style={[styles.btn, styles.btnPrimary, { marginTop: 12 }]}><Text style={styles.btnPrimaryText}>允许并查找</Text></Pressable></View>
          ) : (
            <View>
              <View style={styles.sectionHead}><Text style={styles.sectionTitle}>可能认识的人</Text><Text style={styles.sectionNote}>{CONTACT_MATCHES.length} 人 · 本机演示</Text></View>
              {CONTACT_MATCHES.map((p) => (
                <View key={p.name} style={styles.personRow}><View style={styles.avatarSmall}><Text style={styles.avatarSmallText}>{p.initial}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{p.name}</Text><Text style={styles.personSub}>{p.sub}</Text></View><Pressable disabled={Boolean(sentIds[p.name])} onPress={() => setSentIds((m) => ({ ...m, [p.name]: true }))} style={[styles.addBtn, sentIds[p.name] && styles.addBtnSent]} accessibilityLabel={sentIds[p.name] ? `已发送给${p.name}` : `添加${p.name}`}><Text style={[styles.addBtnText, sentIds[p.name] && styles.addBtnTextSent]}>{sentIds[p.name] ? "已发送" : "添加"}</Text></Pressable></View>
              ))}
            </View>
          )}
        </CrmSheet>

        <CrmSheet open={sheet === "SOCIAL"} onClose={() => setSheet(undefined)} title="从社媒发现好友" sub="下面是本机演示匹配，添加后按钮变已发送，仅本机流转，不会自动导入社交关系。">
          <View style={[styles.sectionHead, { marginTop: 4 }]}><Text style={styles.sectionTitle}>Instagram 匹配</Text><Text style={styles.sectionNote}>{SOCIAL_MATCHES.length} 人 · 本机演示</Text></View>
          {SOCIAL_MATCHES.map((p) => (
            <View key={p.name} style={styles.personRow}><View style={styles.avatarSmall}><Text style={styles.avatarSmallText}>{p.initial}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{p.name}</Text><Text style={styles.personSub}>{p.sub}</Text></View><Pressable disabled={Boolean(sentIds[p.name])} onPress={() => setSentIds((m) => ({ ...m, [p.name]: true }))} style={[styles.addBtn, sentIds[p.name] && styles.addBtnSent]} accessibilityLabel={sentIds[p.name] ? `已发送给${p.name}` : `添加${p.name}`}><Text style={[styles.addBtnText, sentIds[p.name] && styles.addBtnTextSent]}>{sentIds[p.name] ? "已发送" : "添加"}</Text></Pressable></View>
          ))}
        </CrmSheet>

        <CrmSheet open={sheet === "SEARCH"} onClose={() => { setSheet(undefined); setSearchState("idle"); setSearchResults([]); }} title="搜索 Proxy" sub="按昵称或 Proxy ID 搜索全站用户，至少 2 个字符。手机号暂不可搜 —— 还没有「允许被手机号搜到」这个授权开关，先不假装能搜。">
          <View style={styles.searchLine}><TextInput value={proxySearch} onChangeText={setProxySearch} onSubmitEditing={() => void runProxySearch()} returnKeyType="search" placeholder="昵称 / Proxy ID" placeholderTextColor={color.muted} style={styles.searchInput} /><Pressable onPress={() => void runProxySearch()} style={styles.searchBtn}><Text style={styles.searchBtnText}>搜索</Text></Pressable></View>
          {searchState === "idle" ? <View style={styles.resultEmpty}><Text style={styles.resultEmptyText}>输入昵称或 Proxy ID 开始搜索</Text></View> : null}
          {searchState === "too-short" ? <Text style={styles.scanError}>至少输入 2 个字符 —— 一个字会匹配到太多人。</Text> : null}
          {searchState === "no-client" ? <Text style={styles.scanHitNote}>当前没有登录态，无法搜索全站用户。</Text> : null}
          {searchState === "busy" ? <View style={styles.resultEmpty}><Text style={styles.resultEmptyText}>搜索中…</Text></View> : null}
          {searchState === "failed" ? <Text style={styles.scanError}>搜索失败，请稍后重试。</Text> : null}
          {searchState === "empty" ? <View style={styles.resultEmpty}><Text style={styles.resultEmptyText}>没有找到匹配的人。换个昵称或 Proxy ID 试试。</Text></View> : null}
          {searchState === "found" ? <View>{searchResults.map((p) => {
            const self = isSelfProfile(p);
            const added = Boolean(searchAdded[p.userAccountId]);
            const label = p.name || p.handle;
            return (
              <View key={p.userAccountId} style={styles.personRow}><View style={styles.avatarSmall}><Text style={styles.avatarSmallText}>{label.slice(0, 1)}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{label}</Text><Text style={styles.personSub}>@{p.handle}{p.city ? ` · ${p.city}` : ""}</Text></View>{self ? <Text style={styles.scanHitNote}>这是你</Text> : <Pressable disabled={added || !relationship} onPress={() => void addSearchResult(p)} style={[styles.addBtn, added && styles.addBtnSent]} accessibilityLabel={added ? `已发送给${label}` : `添加${label}`}><Text style={[styles.addBtnText, added && styles.addBtnTextSent]}>{added ? "已发送" : "添加"}</Text></Pressable>}</View>
            );
          })}</View> : null}
        </CrmSheet>

        <CrmSheet open={sheet === "REQUESTS"} onClose={() => setSheet(undefined)} title="好友请求" sub="只有你接受后，双方才会成为 Proxy 好友。demo: 开头的是本机演示请求，接受/忽略立即生效。">
          {requests.map((r) => {
            const demo = r.userId.startsWith("demo:");
            const actionable = demo || Boolean(relationship);
            return (
              <View key={`${r.userId ?? r.name}`} style={styles.requestRow}><View style={styles.avatarSmall}><Text style={styles.avatarSmallText}>{r.initial}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{r.name}</Text><Text style={styles.personSub}>{r.source} · {r.time}</Text><View style={styles.requestActions}><Pressable disabled={!actionable} onPress={async () => { if (!actionable) return; if (demo) { acceptDemoRequest(r.userId); return; } if (!relationship) return; try { await relationship.acceptFriendRequest(r.userId); showToast("已成为好友"); void reload(); } catch (error) { showToast(requestErrorMessage(error, "接受失败，请稍后重试。")); } }} style={[styles.btn, styles.btnPrimary, { flex: 1 }]}><Text style={styles.btnPrimaryText}>接受</Text></Pressable><Pressable disabled={!actionable} onPress={async () => { if (!actionable) return; if (demo) { ignoreDemoRequest(r.userId); return; } if (!relationship) return; try { await relationship.ignoreFriendRequest(r.userId); showToast("已忽略请求"); void reload(); } catch (error) { showToast(requestErrorMessage(error, "忽略失败，请稍后重试。")); } }} style={[styles.btn, { flex: 1 }]}><Text style={styles.btnText}>忽略</Text></Pressable></View></View></View>
            );
          })}
          {!requests.length ? <Text style={styles.resultEmptyText}>暂无待处理请求</Text> : null}
          {/* ADD-FRIEND-NEXT-001: “我发出的”分组只展示等待态，不加动作按钮
              （服务端无撤回命令，不编）。空态独立一句，不与上混用。 */}
          <View style={styles.sectionHead}><Text style={styles.sectionTitle}>我发出的</Text><Text style={styles.sectionNote}>{outgoingRequests.length} 个等待中</Text></View>
          {outgoingRequests.map((o) => (
            <View key={o.userId} style={styles.personRow}><View style={styles.avatarSmall}><Text style={styles.avatarSmallText}>{o.initial}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{o.name}</Text><Text style={styles.personSub}>{o.sub}</Text></View><Text style={styles.scanHitNote}>等待对方通过</Text></View>
          ))}
          {!outgoingRequests.length ? <Text style={styles.resultEmptyText}>你还没发出过请求</Text> : null}
        </CrmSheet>

        {toast ? <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}
      </ScrollView>
    );
  }

  // 默认 LIST 视图：轻 CRM 关系图 — 参考原型“好友关系 关系状态、互动与下一步动作”
  // 服务端好友拉到后，列表/计数走服务端真相，不再只展示演示数据。
  const serverMode = projectedServerFriends.length > 0;
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.backRow}><Text style={styles.backText}>‹ 返回我的</Text></Pressable>
      <Text style={styles.title}>好友关系</Text>
      <Text style={styles.sub}>关系状态、互动与下一步动作</Text>
      {/*
        ADD-FRIEND-ENTRY-001: until now nothing in the app could reach the
        ADD_FRIEND view. `me.tsx` renders it for subPage.route === "addfriend",
        but no code ever sets that route; and inside this file nothing ever
        called setView("ADD_FRIEND"). The whole ADD_FRIEND surface — SCAN,
        INVITE, CONTACTS, SOCIAL, SEARCH, REQUESTS — was unreachable, including
        the clipboard scan that resolves a scanned @handle.

        The give-away was the back handler below: it branches on
        `initialView === "ADD_FRIEND"` and otherwise does setView("LIST"), i.e.
        it was written for a LIST → ADD_FRIEND push that was never wired.
      */}
      <View style={styles.actions}>
        <Pressable onPress={() => setView("ADD_FRIEND")} style={[styles.btn, styles.btnPrimary]} accessibilityLabel="添加好友"><Text style={styles.btnPrimaryText}>添加好友</Text></Pressable>
      </View>
      {friendsError ? <Text style={styles.loadError}>好友列表加载失败（{friendsError}），当前显示本地数据。</Text> : null}

      <View style={styles.metricGrid}>
        <View style={styles.metricCard}><Text style={styles.metricValue}>{serverMode ? visible.length + advFriends.length : advFriends.length}</Text><Text style={styles.metricLabel}>好友关系</Text></View>
        <View style={[styles.metricCard, styles.metricCardActive]}><Text style={styles.metricValue}>{advFriends.filter((f) => f.crmStatus === "WARM").length}</Text><Text style={styles.metricLabel}>暖关系</Text></View>
        <View style={styles.metricCard}><Text style={styles.metricValue}>{advFriends.filter((f) => f.crmStatus === "FOLLOW").length}</Text><Text style={styles.metricLabel}>待跟进</Text></View>
        <View style={styles.metricCard}><Text style={styles.metricValue}>{advFriends.filter((f) => f.crmStatus === "MET").length}</Text><Text style={styles.metricLabel}>已见面</Text></View>
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
      </View>

      <View style={styles.recommendCard}>
        <View style={styles.recommendHead}><Text style={styles.recommendTitle}>推荐动作</Text><Text style={styles.recommendSub}>今天最值得先处理的关系</Text></View>
        <View style={styles.recommendPriority}><View style={styles.priorityDot} /><Text style={styles.priorityText}>高优先级 · {advFriends[0]?.name ?? "Mai"} · 发咖啡券</Text></View>
        <Text style={styles.recommendDesc}>最近已回复，且过去7天有持续互动，适合低成本转线下。</Text>
        <View style={styles.recommendActions}><Pressable onPress={() => { const first = advFriends[0]; if (first) openDetail(first); }} style={styles.recommendBtn} accessibilityLabel="查看推荐对象详情"><Text style={styles.recommendBtnText}>查看</Text></Pressable><Pressable onPress={sendVoucher} style={[styles.recommendBtn, styles.recommendBtnPrimary]} accessibilityLabel="发礼券"><Text style={styles.recommendBtnPrimaryText}>发礼券</Text></Pressable><Pressable onPress={() => onOpenConversation(advFriends[0]?.name ?? "Mai")} style={styles.recommendBtn}><Text style={styles.recommendBtnText}>发消息</Text></Pressable></View>
        <View style={styles.contextBuilder}><Text style={styles.contextTitle}>语境构建建议</Text><Text style={styles.contextSub}>用户可选，不自动替用户发送</Text><Text style={styles.contextTag}>可选 · 建议风格：自然、轻松、先场景后邀约</Text><Text style={styles.contextDesc}>从咖啡或摄影共同兴趣切入，再自然推进礼券或活动邀请。</Text><View style={styles.contextChips}><View style={styles.contextChipActive}><Text style={styles.contextChipActiveText}>轻松</Text></View><View style={styles.contextChip}><Text style={styles.contextChipText}>朋友式</Text></View><View style={styles.contextChip}><Text style={styles.contextChipText}>直接</Text></View><View style={styles.contextChip}><Text style={styles.contextChipText}>商务</Text></View></View></View>
      </View>

      <View style={styles.assistantCard}>
        <Text style={styles.assistantTitle}>智能关系助手</Text>
        <Text style={styles.assistantSub}>自动整理 Proxy 内部关系事件；消息内容理解独立授权</Text>
        <View style={styles.assistantRow}><View><Text style={styles.assistantLabel}>内部互动事件整理</Text><Text style={styles.assistantDesc}>基于 Proxy 内部事件</Text></View><View style={styles.toggleOn}><Text style={styles.toggleOnText}>开启</Text></View></View>
        <View style={styles.assistantRow}><View><Text style={styles.assistantLabel}>消息内容理解</Text><Text style={styles.assistantDesc}>需独立授权</Text></View><View style={styles.toggleOff}><Text style={styles.toggleOffText}>关闭</Text></View></View>
        <View style={styles.assistantRow}><View><Text style={styles.assistantLabel}>主动分享的社媒账号自动保存</Text><Text style={styles.assistantDesc}>确认后保存</Text></View><Pressable onPress={() => setAutoSaveSocial((v) => !v)} style={autoSaveSocial ? styles.toggleOn : styles.toggleOff} accessibilityLabel={`社媒账号自动保存${autoSaveSocial ? "开" : "关"}`}><Text style={autoSaveSocial ? styles.toggleOnText : styles.toggleOffText}>{autoSaveSocial ? "开启" : "关闭"}</Text></Pressable></View>
        <Text style={styles.assistantFoot}>数据来源仅限 Proxy 内部事件、用户授权绑定、双方主动分享的信息。</Text>
      </View>

      <View style={styles.searchRow}><TextInput value={search} onChangeText={setSearch} placeholder="搜索好友、备注、互动…" placeholderTextColor={color.muted} style={styles.searchInputFull} /><View style={styles.searchBtnIcon}><ProxyIcon color={color.white} name="search" size={18} /></View></View>

      <View style={styles.filterTabs}>
        <Pressable onPress={() => setCrmTab("ALL")} style={[styles.filterTab, crmTab === "ALL" && styles.filterTabActive]}><Text style={[styles.filterTabText, crmTab === "ALL" && styles.filterTabTextActive]}>全部</Text></Pressable>
        <Pressable onPress={() => setCrmTab("WARM")} style={[styles.filterTab, crmTab === "WARM" && styles.filterTabActive]}><Text style={[styles.filterTabText, crmTab === "WARM" && styles.filterTabTextActive]}>暖关系</Text></Pressable>
        <Pressable onPress={() => setCrmTab("FOLLOW")} style={[styles.filterTab, crmTab === "FOLLOW" && styles.filterTabActive]}><Text style={[styles.filterTabText, crmTab === "FOLLOW" && styles.filterTabTextActive]}>待跟进</Text></Pressable>
        <Pressable onPress={() => setCrmTab("MET")} style={[styles.filterTab, crmTab === "MET" && styles.filterTabActive]}><Text style={[styles.filterTabText, crmTab === "MET" && styles.filterTabTextActive]}>已见面</Text></Pressable>
      </View>

      {serverMode ? (
      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>服务端好友</Text><Text style={styles.sectionNote}>{visible.length} 人 · 服务端真相</Text></View>
        {visible.map((friend, idx) => (
          <View key={friend.id} style={[styles.friendRow, idx > 0 && styles.friendRowLine]}>
            <Pressable onPress={() => openDetail(friend)} style={styles.friendMain}><View style={styles.avatar}><Text style={styles.avatarText}>{friend.initial}</Text></View><View style={styles.friendCopy}><Text style={styles.friendName}>{friend.name}</Text><Text style={styles.friendContext}>{friend.relation}</Text></View></Pressable>
            <Pressable onPress={() => onOpenConversation(friend.name)} style={styles.listActionBtn} accessibilityLabel={`给${friend.name}发消息`}><Text style={styles.listActionBtnText}>发消息</Text></Pressable>
          </View>
        ))}
        {!visible.length ? <Text style={styles.emptyResult}>没有匹配的好友</Text> : null}
      </View>
      ) : null}

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>本地好友</Text><Text style={styles.sectionNote}>{visibleAdv.length} 人 · 本机演示，可全流程操作</Text></View>
        {visibleAdv.map((friend, idx) => (
          <View key={friend.id} style={[styles.friendRow, idx > 0 && styles.friendRowLine]}>
            <Pressable onPress={() => openDetail({ ...friend, relation: friend.actionSub } as CrmFriend)} style={styles.friendMain}><View style={styles.avatar}><Text style={styles.avatarText}>{friend.initial}</Text></View><View style={styles.friendCopy}><Text style={styles.friendName}>{friend.name}</Text><Text style={styles.friendContext}>{friend.note}</Text><View style={styles.tagRow}><View style={styles.tag}><Text style={styles.tagText}>{friend.actionSub}</Text></View></View></View></Pressable>
            <Pressable onPress={() => { if (friend.actionLabel.includes("礼券") || friend.actionLabel.includes("咖啡") || friend.actionLabel.includes("体验")) sendVoucher(); else onOpenConversation(friend.name); }} style={styles.listActionBtn}><Text style={styles.listActionBtnText}>{friend.actionLabel}</Text></Pressable>
          </View>
        ))}
        {!visibleAdv.length ? <Text style={styles.emptyResult}>没有匹配的好友</Text> : null}
      </View>

      <View style={styles.privacy}><View style={styles.privacyIcon}><Text style={styles.privacyIconText}>i</Text></View><View style={styles.privacyCopy}><Text style={styles.privacyStrong}>数据边界</Text><Text style={styles.privacyP}>全部数据来自 Proxy 内部事件与你主动分享的信息，不会自动读取聊天内容或社媒私信。</Text></View></View>

      {toast ? <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}
    </ScrollView>
  );
}

function FriendDetail({ friend, relationship, onBack, onOpenConversation, onOpenVouchers, onRemoveDemo, showToast, toast }: { friend: CrmFriend; relationship?: RelationshipClient | undefined; onBack: () => void; onOpenConversation: (a: string) => void; onOpenVouchers?: (() => void) | undefined; onRemoveDemo: (id: string) => void; showToast: (t: string) => void; toast: string }): React.JSX.Element {
  const [note, setNote] = useState(friend.note);
  const [tags, setTags] = useState<string[]>(friend.tags);
  const [newTag, setNewTag] = useState("");
  const [blocking, setBlocking] = useState(false);
  // 服务端好友走 BlockFriend；本机演示好友（无 userId）走本地移除，
  // 立即从列表消失。两种路径都真实生效，不伪造结果。
  const demo = !friend.userId;
  const blockable = blocking ? false : demo || Boolean(relationship);
  function addTag(): void {
    const t = newTag.trim();
    if (!t || tags.includes(t)) return;
    setTags((prev) => [...prev, t]);
    setNewTag("");
    showToast("标签已添加（仅本机）");
  }
  async function block(): Promise<void> {
    if (blocking) return;
    if (demo) { onRemoveDemo(friend.id); return; }
    if (!friend.userId || !relationship) return;
    setBlocking(true);
    try {
      await relationship.blockFriend(friend.userId);
      showToast("已拉黑");
      onBack();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      showToast(/principal|session|signed|sign in|auth|401|403/i.test(msg) ? "请先登录后再操作。" : "拉黑失败，请稍后重试。");
    } finally {
      setBlocking(false);
    }
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.backRow}><Text style={styles.backText}>‹ 返回好友</Text></Pressable>

      <View style={styles.detailHead}><View style={styles.avatarLarge}><Text style={styles.avatarLargeText}>{friend.initial}</Text></View><View style={styles.detailHeadCopy}><Text style={styles.detailName}>{friend.name}</Text><Text style={styles.detailProxyId}>{friend.proxyId} · {friend.city} · 已验证</Text><View style={styles.tagRow}>{tags.map((t) => <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>)}</View></View></View>

      <View style={styles.actionRow}><Pressable onPress={() => onOpenConversation(friend.name)} style={[styles.actionBtn, styles.actionBtnPrimary]}><Text style={styles.actionBtnPrimaryText}>发消息</Text></Pressable>{onOpenVouchers ? <Pressable onPress={onOpenVouchers} style={styles.actionBtn} accessibilityLabel="发礼券"><Text style={styles.actionBtnText}>发礼券</Text></Pressable> : null}</View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>关系信息</Text><Text style={styles.sectionNote}>轻 CRM</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvLabel}>来源</Text><Text style={styles.kvValue}>{friend.sourceLabel}</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvLabel}>认识时间</Text><Text style={styles.kvValue}>{friend.createdAt}</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvLabel}>共同好友</Text><Text style={styles.kvValue}>{friend.commonFriends} 人</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvLabel}>最近互动</Text><Text style={styles.kvValue}>{friend.lastInteraction}</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvLabel}>关系状态</Text><View style={styles.statusPill}><Text style={styles.statusPillText}>{friend.status === "FRIEND" ? "已是好友" : friend.status}</Text></View></View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>标签</Text><Text style={styles.sectionNote}>用于筛选与回顾 · 仅本机</Text></View>
        <View style={styles.tagRow}>{tags.map((t) => <Pressable key={t} onPress={() => setTags((prev) => prev.filter((x) => x !== t))} style={styles.tagEditable}><Text style={styles.tagText}>{t} ×</Text></Pressable>)}{!tags.length ? <Text style={styles.emptyInline}>暂无标签</Text> : null}</View>
        <View style={styles.tagAddRow}><TextInput value={newTag} onChangeText={setNewTag} placeholder="新增标签，如：摄影" placeholderTextColor={color.muted} style={styles.tagInput} /><Pressable onPress={addTag} style={styles.tagAddBtn}><Text style={styles.tagAddBtnText}>添加</Text></Pressable></View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>备注</Text><Text style={styles.sectionNote}>仅自己可见 · 仅本机</Text></View>
        <TextInput value={note} onChangeText={setNote} placeholder="写下你对这位好友的备注…" placeholderTextColor={color.muted} multiline style={styles.noteInput} />
        <Pressable onPress={() => showToast("备注已保存（仅本机）")} style={[styles.btn, styles.btnPrimary, { marginTop: 10 }]}><Text style={styles.btnPrimaryText}>保存备注</Text></Pressable>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>互动记录</Text><Text style={styles.sectionNote}>最近 3 条</Text></View>
        <View style={styles.timelineRow}><View style={styles.timelineDot} /><View style={styles.timelineCopy}><Text style={styles.timelineTitle}>聊天 · 昨天</Text><Text style={styles.timelineSub}>“好的，到时候联系你。”</Text></View></View>
        <View style={styles.timelineRow}><View style={styles.timelineDot} /><View style={styles.timelineCopy}><Text style={styles.timelineTitle}>活动报名 · 3 天前</Text><Text style={styles.timelineSub}>一起报名了「西湖摄影散步」</Text></View></View>
        <View style={styles.timelineRow}><View style={styles.timelineDot} /><View style={styles.timelineCopy}><Text style={styles.timelineTitle}>添加好友 · {friend.createdAt}</Text><Text style={styles.timelineSub}>{friend.sourceLabel}</Text></View></View>
      </View>

      <View style={styles.dangerRow}><Pressable disabled={!blockable} onPress={() => void block()} style={[styles.dangerBtn, !blockable && styles.dangerBtnDisabled]} accessibilityLabel="拉黑"><Text style={styles.dangerBtnText}>{blocking ? "处理中…" : "拉黑"}</Text></Pressable></View>
      {demo ? <Text style={styles.dangerHint}>本机演示好友：拉黑立即从列表移除，仅本机生效。移除好友暂无服务端指令，不提供假按钮。</Text> : null}

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
  friendMain: { alignItems: "center", flex: 1, flexDirection: "row", gap: 10 },
  avatar: { alignItems: "center", backgroundColor: "#F1E8FF", borderRadius: 12, height: 42, justifyContent: "center", width: 42 },
  avatarText: { color: color.ink, fontSize: 12, fontWeight: "900" },
  friendCopy: { flex: 1 },
  friendName: { color: color.ink, fontSize: 13, fontWeight: "800" },
  friendProxyId: { color: color.muted, fontSize: 11, fontWeight: "700" },
  friendContext: { color: color.muted, fontSize: 11, marginTop: 2 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 5 },
  tag: { backgroundColor: color.proxyPurpleSoft, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  tagText: { color: "color.factInferredFg", fontSize: 11, fontWeight: "800" },
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
  statusPill: { backgroundColor: "color.proxyGreenSoft", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
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
  dangerBtnDisabled: { opacity: 0.45 },
  dangerBtnText: { color: color.error, fontSize: 12, fontWeight: "800" },
  dangerHint: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 8 },
  loadError: { color: color.error, fontSize: 11, lineHeight: 15, marginTop: 6 },
  sheetOverlay: { alignItems: "flex-end", backgroundColor: "rgba(17,13,21,0.38)", flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: color.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: "90%", padding: 16, width: "100%" },
  sheetGrab: { alignSelf: "center", backgroundColor: "color.homeIntentBorder", borderRadius: 999, height: 4, width: 36 },
  sheetHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  sheetTitle: { color: color.ink, fontSize: 15, fontWeight: "900" },
  sheetClose: { color: color.muted, fontSize: 20, paddingHorizontal: 6 },
  sheetSub: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  cameraWrap: { alignItems: "center", backgroundColor: "#0C0A12", borderRadius: 14, overflow: "hidden" },
  cameraView: { height: 320, width: "100%" },
  scanner: { alignItems: "center", backgroundColor: "#111", borderRadius: 18, height: 260, justifyContent: "center", marginTop: 12, overflow: "hidden" },
  scanFrame: { borderColor: "rgba(255,255,255,0.85)", borderRadius: 18, borderWidth: 2, height: 170, width: 170 },
  scannerNote: { bottom: 18, color: "#D6D1D8", fontSize: 11, position: "absolute" },
  scanHit: { backgroundColor: color.violetSoftBg, borderRadius: 14, marginTop: 14, padding: 14 },
  scanHitTitle: { color: color.ink, fontSize: 13, fontWeight: "900" },
  scanHitSub: { color: color.muted, fontSize: 11, marginTop: 4 },
  scanHitNote: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 8 },
  scanPerson: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 12 },
  scanError: { color: color.error, fontSize: 11, lineHeight: 15, marginTop: 14 },
  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  btn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: 10 },
  btnPrimary: { backgroundColor: color.ink, borderColor: color.ink },
  btnText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  btnPrimaryText: { color: color.white, fontSize: 11, fontWeight: "900" },
  btnGhost: { backgroundColor: "color.white" },
  btnGhostText: { color: color.ink, fontSize: 11, fontWeight: "900" },
  qrName: { alignItems: "center", marginTop: 10 },
  qrNameStrong: { color: color.ink, fontSize: 14, fontWeight: "900" },
  qrNameSub: { color: color.muted, fontSize: 11, marginTop: 3 },
  inviteLink: { alignItems: "center", backgroundColor: "#FAFAFA", borderColor: color.line, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, marginTop: 12, padding: 10 },
  inviteLinkText: { color: "#6D6672", flex: 1, fontSize: 11 },
  inviteQrWrap: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginTop: 12, paddingVertical: 16 },
  inviteCopiedNote: { color: "#4C8A5B", fontSize: 11, marginTop: 10, textAlign: "center" },
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
  metricCardActive: { backgroundColor: "color.bottomActiveBg", borderColor: "#FFCFE0" },
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
