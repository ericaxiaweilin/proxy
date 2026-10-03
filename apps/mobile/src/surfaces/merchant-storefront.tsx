// MERCHANT_STOREFRONT — R18.x 真接商家店铺
// 之前 43 行只列账号；现在拉 account + store + photo album + lines +
// spend_daily + member_directory, 全部 server-authoritative.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { captureRef } from "react-native-view-shot";
import { buildContactCard } from "../profile-qr";
import { ProxyQrCode } from "../components/proxy-qr-code";
import { QrZoomOverlay } from "../components/qr-zoom-overlay";
import { describeError, saveImageToAlbum } from "../image-export";
import { color, shadows } from "../theme";
import { retainStorePhoto, storePhotoUri, type RetainedStorePhoto } from "../expo-composer-draft-store";
import type { BusinessClient, StoreLinesWire, StoreProduct } from "../business-client";
import type { ConversationClient, ConversationInboxItem } from "../conversation-client";
import { MediaClient } from "../media-client";
// STORE-LOGO-001：店徽显示走既有解析器（assets/ 前缀 → thumb URL）。
import { merchantAvatarUri } from "../business-client";
// MENU-HOT-001：HOT 徽组件。
import { HotBadge } from "../components/hot-badge";
import { mediaThumbUrl } from "../media-thumb-url";
import { localApiBaseUrl, nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import { ProxyIcon } from "../components/proxy-icon";
import { ProxyBackGlyph, ProxyEmptyState, ProxyLoading } from "../components/proxy-foundation";

// 和 native-app 共用同一份 Keychain 会话：相册/菜单照片走媒体管线上传，
// 拿到 mediaAssetId 后以 thumb URL 远端展示，不再只存本地路径。
const storefrontMedia = new MediaClient({
  authClient: sessionAuthClient,
  secureSessionStore: nativeSecureSessionStore,
  baseUrl: localApiBaseUrl,
});

// ACTIVITY-COVER-001：媒体 thumb URL 的拼法收成一处（media-thumb-url.ts）——
// 场景照片墙、门店相册、活动封面三处原本各写各的。
function thumbUrlFor(mediaAssetId: string): string | undefined {
  return mediaThumbUrl(mediaAssetId, localApiBaseUrl);
}


type Account = { id: string; name: string; status: string };
type Store = { id: string; businessId: string; name: string; address: string; status: string };
type StorePhoto = { id: string; storeId: string; businessId: string; uploadedBy: string; assetPath: string; caption: string; sortOrder: number; mediaAssetId: string; category?: string | undefined; createdAt: string };
// STORE-LOGO-001：营业资料直接用线上契约那一份类型，不在这里复制一份窄的 ——
// 复制的那份漏了 contactName / 设施 / 公告 / 社媒，于是「设店徽」这类只改一个字段
// 的写入会把其余字段一起冲成空（upsert 是整行覆盖）。
type StoreLines = StoreLinesWire;
// upsertStoreLines 的入参形状，从 client 推导 —— 客户端加字段时这里自动跟上，
// 不会再出现"类型里声明了、payload 里没带"那种两头都绿的漏法。
type StoreLinesInput = Parameters<BusinessClient["upsertStoreLines"]>[0];
type SpendDaily = { businessId: string; bucketDate: string; orderCount: number; grossMinor: number; newCustomerCount: number; returningCustomerCount: number };

function formatVnd(minor: number): string {
  const vnd = Math.round(minor / 1000);
  if (vnd >= 1_000_000) return `${(vnd / 1_000_000).toFixed(1)}tr VND`;
  if (vnd >= 1_000) return `${(vnd / 1_000).toFixed(0)}k VND`;
  return `${vnd} VND`;
}

const WEEK_DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;
const WEEK_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
function defaultHoursDays(): Array<{ day: string; open: string; close: string; enabled: boolean }> {
  return (["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const).map((day) => ({ day, open: "07:00", close: "22:00", enabled: true }));
}
function parseHoursDays(hoursJson: string): Array<{ day: string; open: string; close: string; enabled: boolean }> {
  const blank = WEEK_DAYS.map((day) => ({ day, open: "", close: "", enabled: false }));
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(hoursJson) as unknown;
  } catch { return blank; }
  if (!parsed || typeof parsed !== "object") return blank;
  const obj = parsed as Record<string, unknown>;
  const daily = typeof obj["每天"] === "string" ? obj["每天"] : undefined;
  return WEEK_DAYS.map((day, i) => {
    const raw = typeof obj[WEEK_KEYS[i]!] === "string" ? (obj[WEEK_KEYS[i]!] as string) : daily;
    if (!raw) return { day, open: "", close: "", enabled: false };
    const m = raw.match(/^(\d{1,2}:\d{2})\s*[-–~～]\s*(\d{1,2}:\d{2})$/);
    if (!m) return { day, open: "", close: "", enabled: false };
    return { day, open: m[1]!, close: m[2]!, enabled: true };
  });
}
function serializeHoursDays(days: Array<{ day: string; open: string; close: string; enabled: boolean }>): string {
  const out: Record<string, string> = {};
  const keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  days.forEach((d, i) => {
    if (d.enabled && d.open.trim() !== "" && d.close.trim() !== "") {
      out[keys[i]!] = `${d.open.trim()}-${d.close.trim()}`;
    }
  });
  return JSON.stringify(out);
}
function linesAsHoursObject(hoursJson: string): Record<string, string> {
  try {
    const parsed = JSON.parse(hoursJson) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
  } catch { /* fall through */ }
  return {};
}

type StoreAssetPage = "root" | "menu" | "photos" | "details";

// STORE-ASSET-SCOPE-001（2026-10-02，用户「这个还是有重复的」）：
// 这一页作为**独立整页**时，外壳（主体抬头 / 门店身份卡 / 分享 / 店铺二维码 /
// 经营数字 / 资产列表 / 活动 / Creator / 口径说明）就是它的内容；但 hub 把它当
// 「资产编辑子视图」嵌进店详情时，那些外壳和 hub 店详情是同一批东西的**第二份**：
// 同一个店名在一屏里出现三次（返回条 / 身份卡 / 主体抬头），二维码卡、经营数字、
// 券、Creator 两边各一份，而且这里还按 accounts.map 把**别的主体别的门店**一起铺出来。
// 所以给子视图一个作用域：只画被选中的那一家、只画它要编辑的那一节。
export type StoreAssetScope = { storeId: string; page: "menu" | "photos" | "details" };

export function MerchantStorefrontSurface({ client, viewerAccountId, header, showcaseActivities, onOpenVouchers, onStartStoreSetup, scope, autoEditStoreId, conversationClient }: { client: BusinessClient; viewerAccountId?: string | undefined; header?: ReactNode; showcaseActivities?: Array<{ id: string; title: string }>; onOpenVouchers?: () => void; onStartStoreSetup?: () => void; scope?: StoreAssetScope | undefined;
  autoEditStoreId?: string | undefined; conversationClient?: ConversationClient | undefined }): React.JSX.Element {
  const [accounts, setAccounts] = useState<Account[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // STORE-QR-001：店铺二维码此前只是一个 qrGrid 图标 + 「扫码进入…可用于店内
  // 桌牌、海报」的说明 —— 没有任何可扫的东西，也没有复制/存图。等于承诺了一个
  // 不存在的功能。现在画真码，并给同一套复制/存图能力。
  //
  // 一个账号可能有多家店，所以截图锚点必须**按店铺分开**：共用一个 ref 时，
  // 在 A 店按保存会截到列表里最后渲染的那张码。
  const storeQrRefs = useRef<Record<string, { current: View | null }>>({});
  const [storeQrNotice, setStoreQrNotice] = useState<{ storeId: string; text: string } | undefined>(undefined);
  // 放大层当前展示的店铺。存 id+name 而不是只存 id —— 关掉列表数据后标题还得在。
  const [zoomedStore, setZoomedStore] = useState<{ id: string; name: string } | undefined>(undefined);
  // STORE-SHARE-001：分享给站内好友 —— 店铺 vCard（X-PROXY-STORE）走 CONTACT
  // 消息发到选中的会话，对方在对话里看到同一张店名片。系统分享保留，走更多入口。
  const [shareFor, setShareFor] = useState<string | undefined>(undefined);
  const [shareInbox, setShareInbox] = useState<ConversationInboxItem[] | undefined>(undefined);
  const [shareLoading, setShareLoading] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | undefined>(undefined);
  const [shareMsg, setShareMsg] = useState<{ storeId: string; text: string } | undefined>(undefined);
  async function openSharePicker(storeId: string): Promise<void> {
    setShareMsg(undefined);
    if (!conversationClient) {
      setShareMsg({ storeId, text: "站内分享需要登录会话，先去「消息」页登录再回来。" });
      setShareFor(storeId);
      setShareInbox([]);
      return;
    }
    setShareFor(storeId);
    setShareLoading(true);
    try {
      setShareInbox(await conversationClient.listConversations());
    } catch (e) {
      setShareMsg({ storeId, text: e instanceof Error ? e.message : String(e) });
      setShareInbox([]);
    } finally {
      setShareLoading(false);
    }
  }
  async function sendStoreToConversation(storeId: string, storeName: string, conversationId: string, peerName: string): Promise<void> {
    if (!conversationClient) return;
    const vcard = buildContactCard({ name: storeName, storeId });
    if (!vcard) {
      setShareMsg({ storeId, text: "这家店信息不全，名片拼不出来，分享不了。" });
      return;
    }
    setSendingTo(conversationId);
    try {
      await conversationClient.sendContactMessage(conversationId, vcard);
      setShareMsg({ storeId, text: `已分享给 ${peerName}，对方在对话里能看到这家店。` });
    } catch (e) {
      setShareMsg({ storeId, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSendingTo(undefined);
    }
  }
  const storeZoomShotRef = useRef<View>(null);
  function storeQrRefFor(storeId: string): { current: View | null } {
    const existing = storeQrRefs.current[storeId];
    if (existing) return existing;
    const created: { current: View | null } = { current: null };
    storeQrRefs.current[storeId] = created;
    return created;
  }
  const [stores, setStores] = useState<Record<string, Store[]>>({});
  const [photos, setPhotos] = useState<Record<string, StorePhoto[]>>({});
  const [lines, setLines] = useState<Record<string, StoreLines | undefined>>({});
  // R18.x LINES-EDITOR-001: the storefront now lets a
  // BUSINESS_WRITE_REQUIRED viewer edit logo / description /
  // hours / contact for each store. The form is inline
  // (no modal): editing toggles a few TextInputs and a
  // 保存 button, mirrors the photo uploader pattern.
  const [editingLinesFor, setEditingLinesFor] = useState<string | undefined>(undefined);
  const autoEditDoneRef = useRef(false);
  useEffect(() => {
    if (!autoEditStoreId || autoEditDoneRef.current) return;
    const current = lines[autoEditStoreId];
    if (current === undefined) return;
    autoEditDoneRef.current = true;
    startEditLines(autoEditStoreId, current);
  }, [autoEditStoreId, lines]);
  const [editingDescription, setEditingDescription] = useState<string>("");
  const [editingContactPhone, setEditingContactPhone] = useState<string>("");
  const [editingContactEmail, setEditingContactEmail] = useState<string>("");
  const [editingHoursJson, setEditingHoursJson] = useState<string>("");
  const [hoursDays, setHoursDays] = useState<Array<{ day: string; open: string; close: string; enabled: boolean }>>([]);
  const [hoursTouched, setHoursTouched] = useState(false);
  const [editingHoursRaw, setEditingHoursRaw] = useState("{}");
  const [editingSocialZalo, setEditingSocialZalo] = useState("");
  const [editingSocialFacebook, setEditingSocialFacebook] = useState("");
  const [editingSocialTiktok, setEditingSocialTiktok] = useState("");
  const [editingAnnouncement, setEditingAnnouncement] = useState("");
  const [announceTpl, setAnnounceTpl] = useState<number | undefined>(undefined);
  const ANNOUNCE_TEMPLATES = [
    ["😴 今日休息", "今天休息，暂停营业一天，明天见！ / Nghỉ hôm nay, hẹn gặp lại ngày mai!"],
    ["⏰ 调整营业", "因特殊情况，今日营业时间调整为 10:00 - 18:00 / Hôm nay mở cửa từ 10:00 - 18:00"],
    ["🚫 备货售罄", "今日备货已售罄，感谢支持，明天请早！ / Hôm nay đã hết hàng, cảm ơn và hẹn gặp lại!"],
    ["🔥 限时优惠", "【限时特惠】下午2-5点，全场第二杯半价！ / Giảm giá giờ vàng: Mua 1 tặng 1!"],
    ["✨ 新品上市", "新品上市！欢迎来品尝我们的特色饮品。 / Món mới ra mắt, mời bạn ghé thử!"],
  ] as const;
  const [savingLinesFor, setSavingLinesFor] = useState<string | undefined>(undefined);
  const [linesError, setLinesError] = useState<string | undefined>(undefined);
  const [spend, setSpend] = useState<Record<string, { totalOrders: number; totalGrossMinor: number; days: SpendDaily[] } | undefined>>({});
  const [uploadingStoreId, setUploadingStoreId] = useState<string | undefined>(undefined);
  // 相册上传分类：environment（店铺环境）| menu（菜单菜品），按店各自独立，默认环境。
  const [photoCatByStore, setPhotoCatByStore] = useState<Record<string, "environment" | "menu">>({});
  const [products, setProducts] = useState<Record<string, StoreProduct[]>>({});
  // R36.x MENU-001: 菜单新增/编辑表单状态。"new" 表示新增，否则为被编辑商品 id。
  const [editingProductFor, setEditingProductFor] = useState<string | undefined>(undefined);
  const [editingProductId, setEditingProductId] = useState<string | "new" | undefined>(undefined);
  const [editingProductName, setEditingProductName] = useState("");
  const [editingProductPrice, setEditingProductPrice] = useState("");
  const [editingProductDesc, setEditingProductDesc] = useState("");
  const [editingProductCategory, setEditingProductCategory] = useState("");
  const [editingProductScene, setEditingProductScene] = useState("");
  const [editingProductPhoto, setEditingProductPhoto] = useState("");
  // MENU-HOT-001：编辑态的 HOT 开关。
  const [editingProductHot, setEditingProductHot] = useState(false);
  // R25 对齐：SKU 详情当前选中 + 完整目录展开态（按店各自独立）。
  const [selectedProductByStore, setSelectedProductByStore] = useState<Record<string, string | undefined>>({});
  const [catalogOpenByStore, setCatalogOpenByStore] = useState<Record<string, boolean>>({});
  const [savingProduct, setSavingProduct] = useState(false);
  const [productError, setProductError] = useState<string | undefined>(undefined);
  // UI-STORE-ENTRY-001：这里原来有一整段「建店表单」死代码 —— createShop / addStore
  // 两个函数**零调用点**，newShopName / newStoreName / newStoreAddr 三个 state 只有
  // setter 没有读取处，creationOpen 只有声明没有打开的地方，而 createError 被写 3 次
  // 却**从不渲染**（同文件 error / productError / linesError 都老老实实渲染了）。
  // 净效果是：网络失败时错误被静默丢弃，用户点了什么都没发生；两个函数是纯死代码。
  //
  // 真入口不是这个表单，是 `onStartStoreSetup` → 企业运营助手（me.tsx 的 enterpriseops
  // 子页）。me.tsx 之前**没传**这个 prop，于是「让企业运营助手帮我创建」按钮恒灰、
  // 点了没反应，旁边也没有一句说明 —— 那是用户真正能看见的缺陷，已在 me.tsx 接线。
  // 这段表单因此删除，而不是留着「接线一下就能用」：它的字段来源不明，接上也是新功能。
  const [assetPage, setAssetPage] = useState<{ storeId: string; page: StoreAssetPage } | undefined>(undefined);

  const refreshOne = useCallback(async (accountId: string) => {
    try {
      const s = await client.listStores(accountId);
      setStores((prev) => ({ ...prev, [accountId]: s }));
      const photoMap: Record<string, StorePhoto[]> = {};
      const linesMap: Record<string, StoreLines> = {};
      const productMap: Record<string, StoreProduct[]> = {};
      await Promise.all(s.map(async (store) => {
        try {
          photoMap[store.id] = await client.listStorePhotos(store.id);
        } catch {
          photoMap[store.id] = [];
        }
        try {
          productMap[store.id] = await client.listProducts(store.id);
        } catch {
          productMap[store.id] = [];
        }
        try {
          linesMap[store.id] = await client.getStoreLines(store.id);
        } catch { /* missing store_lines is not a failure */ }
      }));
      setPhotos((prev) => ({ ...prev, ...photoMap }));
      setProducts((prev) => ({ ...prev, ...productMap }));
      setLines((prev) => ({ ...prev, ...linesMap }));
      try {
        const sd = await client.listSpendDaily({ businessId: accountId, sinceDays: 7 });
        setSpend((prev) => ({ ...prev, [accountId]: { totalOrders: sd.totalOrders, totalGrossMinor: sd.totalGrossMinor, days: sd.days } }));
      } catch { /* finance read is owner/admin only — fall through silently */ }
    } catch (e) {
      setError((prev) => prev ?? (e instanceof Error ? e.message : String(e)));
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const a = await client.listMyAccounts();
        if (cancelled) return;
        setAccounts(a);
        await Promise.all(a.map((acc) => refreshOne(acc.id)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [client, refreshOne]);

  async function pickAndUploadPhoto(storeId: string, category: "environment" | "menu"): Promise<void> {
    setError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("需要照片权限才能上传店铺相册。");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: false,
      selectionLimit: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const localId = `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let retained: RetainedStorePhoto;
    try {
      retained = await retainStorePhoto({
        localId,
        uri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setUploadingStoreId(storeId);
    try {
      // 照片走媒体管线：READY + PUBLIC 授权后才能远端展示（thumb URL），
      // 否则其它设备永远看不到（R36.x PHOTO-001）。
      const uploaded = await storefrontMedia.uploadImage({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        ...(asset.fileName ? { fileName: asset.fileName } : {}),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
      });
      const created = await client.addStorePhoto({
        storeId,
        assetPath: retained.assetPath,
        caption: asset.fileName ?? "",
        sortOrder: Date.now() % 1000,
        mediaAssetId: uploaded.mediaAssetId,
        category,
      });
      retained.photoId = created.id;
      setPhotos((prev) => ({
        ...prev,
        [storeId]: [created, ...(prev[storeId] ?? [])],
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingStoreId(undefined);
    }
  }

  async function deletePhoto(storeId: string, photoId: string): Promise<void> {
    try {
      await client.deleteStorePhoto(storeId, photoId);
      setPhotos((prev) => ({
        ...prev,
        [storeId]: (prev[storeId] ?? []).filter((p) => p.id !== photoId),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // R18.x LINES-EDITOR-001: open the inline edit form.
  // Pre-fills from the current lines row; if the store
  // has no row yet, all fields are blank. The user can
  // also paste a JSON object for hours, with an inline
  // error if the JSON is malformed (validated client-side
  // before sending to the server).
  function startEditLines(storeId: string, current: StoreLines | undefined): void {
    setLinesError(undefined);
    setEditingLinesFor(storeId);
    setEditingDescription(current?.description ?? "");
    setEditingContactPhone(current?.contactPhone ?? "");
    setEditingContactEmail(current?.contactEmail ?? "");
    setEditingHoursJson(Object.entries(linesAsHoursObject(current?.hoursJson ?? "{}"))
      .map(([day, hours]) => day === "营业时间" ? hours : `${day} ${hours}`).join(" · "));
    setEditingHoursRaw(current?.hoursJson ?? "{}");
    const parsed = current ? parseHoursDays(current.hoursJson ?? "{}") : defaultHoursDays();
    setHoursDays(parsed.some((d) => d.enabled) ? parsed : defaultHoursDays());
    setHoursTouched(false);
    setEditingSocialZalo(current?.socials?.zalo ?? "");
    setEditingSocialFacebook(current?.socials?.facebook ?? "");
    setEditingSocialTiktok(current?.socials?.tiktok ?? "");
    setEditingAnnouncement(current?.announcement ?? "");
    setAnnounceTpl(undefined);
  }

  // upsertStoreLines 是**整行覆盖**：只传改动的那几个字段，等于把没传的字段清空。
  // 这个坑已经咬过一次 —— 详情表单保存从来不传设施（wifi/smoking/acTempC/power/
  // quiet/seating）和对接人姓名，商家改一句简介就把这些全冲成空（HEAD 上就是这样）。
  // 「设店徽」要是照抄那个写法，会把简介/营业时间/公告一起冲掉。
  // 所以两处都走这一个合并口径：以库里那行为底，只覆盖显式给的字段。
  function linesPayload(storeId: string, overrides: Partial<Omit<StoreLinesInput, "storeId">>): StoreLinesInput {
    const c = lines[storeId];
    return {
      storeId,
      logoAssetPath: c?.logoAssetPath ?? "",
      description: c?.description ?? "",
      hoursJson: c?.hoursJson ?? "{}",
      contactPhone: c?.contactPhone ?? "",
      contactEmail: c?.contactEmail ?? "",
      contactName: c?.contactName ?? "",
      wifi: c?.wifi ?? "",
      smoking: c?.smoking ?? "",
      acTempC: c?.acTempC ?? 0,
      power: c?.power ?? "",
      quiet: c?.quiet ?? "",
      seating: c?.seating ?? "",
      announcement: c?.announcement ?? "",
      socials: c?.socials ?? {},
      ...overrides,
    };
  }

  // STORE-LOGO-001：把相册里的某张照片设为店徽。上传入口统一到相册页是对的，
  // 但「换店徽」这个能力不能跟着上传入口一起消失 —— 详情表单删掉选择器之后，
  // logoAssetPath 只剩原样回存，新店永远拿不到店徽、老店也换不掉。这条 pin 当初
  // 就是为用户那句「商家侧的头像为什么不能更换」钉的。
  // 存资产引用 `assets/<mediaAssetId>`，与 merchantAvatarUri 的解析口径一致。
  const [savingLogoFor, setSavingLogoFor] = useState<string | undefined>(undefined);
  async function setStoreLogoFromPhoto(storeId: string, photo: StorePhoto): Promise<void> {
    if (!photo.mediaAssetId) {
      setLinesError("这张照片还没有媒体资产，设不了店徽 —— 删掉重传一次。");
      return;
    }
    setLinesError(undefined);
    setSavingLogoFor(storeId);
    try {
      const saved = await client.upsertStoreLines(
        linesPayload(storeId, { logoAssetPath: `assets/${photo.mediaAssetId}` }),
      );
      setLines((prev) => ({ ...prev, [storeId]: saved }));
    } catch (e) {
      setLinesError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLogoFor(undefined);
    }
  }

  async function saveLines(storeId: string): Promise<void> {    setLinesError(undefined);
    // Validate hours JSON before sending: business server
    // will reject empty / non-object hoursJson, but a
    // local pre-check gives the user a clearer error.
    const hoursJson = hoursTouched ? serializeHoursDays(hoursDays) : editingHoursRaw;
    const socials: Record<string, string> = {};
    if (editingSocialZalo.trim() !== "") socials.zalo = editingSocialZalo.trim();
    if (editingSocialFacebook.trim() !== "") socials.facebook = editingSocialFacebook.trim();
    if (editingSocialTiktok.trim() !== "") socials.tiktok = editingSocialTiktok.trim();
    setSavingLinesFor(storeId);
    try {
      const saved = await client.upsertStoreLines(linesPayload(storeId, {
        description: editingDescription,
        hoursJson,
        contactPhone: editingContactPhone,
        contactEmail: editingContactEmail,
        announcement: editingAnnouncement.trim(),
        socials,
      }));
      setLines((prev) => ({ ...prev, [storeId]: saved }));
      setEditingLinesFor(undefined);
    } catch (e) {
      setLinesError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLinesFor(undefined);
    }
  }

  // R36.x MENU-001: 菜单新增/编辑。价格为 VND 分（整数，必须 >= 0）。
  function startEditProduct(storeId: string, current: StoreProduct | undefined): void {
    setProductError(undefined);
    setEditingProductFor(storeId);
    setEditingProductId(current ? current.id : "new");
    setEditingProductName(current?.name ?? "");
    setEditingProductPrice(current ? String(current.priceMinor) : "");
    setEditingProductDesc(current?.description ?? "");
    setEditingProductCategory(current?.category ?? "");
    setEditingProductScene(current?.scene ?? "");
    setEditingProductPhoto(current?.mediaAssetId ?? "");
    setEditingProductHot(current?.isHot ?? false);
  }

  // 店铺照片入口只在相册页（照片与内容）保留，经营资料页只做预览，不重复上传。
  // logoAssetPath 仍随表单原样回存，不丢已有值。
  // 菜品照片：选中即走媒体管线上传，拿到 mediaAssetId 后才可保存，
  // 保证列表里一定能远端展示（R36.x PHOTO-001）。
  async function pickProductPhoto(): Promise<void> {
    setProductError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setProductError("需要照片权限才能上传菜品照片。");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsMultipleSelection: false,
      selectionLimit: 1,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    setSavingProduct(true);
    try {
      const uploaded = await storefrontMedia.uploadImage({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        ...(asset.fileName ? { fileName: asset.fileName } : {}),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
      });
      setEditingProductPhoto(uploaded.mediaAssetId);
    } catch (e) {
      setProductError(e instanceof Error ? e.message : "照片上传失败，请重试");
    } finally {
      setSavingProduct(false);
    }
  }

  // MENU-HOT-001：一键打标/摘标（只改 isHot）。失败就报错，不静默。
  async function toggleProductHot(storeId: string, product: StoreProduct): Promise<void> {
    setProductError(undefined);
    try {
      const saved = await client.setProductHot(product.id, storeId, !product.isHot);
      setProducts((prev) => ({
        ...prev,
        [storeId]: (prev[storeId] ?? []).map((item) => item.id === product.id ? saved.product : item),
      }));
    } catch (e) {
      setProductError(e instanceof Error ? e.message : "HOT 标记失败，请重试。");
    }
  }

  async function saveProduct(storeId: string): Promise<void> {
    setProductError(undefined);
    const name = editingProductName.trim();
    const price = Number.parseInt(editingProductPrice.trim(), 10);
    if (!name) {
      setProductError("菜名不能为空");
      return;
    }
    if (!Number.isInteger(price) || price < 0) {
      setProductError("价格必须是大于等于 0 的整数（VND 分）");
      return;
    }
    setSavingProduct(true);
    try {
      if (editingProductId === "new" || !editingProductId) {
        const made = await client.createProduct({
          storeId, name, priceMinor: price,
          description: editingProductDesc, category: editingProductCategory, scene: editingProductScene,
          mediaAssetId: editingProductPhoto, isHot: editingProductHot,
        });
        setProducts((prev) => ({ ...prev, [storeId]: [...(prev[storeId] ?? []), made.product] }));
      } else {
        const saved = await client.updateProduct({
          productId: editingProductId, storeId, name, priceMinor: price,
          description: editingProductDesc, category: editingProductCategory, scene: editingProductScene,
          mediaAssetId: editingProductPhoto, isHot: editingProductHot,
        });
        setProducts((prev) => ({
          ...prev,
          [storeId]: (prev[storeId] ?? []).map((p) => (p.id === saved.product.id ? saved.product : p)),
        }));
      }
      setEditingProductFor(undefined);
      setEditingProductId(undefined);
    } catch (e) {
      setProductError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      setSavingProduct(false);
    }
  }

  async function toggleProduct(storeId: string, product: StoreProduct): Promise<void> {
    setProductError(undefined);
    try {
      const saved = await client.setProductAvailability(product.id, storeId, !product.available);
      setProducts((prev) => ({
        ...prev,
        [storeId]: (prev[storeId] ?? []).map((p) => (p.id === saved.product.id ? saved.product : p)),
      }));
    } catch (e) {
      setProductError(e instanceof Error ? e.message : "上下架失败，请重试");
    }
  }

  // PROFILE-QR-002：店铺码里编的是**门店 vCard 名片**（店名 + 店铺 id），
  // 所以能复制的是**店名** —— 以前复制的是拼出来的店铺主页链接：那个域名不是我们的
  // （挂在 Spaceship 上待售），粘给谁都是把对方送去卖域名的落地页，
  // 而且 App 自己的搜索按名字/字面匹配，那串链接谁也对不上。
  // 这里刻意**不写出**那个域名：本文件被 gate 的「不许再拼链接」反向钉盯着，
  // 写进注释会让钉在正确的树上误报。完整的实测记录在 `../profile-qr.ts` 文件头。
  async function copyStoreName(storeId: string, name: string): Promise<void> {
    try {
      await Clipboard.setStringAsync(name);
      setStoreQrNotice({ storeId, text: `已复制「${name}」—— 让对方在 Proxy 里搜它就能找到这家店。` });
    } catch {
      setStoreQrNotice({ storeId, text: "复制失败，请长按店名手动复制。" });
    }
  }
  async function saveStoreQrToAlbum(storeId: string): Promise<void> {
    await saveQrBlockToAlbum(storeQrRefFor(storeId), storeId);
  }
  // 放大层里的存图走同一个出口 —— 但截的是放大层那张（更大、更清楚），
  // 而且结果提示要落回放大层自己，不然用户看不见。
  async function saveZoomedStoreQr(): Promise<void> {
    if (!zoomedStore) return;
    await saveQrBlockToAlbum(storeZoomShotRef, zoomedStore.id);
  }
  async function saveQrBlockToAlbum(
    shot: { current: View | null },
    storeId: string,
  ): Promise<void> {
    try {
      const uri = await captureRef(shot, { format: "png", quality: 1 });
      const result = await saveImageToAlbum(uri);
      setStoreQrNotice({
        storeId,
        text: result.ok
          ? "二维码已保存到相册。"
          : result.code === "permission"
            ? "需要相册权限才能保存二维码。"
            : `保存失败：${result.reason}`,
      });
    } catch (err) {
      setStoreQrNotice({ storeId, text: `保存失败：${describeError(err)}` });
    }
  }

  return (
    <>
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      {header}
      {accounts === undefined && !error ? <ProxyLoading tone="muted" /> : null}
      {error ? <View style={styles.card}><Text selectable style={styles.errorText}>加载失败：{error}</Text></View> : null}
      {accounts !== undefined && accounts.length === 0 ? (
        <View style={styles.card}>
          <ProxyEmptyState icon="storefront" title="还没有线上店铺" sub="你不需要手工搭页面。把店门、菜单、产品照片或已有文件交给企业运营助手，它会先生成店铺草稿，再由你确认发布。" cta={{ label: "让企业运营助手帮我创建", onPress: () => onStartStoreSetup?.(), disabled: !onStartStoreSetup }} />
        </View>
      ) : null}
      {accounts?.map((a) => {
        const allStores = stores[a.id] ?? [];
        const aStores = scope ? allStores.filter((s) => s.id === scope.storeId) : allStores;
        // 子视图只属于一家店：别的主体/别的门店在这一屏里没有位置。
        if (scope && aStores.length === 0) return null;
        const aSpend = spend[a.id];
        const newCustomers = aSpend?.days.reduce((sum, day) => sum + day.newCustomerCount, 0) ?? 0;
        const returningCustomers = aSpend?.days.reduce((sum, day) => sum + day.returningCustomerCount, 0) ?? 0;
        return (
          <View key={a.id} style={styles.accountCard}>
            {scope ? null : <View style={styles.accountHead}><Text selectable style={styles.accountName}>管理别人看到你的店</Text><Text selectable style={styles.accountMeta}>{a.name} · {aStores.length} 家门店</Text></View>}
            {aStores.length === 0 ? (
              <View style={styles.card}>
                <ProxyEmptyState title="尚未建立经营门店" sub="把门店照片、菜单或文件交给企业运营助手，先生成草稿再确认，不需要从空白表单开始。" cta={{ label: "交给企业运营助手", onPress: () => onStartStoreSetup?.(), disabled: !onStartStoreSetup }} />
              </View>
            ) : null}
            {aStores.map((s) => {
              const sPhotos = photos[s.id] ?? [];
              const sLines = lines[s.id];
              const sProducts = products[s.id] ?? [];
              const sAvailable = sProducts.filter((p) => p.available);
              // 子视图的页由宿主定（hub 的「管理菜品 / 管理照片 / 编辑资料」），
              // 不再有自己的资产列表中间页 —— 那一层和 hub 店详情是同一批入口。
              const currentPage: StoreAssetPage = scope ? scope.page
                : assetPage?.storeId === s.id ? assetPage.page : "root";
              // STORE-SHARE-001：选人面板抽出来 —— 非作用域页挂头图下，
              // hub 进来的作用域页挂营业资料上，两边同一份。
              const renderSharePanel = () => (
                <View style={styles.sharePanel}>
                  <View style={styles.photoHead}>
                    <Text selectable style={styles.photoHeadTitle}>发给站内好友</Text>
                    <Pressable onPress={() => { setShareFor(undefined); setShareMsg(undefined); }} style={styles.rowAction}><Text selectable style={styles.rowActionText}>收起</Text></Pressable>
                  </View>
                  {shareLoading ? <Text selectable style={styles.empty}>正在拉会话列表…</Text> : null}
                  {!shareLoading && (shareInbox ?? []).length === 0 && !(shareMsg && shareMsg.storeId === s.id) ? (
                    <Text selectable style={styles.empty}>还没有站内会话 — 先去「消息」页和好友聊一句再回来分享。</Text>
                  ) : null}
                  {(shareInbox ?? []).map((item) => {
                    const convId = item.conversation.conversationId;
                    const peer = item.counterpartySnapshot?.displayName?.trim() || "站内好友";
                    return (
                      <Pressable
                        key={convId}
                        disabled={sendingTo === convId}
                        onPress={() => void sendStoreToConversation(s.id, s.name, convId, peer)}
                        style={styles.assetRow}
                      >
                        <View style={styles.photoRowMain}>
                          <Text selectable style={styles.assetTitle}>{peer}</Text>
                          <Text selectable style={styles.assetMeta}>
                            {sendingTo === convId ? "发送中…" : item.latestMessage?.messageType === "CONTACT" ? "最近：名片" : item.latestMessage?.body ? item.latestMessage.body.slice(0, 20) : "点开发这家店的名片"}
                          </Text>
                        </View>
                        <Text selectable style={styles.assetChevron}>›</Text>
                      </Pressable>
                    );
                  })}
                  {shareMsg && shareMsg.storeId === s.id ? <Text selectable style={styles.storeQrNotice}>{shareMsg.text}</Text> : null}
                </View>
              );
              return (
                <View key={s.id} style={currentPage === "details" && editingLinesFor === s.id ? styles.storeCardPlain : styles.storeCard}>
                  {scope ? null : <>
                  <View style={styles.storeHero}>
                    {(() => {
                      const cover = sPhotos.find((p) => p.mediaAssetId);
                      const coverUri = cover ? thumbUrlFor(cover.mediaAssetId) : undefined;
                      return coverUri
                        ? <Image source={{ uri: coverUri }} style={styles.storeCover} />
                        : <View style={styles.storeLogo}><Text selectable style={styles.storeLogoText}>{s.name.slice(0, 1).toUpperCase()}</Text></View>;
                    })()}
                    <View style={styles.storeHeroCopy}><Text selectable style={styles.storeName}>{s.name} · Proxy 店铺</Text><Text selectable style={styles.storeMeta}>{s.address || "地址待完善"} · {s.status}</Text></View>
                  </View>
                  {/* PROFILE-QR-002：这里原来是「公开主页」+「分享店铺」两个按钮，前者分享
                      拼出来的店铺主页链接。没有域名/公开页之后它就只剩一个卖域名的落地页可分享，
                      所以撤掉，只留「分享店铺」——分享的是**搜得到的店名**。
                      （域名不写在这里，原因见上面 copyStoreName 的注释。） */}
                  <View style={styles.heroActions}><Pressable onPress={() => void openSharePicker(s.id)} style={styles.shareButton} accessibilityLabel="发给站内好友"><Text selectable style={styles.shareButtonText}>发给站内好友</Text></Pressable><Pressable onPress={() => void Share.share({ message: `${s.name} · 在 Proxy 里搜这家店就能找到。` })} style={styles.previewButton} accessibilityLabel="分享到站外"><Text selectable style={styles.previewButtonText}>分享到站外</Text></Pressable></View>
                  {shareFor === s.id ? renderSharePanel() : null}
                  <View style={styles.qrCard}>
                    <View ref={storeQrRefFor(s.id)} collapsable={false} style={styles.qrShot}>
                      <Pressable accessibilityLabel="放大店铺二维码" accessibilityRole="button" onPress={() => setZoomedStore({ id: s.id, name: s.name })}>
                        <ProxyQrCode size={104} value={buildContactCard({ name: s.name, storeId: s.id }) ?? s.name} />
                      </Pressable>
                    </View>
                    <View style={styles.storeHeroCopy}>
                      <Text selectable style={styles.photoHeadTitle}>店铺二维码</Text>
                      <Text selectable style={styles.storeMeta}>扫这张码会把「{s.name}」存成联系人（标准 vCard 名片），任何手机的相机都能扫。可用于店内桌牌、海报和 Creator 分享。</Text>
                      <View style={styles.qrActions}>
                        <Pressable onPress={() => void copyStoreName(s.id, s.name)} style={styles.previewButton} accessibilityLabel="复制店名"><Text selectable style={styles.previewButtonText}>复制店名</Text></Pressable>
                        <Pressable onPress={() => void saveStoreQrToAlbum(s.id)} style={styles.shareButton} accessibilityLabel="保存店铺二维码到相册"><Text selectable style={styles.shareButtonText}>保存到相册</Text></Pressable>
                      </View>
                      {storeQrNotice?.storeId === s.id ? <Text selectable style={styles.storeQrNotice}>{storeQrNotice.text}</Text> : null}
                    </View>
                  </View>

                  <View style={styles.metricStrip}>{[[(aSpend?.totalOrders ?? 0).toString(), "近7天订单"], [aSpend ? formatVnd(aSpend.totalGrossMinor) : "—", "成交额"], [newCustomers.toString(), "新客"], [returningCustomers.toString(), "复购"]].map(([value, label]) => <View key={label} style={styles.metricItem}><Text selectable numberOfLines={1} style={styles.metricValue}>{value}</Text><Text selectable style={styles.metricLabel}>{label}</Text></View>)}</View>
                  </>}

                  {scope ? null : currentPage === "root" ? <View style={styles.assetSection}>
                    <Text selectable style={styles.assetSectionTitle}>店铺资产</Text>
                    <Pressable onPress={() => setAssetPage({ storeId: s.id, page: "menu" })} style={styles.assetRow}><View style={styles.assetIcon}><Text selectable style={styles.assetIconText}>菜</Text></View><View style={styles.photoRowMain}><Text selectable style={styles.assetTitle}>菜单与价格</Text><Text selectable style={styles.assetMeta}>{sProducts.length} 个项目 · 在售 {sAvailable.length}</Text></View><Text selectable style={styles.assetChevron}>›</Text></Pressable>
                    <Pressable onPress={() => setAssetPage({ storeId: s.id, page: "photos" })} style={styles.assetRow}><View style={styles.assetIcon}><Text selectable style={styles.assetIconText}>图</Text></View><View style={styles.photoRowMain}><Text selectable style={styles.assetTitle}>照片与内容</Text><Text selectable style={styles.assetMeta}>{sPhotos.length} 张店铺照片</Text></View><Text selectable style={styles.assetChevron}>›</Text></Pressable>
                    <Pressable disabled={!onOpenVouchers} onPress={onOpenVouchers} style={styles.assetRow}><View style={styles.assetIcon}><Text selectable style={styles.assetIconText}>券</Text></View><View style={styles.photoRowMain}><Text selectable style={styles.assetTitle}>当前礼券</Text><Text selectable style={styles.assetMeta}>查看发行、领取与核销状态</Text></View><Text selectable style={styles.assetChevron}>›</Text></Pressable>
                    <Pressable onPress={() => setAssetPage({ storeId: s.id, page: "details" })} style={styles.assetRow}><View style={styles.assetIcon}><Text selectable style={styles.assetIconText}>店</Text></View><View style={styles.photoRowMain}><Text selectable style={styles.assetTitle}>店铺照片与经营资料</Text><Text selectable style={styles.assetMeta}>门店环境、营业时间、地址与联系方式</Text></View><Text selectable style={styles.assetChevron}>›</Text></Pressable>
                  </View> : <Pressable accessibilityLabel="返回店铺资产" onPress={() => setAssetPage(undefined)} style={styles.assetBack}><ProxyBackGlyph /></Pressable>}

                  {currentPage === "menu" ? <>
                  <View style={styles.managerPanel}><View style={styles.photoHead}>
                    <Text selectable style={styles.photoHeadTitle}>菜单 / 服务</Text>
                    <Text selectable style={styles.photoHeadMeta}>{sProducts.length} 项 · 在售 {sAvailable.length}</Text>
                  </View>
                  {/* 以前这里写「顾客在公开主页看到的菜单与服务」—— App 里**没有**给顾客看的
                      店铺页（全仓库只有「我的 › 线上店铺」这一个商家自己的管理面），
                      对外店铺页属于后续的 Web 管理范围。先说实话。 */}
                  <Text selectable style={styles.empty}>{sProducts.length ? "菜单与服务维护在这里；对外的顾客展示页还没做。" : "还没有菜单或服务"}</Text>
                  <Pressable onPress={() => startEditProduct(s.id, undefined)} style={styles.uploadButton}><Text selectable style={styles.uploadButtonText}>+ 添加菜单 / 服务</Text></Pressable>
                  {sAvailable.length > 0 ? <>
                    <Text selectable style={styles.catalogTitle}>值得先看的 SKU</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.worthRow}>
                      {sAvailable.slice(0, 6).map((p) => (
                        <Pressable key={p.id} onPress={() => setSelectedProductByStore((prev) => ({ ...prev, [s.id]: p.id }))} style={styles.worthCard}>
                          {thumbUrlFor(p.mediaAssetId) ? <Image source={{ uri: thumbUrlFor(p.mediaAssetId) }} style={styles.worthImage} /> : <View style={styles.worthImageMissing}><ProxyIcon color={color.muted} name="storefront" size={24} /></View>}
                          {/* MENU-HOT-001：HOT 徽。 */}
                          <View style={styles.worthNameRow}>
                            <Text selectable style={styles.worthName} numberOfLines={1}>{p.name}</Text>
                            {p.isHot ? <HotBadge /> : null}
                          </View>
                          <Text selectable style={styles.priceRed}>{formatVnd(p.priceMinor)}</Text>
                          {p.scene ? <Text selectable style={styles.scenePill} numberOfLines={1}>{p.scene}</Text> : null}
                        </Pressable>
                      ))}
                    </ScrollView>
                  </> : null}
                  {(() => {
                    const groups = new Map<string, typeof sProducts>();
                    for (const p of sProducts) {
                      const key = p.category || "未分类";
                      const list = groups.get(key) ?? [];
                      list.push(p);
                      groups.set(key, list);
                    }
                    const open = catalogOpenByStore[s.id] ?? false;
                    return (<>
                      <Pressable onPress={() => setCatalogOpenByStore((prev) => ({ ...prev, [s.id]: !open }))} style={styles.catalogHead}>
                        <Text selectable style={styles.catalogTitle}>完整结构化菜单</Text>
                        <Text selectable style={styles.rowActionText}>{open ? "收起" : "展开"}</Text>
                      </Pressable>
                      {open ? [...groups.entries()].map(([cat, list]) => (
                        <View key={cat}>
                          <Text selectable style={styles.catalogCat}>{cat}</Text>
                          {list.map((p) => (
                            <Pressable key={p.id} onPress={() => setSelectedProductByStore((prev) => ({ ...prev, [s.id]: p.id }))} style={styles.menuLine}>
                              <View style={styles.photoRowMain}>
                                <Text selectable style={styles.productName}>{p.name}{p.available ? "" : " · 已下架"}</Text>
                                {p.scene ? <Text selectable style={styles.photoMeta}>{p.scene}</Text> : null}
                              </View>
                              <Text selectable style={styles.priceRed}>{formatVnd(p.priceMinor)}</Text>
                            </Pressable>
                          ))}
                        </View>
                      )) : sProducts.map((p) => <View key={p.id} style={styles.photoRow}>{thumbUrlFor(p.mediaAssetId) ? <Image source={{ uri: thumbUrlFor(p.mediaAssetId) }} style={styles.productThumb} /> : <View style={styles.productThumb}><ProxyIcon color={color.ink} name="storefront" size={20} /></View>}<View style={styles.photoRowMain}><Text selectable style={styles.productName}>{p.name}{p.available ? "" : " · 已下架"}</Text><Text selectable style={styles.photoMeta}>{formatVnd(p.priceMinor)}{p.description ? ` · ${p.description}` : ""}</Text></View>{p.isHot ? <View style={styles.rowHot}><HotBadge /></View> : null}<Pressable accessibilityLabel={p.isHot ? `取消${p.name}的HOT` : `把${p.name}标为HOT`} onPress={() => void toggleProductHot(s.id, p)} style={styles.rowAction}><Text selectable style={styles.rowActionText}>{p.isHot ? "摘HOT" : "HOT"}</Text></Pressable><Pressable onPress={() => startEditProduct(s.id, p)} style={styles.rowAction}><Text selectable style={styles.rowActionText}>编辑</Text></Pressable></View>)}
                    </>);
                  })()}
                  {(() => {
                    const selected = sProducts.find((p) => p.id === selectedProductByStore[s.id]);
                    if (!selected) return null;
                    return (
                      <View style={styles.managerPanel}>
                        <View style={styles.photoHead}>
                          <Text selectable style={styles.photoHeadTitle}>SKU 详情</Text>
                          <Pressable onPress={() => setSelectedProductByStore((prev) => ({ ...prev, [s.id]: undefined }))}><Text selectable style={styles.rowActionText}>关闭</Text></Pressable>
                        </View>
                        {thumbUrlFor(selected.mediaAssetId) ? <Image source={{ uri: thumbUrlFor(selected.mediaAssetId) }} style={styles.skuHero} /> : null}
                        <View style={styles.photoHead}>
                          <View style={styles.photoRowMain}>
                            <Text selectable style={styles.productName}>{selected.name}</Text>
                            {selected.description ? <Text selectable style={styles.photoMeta}>{selected.description}</Text> : null}
                          </View>
                          <Text selectable style={styles.skuPrice}>{formatVnd(selected.priceMinor)}</Text>
                        </View>
                        <View style={styles.pillRow}>
                          {selected.scene ? <Text selectable style={styles.scenePill}>{selected.scene}</Text> : null}
                          {selected.category ? <Text selectable style={styles.metaPill}>{selected.category}</Text> : null}
                          <Text selectable style={styles.metaPill}>{selected.available ? "在售" : "已下架"}</Text>
                        </View>
                        <View style={styles.linesEditActions}>
                          <Pressable onPress={() => startEditProduct(s.id, selected)} style={[styles.createBtn, styles.linesEditCancel]}>
                            <Text selectable style={styles.createBtnText}>编辑</Text>
                          </Pressable>
                          <Pressable onPress={() => void toggleProduct(s.id, selected)} style={styles.createBtn}>
                            <Text selectable style={styles.createBtnText}>{selected.available ? "下架" : "上架"}</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })()}

                  {/* Product editor remains contextual, never the default storefront. */}
                  {editingProductFor === s.id && editingProductId !== undefined ? (
                    <View style={styles.linesEditForm}>
                      <Text selectable style={styles.linesEditLabel}>名称</Text><TextInput value={editingProductName} onChangeText={setEditingProductName} placeholder="菜品或服务名称" placeholderTextColor={color.muted} style={styles.createInput} />
                      <Text selectable style={styles.linesEditLabel}>价格</Text><TextInput value={editingProductPrice} onChangeText={setEditingProductPrice} placeholder="价格" placeholderTextColor={color.muted} keyboardType="number-pad" style={styles.createInput} />
                      <Text selectable style={styles.linesEditLabel}>介绍</Text><TextInput value={editingProductDesc} onChangeText={setEditingProductDesc} placeholder="一句话介绍" placeholderTextColor={color.muted} style={styles.createInput} />
                      <Text selectable style={styles.linesEditLabel}>分类</Text><TextInput value={editingProductCategory} onChangeText={setEditingProductCategory} placeholder="例如 Trà sữa đậm vị" placeholderTextColor={color.muted} style={styles.createInput} />
                      <Text selectable style={styles.linesEditLabel}>适合场景</Text><TextInput value={editingProductScene} onChangeText={setEditingProductScene} placeholder="例如 阳光桌面 · 出片" placeholderTextColor={color.muted} style={styles.createInput} />
                      <Text selectable style={styles.linesEditLabel}>菜品照片</Text>
                      {editingProductPhoto && thumbUrlFor(editingProductPhoto) ? <Image source={{ uri: thumbUrlFor(editingProductPhoto) }} style={styles.productThumb} /> : null}
                      <Pressable onPress={() => void pickProductPhoto()} disabled={savingProduct} style={[styles.uploadButton, savingProduct ? styles.uploadButtonBusy : null]}>
                        <Text selectable style={styles.uploadButtonText}>{editingProductPhoto ? "换一张" : "+ 上传照片"}</Text>
                      </Pressable>
                      {/* MENU-HOT-001：HOT 开关。商家亲手标，不是从销量算的。 */}
                      <Pressable
                        accessibilityLabel={editingProductHot ? "取消 HOT" : "标为 HOT"}
                        onPress={() => setEditingProductHot((v) => !v)}
                        style={[styles.hotToggle, editingProductHot && styles.hotToggleOn]}
                      >
                        <Text selectable style={[styles.hotToggleText, editingProductHot && styles.hotToggleTextOn]}>
                          {editingProductHot ? "HOT · 点按取消" : "标为 HOT"}
                        </Text>
                      </Pressable>
                      {productError ? <Text selectable style={styles.errorText}>{productError}</Text> : null}
                      <View style={styles.linesEditActions}><Pressable onPress={() => { setEditingProductFor(undefined); setEditingProductId(undefined); }} style={[styles.createBtn, styles.linesEditCancel]}><Text selectable style={styles.createBtnText}>取消</Text></Pressable><Pressable disabled={savingProduct} onPress={() => void saveProduct(s.id)} style={styles.createBtn}><Text selectable style={styles.createBtnText}>{savingProduct ? "保存中…" : "保存"}</Text></Pressable></View>
                    </View>
                  ) : null}</View></> : null}

                  {/* Store details editor is contextual, never the default storefront. */}
                  {currentPage === "details" && editingLinesFor === s.id ? (
                    <View style={styles.linesEditForm}>
                      {/* 店铺照片只做预览：上传、分类统一在「照片与内容」页，logo 原样回存。 */}
                      <View style={styles.sectionPhoto}>
                      <View style={styles.photoPad}>
                      <Text selectable style={styles.formSectionTitle}>店铺照片</Text>
                      </View>
                      {(() => {
                        const cover = sPhotos.find((p) => p.mediaAssetId);
                        const coverUri = cover
                          ? thumbUrlFor(cover.mediaAssetId)
                          : merchantAvatarUri(sLines?.logoAssetPath || undefined, localApiBaseUrl);
                        return coverUri ? (
                          <Image source={{ uri: coverUri }} style={styles.storePhotoFlush} />
                        ) : (
                          <View style={styles.storePhotoEmptyFlush}><ProxyIcon color={color.muted} name="storefront" size={26} /></View>
                        );
                      })()}
                      <View style={styles.photoPad}>
                      <Text selectable style={styles.photoMeta}>店铺照片在「照片与内容」页统一上传、分类，换店徽也在那里（每张照片行上有「设为店徽」），这里只做预览。</Text>
                      </View>
                      </View>
                      <View style={styles.sectionCard}>
                      <Text selectable style={styles.formSectionTitle}>基本信息</Text>
                      <Text selectable style={styles.linesEditLabel}>店铺公告（一句话，顾客进店先看到） <Text selectable style={styles.counter}>{editingAnnouncement.length}/100</Text></Text>
                      <View style={styles.chipRow}>
                        {ANNOUNCE_TEMPLATES.map(([label, body], i) => (
                          <Pressable
                            key={label}
                            onPress={() => { setAnnounceTpl(i); setEditingAnnouncement(body); }}
                            style={[styles.chip, announceTpl === i && styles.chipOn]}
                          >
                            <Text selectable style={[styles.chipText, announceTpl === i && styles.chipTextOn]}>{label}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <TextInput
                        value={editingAnnouncement}
                        onChangeText={(text) => { setEditingAnnouncement(text.slice(0, 100)); setAnnounceTpl(undefined); }}
                        placeholder="例如 今日备货已售罄，明天请早"
                        placeholderTextColor={color.muted}
                        multiline
                        style={[styles.createInput, styles.linesEditTextarea]}
                      />
                      <Text selectable style={styles.linesEditLabel}>店铺简介</Text>
                      <TextInput
                        value={editingDescription}
                        onChangeText={setEditingDescription}
                        placeholder="一句话讲清这家店是做什么的"
                        placeholderTextColor={color.muted}
                        multiline
                        style={[styles.createInput, styles.linesEditTextarea]}
                      />
                      </View>
                      <View style={styles.sectionCard}>
                      <Text selectable style={styles.formSectionTitle}>联系方式与社媒</Text>
                      <Text selectable style={styles.linesEditLabel}>联系手机</Text>
                      <TextInput
                        value={editingContactPhone}
                        onChangeText={setEditingContactPhone}
                        placeholder="可选"
                        placeholderTextColor={color.muted}
                        keyboardType="phone-pad"
                        style={styles.createInput}
                      />
                      <Text selectable style={styles.linesEditLabel}>联系邮箱</Text>
                      <TextInput
                        value={editingContactEmail}
                        onChangeText={setEditingContactEmail}
                        placeholder="可选"
                        placeholderTextColor={color.muted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        style={styles.createInput}
                      />
                      <Text selectable style={styles.linesEditLabel}>Zalo（可选）</Text>
                      <TextInput
                        value={editingSocialZalo}
                        onChangeText={setEditingSocialZalo}
                        placeholder="zalo 号码或链接"
                        placeholderTextColor={color.muted}
                        autoCapitalize="none"
                        style={styles.createInput}
                      />
                      <Text selectable style={styles.linesEditLabel}>Facebook（可选）</Text>
                      <TextInput
                        value={editingSocialFacebook}
                        onChangeText={setEditingSocialFacebook}
                        placeholder="facebook 主页链接"
                        placeholderTextColor={color.muted}
                        autoCapitalize="none"
                        style={styles.createInput}
                      />
                      <Text selectable style={styles.linesEditLabel}>TikTok（可选）</Text>
                      <TextInput
                        value={editingSocialTiktok}
                        onChangeText={setEditingSocialTiktok}
                        placeholder="tiktok 主页链接"
                        placeholderTextColor={color.muted}
                        autoCapitalize="none"
                        style={styles.createInput}
                      />
                      </View>
                      <View style={styles.sectionCard}>
                      <Text selectable style={styles.formSectionTitle}>营业时间 · 默认 07:00–22:00 全周营业</Text>
                      {hoursDays.map((d, idx) => (
                        <View key={d.day} style={styles.dayRow}>
                          <Text selectable style={styles.dayLabel}>{d.day}</Text>
                          <View style={styles.timeInputs}>
                            <TextInput
                              value={d.open}
                              onChangeText={(v) => { setHoursDays((prev) => prev.map((x, i) => i === idx ? { ...x, open: v } : x)); setHoursTouched(true); }}
                              placeholder="--:--"
                              placeholderTextColor={color.muted}
                              style={[styles.timeInput, !d.enabled && styles.timeDisabled]}
                              editable={d.enabled}
                            />
                            <Text selectable style={styles.timeSep}>-</Text>
                            <TextInput
                              value={d.close}
                              onChangeText={(v) => { setHoursDays((prev) => prev.map((x, i) => i === idx ? { ...x, close: v } : x)); setHoursTouched(true); }}
                              placeholder="--:--"
                              placeholderTextColor={color.muted}
                              style={[styles.timeInput, !d.enabled && styles.timeDisabled]}
                              editable={d.enabled}
                            />
                            <Pressable
                              accessibilityLabel={`${d.day}${d.enabled ? "休息" : "营业"}`}
                              onPress={() => { setHoursDays((prev) => prev.map((x, i) => i === idx ? { ...x, enabled: !x.enabled } : x)); setHoursTouched(true); }}
                              style={[styles.toggle, d.enabled && styles.toggleOn]}
                            >
                              <View style={[styles.knob, d.enabled && styles.knobOn]} />
                            </Pressable>
                          </View>
                        </View>
                      ))}
                      </View>
                      {linesError ? <Text selectable style={styles.errorText}>{linesError}</Text> : null}
                      <View style={styles.linesEditActions}>
                        <Pressable
                          disabled={savingLinesFor === s.id}
                          onPress={() => {
                            setEditingLinesFor(undefined);
                            setLinesError(undefined);
                          }}
                          style={styles.cancelBtn}
                        >
                          <Text selectable style={styles.cancelBtnText}>取消</Text>
                        </Pressable>
                        <Pressable
                          disabled={savingLinesFor === s.id}
                          onPress={() => void saveLines(s.id)}
                          style={[styles.saveBtn, savingLinesFor === s.id && styles.saveBtnBusy]}
                        >
                          <Text selectable style={styles.saveBtnText}>
                            {savingLinesFor === s.id ? "保存中…" : "保存修改"}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : currentPage === "details" ? (<>
                    <Text selectable style={styles.buildStamp}>build 1011-sharescope</Text>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={12}
                      onPress={() => startEditLines(s.id, sLines)}
                      style={styles.linesEditToggle}
                    >
                      <Text selectable style={styles.linesEditToggleText}>
                        {sLines ? "编辑主页 / 联系方式 / 营业时间" : "填写主页 / 联系方式 / 营业时间"}
                      </Text>
                    </Pressable>
                  </>
                  ) : null}

                  {currentPage === "photos" ?
                  <View style={styles.managerPanel}><View style={styles.photoHead}>
                    <Text selectable style={styles.photoHeadTitle}>照片与视频</Text>
                    <Text selectable style={styles.photoHeadMeta}>环境 · 菜品 · 活动 · {sPhotos.length} 张</Text>
                  </View>
                  <View style={styles.chipRow}>
                    {(["environment", "menu"] as const).map((c) => {
                      const active = (photoCatByStore[s.id] ?? "environment") === c;
                      return (
                        <Pressable
                          key={c}
                          onPress={() => setPhotoCatByStore((prev) => ({ ...prev, [s.id]: c }))}
                          style={[styles.chip, active && styles.chipOn]}
                        >
                          <Text selectable style={[styles.chipText, active && styles.chipTextOn]}>
                            {c === "environment" ? "店铺环境" : "菜单菜品"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable
                    onPress={() => pickAndUploadPhoto(s.id, photoCatByStore[s.id] ?? "environment")}
                    disabled={uploadingStoreId === s.id}
                    style={[styles.uploadButton, uploadingStoreId === s.id ? styles.uploadButtonBusy : null]}
                  >
                    <Text selectable style={styles.uploadButtonText}>
                      {uploadingStoreId === s.id ? "上传中…" : "+ 上传照片"}
                    </Text>
                  </Pressable>
                  {sPhotos.length === 0 ? (
                    <Text selectable style={styles.empty}>暂无照片 — 点上面按钮上传第一张</Text>
                  ) : null}
                  {sPhotos.map((p) => (
                    <View key={p.id} style={styles.photoRow}>
                      {thumbUrlFor(p.mediaAssetId) ? <Image source={{ uri: thumbUrlFor(p.mediaAssetId) }} style={styles.photoThumb} /> : storePhotoUri(p.assetPath) ? <Image source={{ uri: storePhotoUri(p.assetPath) }} style={styles.photoThumb} /> : <View style={styles.photoPlaceholder}><ProxyIcon color={color.muted} name="image" size={20} /></View>}
                      <View style={styles.photoRowMain}>
                        <Text selectable style={styles.productName} numberOfLines={1}>{p.caption || "店铺照片"}</Text>
                        <Text selectable style={styles.photoMeta}>
                          {p.category === "menu" ? "菜品" : "环境"} · {new Date(p.createdAt).toLocaleDateString()}
                        </Text>
                      </View>
                      {p.mediaAssetId && sLines?.logoAssetPath === `assets/${p.mediaAssetId}` ? (
                        <Text selectable style={styles.logoCurrentTag}>当前店徽</Text>
                      ) : p.mediaAssetId ? (
                        <Pressable
                          accessibilityLabel="设为店徽"
                          disabled={savingLogoFor === s.id}
                          onPress={() => void setStoreLogoFromPhoto(s.id, p)}
                          style={styles.logoPickButton}
                        >
                          <Text selectable style={styles.logoPickButtonText}>
                            {savingLogoFor === s.id ? "设置中…" : "设为店徽"}
                          </Text>
                        </Pressable>
                      ) : null}
                      {viewerAccountId && viewerAccountId === p.uploadedBy ? (
                        <Pressable onPress={() => deletePhoto(s.id, p.id)} style={styles.deleteButton}>
                          <Text selectable style={styles.deleteButtonText}>删除</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}</View> : null}

                  {currentPage === "root" ? <><View style={styles.managerPanel}><View style={styles.photoHead}>
                    <Text selectable style={styles.photoHeadTitle}>活动 / Offer</Text>
                    <Text selectable style={styles.photoHeadMeta}>{showcaseActivities?.length ?? 0} 个关联活动</Text>
                  </View>
                  {!showcaseActivities || showcaseActivities.length === 0 ? (
                    <Text selectable style={styles.empty}>暂无关联活动 — 在活动页创建后会自动出现在这里</Text>
                  ) : showcaseActivities.map((a) => (
                    <View key={a.id} style={styles.photoRow}>
                      <View style={styles.photoRowMain}>
                        <Text selectable style={styles.photoAssetPath} numberOfLines={1}>{a.title}</Text>
                      </View>
                    </View>
                  ))}</View>
                  <View style={styles.managerPanel}><View style={styles.photoHead}><Text selectable style={styles.photoHeadTitle}>Creator 权益</Text><Text selectable style={styles.photoHeadMeta}>联营与内容合作</Text></View><Text selectable style={styles.empty}>设置 Creator 到店体验、内容合作与专属权益；对外的展示页还没做，配好之后暂时只有你自己看得到。</Text></View></> : null}
                  {scope && currentPage === "details" ? (
                    <View style={styles.heroActions}><Pressable onPress={() => void openSharePicker(s.id)} style={styles.shareButton} accessibilityLabel="发给站内好友"><Text selectable style={styles.shareButtonText}>发给站内好友</Text></Pressable><Pressable onPress={() => void Share.share({ message: `${s.name} · 在 Proxy 里搜这家店就能找到。` })} style={styles.previewButton} accessibilityLabel="分享到站外"><Text selectable style={styles.previewButtonText}>分享到站外</Text></Pressable></View>
                  ) : null}
                  {scope && shareFor === s.id ? renderSharePanel() : null}
                  {currentPage === "details" ? <View style={editingLinesFor === s.id ? [styles.managerPanel, styles.managerPanelFlat] : styles.managerPanel}><View style={styles.photoHead}><Text selectable style={styles.photoHeadTitle}>营业资料</Text><Text selectable style={styles.photoHeadMeta}>公开展示</Text></View>{sLines ? <View style={styles.linesBlock}>{sLines.announcement ? <Text selectable style={styles.linesAnnouncement}>📢 {sLines.announcement}</Text> : null}<Text selectable style={styles.linesDescription}>{sLines.description || "店铺简介待完善"}</Text><Text selectable style={styles.linesContact}>{[sLines.contactPhone, sLines.contactEmail].filter(Boolean).join(" · ") || "联系方式待完善"}</Text><Text selectable style={styles.linesHours}>{Object.entries(linesAsHoursObject(sLines.hoursJson)).map(([k, v]) => k === "营业时间" ? v : `${k} ${v}`).join(" · ") || "营业时间待完善"}</Text></View> : <Text selectable style={styles.empty}>店铺简介、联系方式和营业时间待完善</Text>}</View> : null}
                  {scope ? null : <View style={styles.scopeNote}><Text selectable style={styles.scopeNoteText}>线上店铺只负责对外展示。订单、客户、退款和经营分析分别进入对应经营模块，不在这里重复做后台。</Text></View>}
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
    <QrZoomOverlay
      actions={
        zoomedStore
          ? [
              { label: "复制店名", onPress: () => void copyStoreName(zoomedStore.id, zoomedStore.name) },
              { label: "保存到相册", onPress: () => void saveZoomedStoreQr(), primary: true },
            ]
          : []
      }
      caption={zoomedStore?.name ?? ""}
      hint="把屏幕朝向顾客即可扫描；扫出来是一张标准 vCard 名片，存进通讯录即可。"
      // 反馈只属于「这张码」：列表里存了 A 店、放大层开着 B 店时，不能把 A 的结果挂到 B 上。
      notice={storeQrNotice && zoomedStore && storeQrNotice.storeId === zoomedStore.id ? storeQrNotice.text : undefined}
      onClose={() => setZoomedStore(undefined)}
      shotRef={storeZoomShotRef}
      title={zoomedStore ? `${zoomedStore.name} · 店铺二维码` : "店铺二维码"}
      value={zoomedStore ? buildContactCard({ name: zoomedStore.name, storeId: zoomedStore.id }) ?? zoomedStore.name : ""}
      visible={zoomedStore !== undefined}
    />
    </>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  container: { gap: 10, padding: 16, paddingBottom: 24 },
  title: { color: color.ink, fontSize: 18, fontWeight: "900" },
  sub: { color: color.muted, fontSize: 12 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 14, ...shadows.card },
  accountCard: { gap: 12 },
  accountHead: { gap: 2 },
  accountName: { color: color.ink, fontSize: 16, fontWeight: "900" },
  accountMeta: { color: color.muted, fontSize: 11 },
  storeCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, padding: 14, gap: 8, ...shadows.card },
  // 编辑资料态：整栏顶到屏幕边，左右零留白。
  storeCardPlain: { gap: 12, marginHorizontal: -16 },
  summary: { backgroundColor: color.deep, borderRadius: 24, padding: 15 },
  summaryTitle: { color: color.white, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  summaryMeta: { color: "#D7D0DD", fontSize: 12, lineHeight: 17, marginTop: 4 },
  summaryStats: { flexDirection: "row", gap: 8, marginTop: 12 },
  summaryStat: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.12)", borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 9 },
  summaryValue: { color: color.white, fontSize: 15, fontWeight: "900" },
  summaryLabel: { color: "#D8D1DD", fontSize: 11, fontWeight: "600", marginTop: 3 },
  blockTitle: { color: color.ink, fontSize: 17, fontWeight: "800", marginTop: 4 },
  blockTitleInside: { color: color.ink, fontSize: 15, fontWeight: "800", marginBottom: 2 },
  funnel: { flexDirection: "row", gap: 8 },
  funnelItem: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flex: 1, paddingHorizontal: 3, paddingVertical: 10 },
  funnelValue: { color: color.ink, fontSize: 13, fontWeight: "900" },
  funnelLabel: { color: color.muted, fontSize: 11, fontWeight: "600", marginTop: 3 },
  sourceBox: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, padding: 14 },
  storeHead: { gap: 2 },
  storeName: { color: color.ink, fontSize: 14, fontWeight: "800" },
  storeMeta: { color: color.muted, fontSize: 11 },
  linesBlock: { gap: 2, paddingVertical: 4 },
  linesDescription: { color: color.ink, fontSize: 12 },
  linesAnnouncement: { color: color.ink, fontSize: 13, fontWeight: "800" },
  linesContact: { color: color.muted, fontSize: 11 },
  linesHours: { color: color.muted, fontSize: 11 },
  managerPanel: { backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 16, borderWidth: 1, gap: 8, marginTop: 4, padding: 12 },
  managerPanelFlat: { borderLeftWidth: 0, borderRadius: 0, borderRightWidth: 0 },
  assetSection: { gap: 0, marginTop: 8 },
  assetSectionTitle: { color: color.ink, fontSize: 18, fontWeight: "900", paddingHorizontal: 4, paddingVertical: 12 },
  assetRow: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 12, minHeight: 82, paddingHorizontal: 4, paddingVertical: 12 },
  assetIcon: { alignItems: "center", backgroundColor: color.offWhite, borderRadius: 22, height: 58, justifyContent: "center", width: 58 },
  assetIconText: { color: color.ink, fontSize: 18, fontWeight: "900" },
  assetTitle: { color: color.ink, fontSize: 16, fontWeight: "900" },
  assetMeta: { color: color.muted, fontSize: 12, marginTop: 4 },
  assetChevron: { color: color.ink, fontSize: 25, fontWeight: "700" },
  assetBack: { alignSelf: "flex-start", paddingHorizontal: 2, paddingVertical: 10 },
  metricStrip: { backgroundColor: color.offWhite, borderRadius: 16, flexDirection: "row", gap: 4, padding: 8 },
  metricItem: { alignItems: "center", flex: 1, minWidth: 0, paddingVertical: 5 },
  metricValue: { color: color.ink, fontSize: 13, fontWeight: "900" },
  metricLabel: { color: color.muted, fontSize: 11, marginTop: 3 },
  // R18.x LINES-EDITOR-001
  // 构建指纹戳（调包新旧一眼定，稳定后删掉）。
  buildStamp: { color: "#B8B0AA", fontSize: 11, marginBottom: 2 },
  linesEditToggle: { paddingVertical: 6 },
  linesEditToggleText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  linesEditForm: { gap: 14 },
  // 编辑资料按原型分段：整栏色带，不再有圆角边框和侧边距。
  sectionCard: { backgroundColor: color.white, gap: 6, padding: 14 },
  sectionPhoto: { backgroundColor: color.white, paddingBottom: 14 },
  photoPad: { paddingHorizontal: 14 },
  formSectionTitle: { color: color.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.5, marginBottom: 4 },
  counter: { color: color.muted, fontSize: 11, fontWeight: "400" },
  storePhotoPreview: { borderRadius: 12, height: 180, width: "100%" },
  storePhotoFlush: { height: 200, width: "100%" },
  storePhotoEmptyFlush: { alignItems: "center", backgroundColor: color.surface, height: 200, justifyContent: "center", width: "100%" },
  storePhotoEmpty: { alignItems: "center", backgroundColor: color.surface, borderRadius: 12, height: 180, justifyContent: "center", width: "100%" },
  // STORE-LOGO-001：店徽预览 72px 方图。
  logoPreview: { backgroundColor: color.surface, borderRadius: 14, height: 72, width: 72 },
  logoEmpty: { alignItems: "center", backgroundColor: color.surface, borderRadius: 14, height: 72, justifyContent: "center", width: 72 },
  linesEditLabel: { color: color.muted, fontSize: 11, fontWeight: "800", marginTop: 4 },
  linesEditTextarea: { minHeight: 60, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  chipTextOn: { color: color.white },
  dayRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  dayLabel: { color: color.ink, fontSize: 12, fontWeight: "800", width: 44 },
  timeInputs: { alignItems: "center", flexDirection: "row", gap: 6 },
  timeInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 8, borderWidth: 1, color: color.ink, fontSize: 12, paddingHorizontal: 8, paddingVertical: 6, width: 64 },
  timeDisabled: { opacity: 0.4 },
  timeSep: { color: color.muted, fontSize: 12 },
  toggle: { alignItems: "flex-start", backgroundColor: color.line, borderRadius: 999, height: 24, justifyContent: "center", paddingHorizontal: 3, width: 44 },
  toggleOn: { alignItems: "flex-end", backgroundColor: "#22C55E" },
  knob: { backgroundColor: color.white, borderRadius: 999, height: 18, width: 18 },
  knobOn: { backgroundColor: color.white },
  linesEditActions: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 10, paddingHorizontal: 16 },
  saveBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 25, flex: 1, height: 50, justifyContent: "center" },
  saveBtnBusy: { opacity: 0.6 },
  saveBtnText: { color: color.white, fontSize: 16, fontWeight: "600" },
  cancelBtn: { alignItems: "center", height: 50, justifyContent: "center", paddingHorizontal: 14 },
  cancelBtnText: { color: color.muted, fontSize: 15, fontWeight: "600" },
  linesEditCancel: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1 },
  photoHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  photoHeadTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  photoHeadMeta: { color: color.muted, fontSize: 11 },
  uploadButton: { alignSelf: "flex-start", backgroundColor: color.lime, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  // MENU-HOT-001：HOT 开关（关=灰框，开=红橙底白字，照原型）。
  hotToggle: { alignItems: "center", borderColor: color.line, borderRadius: 999, borderWidth: 1, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8 },
  hotToggleOn: { backgroundColor: "#FF3B30", borderColor: "#FF3B30" },
  hotToggleText: { color: "#6D666C", fontSize: 11, fontWeight: "800" },
  hotToggleTextOn: { color: color.white },
  // MENU-HOT-001：行内 HOT 徽占位。
  rowHot: { justifyContent: "center" },
  uploadButtonBusy: { opacity: 0.5 },
  uploadButtonText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: color.white, borderColor: color.line, borderRadius: 8, borderWidth: 1, padding: 8 },
  photoThumb: { backgroundColor: color.line, borderRadius: 9, height: 54, width: 54 },
  photoPlaceholder: { alignItems: "center", backgroundColor: color.line, borderRadius: 9, height: 54, justifyContent: "center", width: 54 },
  productThumb: { alignItems: "center", backgroundColor: color.lime, borderRadius: 9, height: 44, justifyContent: "center", width: 44 },
  productName: { color: color.ink, fontSize: 13, fontWeight: "800" },
  // R25 对齐：值得先看 SKU 横滑卡 + 结构化目录 + SKU 详情。
  worthRow: { gap: 10, paddingRight: 12, paddingVertical: 4 },
  worthCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, gap: 4, padding: 8, width: 148 },
  worthImage: { borderRadius: 10, height: 112, width: "100%" },
  worthImageMissing: { alignItems: "center", backgroundColor: color.offWhite, borderRadius: 10, height: 112, justifyContent: "center", width: "100%" },
  worthNameRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  worthName: { color: color.ink, flexShrink: 1, fontSize: 13, fontWeight: "800" },
  priceRed: { color: "#a9231f", fontSize: 13, fontWeight: "900" },
  scenePill: { alignSelf: "flex-start", backgroundColor: "#FFF0F6", borderRadius: 999, color: "#7A0033", fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3 },
  metaPill: { alignSelf: "flex-start", backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 999, borderWidth: 1, color: color.muted, fontSize: 11, fontWeight: "700", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3 },
  catalogHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  catalogTitle: { color: color.ink, fontSize: 14, fontWeight: "800", marginTop: 8 },
  catalogCat: { color: color.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1, marginTop: 8 },
  menuLine: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 8, paddingVertical: 9 },
  skuHero: { borderRadius: 12, height: 200, marginTop: 4, width: "100%" },
  skuPrice: { color: "#a9231f", fontSize: 16, fontWeight: "900" },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  rowAction: { paddingHorizontal: 5, paddingVertical: 7 },
  rowActionText: { color: color.violet, fontSize: 11, fontWeight: "800" },
  photoRowMain: { flex: 1, gap: 2 },
  photoAssetPath: { color: color.ink, fontSize: 11, fontWeight: "600" },
  photoMeta: { color: color.muted, fontSize: 11 },
  deleteButton: { backgroundColor: "#fde7e7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  deleteButtonText: { color: "#a32020", fontSize: 11, fontWeight: "800" },
  // STORE-LOGO-001：相册行上「设为店徽」。和删除同尺寸，避免两个动作抢视觉。
  logoPickButton: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  logoPickButtonText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  logoCurrentTag: { color: color.muted, fontSize: 11, fontWeight: "800" },
  sectionTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  memberRow: { flexDirection: "row", justifyContent: "space-between" },
  memberName: { color: color.ink, fontSize: 12, fontWeight: "700" },
  memberMeta: { color: color.muted, fontSize: 11 },
  spendBlock: { gap: 6, paddingTop: 6, borderTopColor: color.line, borderTopWidth: 1 },
  spendRow: { flexDirection: "row", gap: 16 },
  spendItem: { gap: 2 },
  spendValue: { color: color.ink, fontSize: 16, fontWeight: "900" },
  spendLabel: { color: color.muted, fontSize: 11 },
  empty: { color: color.muted, fontSize: 12, paddingVertical: 4 },
  errorText: { color: "#a32020", fontSize: 12 },
  creationSheet: { borderTopColor: color.line, borderTopWidth: 1, marginTop: 12, paddingTop: 4 },
  storeHero: { alignItems: "center", flexDirection: "row", gap: 11 },
  storeLogo: { alignItems: "center", backgroundColor: color.ink, borderRadius: 18, height: 58, justifyContent: "center", width: 58 },
  storeLogoText: { color: color.white, fontSize: 22, fontWeight: "900" },
  storeCover: { borderRadius: 18, height: 58, width: 58 },
  storeHeroCopy: { flex: 1, minWidth: 0 },
  heroActions: { flexDirection: "row", gap: 8 },
  // STORE-SHARE-001：站内分享选人面板，复用资产行样式，会话即好友。
  sharePanel: { backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 14, borderWidth: 1, gap: 4, marginTop: 8, padding: 10 },
  previewButton: { alignItems: "center", backgroundColor: color.ink, borderRadius: 13, flex: 1, paddingVertical: 11 },
  previewButtonText: { color: color.white, fontSize: 12, fontWeight: "800" },
  shareButton: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 13, borderWidth: 1, flex: 1, paddingVertical: 11 },
  shareButtonText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  qrCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, padding: 12 },
  // STORE-QR-001：真二维码 + 复制/存图动作（原来是 58×58 的 qrGrid 图标）。
  qrShot: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, padding: 8 },
  qrActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  storeQrNotice: { color: color.muted, fontSize: 11, marginTop: 6 },
  createInput: { backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 10, borderWidth: 1, color: color.ink, fontSize: 14, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10 },
  createBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 999, marginTop: 10, paddingVertical: 12 },
  createBtnBusy: { opacity: 0.6 },
  createBtnText: { color: color.white, fontSize: 13, fontWeight: "800" },
  scopeNote: { backgroundColor: "#F7F4F8", borderRadius: 13, marginTop: 8, padding: 11 },
  scopeNoteText: { color: color.muted, fontSize: 11, lineHeight: 17 },
});
