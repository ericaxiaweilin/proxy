// Compact horizontal opportunity-type filter. Visible UI is logo-only; names
// remain available to VoiceOver through accessibilityLabel.

import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { MarketTypeLogo, type MarketOpportunityType as OpportunityType } from "../components/market-type-logo";
import { color } from "../theme";

// 市场·订单重做：筛选栏展示新设计的 6 个单一概念桶（咖啡/晚餐/运动/音乐/
// 聊天/其他）。旧的复合类型（walk_photo/coffee_chinese/bilingual_store）不
// 从筛选栏移除逻辑——它们靠 inferOpportunityTypeForFilter 的关键词推断继续
// 归到最接近的新桶，老种子数据不需要用户手动选老类型就能被筛出来。
const TYPES: { key: OpportunityType; label: string }[] = [
  { key: "coffee_photo", label: "咖啡" },
  { key: "dining", label: "晚餐" },
  { key: "sport_companion", label: "运动" },
  { key: "music", label: "音乐" },
  { key: "chat_companion", label: "聊天" },
  { key: "other", label: "其他" },
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
          // 市场·订单重做：新稿 type-tabs 的"全部"是三横线（M4 6h16M4 12h16M4
          // 18h16），换掉旧的四宫格，纯视觉，不影响 onChange("all") 逻辑。
          <View style={styles.allBars}>
            <View style={styles.allBar} />
            <View style={styles.allBar} />
            <View style={styles.allBar} />
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
  allBars: { gap: 4, height: 18, justifyContent: "center", width: 20 },
  allBar: { backgroundColor: color.ink, borderRadius: 1, height: 2, width: 20 },
});
