import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import type { SupplierCandidate, SupplyClient } from "../supply-client";
import { localApiBaseUrl } from "../native-clients";
import { resolveAssetSource } from "../media/asset-sources";
import { color } from "../theme";
import { HorizontalSwipeRail } from "../components/horizontal-swipe-rail";

// 供给照片可能是相对路径（/v1/media/...，LAN 安全）或绝对 URL。
// 经统一资产层解析；拼不出的进缺图占位，不渲染坏图。
function resolveCreatorPhoto(photo: string | undefined): string | undefined {
  if (!photo) return undefined;
  const source = resolveAssetSource(
    photo.startsWith("/") ? { kind: "serverPath", path: photo } : { kind: "remote", url: photo },
    { baseUrl: localApiBaseUrl }
  );
  return typeof source === "object" ? source.uri : undefined;
}

export function MerchantCreatorRecommendations({ supply, marketId = "hn", onOpenAll }: { supply: SupplyClient | undefined; marketId?: string; onOpenAll: () => void }): React.JSX.Element {
  const [creators, setCreators] = useState<SupplierCandidate[]>([]);
  const [state, setState] = useState<"LOADING" | "READY" | "EMPTY" | "ERROR">(supply ? "LOADING" : "EMPTY");
  useEffect(() => {
    let active = true;
    if (!supply) { setState("EMPTY"); return () => { active = false; }; }
    setState("LOADING");
    void supply.querySuppliers({ marketId, limit: 6 }).then((items) => { if (active) { setCreators(items); setState(items.length ? "READY" : "EMPTY"); } }).catch(() => { if (active) setState("ERROR"); });
    return () => { active = false; };
  }, [marketId, supply]);
  return <View style={styles.section} testID="merchant-creator-recommendations"><View style={styles.head}><View><Text selectable style={styles.title}>Creator 推荐</Text><Text selectable style={styles.hint}>按城市、可用时间与已验证能力匹配</Text></View><Pressable onPress={onOpenAll}><Text selectable style={styles.more}>查看全部 ›</Text></Pressable></View>
    {state === "LOADING" ? <View style={styles.message}><Text selectable style={styles.messageTitle}>正在匹配附近 Creator…</Text></View> : null}
    {state === "ERROR" ? <Pressable onPress={onOpenAll} style={styles.message}><Text selectable style={styles.messageTitle}>没能连上，刷新再试试。</Text><Text selectable style={styles.hint}>进入 Creator 经营可重新加载</Text></Pressable> : null}
    {state === "EMPTY" ? <Pressable onPress={onOpenAll} style={styles.message}><Text selectable style={styles.messageTitle}>附近暂时没有可推荐的 Creator</Text><Text selectable style={styles.hint}>仅展示已激活、时间可用且通过能力校验的真实供给</Text></Pressable> : null}
    {/* SWIPE-RAIL-001：Creator 照片横滑不能触发外层切页。 */}
    {state === "READY" ? <HorizontalSwipeRail contentContainerStyle={styles.rail} preserveChildPresses threshold={3}>{creators.map((creator) => { const photoUri = resolveCreatorPhoto(creator.photos[0]); return <Pressable key={creator.agentId} onPress={onOpenAll} style={styles.card}>{photoUri ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`merchant-creator:${creator.agentId}`} source={{ uri: photoUri }} style={styles.photo} transition={0} /> : <View style={styles.photoMissing}><Text selectable style={styles.photoMissingText}>待完善照片</Text></View>}<Text selectable numberOfLines={1} style={styles.name}>{creator.name}</Text><Text selectable numberOfLines={1} style={styles.meta}>{creator.languages.length ? creator.languages.join(" · ") : "已验证 Creator"}</Text><View style={styles.reasons}><Text selectable style={styles.reason}>同城</Text><Text selectable style={styles.reason}>时间可约</Text></View><Text selectable style={styles.price}>{creator.referencePrice > 0 ? `${Math.round(creator.referencePrice / 1000)}K ${creator.currency}` : "报价待沟通"}</Text></Pressable>;})}</HorizontalSwipeRail> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { marginTop: 18 }, head: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }, title: { color: color.ink, fontSize: 17, fontWeight: "800" }, hint: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 2 }, more: { color: "#6830DA", fontSize: 12, fontWeight: "800" }, rail: { gap: 10, paddingRight: 16 }, card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, padding: 10, width: 164 }, photo: { borderRadius: 14, height: 112, width: "100%" }, photoMissing: { alignItems: "center", backgroundColor: color.surface, borderRadius: 14, height: 112, justifyContent: "center" }, photoMissingText: { color: color.muted, fontSize: 11, fontWeight: "700" }, name: { color: color.ink, fontSize: 15, fontWeight: "800", marginTop: 9 }, meta: { color: color.muted, fontSize: 11, marginTop: 2 }, reasons: { flexDirection: "row", gap: 5, marginTop: 8 }, reason: { backgroundColor: "#F1FFD0", borderRadius: 999, color: "#4D6200", fontSize: 11, fontWeight: "800", paddingHorizontal: 7, paddingVertical: 4 }, price: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 8 }, message: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderStyle: "dashed", borderWidth: 1, padding: 16 }, messageTitle: { color: color.ink, fontSize: 13, fontWeight: "800" } });
