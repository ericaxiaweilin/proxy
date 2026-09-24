import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { Activity } from "@proxy/contracts";
import { ActivityClient, ActivityCommandRejectedError } from "../activity-client";
import type { FulfillmentClient, FulfillmentOrder } from "../fulfillment-client";
import type { MediaClient } from "../media-client";
import type { ModerationClient } from "../moderation-client";
import { ReportSheet } from "../components/report-sheet";
import { nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import { nativeSecureStorageDriver } from "../native-secure-storage";
import { color } from "../theme";
import { ActivityDetailSurface } from "./activity-detail";
import { activityAIPersonaName } from "./activity-detail-model";
import { styles } from "./me-styles";
import { ProxyLoading, ProxyEmptyState } from "../components/proxy-foundation";
import { createSceneFavoritesStore, resolveSavedSceneIds, type SavedSceneEntry } from "../scene-favorites";
import { savedSceneLookup } from "../components/scene-activity-discovery";

type OrderFilter = "all" | "published" | "joined" | "done" | "cancelled";

function orderStatus(order: FulfillmentOrder): string { return ({ OFFERED: "待确认", CONFIRMED: "已确认", EXECUTING: "进行中", COMPLETED: "已完成", CANCELLED: "已取消" } as const)[order.lifecycle]; }
function orderMoney(order: FulfillmentOrder): string { return `${order.snapshot.agreedCompensation.toLocaleString()} ${order.snapshot.currency || "VND"}`; }
// R18.x CANCEL-001: only OFFERED / CONFIRMED / EXECUTING
// can be cancelled by either party. COMPLETED is terminal
// (the cooperation already happened); CANCELLED is itself
// terminal. UI mirrors the server-side check.
function canCancel(order: FulfillmentOrder): boolean {
  return order.lifecycle === "OFFERED" || order.lifecycle === "CONFIRMED" || order.lifecycle === "EXECUTING";
}

export function MyOrdersSurface({ client, moderation, mediaClient, onBack }: {
  client: FulfillmentClient;
  // COMP-REPORT-002: 举报这笔交易。钱与线下见面都在这一层 —— 诈骗、
  // 招嫖揽客、人身威胁的暴露面正是订单，不是帖子。
  moderation: ModerationClient;
  // ORDER-EXEC-001: 提交证据要传照片，没有 mediaClient 就不画证据入口，
  // 不摆拍不了照的假按钮。
  mediaClient?: MediaClient | undefined;
  onBack: () => void;
}): React.JSX.Element {
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [detail, setDetail] = useState<FulfillmentOrder>();
  const [cancellingId, setCancellingId] = useState<string | undefined>(undefined);
  const [cancelError, setCancelError] = useState<string | undefined>(undefined);
  const [reporting, setReporting] = useState<string | undefined>(undefined);
  const [reportNotice, setReportNotice] = useState<string | undefined>(undefined);
  const reload = useCallback(() => {
    let active = true;
    setPhase("LOADING");
    void client.listMyOrders().then((rows) => { if (active) { setOrders(rows); setPhase("READY"); } }).catch(() => { if (active) setPhase("ERROR"); });
    return () => { active = false; };
  }, [client]);
  useEffect(() => { const cleanup = reload(); return cleanup; }, [reload]);
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

  async function submitEvidencePhoto(orderId: string): Promise<void> {
    if (!mediaClient || evidenceBusy) return;
    setActError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setActError("请允许 Proxy 读取照片才能提交证据。");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, selectionLimit: 1 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset?.uri) return;
    setEvidenceBusy(true);
    try {
      const uploaded = await mediaClient.uploadImage({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg", width: asset.width ?? 0, height: asset.height ?? 0 });
      await runOrderAction("evidence", orderId, () => client.submitEvidence(orderId, { mediaAssetId: uploaded.mediaAssetId }));
    } catch (error) {
      setActError(humanOrderError(error, "证据提交失败，请稍后重试。"));
    } finally {
      setEvidenceBusy(false);
    }
  }

  // 打卡地点默认填快照里的碰面地点，省一次输入；换地方就地改。
  useEffect(() => {
    if (detail) setCheckinPlace(detail.snapshot.meetingContext || "");
  }, [detail?.orderId]);

  if (detail) {
    const showSettlement = detail.snapshot.settlementMode === "DIRECT_SETTLEMENT" && detail.lifecycle !== "OFFERED" && detail.lifecycle !== "CANCELLED";
    const actBtn = [styles.orderTab, styles.orderActBtn];
    const actBtnText = [styles.orderTabText, styles.orderActBtnText];
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setDetail(undefined)} style={styles.subPageBack}><Text selectable style={styles.subPageBackText}>‹ 返回订单</Text></Pressable>
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
          {detail.lifecycle === "CONFIRMED" ? (
            <View style={styles.orderCard}>
              <Text selectable style={styles.orderTitle}>开始执行</Text>
              <Pressable
                disabled={acting !== undefined}
                onPress={() => void runOrderAction("开始执行", detail.orderId, () => client.startExecution(detail.orderId))}
                style={actBtn}
                accessibilityLabel="开始执行"
              >
                <Text selectable style={actBtnText}>{acting === "开始执行" ? "提交中…" : "开始执行"}</Text>
              </Pressable>
              <Text selectable style={styles.orderFieldLabel}>到场打卡（市场编号 + 地点）</Text>
              <TextInput
                value={checkinMarket}
                onChangeText={setCheckinMarket}
                placeholder="市场编号"
                placeholderTextColor={color.muted}
                style={styles.actInput}
                accessibilityLabel="打卡市场编号"
              />
              <TextInput
                value={checkinPlace}
                onChangeText={setCheckinPlace}
                placeholder="地点"
                placeholderTextColor={color.muted}
                style={styles.actInput}
                accessibilityLabel="打卡地点"
              />
              <Pressable
                disabled={acting !== undefined || checkinMarket.trim() === ""}
                onPress={() => void runOrderAction("打卡", detail.orderId, () => client.checkInOrder(detail.orderId, { marketId: checkinMarket.trim(), locationLabel: checkinPlace.trim() || checkinMarket.trim() }))}
                style={actBtn}
                accessibilityLabel="到场打卡"
              >
                <Text selectable style={actBtnText}>{acting === "打卡" ? "提交中…" : "到场打卡"}</Text>
              </Pressable>
            </View>
          ) : null}
          {detail.lifecycle === "EXECUTING" ? (
            <View style={styles.orderCard}>
              <Text selectable style={styles.orderTitle}>履约进展</Text>
              {mediaClient ? (
                <Pressable
                  disabled={acting !== undefined || evidenceBusy}
                  onPress={() => void submitEvidencePhoto(detail.orderId)}
                  style={actBtn}
                  accessibilityLabel="提交证据照片"
                >
                  <Text selectable style={actBtnText}>{evidenceBusy || acting === "evidence" ? "提交中…" : "提交证据照片"}</Text>
                </Pressable>
              ) : null}
              <Text selectable style={styles.orderFieldLabel}>记录结果</Text>
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
              <Pressable
                disabled={acting !== undefined}
                onPress={() => void runOrderAction("记录结果", detail.orderId, () => client.recordOutcome(detail.orderId, { onTime: outcomeOnTime, scopeCompleted: outcomeScope, ...(outcomeNote.trim() ? { objectiveNote: outcomeNote.trim() } : {}) }))}
                style={actBtn}
                accessibilityLabel="记录履约结果"
              >
                <Text selectable style={actBtnText}>{acting === "记录结果" ? "提交中…" : "记录结果并完成"}</Text>
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
          <Pressable onPress={onBack} style={styles.orderBack}><Text selectable style={styles.orderBackText}>‹</Text></Pressable>
          <Text selectable style={styles.detailTitle}>我的订单</Text>
        </View>
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
          <Pressable onPress={onBack} style={styles.orderBack}><Text selectable style={styles.orderBackText}>‹</Text></Pressable>
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
  return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><View style={styles.orderPageHead}><Pressable onPress={onBack} style={styles.orderBack}><Text selectable style={styles.orderBackText}>‹</Text></Pressable><Text selectable style={styles.detailTitle}>收藏</Text></View><Text selectable style={styles.savedIntro}>很轻的个人备忘夹。以后还想找到，就放这里。</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.orderTabs}>{([['all','全部'],['scene','场景'],['merchant','商家'],['creator','Creator'],['post','动态'],['activity','活动']] as const).map(([id,label]) => <Pressable key={id} onPress={() => setTab(id)} style={[styles.orderTab, tab === id && styles.orderTabOn]}><Text selectable style={[styles.orderTabText, tab === id && styles.orderTabTextOn]}>{label}</Text></Pressable>)}</ScrollView>{showSceneSection ? <View><Text selectable style={styles.savedMeta}>场景灵感 · 来自首页收藏</Text>{savedScenes.map((scene) => <View key={scene.id} style={[styles.savedCard, styles.savedRow]}><View style={styles.savedThumb}><Text selectable style={styles.savedThumbText}>☆</Text></View><View><Text selectable style={styles.orderTitle}>{scene.title}</Text><Text selectable style={styles.savedMeta}>{scene.meta}</Text></View></View>)}</View> : null}{shown.length ? shown.map((item) => <View key={item.title} style={[styles.savedCard, styles.savedRow]}><View style={styles.savedThumb}><Text selectable style={styles.savedThumbText}>☆</Text></View><View><Text selectable style={styles.orderTitle}>{item.title}</Text><Text selectable style={styles.savedMeta}>{item.meta}</Text></View></View>) : (showSceneSection ? null : (tab === "scene" ? <ProxyEmptyState title="还没有收藏场景" sub="首页场景卡片右上角的 🤍 可以加入收藏" /> : <ProxyEmptyState title="还没有收藏列表" sub="动态收藏正在接入，这里不放示例数据。" />))}</ScrollView></View>;
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
          <Pressable onPress={onBack} style={styles.orderBack}><Text selectable style={styles.orderBackText}>‹</Text></Pressable>
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
