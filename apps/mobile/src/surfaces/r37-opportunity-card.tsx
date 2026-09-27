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
import { type MarketOpportunity, type MarketOpportunityMoneyFlow, merchantVerified, opportunityWhenLabel, parseOpportunityPrice } from "../market-fixtures";
import { color } from "../theme";
import { MarketTypeLogo, type MarketOpportunityType } from "../components/market-type-logo";
import { ProxyIcon } from "../components/proxy-icon";
import { initialAvatarTint } from "../media/author-avatar";

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
  // 市场·订单重做：新设计的简化分类集合。
  dining: { label: "晚餐", sub: "Dining" },
  sport_companion: { label: "运动", sub: "Sport" },
  music: { label: "音乐", sub: "Music" },
  chat_companion: { label: "聊天", sub: "Chat" },
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
  dining: 0,
  sport_companion: 0,
  music: 0,
  chat_companion: 0,
  other: 0,
};
// 未分类 / 新增分类都没有自己的样张：复用咖啡那张（hero 上本来就带「AI 样张」
// 标记）。没有新写 require —— media 管线 R1 禁止在 media/ 之外新增 assets require。
SAMPLE_SCENE_IMAGE.other = SAMPLE_SCENE_IMAGE.coffee_photo;
SAMPLE_SCENE_IMAGE.dining = SAMPLE_SCENE_IMAGE.coffee_photo;
SAMPLE_SCENE_IMAGE.sport_companion = SAMPLE_SCENE_IMAGE.coffee_photo;
SAMPLE_SCENE_IMAGE.music = SAMPLE_SCENE_IMAGE.event_photo;
SAMPLE_SCENE_IMAGE.chat_companion = SAMPLE_SCENE_IMAGE.coffee_photo;

