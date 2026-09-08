import { Image, StyleSheet, View } from "react-native";
import { color } from "../theme";

export type MarketOpportunityType = "coffee_photo" | "walk_photo" | "coffee_chinese" | "bilingual_store" | "event_photo";
export type MarketTypeLogoSize = "FILTER" | "CARD";

const MASTER: Record<MarketOpportunityType, number> = {
  coffee_photo: require("../assets/order-type-logos/coffee_photo.png"),
  coffee_chinese: require("../assets/order-type-logos/coffee_photo.png"),
  walk_photo: require("../assets/order-type-logos/walk_photo.png"),
  bilingual_store: require("../assets/order-type-logos/bilingual_store.png"),
  event_photo: require("../assets/order-type-logos/event_photo.png"),
};

const SIZE = { FILTER: 42, CARD: 30 } as const;

/** Canonical renderer for approved market order-type logos. */
export function MarketTypeLogo({ type, size, selected = false }: { type: MarketOpportunityType; size: MarketTypeLogoSize; selected?: boolean }): React.JSX.Element {
  const pixels = SIZE[size];
  return <View style={[styles.frame, { borderRadius: Math.round(pixels * 0.27), height: pixels, width: pixels }]}>
    <Image resizeMode="contain" source={MASTER[type]} style={{ height: pixels, width: pixels }} />
    {selected ? <View pointerEvents="none" style={[styles.selected, { borderRadius: Math.round(pixels * 0.27) }]} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  // Absolute overlay: a selected border must never shrink or displace the PNG.
  selected: { borderColor: color.ink, borderWidth: 2, bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
});
