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
import { type MarketOpportunity, type MarketOpportunityMoneyFlow, parseOpportunityPrice } from "../market-fixtures";
import { color } from "../theme";
import { MarketTypeLogo, type MarketOpportunityType } from "../components/market-type-logo";

export type OpportunityType = MarketOpportunityType;

// R37-DETAIL-001: 导出给订单详情用。以前详情页头部写的是英文 OPPORTUNITY
// kicker，卡片却是「标准订单类型 + 咖啡 + 拍照」—— 点进去之后视觉断掉。
// 两处共用这一张表，改文案不会出现"卡片改了详情页没改"。
export const TYPE_LABEL: Record<OpportunityType, { label: string; sub: string }> = {
  coffee_photo: { label: "咖啡 + 拍照", sub: "Coffee" },
  walk_photo: { label: "City Walk + 拍照", sub: "Walk" },
  coffee_chinese: { label: "咖啡 + 中文", sub: "Talk" },
  bilingual_store: { label: "看店 + 双语", sub: "Language" },
  event_photo: { label: "活动 + 拍照", sub: "Event" },
  // OPP-TYPE-OTHER-001: 识别不出来就是未分类，不假装知道它是咖啡 + 拍照。
  other: { label: "其他 · 未分类", sub: "Other" },
};

// MARKET-QUOTE-SHEET-001: 详情 hero 兜底图与卡片共用这一张（同 TYPE_LABEL
// 一样的道理：两处各写一份，改了卡片详情又漂移）。
export const SAMPLE_SCENE_IMAGE: Record<OpportunityType, number> = {
  coffee_photo: require("../../assets/market-scene-samples/coffee-photo-v1.jpg"),
  coffee_chinese: require("../../assets/market-scene-samples/coffee-photo-v1.jpg"),
  walk_photo: require("../../assets/market-scene-samples/city-walk-photo-v1.jpg"),
  bilingual_store: require("../../assets/market-scene-samples/bilingual-store-v1.jpg"),
  event_photo: require("../../assets/market-scene-samples/event-photo-v1.jpg"),
  other: 0,
};
// 未分类没有自己的样张：复用咖啡那张（hero 上本来就带「AI 样张」标记）。
// 没有新写一行 require —— media 管线 R1 禁止在 media/ 之外新增 assets require。
SAMPLE_SCENE_IMAGE.other = SAMPLE_SCENE_IMAGE.coffee_photo;

export function inferOpportunityTypeForFilter(opportunity: { opportunityType?: OpportunityType; theme?: string; skills?: string; title?: string }): OpportunityType {
  if (opportunity.opportunityType) return opportunity.opportunityType;
  const theme = (opportunity.theme ?? "").toLowerCase();
  const skills = (opportunity.skills ?? "").toLowerCase();
  const title = (opportunity.title ?? "").toLowerCase();
  if (theme.includes("walk") || title.includes("walk") || skills.includes("walk")) return "walk_photo";
  if (theme.includes("双语") || skills.includes("双语") || skills.includes("bilingual")) return "bilingual_store";
  if (theme.includes("活动") || skills.includes("活动") || title.includes("活动") || title.includes("event")) return "event_photo";
  if (theme.includes("中文") || skills.includes("中文") || skills.includes("chinese")) return "coffee_chinese";
  // OPP-TYPE-OTHER-001: 一个关键词都不中时归未分类。以前这里返回 coffee_photo，
  // 于是自定义发布（大多不带 opportunityType）全掉进「咖啡 + 拍照」—— 这个类目
  // 被稀释成垃圾桶，筛选时也会把无关机会算进来。
  return "other";
}

function inferType(opportunity: MarketOpportunity): OpportunityType {
  return inferOpportunityTypeForFilter(opportunity);
}

