import { StyleSheet, Text, View } from "react-native";
import { Image, type ImageSource } from "expo-image";
import { color } from "../theme";
import { SCENE_ACTIONS } from "./scene-activity-discovery";
import { ProxyIcon } from "./proxy-icon";

// OPP-TYPE-OTHER-001: 识别不出来的机会归 "other"，不再硬塞进 coffee_photo。
// 关键词一个都不中时以前一律返回 coffee_photo —— 等于把「咖啡 + 拍照」当成
// 垃圾桶，自定义发布（大多不带类型字段）全掉进去，筛选也被稀释。
// 未分类不给活动图标（给哪个都是编造语义），渲染中性占位字形。
//
// 市场·订单重做（CLIENT-RATING-001 同批次）：新设计的筛选栏是"咖啡/晚餐/
// 运动/音乐/聊天/其他"6 个更简单的单一概念，跟旧的 5 个复合类型不是一一
// 对应 —— 扩展（新增枚举值），旧值保留不砍，兼容已有种子数据。
export type MarketOpportunityType = "coffee_photo" | "walk_photo" | "coffee_chinese" | "bilingual_store" | "event_photo" | "dining" | "sport_companion" | "music" | "chat_companion" | "other";
export type MarketTypeLogoSize = "FILTER" | "CARD";

const actionIcon = (id: string): ImageSource => SCENE_ACTIONS.find((item) => item.id === id)!.icon;
// chat_companion 没有对应的 SCENE_ACTIONS 图片资产（那套图标是场景照片风格，
// 没有画过对话气泡）—— 用 ProxyIcon 的矢量 "chat" 字形，不用假图片凑数。
const MASTER: Record<MarketOpportunityType, ImageSource | "chat" | undefined> = {
  coffee_photo: actionIcon("photo"),
  coffee_chinese: actionIcon("coffee"),
  walk_photo: actionIcon("city-walk"),
  bilingual_store: actionIcon("translation"),
  event_photo: actionIcon("music"),
  dining: actionIcon("dining"),
  sport_companion: actionIcon("sport"),
  music: actionIcon("music"),
  chat_companion: "chat",
  other: undefined,
};

const SIZE = { FILTER: 42, CARD: 30 } as const;

/** Canonical renderer for approved market order-type logos. */
export function MarketTypeLogo({ type, size, selected = false }: { type: MarketOpportunityType; size: MarketTypeLogoSize; selected?: boolean }): React.JSX.Element {
  const pixels = SIZE[size];
  const icon = MASTER[type];
  return <View style={[styles.frame, selected && styles.frameSelected, { borderRadius: Math.round(pixels * 0.27), height: pixels, width: pixels }]}>
    {icon === "chat" ? (
      <ProxyIcon color={selected ? color.white : color.ink} name="chat" size={Math.round(pixels * 0.6)} />
    ) : icon ? (
      <Image contentFit="contain" source={icon} style={[styles.icon, selected && styles.iconSelected, { height: Math.round(pixels * 0.72), width: Math.round(pixels * 0.72) }]} />
    ) : (
      <Text selectable style={[styles.otherGlyph, selected && styles.otherGlyphSelected, { fontSize: Math.round(pixels * 0.6) }]}>⋯</Text>
    )}
  </View>;
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderWidth: 1, justifyContent: "center", overflow: "hidden" },
  frameSelected: { backgroundColor: color.ink, borderColor: color.ink },
  icon: { tintColor: color.ink },
  iconSelected: { tintColor: color.white },
  // 未分类的中性占位：不给活动图标，避免把"没识别出来"画成"咖啡/拍照"。
  otherGlyph: { color: color.ink, fontWeight: "900" },
  otherGlyphSelected: { color: color.white },
});
