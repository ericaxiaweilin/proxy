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
/**
 * CREATOR-AVATAR-001（2026-10-01，用户「creator中心 creator list 不能只是文本list
 * 要有头像啊」）：照片解析只有一个实现，两个面共用 ——
 * merchant-creator-recommendations 的横滑卡已经会画头像，而 merchant-me-r21 的
 * Creator 经营列表只把 photos.length 印成一个数字，头像一直没画。
 * 两边各写一份解析的话，"为什么这边有图那边没有"会变成没法回答的问题。
 */
export function resolveCreatorPhoto(photo: string | undefined): string | undefined {
  if (!photo) return undefined;
  const source = resolveAssetSource(
    photo.startsWith("/") ? { kind: "serverPath", path: photo } : { kind: "remote", url: photo },
    { baseUrl: localApiBaseUrl }
  );
  return typeof source === "object" ? source.uri : undefined;
}

// CREATOR-RAIL-HOME-001（2026-10-02，用户「点击creator头像 不能弹出入口」）：
// 横滑卡点下去原来直接 onOpenAll（进 Market 机会列表）—— 点的是 Linh 的脸，
// 落到的是市场大盘，跟这个人一点关系没有。-card 点人就该到人。
// onOpenCreator 有就进个人主页，没有就回落 onOpenAll（别处复用不断）。
export function MerchantCreatorRecommendations({ supply, marketId = "hn", onOpenAll, onOpenCreator }: { supply: SupplyClient | undefined; marketId?: string; onOpenAll: () => void; onOpenCreator?: ((creator: SupplierCandidate) => void) | undefined }): React.JSX.Element {
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
    {state === "READY" ? <HorizontalSwipeRail contentContainerStyle={styles.rail} preserveChildPresses threshold={3}>{creators.map((creator) => { const photoUri = resolveCreatorPhoto(creator.photos[0]); return <Pressable key={creator.agentId} accessibilityLabel={`查看${creator.name}的个人主页`} testID={`rail-creator-home-${creator.agentId}`} onPress={() => { if (onOpenCreator) onOpenCreator(creator); else onOpenAll(); }} style={styles.card}>{photoUri ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`merchant-creator:${creator.agentId}`} source={{ uri: photoUri }} style={styles.photo} transition={0} /> : <View style={styles.photoMissing}><Text selectable style={styles.photoMissingText}>待完善照片</Text></View>}<Text selectable numberOfLines={1} style={styles.name}>{creator.name}</Text><Text selectable numberOfLines={1} style={styles.meta}>{creator.languages.length ? creator.languages.join(" · ") : "已验证 Creator"}</Text><View style={styles.reasons}><Text selectable style={styles.reason}>同城</Text><Text selectable style={styles.reason}>时间可约</Text></View><Text selectable style={styles.price}>{creator.referencePrice > 0 ? `${Math.round(creator.referencePrice / 1000)}K ${creator.currency}` : "报价待沟通"}</Text></Pressable>;})}</HorizontalSwipeRail> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { marginTop: 18 }, head: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }, title: { color: color.ink, fontSize: 17, fontWeight: "800" }, hint: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 2 }, more: { color: "#6830DA", fontSize: 12, fontWeight: "800" }, rail: { gap: 10, paddingRight: 16 }, card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, padding: 10, width: 164 }, photo: { borderRadius: 14, height: 112, width: "100%" }, photoMissing: { alignItems: "center", backgroundColor: color.surface, borderRadius: 14, height: 112, justifyContent: "center" }, photoMissingText: { color: color.muted, fontSize: 11, fontWeight: "700" }, name: { color: color.ink, fontSize: 15, fontWeight: "800", marginTop: 9 }, meta: { color: color.muted, fontSize: 11, marginTop: 2 }, reasons: { flexDirection: "row", gap: 5, marginTop: 8 }, reason: { backgroundColor: "#F1FFD0", borderRadius: 999, color: "#4D6200", fontSize: 11, fontWeight: "800", paddingHorizontal: 7, paddingVertical: 4 }, price: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 8 }, message: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderStyle: "dashed", borderWidth: 1, padding: 16 }, messageTitle: { color: color.ink, fontSize: 13, fontWeight: "800" } });
