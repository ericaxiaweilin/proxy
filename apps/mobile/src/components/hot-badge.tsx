import { StyleSheet, Text, View } from "react-native";

import { color, Gradient } from "../theme";
import { ProxyIcon } from "./proxy-icon";

// MENU-HOT-001（2026-10-02，用户给原型 deepseek_html_20261003_59d0d3
// 「给商家菜单 某些打hot标」）：HOT 徽样式照抄原型 hot-badge-v2 ——
// 火焰 + HOT 白字，红橙渐变 pill，带光晕。圆角 20，10pt 800。
//
// 哪个菜是 HOT 由商家亲手标（isHot），不是算出来的。组件只管画，不管判。
export function HotBadge(): React.JSX.Element {
  return (
    <View testID="hot-badge">
      <Gradient from="#FF3B30" to="#FF9500" style={styles.badge}>
        <ProxyIcon color={color.white} name="flame" size={12} />
        <Text selectable style={styles.hotBadgeText}>HOT</Text>
      </Gradient>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    borderRadius: 20,
    flexDirection: "row",
    gap: 3,
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    // 原型 box-shadow: 0 2px 8px rgba(255,149,0,.4) —— RN 用阴影属性近似。
    shadowColor: "#FF9500",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 3,
  },
  // MENU-HOT-001：徽上 10pt 是原型定的（hot-badge-v2），不是正文 ——
  // 和 aiAuthorBadgeText（9pt AI 徽）同类装饰，进 R2 白名单（见 design-system-r3）。
  hotBadgeText: {
    color: color.white,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});

// 菜名行：名字 + HOT（有才画）。原型把徽放在标题右边同一行。
export function HotTitleRow({ name, isHot }: { name: string; isHot: boolean }): React.JSX.Element {
  return (
    <View style={rowStyles.row}>
      <Text selectable numberOfLines={1} style={rowStyles.title}>{name}</Text>
      {isHot ? <HotBadge /> : null}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 8 },
  title: { color: "#000", flexShrink: 1, fontSize: 16, fontWeight: "700" },
});
