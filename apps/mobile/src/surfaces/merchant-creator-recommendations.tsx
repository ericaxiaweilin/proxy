import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { SupplierCandidate, SupplyClient } from "../supply-client";
import { localApiBaseUrl } from "../native-clients";
import { color } from "../theme";

// 供给照片可能是相对路径（/v1/media/...，LAN 安全）或绝对 URL。
// 相对路径按当前 API base 解析， historically 的绝对 URL 原样使用。
function resolveCreatorPhoto(photo: string | undefined): string | undefined {
  if (!photo) return undefined;
  if (photo.startsWith("/")) return `${localApiBaseUrl}${photo}`;
  return photo;
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
  return <View style={styles.section} testID="merchant-creator-recommendations"><View style={styles.head}><View><Text style={styles.title}>Creator 推荐</Text><Text style={styles.hint}>按城市、可用时间与已验证能力匹配</Text></View><Pressable onPress={onOpenAll}><Text style={styles.more}>查看全部 ›</Text></Pressable></View>
    {state === "LOADING" ? <View style={styles.message}><Text style={styles.messageTitle}>正在匹配附近 Creator…</Text></View> : null}
    {state === "ERROR" ? <Pressable onPress={onOpenAll} style={styles.message}><Text style={styles.messageTitle}>推荐暂时不可用</Text><Text style={styles.hint}>进入 Creator 经营可重新加载</Text></Pressable> : null}
    {state === "EMPTY" ? <Pressable onPress={onOpenAll} style={styles.message}><Text style={styles.messageTitle}>附近暂时没有可推荐的 Creator</Text><Text style={styles.hint}>仅展示已激活、时间可用且通过能力校验的真实供给</Text></Pressable> : null}
    {state === "READY" ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>{creators.map((creator) => { const photoUri = resolveCreatorPhoto(creator.photos[0]); return <Pressable key={creator.agentId} onPress={onOpenAll} style={styles.card}>{photoUri ? <Image source={{ uri: photoUri }} style={styles.photo} /> : <View style={styles.photoMissing}><Text style={styles.photoMissingText}>待完善照片</Text></View>}<Text numberOfLines={1} style={styles.name}>{creator.name}</Text><Text numberOfLines={1} style={styles.meta}>{creator.languages.length ? creator.languages.join(" · ") : "已验证 Creator"}</Text><View style={styles.reasons}><Text style={styles.reason}>同城</Text><Text style={styles.reason}>时间可约</Text></View><Text style={styles.price}>{creator.referencePrice > 0 ? `${Math.round(creator.referencePrice / 1000)}K ${creator.currency}` : "报价待沟通"}</Text></Pressable>;})}</ScrollView> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { marginTop: 18 }, head: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }, title: { color: color.ink, fontSize: 17, fontWeight: "800" }, hint: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 2 }, more: { color: "#6830DA", fontSize: 12, fontWeight: "800" }, rail: { gap: 10, paddingRight: 16 }, card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, padding: 10, width: 164 }, photo: { borderRadius: 14, height: 112, width: "100%" }, photoMissing: { alignItems: "center", backgroundColor: color.surface, borderRadius: 14, height: 112, justifyContent: "center" }, photoMissingText: { color: color.muted, fontSize: 11, fontWeight: "700" }, name: { color: color.ink, fontSize: 15, fontWeight: "800", marginTop: 9 }, meta: { color: color.muted, fontSize: 11, marginTop: 2 }, reasons: { flexDirection: "row", gap: 5, marginTop: 8 }, reason: { backgroundColor: "#F1FFD0", borderRadius: 999, color: "#4D6200", fontSize: 11, fontWeight: "800", paddingHorizontal: 7, paddingVertical: 4 }, price: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 8 }, message: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderStyle: "dashed", borderWidth: 1, padding: 16 }, messageTitle: { color: color.ink, fontSize: 13, fontWeight: "800" } });
