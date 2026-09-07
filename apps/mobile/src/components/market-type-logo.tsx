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
  return <View style={[styles.frame, { borderRadius: Math.round(pixels * 0.27), height: pixels, width: pixels }, selected && styles.selected]}>
    <Image resizeMode="contain" source={MASTER[type]} style={{ height: pixels, width: pixels }} />
  </View>;
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", backgroundColor: "#F7EFE1", justifyContent: "center", overflow: "hidden" },
  selected: { borderColor: color.ink, borderWidth: 2 },
});
