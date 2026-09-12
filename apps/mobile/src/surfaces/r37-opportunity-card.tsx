// R37 Market redesign — opportunity card with type logo (visual focus),
// single-line meta, and a black "我想接" CTA. Replaces R4OpportunityCard
// "stacked text" layout that was reading as too text-heavy.
//
// R34.5 audit feedback (commander): "市场-机会的UI改下 目前的UI不行
// 文字太多 不够抓眼球". R37.4 reference approvedLogo assets (4 unique
// 68x68 PNGs from /Users/thanhhuyennguyen/Downloads/Proxy_Market_R37_4
// _Exact_Approved_Order_Logos.html) live at src/assets/order-type-logos.
//
// Layout: 104x136 scene photo | type logo (top-left) + title + meta line
//                              + why line
//                              + price (label + range) | takeBtn

import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { type MarketOpportunity, type MarketOpportunityMoneyFlow } from "../market-fixtures";
import { color } from "../theme";
import { MarketTypeLogo, type MarketOpportunityType } from "../components/market-type-logo";

export type OpportunityType = MarketOpportunityType;

const TYPE_LABEL: Record<OpportunityType, { label: string; sub: string }> = {
  coffee_photo: { label: "咖啡 + 拍照", sub: "Coffee" },
  walk_photo: { label: "City Walk + 拍照", sub: "Walk" },
  coffee_chinese: { label: "咖啡 + 中文", sub: "Talk" },
  bilingual_store: { label: "看店 + 双语", sub: "Language" },
  event_photo: { label: "活动 + 拍照", sub: "Event" },
};

const SAMPLE_SCENE_IMAGE: Record<OpportunityType, number> = {
  coffee_photo: require("../../assets/market-scene-samples/coffee-photo-v1.jpg"),
  coffee_chinese: require("../../assets/market-scene-samples/coffee-photo-v1.jpg"),
  walk_photo: require("../../assets/market-scene-samples/city-walk-photo-v1.jpg"),
  bilingual_store: require("../../assets/market-scene-samples/bilingual-store-v1.jpg"),
  event_photo: require("../../assets/market-scene-samples/event-photo-v1.jpg"),
};

export function inferOpportunityTypeForFilter(opportunity: MarketOpportunity): OpportunityType {
  if (opportunity.opportunityType) return opportunity.opportunityType;
  const theme = (opportunity.theme ?? "").toLowerCase();
  const skills = (opportunity.skills ?? "").toLowerCase();
  const title = (opportunity.title ?? "").toLowerCase();
  if (theme.includes("walk") || title.includes("walk") || skills.includes("walk")) return "walk_photo";
  if (theme.includes("双语") || skills.includes("双语") || skills.includes("bilingual")) return "bilingual_store";
  if (theme.includes("活动") || skills.includes("活动") || title.includes("活动") || title.includes("event")) return "event_photo";
  if (theme.includes("中文") || skills.includes("中文") || skills.includes("chinese")) return "coffee_chinese";
  return "coffee_photo";
}

function inferType(opportunity: MarketOpportunity): OpportunityType {
  return inferOpportunityTypeForFilter(opportunity);
}

function formatRange(budget: string, moneyFlow: MarketOpportunityMoneyFlow): { label: string; value: string; negotiable: boolean } {
  const num = parseInt(budget.replace(/\D/g, ""), 10);
  if (Number.isNaN(num) || num === 0) {
    return { label: moneyFlow === "FREE" ? "同好/社区" : moneyFlow === "TBD" ? "双方面谈" : "完成后获得", value: moneyFlow === "FREE" ? "0₫" : moneyFlow === "TBD" ? "—" : "费用待确认", negotiable: true };
  }
  const k = Math.round(num / 1000);
  const low = Math.round(k * 0.95);
  const high = Math.round(k * 1.35);
  return { label: "参考区间", value: `${low}–${high}K`, negotiable: true };
}

function buildWhy(opportunity: MarketOpportunity): string {
  const parts: string[] = [];
  if (opportunity.skills) parts.push(opportunity.skills.split("·").slice(0, 2).map((s: string) => s.trim()).join(" · "));
  if (opportunity.location) parts.push(opportunity.location);
  return parts.filter(Boolean).join(" · ");
}

