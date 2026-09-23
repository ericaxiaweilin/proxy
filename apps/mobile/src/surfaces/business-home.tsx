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
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { HomeChatBox, type HomeAttachment, type HomeIntentMode } from "../components/home-chat-box";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { HorizontalSwipeRail } from "../components/horizontal-swipe-rail";
import { type MarketTab } from "../market-fixtures";
import { useScrollChrome } from "../shell/scroll-chrome";
import { color, shadows } from "../theme";
import type { BusinessClient, MerchantOperatingHome, StoreProduct } from "../business-client";
import type { ActivityClient } from "../activity-client";
import type { SupplyClient } from "../supply-client";
import { localApiBaseUrl } from "../native-clients";
import { MerchantCreatorRecommendations } from "./merchant-creator-recommendations";
import { ProxyLoading } from "../components/proxy-foundation";

type OperatingSceneCard = { id: string; title: string; sub: string; tag: string; coverImageUrl?: string };

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
  const [scenePackages, setScenePackages] = useState<OperatingSceneCard[]>([]);
  const [inProgress, setInProgress] = useState<OperatingSceneCard[]>([]);
  const [operatingHome, setOperatingHome] = useState<MerchantOperatingHome | undefined>(undefined);
  const [planOpen, setPlanOpen] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [planResult, setPlanResult] = useState<string>();
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

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
              const toCard = (entry: (typeof list)[number]): OperatingSceneCard => ({
                id: entry.activityId,
                title: entry.title,
                sub: entry.time,
                tag: entry.moneyFlow === "FREE" ? "可参与" : "可报名",
                ...(entry.coverImageUrl ? { coverImageUrl: entry.coverImageUrl } : {}),
              });
              setScenePackages(list.slice(0, 2).map(toCard));
              setInProgress(list.filter((entry) => entry.origin === "MERCHANT" && entry.status !== "CANCELLED" && (!head || !entry.merchantName || entry.merchantName === head.name)).slice(0, 3).map((entry) => ({ ...toCard(entry), tag: "进行中" })));
            }
          } catch { /* activities optional */ }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [business, activities]);

  // SCROLL-CHROME-001: shared controller (see shell/scroll-chrome.ts).
  const onScroll = useScrollChrome(onChromeVisibilityChange);

  const showLoading = business !== undefined && accountName === undefined && !loadError;
  const homeTitle = useMemo(() => {
    if (loadError) return "商家";
    return accountName ?? "商家";
  }, [accountName, loadError]);

  async function prepareOperatingAction(): Promise<void> {
    if (!activities || !firstStore || !operatingHome || planBusy) return;
    if (operatingHome.bestNextDecision.kind === "STOP_TRAFFIC") {
      setPlanResult("已记录停止引流建议；该动作不会创建活动或新增预算。现场承接状态需要由门店经营权限确认。");
      return;
    }
    setPlanBusy(true);
    setPlanResult(undefined);
    try {
      const selectedSku = menuItems.find((item) => item.available);
      const created = await activities.publish({
        title: operatingHome.bestNextDecision.title,
        time: "待商家确认具体时段",
        capacity: 12,
        venueName: firstStore.name,
        venueIcon: "☕️",
        venueType: "CAFE",
        realitySceneId: operatingHome.sceneSupply?.sceneId ?? firstStore.id,
        desc: `${operatingHome.bestNextDecision.reason}${selectedSku ? ` · 主推 ${selectedSku.name}` : ""}`,
        consumptionTerm: "SPLIT",
        merchantId: firstStore.id,
      });
      setScenePackages((current) => [{ id: created.activityId, title: created.title, sub: created.time, tag: "准备中", ...(created.coverImageUrl ? { coverImageUrl: created.coverImageUrl } : {}) }, ...current.filter((item) => item.id !== created.activityId)]);
      setInProgress((current) => [{ id: created.activityId, title: created.title, sub: created.time, tag: "准备中", ...(created.coverImageUrl ? { coverImageUrl: created.coverImageUrl } : {}) }, ...current.filter((item) => item.id !== created.activityId)]);
      setPlanResult(`已创建「${created.title}」并进入准备；报名不等于到场，只有核验后才计入经营结果。`);
    } catch (error) {
      setPlanResult(error instanceof Error ? error.message : "准备失败，请重试");
    } finally {
      setPlanBusy(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: bottomNavVisible === false ? 16 : 120 }]} onScroll={onScroll} scrollEventThrottle={16}>
      <View style={styles.homeTop}>
        <View style={styles.homeTopCopy}>
          <Text selectable style={styles.homeTopTitle}>{homeTitle}</Text>
          <Text selectable style={styles.homeTopLoc}>
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
                <Text selectable style={styles.identityAvatarText}>{firstStore.name.slice(0, 1).toUpperCase()}</Text>
              </View>;
          })()}
          <View style={styles.identityCopy}>
            <Text selectable style={styles.identityName}>{firstStore.name}</Text>
            <Text selectable style={styles.identityMeta}>{firstStore.address || "地址待完善"} · {firstStore.status} · {memberCount} 经营人员</Text>
          </View>
          <Text selectable style={styles.identityChev}>›</Text>
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
        <View style={styles.controlCell}><Text selectable style={styles.controlLabel}>现在</Text><Text selectable style={styles.controlValue}>{operatingHome?.sceneSupply ? `${operatingHome.sceneSupply.currentCapacityPct}%` : operatingHome?.operatingPulse.state === "ACTIVE" ? "经营中" : "待接入"}</Text></View>
        <View style={styles.controlCell}><Text selectable style={styles.controlLabel}>预测</Text><Text selectable style={styles.controlValue}>{operatingHome?.sceneSupply ? `${operatingHome.sceneSupply.forecastCapacityPct}%` : "不可用"}</Text></View>
        <View style={styles.controlCell}><Text selectable style={styles.controlLabel}>决策</Text><Text selectable numberOfLines={1} style={styles.controlValue}>{operatingHome?.bestNextDecision.kind ?? "NO_ACTION"}</Text></View>
        <View style={styles.controlCell}><Text selectable style={styles.controlLabel}>预期</Text><Text selectable style={styles.controlValue}>{operatingHome?.forecast.status === "AVAILABLE" ? `V${operatingHome.forecast.version}` : "待建立"}</Text></View>
      </View>

      <View style={styles.sectionHead}>
        <Text selectable style={styles.sectionTitle}>经营结果</Text>
        <Text selectable style={styles.sectionHint}>{operatingHome ? `近 ${operatingHome.outcome.windowDays} 天` : "加载中"}</Text>
      </View>
      <View style={styles.outcomeGrid} testID="merchant-business-outcome">
        <View style={styles.metric}><Text selectable style={styles.metricValue}>{operatingHome?.outcome.orderCount ?? "—"}</Text><Text selectable style={styles.metricLabel}>订单</Text></View>
        <View style={styles.metric}><Text selectable style={styles.metricValue}>{operatingHome ? formatVnd(operatingHome.outcome.grossMinor) : "—"}</Text><Text selectable style={styles.metricLabel}>成交</Text></View>
        <View style={styles.metric}><Text selectable style={styles.metricValue}>{operatingHome?.outcome.returningCustomers ?? "—"}</Text><Text selectable style={styles.metricLabel}>复访客户</Text></View>
      </View>

      <View style={styles.sectionHead}>
        <Text selectable style={styles.sectionTitle}>经营脉搏</Text>
        <Text selectable style={styles.sectionHint}>实时状态 → 未来状态</Text>
      </View>
      <View style={styles.balanceCard} testID="merchant-demand-supply">
        <View style={styles.balanceHead}><Text selectable style={styles.balanceTitle}>需求 × 供给</Text><Text selectable style={styles.unknownPill}>{operatingHome?.demandSupply.state ?? "信号不足"}</Text></View>
        {operatingHome?.aggregatedDemand && operatingHome.sceneSupply ? <>
          <View style={styles.signalRow}><View style={styles.signalCell}><Text selectable style={styles.signalLabel}>聚合需求</Text><Text selectable style={styles.signalValue}>{operatingHome.aggregatedDemand.totalMatchingDemand}</Text><Text selectable style={styles.signalSub}>确认 {operatingHome.aggregatedDemand.confirmedArrivals} · 高概率 {operatingHome.aggregatedDemand.highProbabilityArrivals}</Text></View><View style={styles.signalCell}><Text selectable style={styles.signalLabel}>Scene Supply</Text><Text selectable style={styles.signalValue}>{operatingHome.sceneSupply.forecastCapacityPct}%</Text><Text selectable style={styles.signalSub}>当前 {operatingHome.sceneSupply.currentCapacityPct}% · {operatingHome.sceneSupply.acceptingTraffic ? "可承接" : "停止引流"}</Text></View></View>
          <Text selectable style={styles.balanceBody}>Proxy 判断：{operatingHome.demandSupply.reason}</Text>
        </> : <Text selectable style={styles.balanceBody}>尚未获得通过隐私阈值的聚合需求与 Scene 容量数据。</Text>}
        <Text selectable style={styles.balanceMeta}>{operatingHome?.demandSupply.privacyThresholdPassed ? `置信度 ${Math.round(operatingHome.demandSupply.confidence * 100)}% · 仅展示隐私聚合信号` : "不会用历史销售冒充附近客流，也不会生成虚假精确预测。"}</Text>
        {operatingHome ? <Text selectable style={styles.balanceMeta}>门店 {operatingHome.operatingPulse.storeCount} · 成员 {operatingHome.operatingPulse.memberCount} · {operatingHome.operatingPulse.freshness}</Text> : null}
      </View>

      <View style={styles.sectionHead}>
        <Text selectable style={styles.sectionTitle}>最佳下一步</Text>
        <Text selectable style={styles.sectionHint}>低置信策略</Text>
      </View>
      <View style={styles.decisionCard} testID="merchant-best-next-decision">
        <View style={styles.decisionKind}><Text selectable style={styles.decisionKindText}>{operatingHome?.bestNextDecision.kind ?? "NO_ACTION"}</Text></View>
        <Text selectable style={styles.decisionTitle}>{operatingHome?.bestNextDecision.title ?? "等待经营信号"}</Text>
        <Text selectable style={styles.decisionBody}>{operatingHome?.bestNextDecision.reason ?? "数据加载完成前不建议执行动作"}</Text>
        {operatingHome?.bestNextDecision.requiresApproval ? <Pressable onPress={() => { setPlanOpen((open) => !open); setPlanResult(undefined); }} style={styles.decisionAction}><Text selectable style={styles.decisionActionText}>{planOpen ? "收起方案" : "看方案并确认商业条件"}</Text></Pressable> : <Text selectable style={styles.noActionNote}>无需老板处理 · 信号变化时再提醒</Text>}
      </View>
      {planOpen && operatingHome ? <View style={styles.inlinePlan} testID="merchant-inline-operating-plan">
        <Text selectable style={styles.inlinePlanEyebrow}>OPERATING PLAN · 发布前确认</Text>
        <Text selectable style={styles.inlinePlanTitle}>{operatingHome.bestNextDecision.title}</Text>
        <PlanRow label="目标" value={operatingHome.bestNextDecision.kind === "LOW_PEAK_FILL" ? "填补低峰" : operatingHome.bestNextDecision.kind === "STOP_TRAFFIC" ? "保护现场体验" : "经营调整"} />
        <PlanRow label="Scene" value={operatingHome.sceneSupply?.sceneId ?? "待选择"} />
        <PlanRow label="SKU" value={menuItems.find((item) => item.available)?.name ?? "不指定"} />
        <PlanRow label="参与方" value="本店执行 · Creator / Partner 按需补位" />
        <PlanRow label="商业条件" value={operatingHome.bestNextDecision.kind === "STOP_TRAFFIC" ? "不加预算 · 停止新增流量" : "顾客各自消费 · 容量上限 12"} />
        <Text selectable style={styles.inlinePlanBoundary}>确认只授权当前商业条件。预算增加、合作条件变化或对外重大邀请仍需再次确认。</Text>
        <Pressable disabled={planBusy || !activities || !firstStore} onPress={() => { void prepareOperatingAction(); }} style={[styles.prepareButton, (planBusy || !activities || !firstStore) && styles.prepareButtonDisabled]}><Text selectable style={styles.prepareButtonText}>{planBusy ? "正在准备…" : operatingHome.bestNextDecision.kind === "STOP_TRAFFIC" ? "确认处置边界" : "确认并开始准备"}</Text></Pressable>
        {planResult ? <Text selectable style={styles.planResult}>{planResult}</Text> : null}
      </View> : null}

      <View style={styles.sectionHead}>
        <Text selectable style={styles.sectionTitle}>未来需求</Text>
        <Text selectable style={styles.sectionHint}>Forecast</Text>
      </View>
      <View style={styles.forecastEmpty} testID="merchant-future-demand">
        <Text selectable style={styles.forecastTitle}>{operatingHome?.forecast.status === "AVAILABLE" ? `未来容量 ${operatingHome.sceneSupply?.forecastCapacityPct ?? "—"}%` : "预测暂不可用"}</Text>
        <Text selectable style={styles.forecastBody}>{operatingHome?.aggregatedDemand ? `未来到店：已确认 ${operatingHome.aggregatedDemand.confirmedArrivals} · 高概率 ${operatingHome.aggregatedDemand.highProbabilityArrivals}。预测 V${operatingHome.forecast.version}，历史预期不会被覆盖。` : "接入聚合需求、预计到店、离店速度和活动占用后，才会显示未来容量。"}</Text>
      </View>

      <View style={styles.sectionHead}>
        <Text selectable style={styles.sectionTitle}>高价值场景</Text>
        <Text selectable style={styles.sectionHint}>Scene Package</Text>
      </View>
      {showLoading ? <ProxyLoading tone="muted" /> : null}
      {scenePackages.length === 0 && !showLoading ? (
        <Pressable onPress={() => onOpenMarket("OPPORTUNITY")} style={styles.actionCard}>
          <View style={styles.actionIcon}><ProxyIcon color={color.ink} name="storefront" size={20} /></View>
          <View style={styles.actionCopy}><Text selectable style={styles.actionTitle}>暂无开放场景 — server 列表为空</Text></View>
        </Pressable>
      ) : null}
      {scenePackages.map((pkg) => (
        <Pressable key={pkg.id} onPress={() => onOpenMarket("OPPORTUNITY")} style={styles.scenePackageCard}>
          {pkg.coverImageUrl ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`merchant-scene:${pkg.id}`} source={{ uri: pkg.coverImageUrl }} style={styles.scenePackageImage} transition={0} /> : <View style={styles.scenePackageFallback}><ProxyIcon color={color.muted} name="cup" size={24} /></View>}
          <View style={styles.scenePackageBody}><View style={styles.actionCopy}><Text selectable style={styles.actionTitle}>{pkg.title}</Text><Text selectable style={styles.subtle}>{pkg.sub}</Text></View><View style={styles.actionMetricTag}><Text selectable style={styles.actionMetricTagText}>{pkg.tag}</Text></View></View>
        </Pressable>
      ))}

      <MerchantCreatorRecommendations supply={supply} onOpenAll={() => onOpenMarket("OPPORTUNITY")} />

      <View style={styles.sectionHead}>
        <Text selectable style={styles.sectionTitle}>招牌与在售</Text>
        <Text selectable style={styles.sectionHint}>HOT / COOL menu</Text>
      </View>
      {menuItems.length === 0 ? (
        <Pressable onPress={() => onOpenMe()} style={styles.actionCard}>
          <View style={styles.actionIcon}><ProxyIcon color={color.ink} name="storefront" size={20} /></View>
          <View style={styles.actionCopy}><Text selectable style={styles.actionTitle}>还没有菜单</Text><Text selectable style={styles.subtle}>去线上店铺加第一道菜</Text></View>
        </Pressable>
      ) : (
        // SWIPE-RAIL-001：菜单照片横滑不能触发外层切页。
        <HorizontalSwipeRail contentContainerStyle={styles.menuRail} preserveChildPresses threshold={3}>
          {menuItems.filter((m) => m.available).slice(0, 6).map((m) => (
            <Pressable key={m.id} onPress={() => onOpenMe()} style={styles.menuCard}>
              {m.mediaAssetId ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`merchant-sku:${m.id}`} source={{ uri: `${localApiBaseUrl}/v1/media/thumb/${encodeURIComponent(m.mediaAssetId)}` }} style={styles.menuImage} transition={0} /> : <View style={styles.menuImageMissing}><ProxyIcon color={color.muted} name="storefront" size={22} /></View>}
              <Text selectable style={styles.menuName} numberOfLines={1}>{m.name}</Text>
              <Text selectable style={styles.menuPrice}>{formatVnd(m.priceMinor)}</Text>
            </Pressable>
          ))}
        </HorizontalSwipeRail>
      )}

      {inProgress.length ? <>
        <View style={styles.sectionHead}><Text selectable style={styles.sectionTitle}>正在进行</Text><Text selectable style={styles.sectionHint}>只显示本商家动作</Text></View>
        {inProgress.map((item) => <Pressable key={item.id} onPress={() => onOpenMarket("ACTIVITY")} style={styles.progressCard}><View style={styles.progressDot} /><View style={styles.actionCopy}><Text selectable style={styles.actionTitle}>{item.title}</Text><Text selectable style={styles.subtle}>{item.sub} · 报名不等于到场</Text></View><Text selectable style={styles.progressState}>{item.tag}</Text></Pressable>)}
      </> : null}

      <View style={styles.sectionHead}>
        <Text selectable style={styles.sectionTitle}>待处理</Text>
        <Text selectable style={styles.sectionHint}>今天</Text>
      </View>
      {pendingItems.length === 0 && !showLoading ? (
        <Pressable onPress={() => onOpenMe()} style={styles.actionCard}>
          <View style={styles.actionIcon}><ProxyIcon color={color.ink} name="check" size={20} /></View>
          <View style={styles.actionCopy}><Text selectable style={styles.actionTitle}>暂无待处理事项</Text></View>
        </Pressable>
      ) : null}
      {pendingItems.map((item) => (
        <Pressable key={item.title} onPress={() => onOpenMe()} style={styles.actionCard}>
          <View style={styles.actionIcon}>
            <ProxyIcon color={color.ink} name={item.icon} size={20} />
          </View>
          <View style={styles.actionCopy}>
            <Text selectable style={styles.actionTitle}>{item.title}</Text>
            {item.meta ? <Text selectable style={styles.subtle}>{item.meta}</Text> : null}
          </View>
        </Pressable>
      ))}

      <View style={styles.resultCard}>
        <Text selectable style={styles.resultTitle}>场景结果</Text>
        <Text selectable style={styles.resultSub}>
          {spendSummary.totalOrders > 0
            ? `近 7 天 ${spendSummary.totalOrders} 单 · ${formatVnd(spendSummary.totalGrossMinor)}`
            : "暂无成交 — server 列表为空"}
        </Text>
        <Text selectable style={styles.resultHint}>哪种 Scene 真正带来增量消费和复访？</Text>
      </View>

      <Pressable onPress={onOpenMe} style={styles.resume}>
        <Text selectable style={styles.resumeTitle}>经营</Text>
        <Text selectable style={styles.resumeHint}>更多在「我的」›</Text>
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
            <Text selectable style={styles.quickLabel}>{entry.label}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function PlanRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <View style={styles.planRow}><Text selectable style={styles.planLabel}>{label}</Text><Text selectable style={styles.planValue}>{value}</Text></View>;
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
  controlPlane: { backgroundColor: color.ink, borderRadius: 17, flexDirection: "row", gap: 1, marginTop: 10, padding: 5 }, controlCell: { flex: 1, minWidth: 0, paddingHorizontal: 6, paddingVertical: 8 }, controlLabel: { color: "#AAA4B2", fontSize: 11, fontWeight: "700" }, controlValue: { color: color.white, fontSize: 11, fontWeight: "900", marginTop: 4 },
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
  progressCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 7, padding: 12 }, progressDot: { backgroundColor: "#72A000", borderRadius: 5, height: 10, width: 10 }, progressState: { color: "#4D6200", fontSize: 11, fontWeight: "900" },
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
  inlinePlan: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, marginTop: 8, padding: 14 }, inlinePlanEyebrow: { color: "#735700", fontSize: 10, fontWeight: "900", letterSpacing: 0.6 }, inlinePlanTitle: { color: color.ink, fontSize: 17, fontWeight: "900", marginBottom: 10, marginTop: 6 }, planRow: { borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 12, paddingVertical: 10 }, planLabel: { color: color.muted, fontSize: 11, width: 66 }, planValue: { color: color.ink, flex: 1, fontSize: 12, fontWeight: "700", lineHeight: 17 }, inlinePlanBoundary: { backgroundColor: color.proxyPurpleSoft, borderRadius: 12, color: color.muted, fontSize: 11, lineHeight: 17, marginTop: 4, padding: 10 }, prepareButton: { alignItems: "center", backgroundColor: "#FFAB17", borderRadius: 14, marginTop: 12, paddingVertical: 12 }, prepareButtonDisabled: { opacity: 0.45 }, prepareButtonText: { color: color.ink, fontSize: 13, fontWeight: "900" }, planResult: { color: color.ink, fontSize: 11, fontWeight: "700", lineHeight: 17, marginTop: 9 },
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