export function inferOpportunityTypeForFilter(opportunity: { opportunityType?: OpportunityType; theme?: string; skills?: string; title?: string }): OpportunityType {
  if (opportunity.opportunityType) return opportunity.opportunityType;
  const theme = (opportunity.theme ?? "").toLowerCase();
  const skills = (opportunity.skills ?? "").toLowerCase();
  const title = (opportunity.title ?? "").toLowerCase();
  if (theme.includes("walk") || title.includes("walk") || skills.includes("walk")) return "walk_photo";
  if (theme.includes("双语") || skills.includes("双语") || skills.includes("bilingual")) return "bilingual_store";
  // 市场·订单重做新增分类：晚餐/运动/聊天各自的关键词分支，跟旧分支互不
  // 抢命中（event_photo 的判定条件不变，music 只在直接出现"音乐"/"music"
  // 时命中，不从 event_photo 里抢）。
  if (theme.includes("晚餐") || title.includes("晚餐") || skills.includes("晚餐") || title.includes("晚饭") || theme.includes("dinner") || title.includes("dinner")) return "dining";
  if (theme.includes("运动") || skills.includes("运动") || title.includes("运动") || skills.includes("羽毛球") || skills.includes("网球") || theme.includes("sport") || skills.includes("sport")) return "sport_companion";
  if (theme.includes("陪聊") || skills.includes("陪聊") || title.includes("陪聊") || skills.includes("chat") || theme.includes("线上")) return "chat_companion";
  if (theme.includes("活动") || skills.includes("活动") || title.includes("活动") || title.includes("event")) return "event_photo";
  if (theme.includes("音乐") || skills.includes("音乐") || title.includes("音乐") || theme.includes("music") || skills.includes("music")) return "music";
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

// 市场·订单重做（deepseek_html_20260926_34df37.html）：发布者的姓名首字
// 当种子，跟其它地方（分享面板、动态列表）同一套稳定配色兜底 —— 没有头像
// 资产字段可用（Opportunity 没有 avatar URL），不编一张假照片。
function publisherInitial(owner: string): string {
  return (owner.trim().charAt(0) || "?").toUpperCase();
}

// The 68px approved asset contains the complete rounded logo tile; filling the
// slot avoids nesting it inside a second beige tile and shrinking the glyph.
export function R37OpportunityCard({ opportunity, onOpen, onDismiss }: { opportunity: MarketOpportunity; onOpen: () => void; onDismiss: () => void }): React.JSX.Element {
  const type = inferType(opportunity);
  const range = formatRange(opportunity.price ?? "0", opportunity.moneyFlow, opportunity.priceLabel);
  // MARKET-FAKE-JUDGMENT-001: 服务端没有匹配引擎时 match 是空串 —— 这时候不能
  // 渲染「N% 匹配」标签。以前缺省值写的是 "0%"，等于把"没算过"显示成"0% 匹配"。
  const fit = (opportunity.match ?? "").trim();
  const isHot = opportunity.signalClass === "hot";
  const when = opportunityWhenLabel(opportunity);
  // MARKET-LEGACY-VERIFIED-001: 认证徽章只在服务端能背的形态下画。
  const isVerified = merchantVerified(opportunity);
  const owner = opportunity.owner.trim();
  // CLIENT-RATING-001: ratingCount 缺省/为 0 时整个评分块不渲染 —— 没有真实
  // 评价历史时不能把 undefined 兜成 0 星或占位星。
  const hasRating = typeof opportunity.ratingCount === "number" && opportunity.ratingCount > 0 && typeof opportunity.rating === "number";
  const tint = initialAvatarTint(owner || opportunity.id);

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
          <Text selectable style={styles.oppTitle} numberOfLines={1}>{opportunity.title}</Text>
          {fit !== "" ? <View style={styles.fitTag}>
            <View style={[styles.fitDot, isHot && styles.fitDotHot]} />
            <Text selectable style={styles.fitTagText}>{fit} 匹配</Text>
          </View> : null}
        </View>
        {owner ? (
          <View style={styles.pubRow}>
            <View style={[styles.pubAvatar, { backgroundColor: tint.backgroundColor }]}>
              <Text selectable style={[styles.pubAvatarLetter, { color: tint.color }]}>{publisherInitial(owner)}</Text>
            </View>
            <Text selectable style={styles.pubName} numberOfLines={1}>{owner}</Text>
            {isVerified ? (
              <View style={styles.pubVerified}>
                <ProxyIcon color={color.white} name="check" size={8} />
              </View>
            ) : null}
            {hasRating ? (
              <View style={styles.pubRating}>
                <ProxyIcon color="#D9A400" name="star" size={9} />
                <Text selectable style={styles.pubRatingText}>{opportunity.rating!.toFixed(1)}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={styles.metaLine}>
          {/* MARKET-WHEN-LABEL-001: 卡片以前手拼 `${date} ${time}` —— 需求向导发的
              机会两个字段是同一串，卡片上就印成
              「今晚 19:00 今晚 19:00 · 2 小时 · 1:1」。走共用串。 */}
          {when ? <Text selectable style={styles.metaText}>{when}</Text> : null}
          {when ? <View style={styles.dot} /> : null}
          {opportunity.location ? <Text selectable style={styles.metaText} numberOfLines={1}>{opportunity.location}</Text> : null}
        </View>
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
  // 市场·订单重做：96×96 正方形缩略图，不再拉伸撑满卡片高度。
  thumbWrap: { alignSelf: "center" },
  thumb: { backgroundColor: "#F1ECE3", borderRadius: 12, height: 96, overflow: "hidden", width: 96 },
  sampleTag: { backgroundColor: "rgba(20,19,26,.74)", borderRadius: 6, bottom: 6, left: 6, paddingHorizontal: 6, paddingVertical: 3, position: "absolute" }, sampleTagText: { color: color.white, fontSize: 8, fontWeight: "800" },
  body: { flex: 1, gap: 5, justifyContent: "center", minWidth: 0, paddingBottom: 10, paddingRight: 6, paddingTop: 10 },
  typeRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  oppTitle: { color: color.ink, flex: 1, fontSize: 13, fontWeight: "900", letterSpacing: -0.2, minWidth: 0 },
  fitTag: { alignItems: "center", flexDirection: "row", gap: 4 },
  fitDot: { backgroundColor: "#F2AD29", borderRadius: 999, height: 5, width: 5 },
  fitDotHot: { backgroundColor: "#B91451" },
  fitTagText: { color: "#7A5711", fontSize: 7, fontWeight: "800" },
  // 发布者行：头像首字 + 姓名 + 认证徽章 + 真实评分（ratingCount > 0 才画）。
  pubRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  pubAvatar: { alignItems: "center", borderRadius: 999, height: 18, justifyContent: "center", width: 18 },
  pubAvatarLetter: { fontSize: 8.5, fontWeight: "900" },
  pubName: { color: color.ink, flexShrink: 1, fontSize: 10.5, fontWeight: "800", minWidth: 0 },
  pubVerified: { alignItems: "center", backgroundColor: "#2D8CE5", borderRadius: 999, height: 11, justifyContent: "center", width: 11 },
  pubRating: { alignItems: "center", flexDirection: "row", gap: 2, marginLeft: "auto" },
  pubRatingText: { color: "#8F8A82", fontSize: 9.5, fontWeight: "800" },
  metaLine: { alignItems: "center", flexDirection: "row", gap: 5 },
  metaText: { color: "#6F6A63", fontSize: 8, minWidth: 0 },
  dot: { backgroundColor: "#BDB7AF", borderRadius: 999, height: 2, width: 2 },
  cardFoot: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  price: { flex: 1 },
  priceLabel: { color: "#AAA49C", fontSize: 6.5, lineHeight: 9, marginBottom: 3 },
  priceValueRow: { alignItems: "baseline", flexDirection: "row", gap: 4 },
  priceValue: { color: color.ink, fontSize: 15, fontWeight: "800", letterSpacing: -0.4 },
  priceNegotiable: { color: "#8B857C", fontSize: 6.5, fontWeight: "700" },
  takeBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 4, height: 30, justifyContent: "center", paddingHorizontal: 13 },
  takeBtnText: { color: color.white, fontSize: 8.5, fontWeight: "800" },
});
