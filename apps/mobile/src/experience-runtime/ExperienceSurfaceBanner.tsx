import { StyleSheet, Text, View } from "react-native";
import type { UISchema } from "@proxy/contracts";
import { renderUISchema } from "./renderer";
import type { SurfacePlan } from "@proxy/contracts";
import { color } from "../theme";
import { ProxyButton } from "../components/proxy-foundation";

export function ExperienceSurfaceBanner({
  plan,
  schema,
  onAction,
}: {
  plan: SurfacePlan | null;
  schema: UISchema | null;
  onAction?: (actionId: string) => void;
}): React.JSX.Element | null {
  if (!plan || !schema) return null;
  const result = renderUISchema(schema, { surfacePlan: plan });
  if (!result.ok) return null;
  // Minimal renderer for banner: extract alert/text/metric nodes
  // In production, this would be a full json-render spec; here we map to themed Views.
  const tree = result.tree;
  const children = tree.children ?? [];
  if (children.length === 0) return null;

  return (
    <View style={styles.banner} testID="experience-surface-banner">
      {children.map((node, idx) => {
        if (node.type === "alert") {
          return (
            <View key={idx} style={styles.alert}>
              <Text selectable style={styles.alertText}>{String(node.props.text ?? node.props.level ?? "")}</Text>
            </View>
          );
        }
        if (node.type === "text" || node.type === "title") {
          return <Text selectable key={idx} style={styles.text}>{String(node.props.text ?? "")}</Text>;
        }
        if (node.type === "grid" && node.children) {
          return (
            <View key={idx} style={styles.grid}>
              {node.children.map((metric, j) => (
                <View key={j} style={styles.metric}>
                  <Text selectable style={styles.metricLabel}>{String(metric.props.label ?? "")}</Text>
                  <Text selectable style={styles.metricValue}>{String(metric.props.value ?? "")}</Text>
                </View>
              ))}
            </View>
          );
        }
        if (node.type === "merchant_list") {
          return <Text selectable key={idx} style={styles.hint}>推荐商家 · {String(node.props.limit ?? 3)} 个选择</Text>;
        }
        // BUTTON-UNIFY-004：banner 里的 primary_action 改用公共 ProxyButton。原来手写
        // ink 底 + 圆角 999 胶囊 + 内边距 16/10。迁完形状与按压反馈只有一个出处。
        // ⚠️ 这里不能写 {/* … */} —— 这是 return 里的 JS 表达式上下文，不是 JSX 子节点。
        if (node.type === "primary_action") {
          return (
            <ProxyButton key={idx} onPress={() => onAction?.(node.actionId ?? "open_fastest_plan")} style={styles.action}>
              {String(node.props.label ?? "查看")}
            </ProxyButton>
          );
        }
        return null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, marginBottom: 12, padding: 14, gap: 8 },
  alert: { backgroundColor: "#FFF4D6", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start" },
  alertText: { color: "#8A6A00", fontSize: 12, fontWeight: "800" },
  text: { color: color.ink, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  grid: { flexDirection: "row", gap: 8 },
  metric: { backgroundColor: "#F3EDFF", borderRadius: 14, flex: 1, padding: 10 },
  metricLabel: { color: color.muted, fontSize: 11 },
  metricValue: { color: color.ink, fontSize: 13, fontWeight: "800", marginTop: 2 },
  hint: { color: color.muted, fontSize: 11 },
  // BUTTON-UNIFY-004: 只剩布局（左对齐，不撑满一行）。ink 底 / 圆角 11 / 最小高 40 /
  // 白字 13 800 / 按压反馈由 ProxyButton tone="primary" 提供；actionText 键已删。
  action: { alignSelf: "flex-start" },
});