// MARKET-PRICE-RANGE-PARSE-001: 这里以前把 price 里的数字整串抠出来当单一预算，
// 再乘两个系数外推一个「参考区间」。两个问题：
//   · price 可以是发布方自己填的真区间（两端各有一个金额），抠数字会把两端拼成
//     一个天文数字，卡片上显示成一串没人看得懂的 K 值；
//   · 只有单一价格时，那个区间是客户端替发布方外推的，没有人填过这两框。
// 现在：有真区间就显示真区间；只有一个价就显示那个价，不外推，也不声称可协商。
function formatRange(budget: string, moneyFlow: MarketOpportunityMoneyFlow, priceLabel?: string): { label: string; value: string; negotiable: boolean } {
  const parsed = parseOpportunityPrice(budget);
  if (parsed.low <= 0) {
    return { label: moneyFlow === "FREE" ? "同好/社区" : moneyFlow === "TBD" ? "双方面谈" : "完成后获得", value: moneyFlow === "FREE" ? "0₫" : moneyFlow === "TBD" ? "—" : "费用待确认", negotiable: true };
  }
  if (parsed.hasRange) {
    return { label: "报价区间", value: `${Math.round(parsed.low / 1000)}–${Math.round(parsed.high / 1000)}K`, negotiable: true };
  }
  return { label: priceLabel?.trim() || (moneyFlow === "EARN" ? "完成后获得" : "报价"), value: `${Math.round(parsed.low / 1000)}K`, negotiable: false };
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
  const range = formatRange(opportunity.price ?? "0", opportunity.moneyFlow, opportunity.priceLabel);
  const why = buildWhy(opportunity);
  // MARKET-FAKE-JUDGMENT-001: 服务端没有匹配引擎时 match 是空串 —— 这时候不能
  // 渲染「N% 匹配」标签。以前缺省值写的是 "0%"，等于把"没算过"显示成"0% 匹配"。
  const fit = (opportunity.match ?? "").trim();
  const isHot = opportunity.signalClass === "hot";

  return (
    <View style={styles.card}>
      <Pressable onPress={onOpen} style={styles.thumbWrap}>
        <View style={styles.thumb}>
          <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`market-scene:${opportunity.id}`} source={opportunity.sceneImageUrl ? { uri: opportunity.sceneImageUrl } : SAMPLE_SCENE_IMAGE[type]} style={StyleSheet.absoluteFill} transition={0} />
          {!opportunity.sceneImageUrl ? <View style={styles.sampleTag}><Text selectable style={styles.sampleTagText}>AI 样张</Text></View> : null}
        </View>
      </Pressable>
      <View style={styles.body}>
        <View style={styles.typeRow}>
          <MarketTypeLogo type={type} size="CARD" />
          <View style={styles.typeMeta}>
            <Text selectable style={styles.typeMetaLabel}>标准订单类型</Text>
            <Text selectable style={styles.typeMetaTitle} numberOfLines={1}>{typeLabel.label}</Text>
          </View>
          {fit !== "" ? <View style={styles.fitTag}>
            <View style={[styles.fitDot, isHot && styles.fitDotHot]} />
            <Text selectable style={styles.fitTagText}>{fit} 匹配</Text>
          </View> : null}
        </View>
        <Text selectable style={styles.oppTitle} numberOfLines={1}>{opportunity.title}</Text>
        <View style={styles.metaLine}>
          {opportunity.date ? <Text selectable style={styles.metaText}>{opportunity.date} {opportunity.time}</Text> : null}
          {opportunity.date ? <View style={styles.dot} /> : null}
          {opportunity.location ? <Text selectable style={styles.metaText}>{opportunity.location}</Text> : null}
        </View>
        {why ? <Text selectable style={styles.why} numberOfLines={1}>{why}</Text> : null}
        <View style={styles.cardFoot}>
          <View style={styles.price}>
            <Text selectable style={styles.priceLabel}>{range.label}</Text>
            <View style={styles.priceValueRow}>
              <Text selectable style={styles.priceValue}>{range.value}</Text>
              {range.negotiable ? <Text selectable style={styles.priceNegotiable}>可协商</Text> : null}
            </View>
          </View>
          <Pressable onPress={onOpen} style={styles.takeBtn}>
            <Text selectable style={styles.takeBtnText}>我想接</Text>
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
