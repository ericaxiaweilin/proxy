import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { Activity } from "@proxy/contracts";
import { ActivityClient, ActivityCommandRejectedError } from "../activity-client";
import type { FulfillmentClient, FulfillmentOrder } from "../fulfillment-client";
import { nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import { color } from "../theme";
import { ActivityDetailSurface } from "./activity-detail";
import { styles } from "./me-styles";

type OrderFilter = "all" | "published" | "joined" | "done" | "cancelled";

function orderStatus(order: FulfillmentOrder): string { return ({ OFFERED: "待确认", CONFIRMED: "已确认", EXECUTING: "进行中", COMPLETED: "已完成", CANCELLED: "已取消" } as const)[order.lifecycle]; }
function orderMoney(order: FulfillmentOrder): string { return `${order.snapshot.agreedCompensation.toLocaleString()} ${order.snapshot.currency || "VND"}`; }

export function MyOrdersSurface({ client, onBack }: { client: FulfillmentClient; onBack: () => void }): React.JSX.Element {
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [detail, setDetail] = useState<FulfillmentOrder>();
  useEffect(() => { let active = true; setPhase("LOADING"); void client.listMyOrders().then((rows) => { if (active) { setOrders(rows); setPhase("READY"); } }).catch(() => { if (active) setPhase("ERROR"); }); return () => { active = false; }; }, [client]);
  const visible = orders.filter((order) => filter === "all" || filter === "published" && order.viewerRole === "REQUESTER" || filter === "joined" && order.viewerRole === "AGENT" || filter === "done" && order.lifecycle === "COMPLETED" || filter === "cancelled" && order.lifecycle === "CANCELLED");
  const fields = (order: FulfillmentOrder): Array<[string,string]> => [["服务", order.snapshot.serviceSku || order.needId], ["金额", orderMoney(order)], ["时间", order.snapshot.startTime || "待确认"], ["地点", order.snapshot.meetingContext || "待确认"], ["时长", order.snapshot.duration || "待确认"], ["结算", order.snapshot.settlementMode || "待确认"]];
  if (detail) return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><Pressable onPress={() => setDetail(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回订单</Text></Pressable><Text style={styles.detailTitle}>订单详情</Text><View style={styles.orderCard}><View style={styles.orderHead}><View style={styles.orderCopy}><Text style={styles.orderTitle}>{detail.snapshot.serviceSku || "Proxy 订单"}</Text><Text style={styles.orderId}>{detail.orderId}</Text></View><Text style={[styles.orderBadge, detail.lifecycle === "EXECUTING" && styles.orderBadgeLive]}>{orderStatus(detail)}</Text></View><Text style={styles.orderNotice}>订单编号是订单全生命周期的唯一识别号，用于支付、退款、客服、争议、结算和记录查询。</Text></View><View style={styles.orderCard}><Text style={styles.orderTitle}>服务信息</Text><View style={styles.orderGrid}>{fields(detail).map(([label, value]) => <View key={label} style={styles.orderField}><Text style={styles.orderFieldLabel}>{label}</Text><Text style={styles.orderFieldValue}>{value}</Text></View>)}</View></View></ScrollView></View>;
  return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><View style={styles.orderPageHead}><Pressable onPress={onBack} style={styles.orderBack}><Text style={styles.orderBackText}>‹</Text></Pressable><Text style={styles.detailTitle}>我的订单</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.orderTabs}>{([['all','全部'],['published','我发布的'],['joined','我参与的'],['done','已完成'],['cancelled','已取消']] as const).map(([id,label]) => <Pressable key={id} onPress={() => setFilter(id)} style={[styles.orderTab, filter === id && styles.orderTabOn]}><Text style={[styles.orderTabText, filter === id && styles.orderTabTextOn]}>{label}</Text></Pressable>)}</ScrollView>{phase === "LOADING" ? <ActivityIndicator color={color.magenta} /> : null}{phase === "ERROR" ? <Text style={styles.personalEmpty}>订单服务暂时不可用，请稍后重试。</Text> : null}{phase === "READY" && visible.length === 0 ? <Text style={styles.personalEmpty}>当前分类还没有订单。</Text> : null}{visible.map((item) => <Pressable key={item.orderId} onPress={() => setDetail(item)} style={styles.orderCard}><View style={styles.orderHead}><View style={styles.orderCopy}><Text style={styles.orderTitle}>{item.snapshot.serviceSku || "Proxy 订单"}</Text><Text style={styles.orderId}>订单编号：{item.orderId}</Text></View><Text style={[styles.orderBadge, item.lifecycle === "EXECUTING" && styles.orderBadgeLive]}>{orderStatus(item)}</Text></View><View style={styles.orderGrid}>{fields(item).slice(0,4).map(([label,value]) => <View key={label} style={styles.orderField}><Text style={styles.orderFieldLabel}>{label}</Text><Text style={styles.orderFieldValue}>{value}</Text></View>)}</View></Pressable>)}</ScrollView></View>;
}

export function MyActivitiesSurface({ onBack }: { onBack: () => void }): React.JSX.Element {
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
        <ActivityDetailSurface client={client} initialActivityId={detailId} onBack={() => { setDetailId(undefined); reload(); }} />
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.orderPageHead}>
          <Pressable onPress={onBack} style={styles.orderBack}><Text style={styles.orderBackText}>‹</Text></Pressable>
          <Text style={styles.detailTitle}>我的活动</Text>
        </View>
        <View style={styles.activityOwnedTabs}>
          {([["open", "可参加"], ["joined", "已参加"], ["created", "我发起的"]] as const).map(([id, label]) => (
            <Pressable key={id} onPress={() => setTab(id)} style={[styles.activityOwnedTab, tab === id && styles.activityOwnedTabOn]}>
              <Text style={[styles.activityOwnedTabText, tab === id && styles.activityOwnedTabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {notice ? <Text style={styles.savedMeta}>{notice}</Text> : null}
        {!authed ? <Text style={styles.savedMeta}>登录后才能查看 “已参加” / “我发起的”。</Text> : null}
        {phase === "LOADING" ? <ActivityIndicator color={color.magenta} /> : null}
        {phase === "ERROR" ? (
          <View>
            <Text style={styles.personalEmpty}>活动加载失败，请检查连接后重试。</Text>
            <Pressable onPress={() => reload()} style={[styles.orderTab, styles.orderTabOn]}><Text style={[styles.orderTabText, styles.orderTabTextOn]}>重试</Text></Pressable>
          </View>
        ) : null}
        {phase === "READY" && tab === "created" && authed && items.length === 0 ? <Text style={styles.personalEmpty}>还没有发起过活动。</Text> : null}
        {phase === "READY" && tab === "joined" && authed && items.length === 0 ? <Text style={styles.personalEmpty}>还没有报名，去可参加看看。</Text> : null}
        {phase === "READY" && tab === "open" && items.length === 0 ? <Text style={styles.personalEmpty}>本周暂无开放活动。</Text> : null}
        {phase === "READY" ? items.map((item) => {
          const joinedSet = new Set(joined.map((a) => a.activityId));
          const isJoined = joinedSet.has(item.activityId);
          const capacity = item.capacity ?? 0;
          const full = capacity > 0 && item.joined >= capacity;
          return (
            <Pressable key={item.activityId} onPress={() => setDetailId(item.activityId)} style={styles.savedCard}>
              <Text style={styles.orderTitle}>{item.title}</Text>
              <Text style={styles.savedMeta}>{item.time} · {item.venueIcon} {item.venueName}</Text>
              <Text style={styles.savedMeta}>{item.priceLabel}{item.price ? ` · ${item.price}` : ""} · 感兴趣 {item.interested} · 已报名 {item.joined}{capacity > 0 ? `/${capacity}` : ""}</Text>
              {item.aiStatus !== "NONE" && item.aiPersonaName ? <Text style={styles.savedMeta}>AI 虚拟 · {item.aiPersonaName}</Text> : null}
              <Text style={styles.savedMeta}>查看明细 ›</Text>
              {tab === "open" ? (
                <Pressable
                  disabled={isJoined || full || joiningId === item.activityId}
                  onPress={() => void join(item.activityId)}
                  style={[styles.orderTab, (isJoined || full) && styles.orderTabOn]}
                >
                  <Text style={[styles.orderTabText, (isJoined || full) && styles.orderTabTextOn]}>
                    {joiningId === item.activityId ? "报名中…" : isJoined ? "已报名" : full ? "已满员" : "报名"}
                  </Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        }) : null}
      </ScrollView>
    </View>
  );
}

type FavoriteTab = "all" | "merchant" | "creator" | "post" | "activity";

export function FavoritesSurface({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<FavoriteTab>("all");
  const entries = [{ type: "merchant", title: "Luna Spa", meta: "Beauty & Wellness · 西湖区" }, { type: "creator", title: "Linh Tran", meta: "Creator · 美妆 / Lifestyle" }];
  const visible = tab === "all" ? entries : entries.filter((item) => item.type === tab);
  return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><View style={styles.orderPageHead}><Pressable onPress={onBack} style={styles.orderBack}><Text style={styles.orderBackText}>‹</Text></Pressable><Text style={styles.detailTitle}>收藏</Text></View><Text style={styles.savedIntro}>很轻的个人备忘夹。以后还想找到，就放这里。</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.orderTabs}>{([['all','全部'],['merchant','商家'],['creator','Creator'],['post','动态'],['activity','活动']] as const).map(([id,label]) => <Pressable key={id} onPress={() => setTab(id)} style={[styles.orderTab, tab === id && styles.orderTabOn]}><Text style={[styles.orderTabText, tab === id && styles.orderTabTextOn]}>{label}</Text></Pressable>)}</ScrollView>{visible.length ? visible.map((item) => <View key={item.title} style={[styles.savedCard, styles.savedRow]}><View style={styles.savedThumb}><Text style={styles.savedThumbText}>☆</Text></View><View><Text style={styles.orderTitle}>{item.title}</Text><Text style={styles.savedMeta}>{item.meta}</Text></View></View>) : <View style={styles.savedCard}><Text style={styles.savedMeta}>这里还没有收藏。</Text></View>}</ScrollView></View>;
}
