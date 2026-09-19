// Compact horizontal opportunity-type filter. Visible UI is logo-only; names
// remain available to VoiceOver through accessibilityLabel.

import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { MarketTypeLogo, type MarketOpportunityType as OpportunityType } from "../components/market-type-logo";
import { color } from "../theme";

const TYPES: { key: OpportunityType; label: string }[] = [
  { key: "coffee_photo", label: "咖啡加拍照" },
  { key: "walk_photo", label: "城市漫步加拍照" },
  { key: "coffee_chinese", label: "咖啡加中文交流" },
  { key: "bilingual_store", label: "看店加双语服务" },
  { key: "event_photo", label: "活动加拍照" },
  { key: "other", label: "其他未分类" },
];

export function R37TypePalette({ active, onChange }: { active: OpportunityType | "all"; onChange: (next: OpportunityType | "all") => void }): React.JSX.Element {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      <Pill
        label="全部"
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
function Pill({ label, onPress, active, renderLogo, logoBoxStyle }: { label: string; onPress: () => void; active: boolean; renderLogo: () => React.JSX.Element; logoBoxStyle?: any }): React.JSX.Element {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={styles.pill}>
      <View style={[styles.logoBox, logoBoxStyle]}>{renderLogo()}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 3, paddingHorizontal: 10, paddingVertical: 5 },
  pill: { alignItems: "center", height: 46, justifyContent: "center", width: 46 },
  logoBox: { alignItems: "center", height: 42, justifyContent: "center", width: 42 },
  allLogo: { backgroundColor: "#F7EFE1" },
  allGrid: { gap: 1, height: 18, width: 18 },
  allCell: { backgroundColor: color.ink, borderRadius: 0.5, flex: 1, height: 8, margin: 0.5, width: 8 },
});
