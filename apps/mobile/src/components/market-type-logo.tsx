import { Image, StyleSheet, View } from "react-native";
import { color } from "../theme";

export type MarketOpportunityType = "coffee_photo" | "walk_photo" | "coffee_chinese" | "bilingual_store" | "event_photo";
export type MarketTypeLogoSize = "FILTER" | "CARD";

const MASTER: Record<MarketOpportunityType, { source: number; opticalX: number; opticalY: number }> = {
  coffee_photo: { source: require("../assets/order-type-logos/coffee_photo.png"), opticalX: -3, opticalY: -6 },
  coffee_chinese: { source: require("../assets/order-type-logos/coffee_photo.png"), opticalX: -3, opticalY: -6 },
  walk_photo: { source: require("../assets/order-type-logos/walk_photo.png"), opticalX: -6, opticalY: -3 },
  bilingual_store: { source: require("../assets/order-type-logos/bilingual_store.png"), opticalX: -6, opticalY: -11 },
  event_photo: { source: require("../assets/order-type-logos/event_photo.png"), opticalX: -11, opticalY: -9 },
};

const SIZE = { FILTER: 42, CARD: 30 } as const;

/** Canonical renderer for approved market order-type logos. */
export function MarketTypeLogo({ type, size, selected = false }: { type: MarketOpportunityType; size: MarketTypeLogoSize; selected?: boolean }): React.JSX.Element {
  const pixels = SIZE[size];
  const master = MASTER[type];
  const scale = pixels / 68;
  return <View style={[styles.frame, { borderRadius: Math.round(pixels * 0.27), height: pixels, width: pixels }, selected && styles.selected]}>
    <Image resizeMode="contain" source={master.source} style={{ height: pixels, transform: [{ translateX: master.opticalX * scale }, { translateY: master.opticalY * scale }], width: pixels }} />
  </View>;
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", backgroundColor: "#F7EFE1", justifyContent: "center", overflow: "hidden" },
  selected: { borderColor: color.ink, borderWidth: 2 },
});
