import { StyleSheet, View } from "react-native";
import { Image, type ImageSource } from "expo-image";
import { color } from "../theme";
import { SCENE_ACTIONS } from "./scene-activity-discovery";

export type MarketOpportunityType = "coffee_photo" | "walk_photo" | "coffee_chinese" | "bilingual_store" | "event_photo";
export type MarketTypeLogoSize = "FILTER" | "CARD";

const actionIcon = (id: string): ImageSource => SCENE_ACTIONS.find((item) => item.id === id)!.icon;
const MASTER: Record<MarketOpportunityType, ImageSource> = {
  coffee_photo: actionIcon("photo"),
  coffee_chinese: actionIcon("coffee"),
  walk_photo: actionIcon("city-walk"),
  bilingual_store: actionIcon("translation"),
  event_photo: actionIcon("music"),
};

const SIZE = { FILTER: 42, CARD: 30 } as const;

/** Canonical renderer for approved market order-type logos. */
export function MarketTypeLogo({ type, size, selected = false }: { type: MarketOpportunityType; size: MarketTypeLogoSize; selected?: boolean }): React.JSX.Element {
  const pixels = SIZE[size];
  return <View style={[styles.frame, selected && styles.frameSelected, { borderRadius: Math.round(pixels * 0.27), height: pixels, width: pixels }]}>
    <Image contentFit="contain" source={MASTER[type]} style={[styles.icon, selected && styles.iconSelected, { height: Math.round(pixels * 0.72), width: Math.round(pixels * 0.72) }]} />
  </View>;
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderWidth: 1, justifyContent: "center", overflow: "hidden" },
  frameSelected: { backgroundColor: color.ink, borderColor: color.ink },
  icon: { tintColor: color.ink },
  iconSelected: { tintColor: color.white },
});
