// ORDER_EXECUTION — 订单执行（稳定 Surface，去占位化）
// PRD Chapter11：Execution / Checkin / Evidence / Completion
// 接线：直接复用 fulfillment 域已有的 ListMyOrders 真实读模型，
// 不再经 ComingSoon 占位。访客可见空态，已登录用户看到真实订单。
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, shadows } from "../theme";
import type { FulfillmentClient, FulfillmentOrder } from "../fulfillment-client";
import { SwipeBackShell } from "../architecture/swipe-back";
import { ProxyLoading } from "../components/proxy-foundation";

function orderStatus(order: FulfillmentOrder): string {
  const m = { OFFERED: "待确认", CONFIRMED: "已确认", EXECUTING: "进行中", COMPLETED: "已完成", CANCELLED: "已取消" } as const;
  return (m as Record<string, string>)[order.lifecycle] ?? order.lifecycle;
}
function orderMoney(order: FulfillmentOrder): string {
  return `${order.snapshot.agreedCompensation?.toLocaleString?.() ?? order.snapshot.agreedCompensation} ${order.snapshot.currency || "VND"}`;
}

export function OrderExecutionSurface({ client, onBack }: { client: FulfillmentClient; onBack?: () => void }): React.JSX.Element {
  const [orders, setOrders] = useState<FulfillmentOrder[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [detail, setDetail] = useState<FulfillmentOrder | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await client.listMyOrders();
        if (!cancelled) setOrders(list);
      } catch {
        // 英文技术错不直接展示（未登录和断网都是这个口径）。
        if (!cancelled) setError("订单加载失败，请检查连接后重试。");
      }
    })();
    return () => { cancelled = true; };
  }, [client]);

  if (detail) {
    const fields: Array<[string, string]> = [
      ["服务", detail.snapshot.serviceSku || detail.needId],
      ["金额", orderMoney(detail)],
      ["时间", detail.snapshot.startTime || "待确认"],
      ["地点", detail.snapshot.meetingContext || "待确认"],
      ["时长", detail.snapshot.duration || "待确认"],
      ["结算", detail.snapshot.settlementMode || "待确认"],
      ["状态", orderStatus(detail)],
    ];
    return (
      <SwipeBackShell onExit={() => setDetail(undefined)}>
        <ScrollView style={styles.root} contentContainerStyle={styles.detailContainer}>
          {onBack ? <Pressable onPress={onBack} style={styles.back}><Text selectable style={styles.backText}>‹ 返回</Text></Pressable> : null}
          <Text selectable style={styles.title}>订单 {detail.orderId.slice(0, 8)}</Text>
          <Text selectable style={styles.orderMeta}>{orderStatus(detail)} · {orderMoney(detail)}</Text>
          <View style={styles.card}>
            {fields.map(([k, v]) => <View key={k} style={styles.row}><Text selectable style={styles.k}>{k}</Text><Text selectable style={styles.v}>{v}</Text></View>)}
          </View>
          <Pressable onPress={() => setDetail(undefined)} style={styles.cta}><Text selectable style={styles.ctaText}>返回列表</Text></Pressable>
        </ScrollView>
      </SwipeBackShell>
    );
  }

  return (
    <View style={styles.root}>
      {onBack ? <Pressable onPress={onBack} style={styles.back}><Text selectable style={styles.backText}>‹ 返回</Text></Pressable> : null}
      <Text selectable style={styles.title}>订单执行</Text>
      <Text selectable style={styles.sub}>执行 / 打卡 / 证据 / 完成 — 来自 fulfillment 真实读模型（非占位）</Text>
      {orders === undefined && !error ? <ProxyLoading tone="muted" style={styles.loader} /> : null}
      {error ? <View style={styles.empty}><Text selectable style={styles.emptyText}>加载失败：{error}</Text></View> : null}
      {orders !== undefined && orders.length === 0 && !error ? <View style={styles.empty}><Text selectable style={styles.emptyText}>暂无订单 — 去市场接一个或去首页发布需求</Text></View> : null}
      {orders !== undefined && orders.length > 0 ? (
        <ScrollView contentContainerStyle={styles.list}>
          {orders.map((o) => (
            <Pressable key={o.orderId} onPress={() => setDetail(o)} style={styles.orderCard}>
              <Text selectable style={styles.orderTitle}>{o.snapshot.serviceSku || o.needId}</Text>
              <Text selectable style={styles.orderMeta}>{orderStatus(o)} · {orderMoney(o)}</Text>
              <Text selectable style={styles.orderMeta}>{o.snapshot.startTime || "时间待确认"} · {o.snapshot.meetingContext || "地点待确认"}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1, padding: 16, paddingTop: 8 },
  back: { alignSelf: "flex-start", paddingVertical: 6 },
  backText: { color: color.ink, fontSize: 14, fontWeight: "700" },
  title: { color: color.ink, fontSize: 18, fontWeight: "900", marginTop: 4 },
  sub: { color: color.muted, fontSize: 12, lineHeight: 16, marginTop: 4 },
  loader: { marginTop: 24 },
  empty: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 16, padding: 16, ...shadows.card },
  emptyText: { color: color.muted, fontSize: 13, lineHeight: 18 },
  list: { gap: 10, paddingBottom: 24, paddingTop: 12 },
  orderCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 14, ...shadows.card },
  orderTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  orderMeta: { color: color.muted, fontSize: 12, marginTop: 4 },
  detailContainer: { gap: 10, paddingBottom: 24 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 12, ...shadows.card },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  k: { color: color.muted, fontSize: 12, fontWeight: "600" },
  v: { color: color.ink, fontSize: 12, fontWeight: "700", maxWidth: 180, textAlign: "right" },
  cta: { backgroundColor: color.ink, borderRadius: 999, marginTop: 8, paddingVertical: 12, alignItems: "center" },
  ctaText: { color: color.white, fontSize: 13, fontWeight: "800" },
});
