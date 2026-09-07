// R18.x: BusinessHome 真接 (商家 Home Tab)
//
// 之前是 242 行 hardcoded mock: 'Bonsaidon / 今天要推进什么?' +
// 3 个固定待办 + 2 个 hardcoded 'Rooftop Photo Afternoon / Aster
// Coffee Sunset' 场景包 + '场景结果 Invite Sent 12' 全部 inline.
//
// 现在 server-authoritative: listMyAccounts 取账号名,
// listStores / listSpendDaily 取门店 / 销售, listActivities 取
// 可供给场景 (Scene Package placeholder for now), member_directory
// 取待处理 / 经营数字.

import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { HomeChatBox, type HomeAttachment, type HomeIntentMode } from "../components/home-chat-box";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { type MarketTab } from "../market-fixtures";
import { color, shadows } from "../theme";
import type { BusinessClient, MerchantOperatingHome, StoreProduct } from "../business-client";
import type { ActivityClient } from "../activity-client";
import type { SupplyClient } from "../supply-client";
import { localApiBaseUrl } from "../native-clients";
import { MerchantCreatorRecommendations } from "./merchant-creator-recommendations";

function formatVnd(minor: number): string {
  const vnd = Math.round(minor / 1000);
  if (vnd >= 1_000_000) return `${(vnd / 1_000_000).toFixed(1)}tr VND`;
  if (vnd >= 1_000) return `${(vnd / 1_000).toFixed(0)}k VND`;
  return `${vnd} VND`;
}

