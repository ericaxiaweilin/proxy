// 已登记但尚未实现的稳定 Surface 的占位渲染（R15 Product Freeze：
// Surface 名单冻结，实现按排期推进；占位卡不得演化为新页面路由）。
import { StyleSheet, Text, View } from "react-native";
import { color, shadows } from "../theme";
import type { SurfaceId } from "../uiplan/types";

const SURFACE_LABEL: Partial<Record<SurfaceId, string>> = {
  BUSINESS_HOME: "商家首页",
  SKILL_WORKSPACE: "Enterprise 运营 Skill 工作区",
  CONVERSATION: "会话",
  MERCHANT_STOREFRONT: "商家店铺",
  ORDER_EXECUTION: "订单执行",
  OUTCOME: "结果",
  ACTIVITY_DETAIL: "活动详情"
};

export function ComingSoonSurface({ surface }: { surface: SurfaceId }): React.JSX.Element {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>STABLE SURFACE · 已登记</Text>
        </View>
        <Text style={styles.title}>{SURFACE_LABEL[surface] ?? surface}</Text>
        <Text style={styles.body}>
          {surface} 属于 R15 冻结的稳定 Surface 名单，能力将按组件注册表排期实现；在此之前保持占位，不新增页面路由。
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", backgroundColor: color.offWhite, flex: 1, justifyContent: "center", padding: 24 },
  card: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    ...shadows.card
  },
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: color.ink,
    borderRadius: 999,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  badgeDot: { backgroundColor: color.lime, borderRadius: 999, height: 6, width: 6 },
  badgeText: { color: color.white, fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  title: { color: color.ink, fontSize: 16, fontWeight: "900", marginTop: 10 },
  body: { color: color.muted, fontSize: 11, lineHeight: 17, marginTop: 6 }
});
