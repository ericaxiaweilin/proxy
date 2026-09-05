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
import { HomeChatBox, type HomeAttachment, type HomeIntentMode } from "../components/home-chat-box";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { type MarketTab } from "../market-fixtures";
import { color, shadows } from "../theme";
import type { BusinessClient } from "../business-client";
import type { ActivityClient } from "../activity-client";

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
}: {
  onOpenMarket: (tab: MarketTab) => void;
  onOpenMe: () => void;
  onChat?: ((text: string, mode?: HomeIntentMode, attachment?: HomeAttachment) => void) | undefined;
  onChromeVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
  business?: BusinessClient | undefined;
  activities?: ActivityClient | undefined;
}): React.JSX.Element {
  const [intentMode, setIntentMode] = useState<HomeIntentMode>();
  const [accountName, setAccountName] = useState<string | undefined>(undefined);
  const [storeCount, setStoreCount] = useState<number>(0);
  const [pendingItems, setPendingItems] = useState<Array<{ icon: ProxyIconName; title: string; meta?: string }>>([]);
  const [spendSummary, setSpendSummary] = useState<{ totalOrders: number; totalGrossMinor: number }>({ totalOrders: 0, totalGrossMinor: 0 });
  const [scenePackages, setScenePackages] = useState<Array<{ title: string; sub: string; tag: string }>>([]);
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
        const [stores, memberDir, spend] = await Promise.all([
          business.listStores(first.id).catch(() => []),
          business.listMemberDirectory(first.id).catch(() => []),
          business.listSpendDaily({ businessId: first.id, sinceDays: 7 }).catch(() => ({ totalOrders: 0, totalGrossMinor: 0, days: [], sinceDays: 7 })),
        ]);
        if (cancelled) return;
        setStoreCount(stores.length);
        setSpendSummary({ totalOrders: spend.totalOrders, totalGrossMinor: spend.totalGrossMinor });
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
                title: entry.title,
                sub: entry.time,
                tag: entry.moneyFlow === "FREE" ? "可参与" : "可报名",
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

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>可供给场景</Text>
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
        <Pressable key={pkg.title} onPress={() => onOpenMarket("OPPORTUNITY")} style={styles.actionCard}>
          <View style={styles.actionIcon}><ProxyIcon color={color.ink} name="cup" size={20} /></View>
          <View style={styles.actionCopy}><Text style={styles.actionTitle}>{pkg.title}</Text><Text style={styles.subtle}>{pkg.sub}</Text></View>
          <View style={styles.actionMetricTag}><Text style={styles.actionMetricTagText}>{pkg.tag}</Text></View>
        </Pressable>
      ))}

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