export function BusinessHome({
  onOpenMarket,
  onOpenMe,
  onChat,
  onChromeVisibilityChange,
  bottomNavVisible,
  business,
  activities,
  supply,
}: {
  onOpenMarket: (tab: MarketTab) => void;
  onOpenMe: () => void;
  onChat?: ((text: string, mode?: HomeIntentMode, attachment?: HomeAttachment) => void) | undefined;
  onChromeVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
  business?: BusinessClient | undefined;
  activities?: ActivityClient | undefined;
  supply?: SupplyClient | undefined;
}): React.JSX.Element {
  const [intentMode, setIntentMode] = useState<HomeIntentMode>();
  const [accountName, setAccountName] = useState<string | undefined>(undefined);
  const [storeCount, setStoreCount] = useState<number>(0);
  const [firstStore, setFirstStore] = useState<{ id: string; name: string; address: string; status: string } | undefined>(undefined);
  const [memberCount, setMemberCount] = useState<number>(0);
  const [menuItems, setMenuItems] = useState<StoreProduct[]>([]);
  const [pendingItems, setPendingItems] = useState<Array<{ icon: ProxyIconName; title: string; meta?: string }>>([]);
  const [spendSummary, setSpendSummary] = useState<{ totalOrders: number; totalGrossMinor: number }>({ totalOrders: 0, totalGrossMinor: 0 });
  const [scenePackages, setScenePackages] = useState<Array<{ id: string; title: string; sub: string; tag: string; coverImageUrl?: string }>>([]);
  const [operatingHome, setOperatingHome] = useState<MerchantOperatingHome | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const lastYRef = useRef(0);
  const dirRef = useRef(0);
  const visibleRef = useRef(true);

  useEffect(() => {
    if (!business) return;
    let cancelled = false;
    (async () => {
      try {
        const accounts = await business.listMyAccounts();
        if (cancelled) return;
        const first = accounts[0];
        setAccountName(first?.name);
        if (!first) {
          setPendingItems([]);
          setScenePackages([]);
          return;
        }
        const [stores, memberDir, spend, home] = await Promise.all([
          business.listStores(first.id).catch(() => []),
          business.listMemberDirectory(first.id).catch(() => []),
          business.listSpendDaily({ businessId: first.id, sinceDays: 7 }).catch(() => ({ totalOrders: 0, totalGrossMinor: 0, days: [], sinceDays: 7 })),
          business.getMerchantOperatingHome(first.id),
        ]);
        if (cancelled) return;
        setStoreCount(stores.length);
        const head = stores[0];
        setFirstStore(head ? { id: head.id, name: head.name, address: head.address, status: head.status } : undefined);
        setSpendSummary({ totalOrders: spend.totalOrders, totalGrossMinor: spend.totalGrossMinor });
        setOperatingHome(home);
        setMemberCount(memberDir.length);
        if (head) {
          try {
            const menu = await business.listProducts(head.id);
            if (!cancelled) setMenuItems(menu);
          } catch { /* menu optional */ }
        }
        const items: Array<{ icon: ProxyIconName; title: string; meta?: string }> = [];
        if (stores.length === 0) {
          items.push({ icon: "storefront", title: "暂无门店 — 创建一个开始营业" });
        } else if (stores.length === 1) {
          items.push({ icon: "storefront", title: `1 个门店：${stores[0]?.name ?? ""}`, meta: "查看 → 我的 › 线上店铺" });
        } else {
          items.push({ icon: "storefront", title: `${stores.length} 个门店`, meta: "查看 → 我的 › 线上店铺" });
        }
        if (spend.totalOrders > 0) {
          items.push({ icon: "check", title: `${spend.totalOrders} 单 / ${formatVnd(spend.totalGrossMinor)}`, meta: "近 7 天" });
        } else {
          items.push({ icon: "check", title: "今日现场执行", meta: "暂无订单" });
        }
        items.push({ icon: "target", title: `${memberDir.length} 位经营人员`, meta: "Creator / Operator" });
        setPendingItems(items);
        if (activities) {
          try {
            const list = await activities.listActivities();
            if (!cancelled) {
              setScenePackages(list.slice(0, 2).map((entry) => ({
                id: entry.activityId,
                title: entry.title,
                sub: entry.time,
                tag: entry.moneyFlow === "FREE" ? "可参与" : "可报名",
                ...(entry.coverImageUrl ? { coverImageUrl: entry.coverImageUrl } : {}),
              })));
            }
          } catch { /* activities optional */ }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [business, activities]);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    const delta = y - lastYRef.current;
    if (y <= 48) { if (!visibleRef.current) { visibleRef.current = true; onChromeVisibilityChange?.(true); } dirRef.current = 0; }
    else if (Math.abs(delta) >= 1) {
      const prevDir = Math.sign(dirRef.current);
      const nextDir = Math.sign(delta);
      dirRef.current = prevDir !== 0 && prevDir !== nextDir ? delta : dirRef.current + delta;
      if (dirRef.current <= -18) { if (!visibleRef.current) { visibleRef.current = true; onChromeVisibilityChange?.(true); } dirRef.current = 0; }
      else if (dirRef.current >= 28) { if (visibleRef.current) { visibleRef.current = false; onChromeVisibilityChange?.(false); } dirRef.current = 0; }
    }
    lastYRef.current = y;
  }

  const showLoading = business !== undefined && accountName === undefined && !loadError;
  const homeTitle = useMemo(() => {
    if (loadError) return "商家";
    return accountName ?? "商家";
  }, [accountName, loadError]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: bottomNavVisible === false ? 16 : 120 }]} onScroll={onScroll} scrollEventThrottle={16}>
      <View style={styles.homeTop}>
        <View style={styles.homeTopCopy}>
          <Text style={styles.homeTopTitle}>{homeTitle}</Text>
          <Text style={styles.homeTopLoc}>
            {loadError ? `加载失败：${loadError}` : storeCount > 0 ? `${storeCount} 个门店 · ${spendSummary.totalOrders} 单` : "暂无门店 — 在「我的 › 商家」创建"}
          </Text>
        </View>
      </View>

      {firstStore ? (
        <Pressable onPress={() => onOpenMe()} style={styles.identityCard}>
          {(() => {
            const dish = menuItems.find((m) => m.available && m.mediaAssetId);
            const dishUri = dish ? `${localApiBaseUrl}/v1/media/thumb/${encodeURIComponent(dish.mediaAssetId)}` : undefined;
            return dishUri
              ? <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: dishUri }} style={styles.identityPhoto} transition={0} />
              : <View style={styles.identityAvatar}>
                <Text style={styles.identityAvatarText}>{firstStore.name.slice(0, 1).toUpperCase()}</Text>
              </View>;
          })()}
          <View style={styles.identityCopy}>
            <Text style={styles.identityName}>{firstStore.name}</Text>
            <Text style={styles.identityMeta}>{firstStore.address || "地址待完善"} · {firstStore.status} · {memberCount} 经营人员</Text>
          </View>
          <Text style={styles.identityChev}>›</Text>
        </Pressable>
      ) : null}

      {onChat ? (
        <HomeChatBox
          contextLabel="商家"
          placeholder="例如：周六想办一场门店体验活动"
          mode={intentMode}
          onSelectMode={(mode) => {
            setIntentMode((current) => current === mode ? undefined : mode);
          }}
          onSend={(text, mode, attachment) => onChat(text, mode, attachment)}
        />
      ) : null}

      <View style={styles.controlPlane} testID="merchant-control-plane">
        <View style={styles.controlCell}><Text style={styles.controlLabel}>现在</Text><Text style={styles.controlValue}>{operatingHome?.sceneSupply ? `${operatingHome.sceneSupply.currentCapacityPct}%` : operatingHome?.operatingPulse.state === "ACTIVE" ? "经营中" : "待接入"}</Text></View>
        <View style={styles.controlCell}><Text style={styles.controlLabel}>预测</Text><Text style={styles.controlValue}>{operatingHome?.sceneSupply ? `${operatingHome.sceneSupply.forecastCapacityPct}%` : "不可用"}</Text></View>
        <View style={styles.controlCell}><Text style={styles.controlLabel}>决策</Text><Text numberOfLines={1} style={styles.controlValue}>{operatingHome?.bestNextDecision.kind ?? "NO_ACTION"}</Text></View>
        <View style={styles.controlCell}><Text style={styles.controlLabel}>预期</Text><Text style={styles.controlValue}>{operatingHome?.forecast.status === "AVAILABLE" ? `V${operatingHome.forecast.version}` : "待建立"}</Text></View>
      </View>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>经营结果</Text>
        <Text style={styles.sectionHint}>{operatingHome ? `近 ${operatingHome.outcome.windowDays} 天` : "加载中"}</Text>
      </View>
      <View style={styles.outcomeGrid} testID="merchant-business-outcome">
        <View style={styles.metric}><Text style={styles.metricValue}>{operatingHome?.outcome.orderCount ?? "—"}</Text><Text style={styles.metricLabel}>订单</Text></View>
        <View style={styles.metric}><Text style={styles.metricValue}>{operatingHome ? formatVnd(operatingHome.outcome.grossMinor) : "—"}</Text><Text style={styles.metricLabel}>成交</Text></View>
        <View style={styles.metric}><Text style={styles.metricValue}>{operatingHome?.outcome.returningCustomers ?? "—"}</Text><Text style={styles.metricLabel}>复访客户</Text></View>
      </View>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>经营脉搏</Text>
        <Text style={styles.sectionHint}>实时状态 → 未来状态</Text>
      </View>
      <View style={styles.balanceCard} testID="merchant-demand-supply">
        <View style={styles.balanceHead}><Text style={styles.balanceTitle}>需求 × 供给</Text><Text style={styles.unknownPill}>{operatingHome?.demandSupply.state ?? "信号不足"}</Text></View>
        {operatingHome?.aggregatedDemand && operatingHome.sceneSupply ? <>
          <View style={styles.signalRow}><View style={styles.signalCell}><Text style={styles.signalLabel}>聚合需求</Text><Text style={styles.signalValue}>{operatingHome.aggregatedDemand.totalMatchingDemand}</Text><Text style={styles.signalSub}>确认 {operatingHome.aggregatedDemand.confirmedArrivals} · 高概率 {operatingHome.aggregatedDemand.highProbabilityArrivals}</Text></View><View style={styles.signalCell}><Text style={styles.signalLabel}>Scene Supply</Text><Text style={styles.signalValue}>{operatingHome.sceneSupply.forecastCapacityPct}%</Text><Text style={styles.signalSub}>当前 {operatingHome.sceneSupply.currentCapacityPct}% · {operatingHome.sceneSupply.acceptingTraffic ? "可承接" : "停止引流"}</Text></View></View>
          <Text style={styles.balanceBody}>Proxy 判断：{operatingHome.demandSupply.reason}</Text>
        </> : <Text style={styles.balanceBody}>尚未获得通过隐私阈值的聚合需求与 Scene 容量数据。</Text>}
        <Text style={styles.balanceMeta}>{operatingHome?.demandSupply.privacyThresholdPassed ? `置信度 ${Math.round(operatingHome.demandSupply.confidence * 100)}% · 仅展示隐私聚合信号` : "不会用历史销售冒充附近客流，也不会生成虚假精确预测。"}</Text>
        {operatingHome ? <Text style={styles.balanceMeta}>门店 {operatingHome.operatingPulse.storeCount} · 成员 {operatingHome.operatingPulse.memberCount} · {operatingHome.operatingPulse.freshness}</Text> : null}
      </View>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>最佳下一步</Text>
        <Text style={styles.sectionHint}>低置信策略</Text>
      </View>
      <View style={styles.decisionCard} testID="merchant-best-next-decision">
        <View style={styles.decisionKind}><Text style={styles.decisionKindText}>{operatingHome?.bestNextDecision.kind ?? "NO_ACTION"}</Text></View>
        <Text style={styles.decisionTitle}>{operatingHome?.bestNextDecision.title ?? "等待经营信号"}</Text>
        <Text style={styles.decisionBody}>{operatingHome?.bestNextDecision.reason ?? "数据加载完成前不建议执行动作"}</Text>
        {operatingHome?.bestNextDecision.requiresApproval ? <Pressable onPress={() => onChat?.(`按当前经营建议准备方案：${operatingHome.bestNextDecision.title}`)} style={styles.decisionAction}><Text style={styles.decisionActionText}>看方案并确认商业条件</Text></Pressable> : <Text style={styles.noActionNote}>无需老板处理 · 信号变化时再提醒</Text>}
      </View>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>未来需求</Text>
        <Text style={styles.sectionHint}>Forecast</Text>
      </View>
      <View style={styles.forecastEmpty} testID="merchant-future-demand">
        <Text style={styles.forecastTitle}>{operatingHome?.forecast.status === "AVAILABLE" ? `未来容量 ${operatingHome.sceneSupply?.forecastCapacityPct ?? "—"}%` : "预测暂不可用"}</Text>
        <Text style={styles.forecastBody}>{operatingHome?.aggregatedDemand ? `未来到店：已确认 ${operatingHome.aggregatedDemand.confirmedArrivals} · 高概率 ${operatingHome.aggregatedDemand.highProbabilityArrivals}。预测 V${operatingHome.forecast.version}，历史预期不会被覆盖。` : "接入聚合需求、预计到店、离店速度和活动占用后，才会显示未来容量。"}</Text>
      </View>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>高价值场景</Text>
        <Text style={styles.sectionHint}>Scene Package</Text>
      </View>
      {showLoading ? <ActivityIndicator /> : null}
      {scenePackages.length === 0 && !showLoading ? (
        <Pressable onPress={() => onOpenMarket("OPPORTUNITY")} style={styles.actionCard}>
          <View style={styles.actionIcon}><ProxyIcon color={color.ink} name="storefront" size={20} /></View>
          <View style={styles.actionCopy}><Text style={styles.actionTitle}>暂无开放场景 — server 列表为空</Text></View>
        </Pressable>
      ) : null}
      {scenePackages.map((pkg) => (
        <Pressable key={pkg.id} onPress={() => onOpenMarket("OPPORTUNITY")} style={styles.scenePackageCard}>
          {pkg.coverImageUrl ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`merchant-scene:${pkg.id}`} source={{ uri: pkg.coverImageUrl }} style={styles.scenePackageImage} transition={0} /> : <View style={styles.scenePackageFallback}><ProxyIcon color={color.muted} name="cup" size={24} /></View>}
          <View style={styles.scenePackageBody}><View style={styles.actionCopy}><Text style={styles.actionTitle}>{pkg.title}</Text><Text style={styles.subtle}>{pkg.sub}</Text></View><View style={styles.actionMetricTag}><Text style={styles.actionMetricTagText}>{pkg.tag}</Text></View></View>
        </Pressable>
      ))}

      <MerchantCreatorRecommendations supply={supply} onOpenAll={() => onOpenMarket("OPPORTUNITY")} />

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>招牌与在售</Text>
        <Text style={styles.sectionHint}>HOT / COOL menu</Text>
      </View>
      {menuItems.length === 0 ? (
        <Pressable onPress={() => onOpenMe()} style={styles.actionCard}>
          <View style={styles.actionIcon}><ProxyIcon color={color.ink} name="storefront" size={20} /></View>
          <View style={styles.actionCopy}><Text style={styles.actionTitle}>还没有菜单</Text><Text style={styles.subtle}>去线上店铺加第一道菜</Text></View>
        </Pressable>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.menuRail}>
          {menuItems.filter((m) => m.available).slice(0, 6).map((m) => (
            <Pressable key={m.id} onPress={() => onOpenMe()} style={styles.menuCard}>
              {m.mediaAssetId ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`merchant-sku:${m.id}`} source={{ uri: `${localApiBaseUrl}/v1/media/thumb/${encodeURIComponent(m.mediaAssetId)}` }} style={styles.menuImage} transition={0} /> : <View style={styles.menuImageMissing}><ProxyIcon color={color.muted} name="storefront" size={22} /></View>}
              <Text style={styles.menuName} numberOfLines={1}>{m.name}</Text>
              <Text style={styles.menuPrice}>{formatVnd(m.priceMinor)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>待处理</Text>
        <Text style={styles.sectionHint}>今天</Text>
      </View>
      {pendingItems.length === 0 && !showLoading ? (
        <Pressable onPress={() => onOpenMe()} style={styles.actionCard}>
          <View style={styles.actionIcon}><ProxyIcon color={color.ink} name="check" size={20} /></View>
          <View style={styles.actionCopy}><Text style={styles.actionTitle}>暂无待处理事项</Text></View>
        </Pressable>
      ) : null}
      {pendingItems.map((item) => (
        <Pressable key={item.title} onPress={() => onOpenMe()} style={styles.actionCard}>
          <View style={styles.actionIcon}>
            <ProxyIcon color={color.ink} name={item.icon} size={20} />
          </View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>{item.title}</Text>
            {item.meta ? <Text style={styles.subtle}>{item.meta}</Text> : null}
          </View>
        </Pressable>
      ))}

      <View style={styles.resultCard}>
        <Text style={styles.resultTitle}>场景结果</Text>
        <Text style={styles.resultSub}>
          {spendSummary.totalOrders > 0
            ? `近 7 天 ${spendSummary.totalOrders} 单 · ${formatVnd(spendSummary.totalGrossMinor)}`
            : "暂无成交 — server 列表为空"}
        </Text>
        <Text style={styles.resultHint}>哪种 Scene 真正带来增量消费和复访？</Text>
      </View>

      <Pressable onPress={onOpenMe} style={styles.resume}>
        <Text style={styles.resumeTitle}>经营</Text>
        <Text style={styles.resumeHint}>更多在「我的」›</Text>
      </Pressable>

      <View style={styles.quickRow}>
        {[
          { icon: "storefront" as ProxyIconName, label: "线上店铺" },
          { icon: "arrowUpRight" as ProxyIconName, label: "结果复盘" },
          { icon: "target" as ProxyIconName, label: "客户" },
        ].map((entry) => (
          <Pressable key={entry.label} onPress={onOpenMe} style={styles.quickCard}>
            <View style={styles.quickIcon}>
              <ProxyIcon color={color.muted} name={entry.icon} size={20} />
            </View>
            <Text style={styles.quickLabel}>{entry.label}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 16, paddingTop: 13 },
  homeTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 7 },
  homeTopCopy: { flex: 1 },
  homeTopTitle: { color: color.ink, fontSize: 28, fontWeight: "900", lineHeight: 34 },
  homeTopLoc: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  identityCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, marginTop: 8, padding: 12, ...shadows.card },
  identityAvatar: { alignItems: "center", backgroundColor: "#45208A", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  identityAvatarText: { color: color.white, fontSize: 18, fontWeight: "900" },
  identityPhoto: { borderRadius: 22, height: 44, width: 44 },
  identityCopy: { flex: 1, gap: 2 },
  identityName: { color: color.ink, fontSize: 15, fontWeight: "900" },
  identityMeta: { color: color.muted, fontSize: 11, lineHeight: 15 },
  identityChev: { color: color.muted, fontSize: 18, fontWeight: "800" },
  controlPlane: { backgroundColor: color.ink, borderRadius: 17, flexDirection: "row", gap: 1, marginTop: 10, padding: 5 }, controlCell: { flex: 1, minWidth: 0, paddingHorizontal: 6, paddingVertical: 8 }, controlLabel: { color: "#AAA4B2", fontSize: 9, fontWeight: "700" }, controlValue: { color: color.white, fontSize: 11, fontWeight: "900", marginTop: 4 },
  menuRail: { gap: 10, paddingRight: 16, paddingVertical: 4 },
  menuCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, gap: 4, padding: 8, width: 132 },
  menuImage: { borderRadius: 10, height: 96, width: "100%" },
  menuImageMissing: { alignItems: "center", backgroundColor: color.offWhite, borderRadius: 10, height: 96, justifyContent: "center", width: "100%" },
  menuName: { color: color.ink, fontSize: 13, fontWeight: "800" },
  menuPrice: { color: "#a9231f", fontSize: 12, fontWeight: "900" },
  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginBottom: 6, marginTop: 10 },
  sectionTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  sectionHint: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  actionCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 12, marginVertical: 5, padding: 12, ...shadows.card },
  actionIcon: { alignItems: "center", backgroundColor: "#F3EDFF", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  actionCopy: { flex: 1 },
  actionTitle: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  subtle: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  actionMetricTag: { backgroundColor: color.lime, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6 },
  actionMetricTagText: { color: color.ink, fontSize: 11, fontWeight: "800", lineHeight: 15 },
  scenePackageCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, marginVertical: 5, overflow: "hidden", ...shadows.card }, scenePackageImage: { height: 144, width: "100%" }, scenePackageFallback: { alignItems: "center", backgroundColor: color.offWhite, height: 112, justifyContent: "center" }, scenePackageBody: { alignItems: "center", flexDirection: "row", gap: 10, padding: 12 },
  outcomeGrid: { flexDirection: "row", gap: 8 },
  metric: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flex: 1, paddingHorizontal: 8, paddingVertical: 13 },
  metricValue: { color: color.ink, fontSize: 16, fontWeight: "900", textAlign: "center" },
  metricLabel: { color: color.muted, fontSize: 11, marginTop: 4 },
  balanceCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, padding: 14, ...shadows.card },
  balanceHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  balanceTitle: { color: color.ink, fontSize: 15, fontWeight: "900" },
  unknownPill: { backgroundColor: "#F3F0EA", borderRadius: 999, color: color.muted, fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5 },
  balanceBody: { color: color.ink, fontSize: 12, lineHeight: 18, marginTop: 9 },
  balanceMeta: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 5 },
  signalRow: { flexDirection: "row", gap: 8, marginTop: 10 }, signalCell: { backgroundColor: color.offWhite, borderRadius: 13, flex: 1, padding: 10 }, signalLabel: { color: color.muted, fontSize: 10, fontWeight: "700" }, signalValue: { color: color.ink, fontSize: 22, fontWeight: "900", marginTop: 4 }, signalSub: { color: color.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  decisionCard: { backgroundColor: "#14131A", borderRadius: 18, padding: 15 },
  decisionKind: { alignSelf: "flex-start", backgroundColor: "#F1FFD0", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  decisionKindText: { color: "#4D6200", fontSize: 11, fontWeight: "900" },
  decisionTitle: { color: color.white, fontSize: 17, fontWeight: "900", marginTop: 10 },
  decisionBody: { color: "#D8D3DD", fontSize: 12, lineHeight: 18, marginTop: 5 },
  decisionAction: { alignItems: "center", backgroundColor: "#FFAB17", borderRadius: 13, marginTop: 12, paddingVertical: 11 }, decisionActionText: { color: color.ink, fontSize: 12, fontWeight: "900" }, noActionNote: { color: "#AAA4B2", fontSize: 11, marginTop: 10 },
  forecastEmpty: { backgroundColor: "#F6F3ED", borderColor: color.line, borderRadius: 16, borderStyle: "dashed", borderWidth: 1, padding: 14 },
  forecastTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  forecastBody: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  resume: { alignItems: "center", backgroundColor: color.resumebarBg, borderColor: color.resumebarBorder, borderRadius: 17, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginVertical: 9, padding: 12 },
  resumeTitle: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  resumeHint: { color: "#6A7A2C", fontSize: 11, fontWeight: "600", lineHeight: 21 },
  quickRow: { flexDirection: "row", gap: 7 },
  quickCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, flex: 1, gap: 8, padding: 12 },
  quickIcon: { alignItems: "center", height: 26, justifyContent: "center", width: 26 },
  quickLabel: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  resultCard: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 10, gap: 4, ...shadows.card },
  resultTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  resultSub: { color: color.ink, fontSize: 12, fontWeight: "600" },
  resultHint: { color: color.muted, fontSize: 11 },
});
