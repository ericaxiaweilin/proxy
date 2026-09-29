import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { Activity } from "@proxy/contracts";
import { ActivityClient, ActivityCommandRejectedError } from "../activity-client";
import type { BusinessClient } from "../business-client";
import { loadStoreOptions, type StoreOption } from "../my-store-options";
import type { FulfillmentClient, FulfillmentOrder, SlotOffer } from "../fulfillment-client";
import type { MediaClient } from "../media-client";
import type { ModerationClient } from "../moderation-client";
import { ReportSheet } from "../components/report-sheet";
import { nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import { nativeSecureStorageDriver } from "../native-secure-storage";
import { color } from "../theme";
import { ActivityDetailSurface } from "./activity-detail";
import { activityAIPersonaName } from "./activity-detail-model";
import { styles } from "./me-styles";
import * as Clipboard from "expo-clipboard";
import type { ActivityJoinOrder } from "@proxy/contracts";
import { activityOrderFields, formatJoinedAt, joinStateLabel, orderSnapshotFor, sortJoinedByOrderTime } from "../my-activity-orders";
import { ActivityOrderTicket, peopleCountLabel } from "../components/activity-order-ticket";
import { ProxyBackGlyph, ProxyEmptyState, ProxyLoading } from "../components/proxy-foundation";
import { createSceneFavoritesStore, resolveSavedSceneIds, type SavedSceneEntry } from "../scene-favorites";
import { savedSceneLookup } from "../components/scene-activity-discovery";
import { fetchProviderStats, formatRate, permissionLine, type ProviderStatsView } from "../provider-application-client";

type OrderFilter = "all" | "published" | "joined" | "done" | "cancelled";

function orderStatus(order: FulfillmentOrder): string { return ({ OFFERED: "待确认", CONFIRMED: "已确认", EXECUTING: "进行中", COMPLETED: "已完成", CANCELLED: "已取消" } as const)[order.lifecycle]; }
function orderMoney(order: FulfillmentOrder): string { return `${order.snapshot.agreedCompensation.toLocaleString()} ${order.snapshot.currency || "VND"}`; }
// OFFER-ACCEPT-001：Offer 里只有裸 id（requesterId / taskId），服务端没有
// 带 name/title。截短展示比塞一个查不到的假名诚实。
function shortId(id: string): string { return id.length > 12 ? `${id.slice(0, 12)}…` : id; }
// R18.x CANCEL-001: only OFFERED / CONFIRMED / EXECUTING
// can be cancelled by either party. COMPLETED is terminal
// (the cooperation already happened); CANCELLED is itself
// terminal. UI mirrors the server-side check.
function canCancel(order: FulfillmentOrder): boolean {
  return order.lifecycle === "OFFERED" || order.lifecycle === "CONFIRMED" || order.lifecycle === "EXECUTING";
}

// ORDER-CENTER-STATS-001（原型 33987c「接单中心」；用户：「我的订单模块不是有吗 在那里做」）：
// 我的订单顶部的接单面板 —— 接单权限状态 + 真实履约记录（已接单 / 按约完成率 / 准时率 / 复邀客户 / 投诉）。
// 数字全部来自真实订单与举报；分母为 0 的比率显示「—」。读失败就不画，不影响订单列表。
function ProviderOrderPanel({ onOpenApply }: { onOpenApply?: (() => void) | undefined }): React.JSX.Element | null {
  const [view, setView] = useState<ProviderStatsView>();
  useEffect(() => {
    let active = true;
    fetchProviderStats(sessionAuthClient).then((v) => { if (active) setView(v); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!view) return null;
  const line = permissionLine(view.permission);
  const cells: Array<[string, string]> = [
    ["已接单", String(view.stats.completed)],
    ["按约完成率", formatRate(view.stats.completionRate)],
    ["准时率", formatRate(view.stats.onTimeRate)],
    ["复邀客户", String(view.stats.repeatClients)],
    ["投诉记录", view.stats.openComplaints > 0 ? `${view.stats.complaints}（${view.stats.openComplaints} 处理中）` : String(view.stats.complaints)],
  ];
  return (
    <View style={styles.orderCard}>
      <View style={styles.orderHead}>
        <View style={styles.orderCopy}>
          <Text selectable style={styles.orderTitle}>接单</Text>
          <Text selectable style={styles.orderId}>{line.text}</Text>
        </View>
        {line.canApply && onOpenApply ? (
          <Pressable accessibilityLabel={view.permission === "SUBMITTED" ? "查看KYC认证进度" : "去KYC认证"} onPress={onOpenApply} style={styles.orderTab}>
            <Text selectable style={styles.orderTabText}>{view.permission === "SUBMITTED" ? "查看进度" : "去认证"}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.orderGrid}>
        {cells.map(([label, value]) => (
          <View key={label} style={styles.orderField}>
            <Text selectable style={styles.orderFieldLabel}>{label}</Text>
            <Text selectable style={styles.orderFieldValue}>{value}</Text>
          </View>
        ))}
      </View>
      <Text selectable style={[styles.orderFieldLabel, { marginTop: 10 }]}>按约完成率只算你自己取消的单；客户取消不算你违约。投诉记录不含已驳回的。</Text>
    </View>
  );
}

export function MyOrdersSurface({ client, moderation, mediaClient, business, onBack, onOpenApply }: {
  client: FulfillmentClient;
  // COMP-REPORT-002: 举报这笔交易。钱与线下见面都在这一层 —— 诈骗、
  // 招嫖揽客、人身威胁的暴露面正是订单，不是帖子。
  moderation: ModerationClient;
  // ORDER-EXEC-001: 提交证据要传照片，没有 mediaClient 就不画证据入口，
  // 不摆拍不了照的假按钮。
  mediaClient?: MediaClient | undefined;
  // STORE-STATS-001：完成订单时把这一单归到自己的哪家店。没有 business
  // 就不画归因选择器（不摆一个选不了的假控件）。
  business?: BusinessClient | undefined;
  onBack: () => void;
  // ORDER-CENTER-STATS-001：接单面板「去申请 / 查看进度」→ 接单权限申请页。
  onOpenApply?: (() => void) | undefined;
}): React.JSX.Element {
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [detail, setDetail] = useState<FulfillmentOrder>();
  const [cancellingId, setCancellingId] = useState<string | undefined>(undefined);
  const [cancelError, setCancelError] = useState<string | undefined>(undefined);
  const [reporting, setReporting] = useState<string | undefined>(undefined);
  const [reportNotice, setReportNotice] = useState<string | undefined>(undefined);
  // OFFER-ACCEPT-001（P0，用户「我的-我的订单 没有任何订单记录」2026-09-29）：
  // 订单只在 agent 接 Offer（AcceptSlotOffer）时生成 —— market.tsx 的「发 Offer」
  // 是链路上游，但这之前 App 里**没有任何地方能接 Offer**：acceptSlotOffer /
  // listAgentOffers / getOffer 三个客户端方法零调用方。发出去的 Offer 5 分钟
  // 过期、永远没人接得了 ⇒ 订单永远不生成 ⇒ 我的订单永远空。这里补上 agent
  // 侧的收件箱：只列还活着的 OFFERED，接单成功订单立刻出现在下面的列表里。
  // 读失败不挡订单列表（offer 面板是增值信息，不是这块页面的主数据）。
  const [pendingOffers, setPendingOffers] = useState<SlotOffer[]>([]);
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | undefined>(undefined);
  const [offerNotice, setOfferNotice] = useState<string | undefined>(undefined);
  // HOME-MYORDERS-JOINS-001（用户「我的订单还是空白」2026-09-29）：For You 下单
  // 走 JoinActivity —— 是活动报名，不落履约订单（join is join 的钉早已定死两条链）。
  // 但下单成功页发了编号，我的订单却看不到这笔记录，用户的预期是断的。这里把
  // 报名记录（ListMyActivities.joined，与「我的活动→已参加」同源）接进来，单独
  // 一个「活动报名」区块摆在履约订单上面，编号标「活动编号」跟履约订单区分开。
  // 读失败单独说一句（「取不出来」和「确实没有」分开），不挡下面的订单主列表。
  const [activityClient] = useState(() => new ActivityClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore }));
  const [joinedActs, setJoinedActs] = useState<Activity[]>([]);
  // MY-ORDERS-DETAIL-001：每笔报名自己的订单信息（编号 / 下单时间 / 状态）。
  const [joinOrders, setJoinOrders] = useState<ReadonlyMap<string, ActivityJoinOrder>>(new Map());
  const [copiedOrderNo, setCopiedOrderNo] = useState<string | undefined>(undefined);
  // ORDER-RECIPE-001：点一笔报名打开它的票（跟下单成功页同一个组件、同一份快照）。
  const [ticketActivityId, setTicketActivityId] = useState<string | undefined>(undefined);
  const [joinsFailed, setJoinsFailed] = useState(false);
  const [activityDetailId, setActivityDetailId] = useState<string | undefined>(undefined);
  const reload = useCallback(() => {
    let active = true;
    setPhase("LOADING");
    void client.listMyOrders().then((rows) => { if (active) { setOrders(rows); setPhase("READY"); } }).catch(() => { if (active) setPhase("ERROR"); });
    void client.listAgentOffers().then((rows) => { if (active) setPendingOffers(rows.filter((offer) => offer.status === "OFFERED")); }).catch(() => { if (active) setPendingOffers([]); });
    void activityClient.listMyActivities().then((payload) => {
      if (!active) return;
      const byActivity = new Map(payload.joinOrders.map((order) => [order.activityId, order] as const));
      setJoinOrders(byActivity);
      setJoinedActs(sortJoinedByOrderTime(payload.joined, byActivity));
      setJoinsFailed(false);
    }).catch(() => { if (active) setJoinsFailed(true); });
    return () => { active = false; };
  }, [client, activityClient]);
  useEffect(() => { const cleanup = reload(); return cleanup; }, [reload]);
  async function acceptOffer(offer: SlotOffer): Promise<void> {
    if (acceptingOfferId) return;
    setAcceptingOfferId(offer.offerId);
    setOfferNotice(undefined);
    try {
      await client.acceptSlotOffer(offer.offerId);
      setOfferNotice("已接单，订单已生成。");
      reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setOfferNotice(/OFFER_EXPIRED/i.test(message) ? "这份邀请已过期，请让对方重新发送。" : /OFFER_NOT_AVAILABLE/i.test(message) ? "这份邀请已被处理。" : /NOT_OWNED|AUTHORIZATION/i.test(message) ? "这份邀请不是发给当前账号的。" : "接单没有成功，请稍后重试。");
    } finally {
      setAcceptingOfferId(undefined);
    }
  }
  const visible = orders.filter((order) => filter === "all" || filter === "published" && order.viewerRole === "REQUESTER" || filter === "joined" && order.viewerRole === "AGENT" || filter === "done" && order.lifecycle === "COMPLETED" || filter === "cancelled" && order.lifecycle === "CANCELLED");
  const fields = (order: FulfillmentOrder): Array<[string,string]> => [["服务", order.snapshot.serviceSku || order.needId], ["金额", orderMoney(order)], ["时间", order.snapshot.startTime || "待确认"], ["地点", order.snapshot.meetingContext || "待确认"], ["时长", order.snapshot.duration || "待确认"], ["结算", order.snapshot.settlementMode || "待确认"]];

  // R18.x CANCEL-001: confirmation prompt + non-fatal
  // server error surfacing. The cancel command mutates the
  // order lifecycle to CANCELLED on the server; the local
  // row is updated optimistically after the server
  // confirms so a re-render immediately moves the row
  // into the '已取消' tab.
  async function confirmAndCancel(order: FulfillmentOrder): Promise<void> {
    setCancelError(undefined);
    const confirm = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "取消订单？",
        `${order.snapshot.serviceSku || "Proxy 订单"} · 订单编号 ${order.orderId}\n\n取消后不可恢复，双方结算状态以实际协商为准。`,
        [
          { text: "再想想", style: "cancel", onPress: () => resolve(false) },
          { text: "确认取消", style: "destructive", onPress: () => resolve(true) },
        ],
      );
    });
    if (!confirm) return;
    setCancellingId(order.orderId);
    try {
      await client.cancelOrder(order.orderId, "user-cancelled");
      // Optimistic local update: reflect the new lifecycle
      // without a full re-list. The next reload() will
      // reconcile any drift.
      setOrders((prev) => prev.map((o) => o.orderId === order.orderId ? { ...o, lifecycle: "CANCELLED" } : o));
      if (detail?.orderId === order.orderId) {
        setDetail({ ...detail, lifecycle: "CANCELLED" });
      }
    } catch (error) {
      // 服务端拒绝码不直接展示；会话类问题提示重登，其他归网络重试。
      const msg = error instanceof Error ? error.message : "";
      if (/principal|session|signed|sign in|re-authenticate|AUTH|auth/i.test(msg)) {
        setCancelError("登录已过期，请重新登录后再取消。");
      } else {
        setCancelError("取消失败，请检查连接后重试。");
      }
    } finally {
      setCancellingId(undefined);
    }
  }

  // ORDER-EXEC-001: 订单详情以前只有"返回列表" —— OFFERED 卡死，EXECUTING 走不到
  // COMPLETED，COMPLETED 评不了分。下面按 lifecycle 逐态出按钮，全部走真命令，
  // 成功后重拉列表并同步明细；服务端拒绝码翻译成人话，不直接展示。
  const [acting, setActing] = useState<string | undefined>(undefined);
  const [actError, setActError] = useState<string | undefined>(undefined);
  const [checkinMarket, setCheckinMarket] = useState("");
  const [checkinPlace, setCheckinPlace] = useState("");
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [outcomeOnTime, setOutcomeOnTime] = useState(true);
  const [outcomeScope, setOutcomeScope] = useState(true);
  const [outcomeNote, setOutcomeNote] = useState("");
  const [outcomePhoto, setOutcomePhoto] = useState<{ uri: string; mimeType: string; width: number; height: number } | undefined>(undefined);
  // STORE-STATS-001 归因：履约方完成订单时指认「这笔单在我哪家店完成」。
  // 取法和「我的店铺」同一套（ACTIVE 企业、逐个账号读失败不中断，见 my-store-options.ts）。
  // 读失败要单独记 —— 「列表读不出来」和「你确实没有店」不是一回事，前者得说一句，
  // 不能静默装成没有。
  const [myStores, setMyStores] = useState<StoreOption[]>([]);
  const [storesFailed, setStoresFailed] = useState(false);
  const [outcomeStoreId, setOutcomeStoreId] = useState("");
  useEffect(() => {
    if (!business) return;
    let active = true;
    void loadStoreOptions(business).then((result) => {
      if (active) { setMyStores(result.rows); setStoresFailed(result.failed); }
    });
    return () => { active = false; };
  }, [business]);
  const [satisfactionResolved, setSatisfactionResolved] = useState<"FULL" | "PARTIAL" | "NONE">("FULL");
  const [satisfactionRepeat, setSatisfactionRepeat] = useState<"" | "REUSE" | "MAYBE" | "NO">("");
  const [settleAmount, setSettleAmount] = useState("");
  const [settleMethod, setSettleMethod] = useState("");
  const [settlePayer, setSettlePayer] = useState(false);
  const [settlePayee, setSettlePayee] = useState(false);

  function humanOrderError(error: unknown, fallback: string): string {
    const msg = error instanceof Error ? error.message : "";
    if (/principal|session|signed|sign in|re-authenticate|AUTH|auth/i.test(msg)) return "登录已过期，请重新登录后再操作。";
    if (/NOT_ORDER_PARTY/i.test(msg)) return "只有订单双方能操作这笔订单。";
    if (/NOT_CHECKINABLE|NOT_EXECUTABLE|EVIDENCE_NOT_ALLOWED|NOT_COMPLETABLE|NOT_COMPLETED|NOT_CONFIRMABLE|NOT_AMENDABLE|SETTLEMENT_NOT_RECORDABLE|MODE_MISMATCH/i.test(msg)) return "当前状态不能做这个操作，下拉刷新看看最新状态。";
    if (/ONLY_REQUESTER_RATES/i.test(msg)) return "只有需求方能评价。";
    if (/CASH_ELIGIBILITY|ELIGIBILITY/i.test(msg)) return "这笔现金单还没过审，先走平台担保或等审核。";
    if (/OUTCOME_ALREADY|ALREADY/i.test(msg)) return "已经操作过了，刷新看看。";
    return fallback;
  }

  async function refreshDetail(orderId: string): Promise<void> {
    try {
      const rows = await client.listMyOrders();
      setOrders(rows);
      const updated = rows.find((o) => o.orderId === orderId);
      if (updated) setDetail(updated);
    } catch {
      setActError("已提交，但列表刷新失败，重进页面查看最新状态。");
    }
  }

  async function runOrderAction(label: string, orderId: string, fn: () => Promise<void>): Promise<void> {
    if (acting) return;
    setActError(undefined);
    setActing(label);
    try {
      await fn();
      await refreshDetail(orderId);
    } catch (error) {
      setActError(humanOrderError(error, "操作失败，请检查连接后重试。"));
    } finally {
      setActing(undefined);
    }
  }

  async function pickOutcomePhoto(): Promise<void> {
    if (!mediaClient || evidenceBusy) return;
    setActError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setActError("请允许 Proxy 读取照片才能附证据。");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, selectionLimit: 1 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset?.uri) return;
    setOutcomePhoto({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg", width: asset.width ?? 0, height: asset.height ?? 0 });
  }

  // 确认完成 = 可选附一张证据照片 + 准时/范围/备注 + 可选归因到自己的店，一次提交。
  // 照片先上传拿 mediaAssetId 再调记录结果；没选照片就只记结果，不摆拍不了照的假按钮。
  // 小单在 CONFIRMED 点确认完成时先自动开工（服务端强制过 EXECUTING），
  // 用户只点一次，两次状态翻转都在服务端留痕。
  // STORE-STATS-001：归因和状态翻转在同一次提交里 —— 分开做会出现「单已完成但归因
  // 没落」的中间态，而 RecordOutcome 是记录结果的唯一入口，之后没有再改归因的命令。
  async function submitCompletion(orderId: string, lifecycle: string): Promise<void> {
    if (!mediaClient && outcomePhoto) return;
    setActError(undefined);
    setEvidenceBusy(true);
    try {
      if (outcomePhoto && mediaClient) {
        const uploaded = await mediaClient.uploadImage({ uri: outcomePhoto.uri, mimeType: outcomePhoto.mimeType, width: outcomePhoto.width, height: outcomePhoto.height });
        await client.submitEvidence(orderId, { mediaAssetId: uploaded.mediaAssetId });
      }
      if (lifecycle === "CONFIRMED") {
        await client.startExecution(orderId);
      }
      await runOrderAction("确认完成", orderId, () => client.recordOutcome(orderId, {
        onTime: outcomeOnTime,
        scopeCompleted: outcomeScope,
        ...(outcomeNote.trim() ? { objectiveNote: outcomeNote.trim() } : {}),
        ...(outcomeStoreId ? { storeId: outcomeStoreId } : {}),
      }));
      setOutcomePhoto(undefined);
      setOutcomeNote("");
      setOutcomeStoreId("");
    } catch (error) {
      setActError(humanOrderError(error, "完成提交失败，请稍后重试。"));
    } finally {
      setEvidenceBusy(false);
    }
  }

  // 打卡地点默认填快照里的碰面地点；市场名按碰面地点猜填，可改。
  useEffect(() => {
    if (detail) {
      if (checkinPlace === "") setCheckinPlace(detail.snapshot.meetingContext || "");
    }
  }, [detail?.orderId]);

  const ticketActivity = ticketActivityId ? joinedActs.find((a) => a.activityId === ticketActivityId) : undefined;
  if (ticketActivity && !activityDetailId) {
    const order = joinOrders.get(ticketActivity.activityId);
    const { snapshot, saved } = orderSnapshotFor(ticketActivity, order);
    const state = joinStateLabel(order?.state);
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.orderPageHead}>
            <Pressable accessibilityLabel="返回我的订单" onPress={() => setTicketActivityId(undefined)} style={styles.orderBack}><ProxyBackGlyph /></Pressable>
            <Text selectable style={styles.detailTitle}>订单详情</Text>
          </View>
          <View style={[styles.orderCard, { marginBottom: 12 }]}>
            <View style={styles.orderHead}>
              <View style={styles.orderCopy}>
                <Text selectable style={styles.orderTitle}>{snapshot.companion ? `到时候见 · ${snapshot.companion.name}` : saved ? "已报名这场活动" : "同行人没有保存"}</Text>
                <Text selectable style={styles.orderId}>{[snapshot.source === "FOR_YOU" ? "For You 下单" : "活动报名", order ? formatJoinedAt(order.joinedAt) : ""].filter(Boolean).join(" · ")}</Text>
              </View>
              <Text selectable style={[styles.orderBadge, state.tone === "ok" && styles.orderBadgeLive]}>{state.label}</Text>
            </View>
            <View style={styles.orderGrid}>
              <View style={styles.orderField}>
                <Text selectable style={styles.orderFieldLabel}>{saved ? "下单时人数" : "当前人数"}</Text>
                <Text selectable style={styles.orderFieldValue}>{peopleCountLabel(snapshot)}</Text>
              </View>
              {snapshot.activity.code ? (
                <View style={styles.orderField}>
                  <Text selectable style={styles.orderFieldLabel}>活动编号</Text>
                  <Text selectable style={styles.orderFieldValue}>{snapshot.activity.code}</Text>
                </View>
              ) : null}
            </View>
          </View>
          {!saved ? (
            <Text selectable style={[styles.orderNotice, { marginBottom: 12 }]}>这笔是票面快照上线前下的单，当时在 For You 里选的同行人、地点区域没有保存，以下按活动现在的信息显示。</Text>
          ) : null}
          {snapshot.orderNo ? (
            <ActivityOrderTicket
              noCompanionText={!saved ? "下单时选的同行人没有保存（票面快照上线前的订单），找不回来了" : snapshot.source === "FOR_YOU" ? undefined : "这单是直接报名的活动，没有系统推荐的同行人"}
              copied={copiedOrderNo === snapshot.orderNo}
              onCopyOrderNo={() => { void Clipboard.setStringAsync(snapshot.orderNo).then(() => setCopiedOrderNo(snapshot.orderNo)).catch(() => undefined); }}
              snapshot={snapshot}
            />
          ) : (
            <Text selectable style={styles.orderNotice}>订单编号暂未取到，下拉刷新或重新进入再看</Text>
          )}
          <Pressable accessibilityLabel="查看活动详情" onPress={() => setActivityDetailId(ticketActivity.activityId)} style={[styles.orderTab, { alignSelf: "stretch", marginTop: 14 }]}>
            <Text selectable style={[styles.orderTabText, { textAlign: "center" }]}>查看活动详情（活动现在的样子）</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (activityDetailId) {
    // HOME-MYORDERS-JOINS-001：报名记录的明细复用活动详情面 —— 同一个
    // ActivityClient；返回时重拉（详情里可能退了报名，列表要跟上）。
    return (
      <View style={styles.root}>
        <ActivityDetailSurface client={activityClient} moderation={moderation} initialActivityId={activityDetailId} onBack={() => { setActivityDetailId(undefined); reload(); }} />
      </View>
    );
  }
  if (detail) {
    // ORDER-TIER-001：流程按金额 + 场景双维度分档 —— 小单步骤多就是阻碍，
    // 步骤多的基本是城市协助。城市协助（scenario === "assistance"）永远走全流程，
    // 跟金额无关；普通消费按金额：500K 以下短流程，大单/面议（0/未填）全流程。
    // 服务端状态机强制过 EXECUTING：短流程点确认完成时自动先开工再记结果，
    // 两次服务端状态翻转都留痕，只是用户只点一次。
    const SMALL_ORDER_AMOUNT_VND = 500_000;
    const quotedAmount = detail.snapshot.agreedCompensation || 0;
    const isAssistance = detail.snapshot.scenario === "assistance";
    const isSmallOrder = !isAssistance && quotedAmount > 0 && quotedAmount < SMALL_ORDER_AMOUNT_VND;
    const showSettlement = detail.snapshot.settlementMode === "DIRECT_SETTLEMENT" && detail.lifecycle !== "OFFERED" && detail.lifecycle !== "CANCELLED" && !isSmallOrder;
    const actBtn = [styles.orderTab, styles.orderActBtn];
    const actBtnText = [styles.orderTabText, styles.orderActBtnText];
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setDetail(undefined)} style={styles.subPageBack}><ProxyBackGlyph /></Pressable>
          <Text selectable style={styles.detailTitle}>订单详情</Text>
          <View style={styles.orderCard}>
            <View style={styles.orderHead}>
              <View style={styles.orderCopy}>
                <Text selectable style={styles.orderTitle}>{detail.snapshot.serviceSku || "Proxy 订单"}</Text>
                <Text selectable style={styles.orderId}>{detail.orderId}</Text>
              </View>
              <Text selectable style={[styles.orderBadge, detail.lifecycle === "EXECUTING" && styles.orderBadgeLive]}>{orderStatus(detail)}</Text>
            </View>
            <Text selectable style={styles.orderNotice}>订单编号是订单全生命周期的唯一识别号，用于支付、退款、客服、争议、结算和记录查询。</Text>
          </View>
          <View style={styles.orderCard}>
            <Text selectable style={styles.orderTitle}>服务信息</Text>
            <View style={styles.orderGrid}>
              {fields(detail).map(([label, value]) => (
                <View key={label} style={styles.orderField}>
                  <Text selectable style={styles.orderFieldLabel}>{label}</Text>
                  <Text selectable style={styles.orderFieldValue}>{value}</Text>
                </View>
              ))}
            </View>
          </View>
          {/* ORDER-EXEC-001：按 lifecycle 出执行动作。服务端按状态 + 身份 double-check，
              这里只做"该出的出"（不该出的不摆假按钮），拒绝码翻人话。 */}
          {detail.lifecycle === "OFFERED" ? (
            <Pressable
              disabled={acting !== undefined}
              onPress={() => void runOrderAction("确认合作", detail.orderId, () => client.confirmCooperation(detail.orderId))}
              style={actBtn}
              accessibilityLabel="确认合作"
            >
              <Text selectable style={actBtnText}>{acting === "确认合作" ? "提交中…" : "确认合作"}</Text>
            </Pressable>
          ) : null}
          {detail.lifecycle === "CONFIRMED" && !isSmallOrder ? (
            <View style={styles.orderCard}>
              <Text selectable style={styles.orderTitle}>到场</Text>
              {/* 消费场景（PRD Ch11）：到场是信任锚 —— agent 到场举证，requester 也可
                  按"对方已到场"确认。开工是另一个节拍，服务端保留 StartExecution
                  能力，UI 只给出场这一条路，步骤不翻倍。 */}
              <Text selectable style={styles.orderFieldLabel}>碰面地点（默认快照里的地点）</Text>
              <TextInput
                value={checkinPlace}
                onChangeText={setCheckinPlace}
                placeholder="碰面地点"
                placeholderTextColor={color.muted}
                style={styles.actInput}
                accessibilityLabel="碰面地点"
              />
              <Text selectable style={styles.orderFieldLabel}>市场 / 商场名</Text>
              <TextInput
                value={checkinMarket}
                onChangeText={setCheckinMarket}
                placeholder="如 Complex 01"
                placeholderTextColor={color.muted}
                style={styles.actInput}
                accessibilityLabel="市场编号"
              />
              <Pressable
                disabled={acting !== undefined || checkinMarket.trim() === ""}
                onPress={() => void runOrderAction("到场", detail.orderId, () => client.checkInOrder(detail.orderId, { marketId: checkinMarket.trim(), locationLabel: checkinPlace.trim() || checkinMarket.trim() }))}
                style={actBtn}
                accessibilityLabel="确认到场"
              >
                <Text selectable style={actBtnText}>{acting === "到场" ? "提交中…" : "确认到场"}</Text>
              </Pressable>
            </View>
          ) : null}
          {(detail.lifecycle === "EXECUTING" || (isSmallOrder && detail.lifecycle === "CONFIRMED")) ? (
            <View style={styles.orderCard}>
              <Text selectable style={styles.orderTitle}>确认完成</Text>
              {mediaClient ? (
                <Pressable
                  disabled={acting !== undefined || evidenceBusy}
                  onPress={() => void pickOutcomePhoto()}
                  style={actBtn}
                  accessibilityLabel="附证据照片"
                >
                  <Text selectable style={actBtnText}>{outcomePhoto ? "✓ 已选一张证据照片" : "附证据照片（可选）"}</Text>
                </Pressable>
              ) : null}
              <Text selectable style={styles.orderFieldLabel}>准时和范围如实勾选，有话写在说明里</Text>
              <View style={styles.actRow}>
                <Pressable onPress={() => setOutcomeOnTime((v) => !v)} style={[styles.actChip, outcomeOnTime && styles.actChipOn]} accessibilityLabel="是否准时">
                  <Text selectable style={styles.actChipText}>{outcomeOnTime ? "✓ 准时" : "未准时"}</Text>
                </Pressable>
                <Pressable onPress={() => setOutcomeScope((v) => !v)} style={[styles.actChip, outcomeScope && styles.actChipOn]} accessibilityLabel="范围是否完成">
                  <Text selectable style={styles.actChipText}>{outcomeScope ? "✓ 范围完成" : "范围未完成"}</Text>
                </Pressable>
              </View>
              <TextInput
                value={outcomeNote}
                onChangeText={setOutcomeNote}
                placeholder="结果说明（可选）"
                placeholderTextColor={color.muted}
                style={styles.actInput}
                accessibilityLabel="结果说明"
              />
              {/* STORE-STATS-001 归因：只有履约方（AGENT）能指认 —— 店铺统计记的是
                  「这家店接了多少单」，让需求方替店家决定记给谁不合适。没有店、或
                  没接 business 客户端，就整块不画（不摆一个选不了的假控件）。 */}
              {detail.viewerRole === "AGENT" && business ? (
                storesFailed ? (
                  <Text selectable style={styles.orderFieldLabel}>店铺列表没读出来，这次先不计入店铺统计。</Text>
                ) : myStores.length > 0 ? (
                  <View>
                    <Text selectable style={styles.orderFieldLabel}>
                      {outcomeStoreId ? `计入「${myStores.find((store) => store.id === outcomeStoreId)?.name ?? ""}」的经营数据` : "这笔单在我哪家店完成？不选就不计入店铺统计"}
                    </Text>
                    <View style={styles.actRow}>
                      {myStores.map((store) => (
                        <Pressable
                          key={store.id}
                          onPress={() => setOutcomeStoreId((current) => (current === store.id ? "" : store.id))}
                          style={[styles.actChip, outcomeStoreId === store.id && styles.actChipOn]}
                          accessibilityLabel={`归到店铺${store.name}`}
                        >
                          <Text selectable style={styles.actChipText}>{store.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null
              ) : null}
              <Pressable
                disabled={acting !== undefined || evidenceBusy}
                onPress={() => void submitCompletion(detail.orderId, detail.lifecycle)}
                style={actBtn}
                accessibilityLabel="确认完成"
              >
                <Text selectable style={actBtnText}>{acting === "确认完成" || evidenceBusy ? "提交中…" : "确认完成"}</Text>
              </Pressable>
            </View>
          ) : null}
          {detail.lifecycle === "COMPLETED" && detail.viewerRole === "REQUESTER" ? (
            <View style={styles.orderCard}>
              <Text selectable style={styles.orderTitle}>评价这次合作</Text>
              <View style={styles.actRow}>
                {(["FULL", "PARTIAL", "NONE"] as const).map((option) => (
                  <Pressable key={option} onPress={() => setSatisfactionResolved(option)} style={[styles.actChip, satisfactionResolved === option && styles.actChipOn]} accessibilityLabel={`解决程度${option}`}>
                    <Text selectable style={styles.actChipText}>{option === "FULL" ? "完全解决" : option === "PARTIAL" ? "部分解决" : "没解决"}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.actRow}>
                {(["REUSE", "MAYBE", "NO"] as const).map((option) => (
                  <Pressable key={option} onPress={() => setSatisfactionRepeat((prev) => (prev === option ? "" : option))} style={[styles.actChip, satisfactionRepeat === option && styles.actChipOn]} accessibilityLabel={`是否再合作${option}`}>
                    <Text selectable style={styles.actChipText}>{option === "REUSE" ? "再合作" : option === "MAYBE" ? "考虑" : "不再合作"}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                disabled={acting !== undefined}
                onPress={() => void runOrderAction("评价", detail.orderId, () => client.recordSatisfaction(detail.orderId, { resolved: satisfactionResolved, ...(satisfactionRepeat ? { repeatIntent: satisfactionRepeat } : {}) }))}
                style={actBtn}
                accessibilityLabel="提交评价"
              >
                <Text selectable style={actBtnText}>{acting === "评价" ? "提交中…" : "提交评价"}</Text>
              </Pressable>
            </View>
          ) : null}
          {showSettlement ? (
            <View style={styles.orderCard}>
              <Text selectable style={styles.orderTitle}>记录结算（线下直接结算）</Text>
              <TextInput
                value={settleAmount}
                onChangeText={(v) => setSettleAmount(v.replace(/[^0-9]/g, ""))}
                placeholder={`金额（快照 ${detail.snapshot.agreedCompensation.toLocaleString()} ${detail.snapshot.currency || "VND"}）`}
                placeholderTextColor={color.muted}
                keyboardType="numeric"
                style={styles.actInput}
                accessibilityLabel="结算金额"
              />
              <TextInput
                value={settleMethod}
                onChangeText={setSettleMethod}
                placeholder={detail.snapshot.paymentMethodLabel || "支付方式说明"}
                placeholderTextColor={color.muted}
                style={styles.actInput}
                accessibilityLabel="支付方式"
              />
              <View style={styles.actRow}>
                <Pressable onPress={() => setSettlePayer((v) => !v)} style={[styles.actChip, settlePayer && styles.actChipOn]} accessibilityLabel="付款方已确认">
                  <Text selectable style={styles.actChipText}>{settlePayer ? "✓ 付款方确认" : "付款方确认"}</Text>
                </Pressable>
                <Pressable onPress={() => setSettlePayee((v) => !v)} style={[styles.actChip, settlePayee && styles.actChipOn]} accessibilityLabel="收款方已确认">
                  <Text selectable style={styles.actChipText}>{settlePayee ? "✓ 收款方确认" : "收款方确认"}</Text>
                </Pressable>
              </View>
              <Pressable
                disabled={acting !== undefined || settleAmount.trim() === ""}
                onPress={() => void runOrderAction("记录结算", detail.orderId, () => client.recordSettlement(detail.orderId, { agreedAmount: Number(settleAmount), ...(settleMethod.trim() ? { paymentMethodLabel: settleMethod.trim() } : {}), payerConfirmed: settlePayer, payeeConfirmed: settlePayee }))}
                style={actBtn}
                accessibilityLabel="记录结算"
              >
                <Text selectable style={actBtnText}>{acting === "记录结算" ? "提交中…" : "记录结算"}</Text>
              </Pressable>
            </View>
          ) : null}
          {actError ? <Text selectable style={styles.orderNotice}>{actError}</Text> : null}
          {canCancel(detail) ? (
            <Pressable
              disabled={cancellingId === detail.orderId}
              onPress={() => void confirmAndCancel(detail)}
              style={[styles.orderTab, styles.orderCancelBtn, cancellingId === detail.orderId && styles.orderTabOn]}
            >
              <Text selectable style={[styles.orderTabText, styles.orderCancelBtnText, cancellingId === detail.orderId && styles.orderTabTextOn]}>
                {cancellingId === detail.orderId ? "取消中…" : "取消订单"}
              </Text>
            </Pressable>
          ) : null}
          {cancelError ? <Text selectable style={styles.orderNotice}>{cancelError}</Text> : null}
          <Pressable
            accessibilityLabel="举报这笔交易"
            onPress={() => { setReportNotice(undefined); setReporting(detail.orderId); }}
            style={styles.orderTab}
          >
            <Text selectable style={styles.orderTabText}>举报这笔交易</Text>
          </Pressable>
          {reportNotice ? <Text selectable style={styles.orderNotice}>{reportNotice}</Text> : null}
        </ScrollView>
        {/* COMP-REPORT-002: 举报交易。target 用 orderId —— 报的是这笔
            交易，不是对方这个人（报人走账号举报入口）。 */}
        {reporting ? (
          <ReportSheet
            moderation={moderation}
            targetType="TRANSACTION"
            targetId={reporting}
            title="举报这笔交易"
            subtitle={reporting}
            onClose={() => setReporting(undefined)}
            onDone={() => { setReporting(undefined); setReportNotice("举报已提交，平台将按审核流程处理。"); }}
          />
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.orderPageHead}>
          <Pressable onPress={onBack} style={styles.orderBack}><ProxyBackGlyph /></Pressable>
          <Text selectable style={styles.detailTitle}>我的订单</Text>
        </View>
        <ProviderOrderPanel onOpenApply={onOpenApply} />
        {pendingOffers.length > 0 ? (
          <View style={{ marginBottom: 11 }}>
            <Text selectable style={[styles.orderFieldLabel, { marginBottom: 7, fontSize: 12, fontWeight: "900", color: color.ink }]}>收到的合作邀请</Text>
            {offerNotice ? <Text selectable style={styles.orderNotice}>{offerNotice}</Text> : null}
            {pendingOffers.map((offer) => {
              const remainingMs = new Date(offer.expiresAt).getTime() - Date.now();
              const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
              return (
                <View key={offer.offerId} style={styles.orderCard}>
                  <View style={styles.orderHead}>
                    <View style={styles.orderCopy}>
                      <Text selectable style={styles.orderTitle}>合作邀请 · 来自 {shortId(offer.requesterId)}</Text>
                      <Text selectable style={styles.orderId}>任务 {shortId(offer.taskId)} · {remainingMin > 0 ? `剩 ${remainingMin} 分钟有效` : "即将过期"}</Text>
                    </View>
                    <Text selectable style={styles.orderBadge}>待接受</Text>
                  </View>
                  <View style={styles.orderActions}>
                    <Pressable disabled={acceptingOfferId === offer.offerId} onPress={() => void acceptOffer(offer)} style={[styles.orderAction, styles.orderActionPrimary]}>
                      <Text selectable style={styles.orderActionPrimaryText}>{acceptingOfferId === offer.offerId ? "接单中…" : "接受并生成订单"}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
        {joinsFailed ? <Text selectable style={styles.orderNotice}>活动报名记录没读出来，报名是否成功以「我的活动」为准。</Text> : null}
        {joinedActs.length > 0 ? (
          <View style={{ marginBottom: 11 }}>
            <Text selectable style={[styles.orderFieldLabel, { marginBottom: 7, fontSize: 12, fontWeight: "900", color: color.ink }]}>活动报名</Text>
            <Text selectable style={styles.savedMeta}>For You 下单报的是活动，不是履约订单 —— 记录在这里，钱货两讫的单在下面。</Text>
            {joinedActs.map((item) => {
              const order = joinOrders.get(item.activityId);
              const state = joinStateLabel(order?.state);
              return (
                <View key={item.activityId} style={styles.orderCard}>
                  <Pressable onPress={() => setTicketActivityId(item.activityId)} accessibilityLabel={`查看${item.title}订单详情`}>
                    <View style={styles.orderHead}>
                      <View style={styles.orderCopy}>
                        <Text selectable style={styles.orderTitle}>{item.title}</Text>
                        <Text selectable style={styles.orderId}>{item.desc ? item.desc : `${item.time} · ${item.venueName}`}</Text>
                      </View>
                      <Text selectable style={[styles.orderBadge, state.tone === "ok" && styles.orderBadgeLive]}>{state.label}</Text>
                    </View>
                    <View style={styles.orderGrid}>
                      {activityOrderFields(item, order).map(([label, value]) => (
                        <View key={label} style={styles.orderField}>
                          <Text selectable style={styles.orderFieldLabel}>{label}</Text>
                          <Text selectable style={styles.orderFieldValue}>{value}</Text>
                        </View>
                      ))}
                    </View>
                  </Pressable>
                  {/* 订单编号单独一行、点一下复制（客服/争议时要报这个号）。老报名没有编号时如实说，
                      不拿活动编号冒充订单号——活动编号是整场活动共用的。 */}
                  {order?.orderNo ? (
                    <Pressable
                      accessibilityLabel="复制订单编号"
                      onPress={() => { const no = order.orderNo ?? ""; void Clipboard.setStringAsync(no).then(() => setCopiedOrderNo(no)).catch(() => undefined); }}
                      style={{ paddingTop: 10 }}
                    >
                      <Text selectable style={styles.orderFieldLabel}>订单编号 · {copiedOrderNo === order.orderNo ? "已复制" : "点击复制"}</Text>
                      <Text selectable style={[styles.orderFieldValue, { letterSpacing: 0.5 }]}>{order.orderNo}</Text>
                    </Pressable>
                  ) : (
                    <Text selectable style={[styles.orderId, { paddingTop: 10 }]}>订单编号暂未取到，下拉刷新或重新进入再看</Text>
                  )}
                  {item.code ? <Text selectable style={styles.orderId}>活动编号：{item.code}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.orderTabs}>
          {([['all','全部'],['published','我发布的'],['joined','我参与的'],['done','已完成'],['cancelled','已取消']] as const).map(([id,label]) => (
            <Pressable key={id} onPress={() => setFilter(id)} style={[styles.orderTab, filter === id && styles.orderTabOn]}>
              <Text selectable style={[styles.orderTabText, filter === id && styles.orderTabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {phase === "LOADING" ? <ProxyLoading tone="brand" /> : null}
        {phase === "ERROR" ? <Text selectable style={styles.personalEmpty}>订单服务暂时不可用，请稍后重试。</Text> : null}
        {phase === "READY" && visible.length === 0 ? <Text selectable style={styles.personalEmpty}>当前分类还没有订单。</Text> : null}
        {cancelError ? <Text selectable style={styles.orderNotice}>{cancelError}</Text> : null}
        {visible.map((item) => (
          <View key={item.orderId} style={styles.orderCard}>
            <Pressable onPress={() => setDetail(item)}>
              <View style={styles.orderHead}>
                <View style={styles.orderCopy}>
                  <Text selectable style={styles.orderTitle}>{item.snapshot.serviceSku || "Proxy 订单"}</Text>
                  <Text selectable style={styles.orderId}>订单编号：{item.orderId}</Text>
                </View>
                <Text selectable style={[styles.orderBadge, item.lifecycle === "EXECUTING" && styles.orderBadgeLive]}>{orderStatus(item)}</Text>
              </View>
              <View style={styles.orderGrid}>
                {fields(item).slice(0, 4).map(([label, value]) => (
                  <View key={label} style={styles.orderField}>
                    <Text selectable style={styles.orderFieldLabel}>{label}</Text>
                    <Text selectable style={styles.orderFieldValue}>{value}</Text>
                  </View>
                ))}
              </View>
            </Pressable>
            {canCancel(item) ? (
              <Pressable
                disabled={cancellingId === item.orderId}
                onPress={() => void confirmAndCancel(item)}
                style={[styles.orderTab, styles.orderCancelBtn, cancellingId === item.orderId && styles.orderTabOn]}
              >
                <Text selectable style={[styles.orderTabText, styles.orderCancelBtnText, cancellingId === item.orderId && styles.orderTabTextOn]}>
                  {cancellingId === item.orderId ? "取消中…" : "取消订单"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function MyActivitiesSurface({ onBack, moderation }: { onBack: () => void; moderation: ModerationClient }): React.JSX.Element {
  // R17.x: 我的活动物化路径。listMyActivities 取代
  // hardcoded mock (会报 "本周暂无开放活动") — 服务端
  // 返 actor-scoped created + joined, 客户端按 tab 分类.
  // "可参加" tab 仍用 ListActivities (server 端返全表),
  // 让用户能继续报新活动; "已参加" / "我发起的" 走
  // ListMyActivities (actor-scoped).
  const [client] = useState(() => new ActivityClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore }));
  const [tab, setTab] = useState<"open" | "joined" | "created">("open");
  const [openItems, setOpenItems] = useState<Activity[]>([]);
  const [created, setCreated] = useState<Activity[]>([]);
  const [joined, setJoined] = useState<Activity[]>([]);
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [joiningId, setJoiningId] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [detailId, setDetailId] = useState<string | undefined>(undefined);
  const [authed, setAuthed] = useState<boolean>(true);

  const reload = useCallback(() => {
    let active = true;
    setPhase("LOADING");
    setNotice(undefined);
    void client.listActivities().then((rows) => {
      if (active) setOpenItems(rows);
    }).catch(() => { if (active) setPhase("ERROR"); });
    void client.listMyActivities().then((payload) => {
      if (!active) return;
      setCreated(payload.created);
      setJoined(payload.joined);
      setAuthed(true);
      setPhase("READY");
    }).catch((error: unknown) => {
      if (!active) return;
      // ListMyActivities 需要 authenticated principal。匿名
      // 访问时 server 会拒, 这里以同个 ListActivities
      // (anonymous 可读) 完成刷新, 且在 UI 告知"登录后
      // 才能看到 "我的" 活动"".
      if (error instanceof Error && /authenticated principal|session expired/i.test(error.message)) {
        setAuthed(false);
        setPhase("READY");
      } else {
        setPhase("ERROR");
      }
    });
  }, [client]);
  useEffect(() => reload(), [reload]);

  async function join(activityId: string): Promise<void> {
    setJoiningId(activityId);
    setNotice(undefined);
    try {
      await client.join(activityId);
      setNotice("报名成功");
      reload();
    } catch (error) {
      if (error instanceof ActivityCommandRejectedError) {
        const code = error.result.error?.errorCode ?? "";
        if (code === "ACTIVITY_FULL") setNotice("名额已满");
        else if (code === "ACTIVITY_ALREADY_JOINED") {
          setNotice("你已报过名");
          reload();
        } else if (code === "AI_ACTION_FORBIDDEN") setNotice("该操作不支持");
        else setNotice("报名失败，请稍后重试");
      } else if (error instanceof Error && /authenticated principal|SessionExpired|session expired/i.test(error.message)) {
        setNotice("请登录后重试");
      } else {
        setNotice("报名失败，请稍后重试");
      }
    } finally {
      setJoiningId(undefined);
    }
  }

  const items = tab === "open" ? openItems : tab === "joined" ? joined : created;
  // 已参加 / 我发起的本地状态 (未登录 = server 不返, 不在本地
  // 跟踪, 避免 "我报过 5 个" 货不对版).
  // 明细：复用 ActivityDetailSurface（同一 client），返回键回到列表。
  // 列表→明细→报名就此打通；明细内的报名成功后，回列表刷新已参加。
  if (detailId) {
    return (
      <View style={styles.root}>
        <ActivityDetailSurface client={client} moderation={moderation} initialActivityId={detailId} onBack={() => { setDetailId(undefined); reload(); }} />
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.orderPageHead}>
          <Pressable onPress={onBack} style={styles.orderBack}><ProxyBackGlyph /></Pressable>
          <Text selectable style={styles.detailTitle}>我的活动</Text>
        </View>
        <View style={styles.activityOwnedTabs}>
          {([["open", "可参加"], ["joined", "已参加"], ["created", "我发起的"]] as const).map(([id, label]) => (
            <Pressable key={id} onPress={() => setTab(id)} style={[styles.activityOwnedTab, tab === id && styles.activityOwnedTabOn]}>
              <Text selectable style={[styles.activityOwnedTabText, tab === id && styles.activityOwnedTabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {notice ? <Text selectable style={styles.savedMeta}>{notice}</Text> : null}
        {!authed ? <Text selectable style={styles.savedMeta}>登录后才能查看 “已参加” / “我发起的”。</Text> : null}
        {phase === "LOADING" ? <ProxyLoading tone="brand" /> : null}
        {phase === "ERROR" ? (
          <View>
            <Text selectable style={styles.personalEmpty}>活动加载失败，请检查连接后重试。</Text>
            <Pressable onPress={() => reload()} style={[styles.orderTab, styles.orderTabOn]}><Text selectable style={[styles.orderTabText, styles.orderTabTextOn]}>重试</Text></Pressable>
          </View>
        ) : null}
        {phase === "READY" && tab === "created" && authed && items.length === 0 ? <Text selectable style={styles.personalEmpty}>还没有发起过活动。</Text> : null}
        {phase === "READY" && tab === "joined" && authed && items.length === 0 ? <Text selectable style={styles.personalEmpty}>还没有报名，去可参加看看。</Text> : null}
        {phase === "READY" && tab === "open" && items.length === 0 ? <Text selectable style={styles.personalEmpty}>本周暂无开放活动。</Text> : null}
        {phase === "READY" ? items.map((item) => {
          const joinedSet = new Set(joined.map((a) => a.activityId));
          const isJoined = joinedSet.has(item.activityId);
          const capacity = item.capacity ?? 0;
          const full = capacity > 0 && item.joined >= capacity;
          return (
            <View key={item.activityId} style={styles.savedCard}>
              <Pressable onPress={() => setDetailId(item.activityId)} accessibilityLabel={`查看${item.title}明细`}>
              <Text selectable style={styles.orderTitle}>{item.title}</Text>
              <Text selectable style={styles.savedMeta}>{item.time} · {item.venueIcon} {item.venueName}</Text>
              <Text selectable style={styles.savedMeta}>{item.priceLabel}{item.price ? ` · ${item.price}` : ""} · 感兴趣 {item.interested} · 已报名 {item.joined}{capacity > 0 ? `/${capacity}` : ""}</Text>
              {item.aiStatus !== "NONE" ? <Text selectable style={styles.savedMeta}>AI 虚拟 · {activityAIPersonaName(item)}</Text> : null}
              <Text selectable style={styles.savedMeta}>查看明细 ›</Text>
              </Pressable>
              {tab === "open" ? (
                <Pressable
                  disabled={isJoined || full || joiningId === item.activityId}
                  onPress={() => void join(item.activityId)}
                  style={[styles.orderTab, (isJoined || full) && styles.orderTabOn]}
                >
                  <Text selectable style={[styles.orderTabText, (isJoined || full) && styles.orderTabTextOn]}>
                    {joiningId === item.activityId ? "报名中…" : isJoined ? "已报名" : full ? "已满员" : "报名"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        }) : null}
      </ScrollView>
    </View>
  );
}

// SCENE-FAVORITE-002：加 "scene" 页签。以前场景区只在「全部」出现，而页签是
// 全部/商家/Creator/动态/活动 —— 没有场景页签，切到任何一个别的页签就只剩空态，
// 等于把这一页唯一的真内容藏起来。
type FavoriteTab = "all" | "scene" | "merchant" | "creator" | "post" | "activity";

export function FavoritesSurface({ onBack, viewerAccountId }: { onBack: () => void; viewerAccountId?: string | undefined }): React.JSX.Element {
  const [tab, setTab] = useState<FavoriteTab>("all");
  // SCENE-FAVORITE-001：home 场景卡片的 🤍 落盘到本机（按账号），这里读出来
  // 用静态目录回查标题 —— 标题来自 MOMENTS 真目录，hearts 是用户自己的，
  // 两边都是真数据。目录里查不到的 id 直接丢弃，不画幽灵卡。
  // SCENE-FAVORITE-002：解析改走 resolveSavedSceneIds —— 与个人主页的收藏 tab
  // 共用同一份实现，两个面不会各写一遍导致同一份 hearts 显示不一致。
  const [savedScenes, setSavedScenes] = useState<readonly SavedSceneEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!viewerAccountId) {
      setSavedScenes([]);
      return;
    }
    void createSceneFavoritesStore(nativeSecureStorageDriver, viewerAccountId)
      .read()
      .then((ids) => {
        if (cancelled) return;
        setSavedScenes(resolveSavedSceneIds(ids, savedSceneLookup));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [viewerAccountId]);
  // FAVORITES-REAL-001: 以前这里是两条写死的假记录，所有用户看到同一份，
  // 所有用户看到同一份，跟本人收藏无关。后端有 bookmarkPost 写入和
  // ListUserBookmarks 读 ID 的能力，但 ID 没有批量解标题的接口 ——
  // 逐条 N+1 查标题是错的（慢且失败一半时列表半真半假）。列表 UI 接好之前，
  // 这里只放诚实空态，不放示例数据冒充。
  const visible: Array<{ type: string; title: string; meta: string }> = [];
  const shown = tab === "all" ? visible : visible.filter((item) => item.type === tab);
  // SCENE-FAVORITE-001：场景区只画读盘回查到的真目录条目，只在「全部」出现
  // （场景灵感不属于商家/Creator/动态/活动任一页签，不冒充）；动态区仍是诚实空态
  // （服务端收藏读 ID 的能力有了，但批量解标题接口还没接，见注释）。
  // SCENE-FAVORITE-002：场景区在「全部」和「场景」两个页签都画 —— 有独立页签，
  // 切过去不会空掉。
  const showSceneSection = savedScenes.length > 0 && (tab === "all" || tab === "scene");
  return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><View style={styles.orderPageHead}><Pressable onPress={onBack} style={styles.orderBack}><ProxyBackGlyph /></Pressable><Text selectable style={styles.detailTitle}>收藏</Text></View><Text selectable style={styles.savedIntro}>很轻的个人备忘夹。以后还想找到，就放这里。</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.orderTabs}>{([['all','全部'],['scene','场景'],['merchant','商家'],['creator','Creator'],['post','动态'],['activity','活动']] as const).map(([id,label]) => <Pressable key={id} onPress={() => setTab(id)} style={[styles.orderTab, tab === id && styles.orderTabOn]}><Text selectable style={[styles.orderTabText, tab === id && styles.orderTabTextOn]}>{label}</Text></Pressable>)}</ScrollView>{showSceneSection ? <View><Text selectable style={styles.savedMeta}>场景灵感 · 来自首页收藏</Text>{savedScenes.map((scene) => <View key={scene.id} style={[styles.savedCard, styles.savedRow]}><View style={styles.savedThumb}><Text selectable style={styles.savedThumbText}>☆</Text></View><View><Text selectable style={styles.orderTitle}>{scene.title}</Text><Text selectable style={styles.savedMeta}>{scene.meta}</Text></View></View>)}</View> : null}{shown.length ? shown.map((item) => <View key={item.title} style={[styles.savedCard, styles.savedRow]}><View style={styles.savedThumb}><Text selectable style={styles.savedThumbText}>☆</Text></View><View><Text selectable style={styles.orderTitle}>{item.title}</Text><Text selectable style={styles.savedMeta}>{item.meta}</Text></View></View>) : (showSceneSection ? null : (tab === "scene" ? <ProxyEmptyState title="还没有收藏场景" sub="首页场景卡片右上角的 🤍 可以加入收藏" /> : <ProxyEmptyState title="还没有收藏列表" sub="动态收藏正在接入，这里不放示例数据。" />))}</ScrollView></View>;
}

// 商家活动导流：只列 Origin=MERCHANT 的开放活动（种子 + 商家实发），匿名
// 可读；报名走认证通道，未登录提示登录。之前是有 tile 无页面的死入口。
export function MerchantCampaignSurface({ onBack, moderation }: { onBack: () => void; moderation: ModerationClient }): React.JSX.Element {
  const [client] = useState(() => new ActivityClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore }));
  const [items, setItems] = useState<Activity[]>([]);
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [detailId, setDetailId] = useState<string | undefined>(undefined);
  const [joiningId, setJoiningId] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const reload = useCallback(() => {
    let active = true;
    setPhase("LOADING");
    void client.listActivities().then((rows) => {
      if (active) { setItems(rows.filter((item) => item.origin === "MERCHANT")); setPhase("READY"); }
    }).catch(() => { if (active) setPhase("ERROR"); });
    return () => { active = false; };
  }, [client]);
  useEffect(() => reload(), [reload]);

  async function join(activityId: string): Promise<void> {
    setJoiningId(activityId);
    setNotice(undefined);
    try {
      await client.join(activityId);
      setNotice("报名成功");
      reload();
    } catch (error) {
      if (error instanceof ActivityCommandRejectedError) {
        const code = error.result.error?.errorCode ?? "";
        if (code === "ACTIVITY_FULL") setNotice("名额已满");
        else if (code === "ACTIVITY_ALREADY_JOINED") setNotice("你已报过名");
        else setNotice("报名失败，请稍后重试");
      } else if (error instanceof Error && /authenticated principal|SessionExpired|session expired/i.test(error.message)) {
        setNotice("请登录后重试");
      } else {
        setNotice("报名失败，请稍后重试");
      }
    } finally {
      setJoiningId(undefined);
    }
  }

  if (detailId) {
    return (
      <View style={styles.root}>
        <ActivityDetailSurface client={client} moderation={moderation} initialActivityId={detailId} onBack={() => { setDetailId(undefined); reload(); }} />
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.orderPageHead}>
          <Pressable onPress={onBack} style={styles.orderBack}><ProxyBackGlyph /></Pressable>
          <Text selectable style={styles.detailTitle}>活动导流</Text>
        </View>
        {notice ? <Text selectable style={styles.savedMeta}>{notice}</Text> : null}
        {phase === "LOADING" ? <ProxyLoading tone="brand" /> : null}
        {phase === "ERROR" ? (
          <View>
            <Text selectable style={styles.personalEmpty}>活动加载失败，请检查连接后重试。</Text>
            <Pressable onPress={() => reload()} style={[styles.orderTab, styles.orderTabOn]}><Text selectable style={[styles.orderTabText, styles.orderTabTextOn]}>重试</Text></Pressable>
          </View>
        ) : null}
        {phase === "READY" && items.length === 0 ? <Text selectable style={styles.personalEmpty}>暂无商家活动。</Text> : null}
        {phase === "READY" ? items.map((item) => {
          const capacity = item.capacity ?? 0;
          const full = capacity > 0 && item.joined >= capacity;
          return (
            <View key={item.activityId} style={styles.savedCard}>
              <Pressable onPress={() => setDetailId(item.activityId)} accessibilityLabel={`查看${item.title}明细`}>
              <Text selectable style={styles.orderTitle}>{item.title}</Text>
              <Text selectable style={styles.savedMeta}>{item.time} · {item.venueIcon} {item.venueName}</Text>
              <Text selectable style={styles.savedMeta}>{item.priceLabel}{item.price ? ` · ${item.price}` : ""} · 已报名 {item.joined}{capacity > 0 ? `/${capacity}` : ""}</Text>
              <Text selectable style={styles.savedMeta}>查看明细 ›</Text>
              </Pressable>
              <Pressable
                disabled={full || joiningId === item.activityId}
                onPress={() => void join(item.activityId)}
                style={[styles.orderTab, full && styles.orderTabOn]}
              >
                <Text selectable style={[styles.orderTabText, full && styles.orderTabTextOn]}>
                  {joiningId === item.activityId ? "报名中…" : full ? "已满员" : "报名"}
                </Text>
              </Pressable>
            </View>
          );
        }) : null}
      </ScrollView>
    </View>
  );
}
