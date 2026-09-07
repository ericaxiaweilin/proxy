// R37 TypePalette — horizontal type filter. 4-5 typePills (logo + label
// + sub). Tap to filter opportunity list. Lives above the opportunity
// list; ScrollView so it works on narrow screens.

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MarketTypeLogo, type MarketOpportunityType as OpportunityType } from "../components/market-type-logo";
import { color } from "../theme";

const TYPES: { key: OpportunityType; label: string; sub: string }[] = [
  { key: "coffee_photo", label: "咖啡 + 拍照", sub: "Coffee" },
  { key: "walk_photo", label: "City Walk + 拍照", sub: "Walk" },
  { key: "coffee_chinese", label: "咖啡 + 中文", sub: "Talk" },
  { key: "bilingual_store", label: "看店 + 双语", sub: "Language" },
  { key: "event_photo", label: "活动 + 拍照", sub: "Event" },
];

export function R37TypePalette({ active, onChange }: { active: OpportunityType | "all"; onChange: (next: OpportunityType | "all") => void }): React.JSX.Element {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      <Pill
        label="全部"
        sub="订单类型"
        logoBoxStyle={styles.allLogo}
        onPress={() => onChange("all")}
        active={active === "all"}
        renderLogo={() => (
          <View style={styles.allGrid}>
            <View style={styles.allCell} />
            <View style={styles.allCell} />
            <View style={styles.allCell} />
            <View style={styles.allCell} />
          </View>
        )}
      />
      {TYPES.map((t) => (
        <Pill
          key={t.key}
          label={t.label}
          sub={t.sub}
          onPress={() => onChange(active === t.key ? "all" : t.key)}
          active={active === t.key}
          renderLogo={() => <MarketTypeLogo type={t.key} size="FILTER" selected={active === t.key} />}
        />
      ))}
    </ScrollView>
  );
}

// Approved PNGs already include their own rounded tile. Render edge-to-edge;
// another colored box around them creates the “logo inside a logo” effect.
function Pill({ label, sub, onPress, active, renderLogo, logoBoxStyle }: { label: string; sub: string; onPress: () => void; active: boolean; renderLogo: () => React.JSX.Element; logoBoxStyle?: any }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={styles.pill}>
      <View style={[styles.logoBox, logoBoxStyle]}>{renderLogo()}</View>
      <Text style={[styles.pillLabel, active && styles.pillLabelActive]} numberOfLines={2}>{label}</Text>
      <Text style={styles.pillSub}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 7, paddingHorizontal: 14, paddingVertical: 6 },
  pill: { alignItems: "center", minWidth: 74, paddingHorizontal: 0, paddingVertical: 0 },
  logoBox: { alignItems: "center", height: 46, justifyContent: "center", marginBottom: 3, width: 46 },
  pillLabel: { color: color.ink, fontSize: 7.2, fontWeight: "500", lineHeight: 9, textAlign: "center" },
  pillLabelActive: { fontWeight: "800" },
  pillSub: { color: "#AAA49C", fontSize: 6.2, marginTop: 2 },
  allLogo: { backgroundColor: "#F7EFE1" },
  allGrid: { gap: 1, height: 18, width: 18 },
  allCell: { backgroundColor: color.ink, borderRadius: 0.5, flex: 1, height: 8, margin: 0.5, width: 8 },
});