// The 68px approved asset contains the complete rounded logo tile; filling the
// slot avoids nesting it inside a second beige tile and shrinking the glyph.
export function R37OpportunityCard({ opportunity, onOpen, onDismiss }: { opportunity: MarketOpportunity; onOpen: () => void; onDismiss: () => void }): React.JSX.Element {
  const type = inferType(opportunity);
  const typeLabel = TYPE_LABEL[type];
  const range = formatRange(opportunity.price ?? "0", opportunity.moneyFlow);
  const why = buildWhy(opportunity);
  const fit = opportunity.match ?? "0%";
  const isHot = opportunity.signalClass === "hot";

  return (
    <View style={styles.card}>
      <Pressable onPress={onOpen} style={styles.thumbWrap}>
        <View style={styles.thumb}>
          <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`market-scene:${opportunity.id}`} source={opportunity.sceneImageUrl ? { uri: opportunity.sceneImageUrl } : SAMPLE_SCENE_IMAGE[type]} style={StyleSheet.absoluteFill} transition={0} />
          {!opportunity.sceneImageUrl ? <View style={styles.sampleTag}><Text style={styles.sampleTagText}>AI 样张</Text></View> : null}
        </View>
      </Pressable>
      <View style={styles.body}>
        <View style={styles.typeRow}>
          <MarketTypeLogo type={type} size="CARD" />
          <View style={styles.typeMeta}>
            <Text style={styles.typeMetaLabel}>标准订单类型</Text>
            <Text style={styles.typeMetaTitle} numberOfLines={1}>{typeLabel.label}</Text>
          </View>
          <View style={styles.fitTag}>
            <View style={[styles.fitDot, isHot && styles.fitDotHot]} />
            <Text style={styles.fitTagText}>{fit} 匹配</Text>
          </View>
        </View>
        <Text style={styles.oppTitle} numberOfLines={1}>{opportunity.title}</Text>
        <View style={styles.metaLine}>
          {opportunity.date ? <Text style={styles.metaText}>{opportunity.date} {opportunity.time}</Text> : null}
          {opportunity.date ? <View style={styles.dot} /> : null}
          {opportunity.location ? <Text style={styles.metaText}>{opportunity.location}</Text> : null}
        </View>
        {why ? <Text style={styles.why} numberOfLines={1}>{why}</Text> : null}
        <View style={styles.cardFoot}>
          <View style={styles.price}>
            <Text style={styles.priceLabel}>{range.label}</Text>
            <View style={styles.priceValueRow}>
              <Text style={styles.priceValue}>{range.value}</Text>
              {range.negotiable ? <Text style={styles.priceNegotiable}>可协商</Text> : null}
            </View>
          </View>
          <Pressable onPress={onOpen} style={styles.takeBtn}>
            <Text style={styles.takeBtnText}>我想接</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.white, borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 12 },
  thumbWrap: { alignSelf: "stretch" },
  thumb: { backgroundColor: "#F1ECE3", flex: 1, minHeight: 136, overflow: "hidden", width: 104 },
  sampleTag: { backgroundColor: "rgba(20,19,26,.74)", borderRadius: 6, bottom: 6, left: 6, paddingHorizontal: 6, paddingVertical: 3, position: "absolute" }, sampleTagText: { color: color.white, fontSize: 8, fontWeight: "800" },
  body: { flex: 1, minWidth: 0, paddingBottom: 12, paddingRight: 14, paddingTop: 12 },
  typeRow: { alignItems: "center", flexDirection: "row", gap: 9, marginBottom: 5 },
  typeMeta: { flex: 1, minWidth: 0 },
  typeMetaLabel: { color: "#AAA49C", fontSize: 6.4, letterSpacing: 0.15, lineHeight: 9 },
  typeMetaTitle: { color: color.ink, fontSize: 10.5, fontWeight: "800", lineHeight: 13, marginTop: 1 },
  fitTag: { alignItems: "center", flexDirection: "row", gap: 4 },
  fitDot: { backgroundColor: "#F2AD29", borderRadius: 999, height: 5, width: 5 },
  fitDotHot: { backgroundColor: "#B91451" },
  fitTagText: { color: "#7A5711", fontSize: 7, fontWeight: "800" },
  oppTitle: { color: "#716B63", fontSize: 8.8, lineHeight: 12, marginTop: 1 },
  metaLine: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 4 },
  metaText: { color: "#6F6A63", fontSize: 8 },
  dot: { backgroundColor: "#BDB7AF", borderRadius: 999, height: 2, width: 2 },
  why: { color: "#8F8A82", fontSize: 7.5, marginTop: 4 },
  cardFoot: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginTop: 7 },
  price: { flex: 1 },
  priceLabel: { color: "#AAA49C", fontSize: 6.5, lineHeight: 9, marginBottom: 3 },
  priceValueRow: { alignItems: "baseline", flexDirection: "row", gap: 4 },
  priceValue: { color: color.ink, fontSize: 15, fontWeight: "800", letterSpacing: -0.4 },
  priceNegotiable: { color: "#8B857C", fontSize: 6.5, fontWeight: "700" },
  takeBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 4, height: 30, justifyContent: "center", paddingHorizontal: 13 },
  takeBtnText: { color: color.white, fontSize: 8.5, fontWeight: "800" },
});
