import { Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import { ProxyBackGlyph } from "../components/proxy-foundation";

export function AvatarDressingSurface({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <View style={styles.root}>
      <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.subPageBack}>
        <ProxyBackGlyph />
      </Pressable>
      <Text selectable style={styles.h1}>3D 换装已下线</Text>
      <Text selectable style={styles.meta}>该功能暂不成熟，已移除 · 请从 Creator 详情继续操作</Text>
      <View style={styles.card}>
        <Text selectable style={styles.cardTitle}>提示</Text>
        <Text selectable style={styles.cardText}>实时 3D 预览与换装已暂时移除，后续成熟后再开放。当前 Creator 经营请使用 Creator / 活动 / 券 页面。</Text>
      </View>
      <Pressable accessibilityLabel="返回 Creator" onPress={onBack} style={styles.primary}>
        <ProxyBackGlyph />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1, padding: 16 },
  subPageBack: { marginBottom: 10, paddingVertical: 4 },
  h1: { color: color.ink, fontSize: 24, fontWeight: "900", letterSpacing: -0.7, lineHeight: 30, marginTop: 4 },
  meta: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginTop: 16, padding: 14 },
  cardTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  cardText: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  primary: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, height: 44, justifyContent: "center", marginTop: 16 },
});
