// Lotus RFC §8 — 设置页「安全」区块 (营销包装 + 真开关)
// 包含：端到端加密徽标、防截图提醒、多身份入口、消息保留时间、设备管理 (2 设备踢旧)

import { Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";

export function SecuritySettings({
  retentionDays,
  onRetentionChange,
  onManageIdentities,
  onManageDevices,
  screenshotWarnEnabled,
  onToggleScreenshotWarn,
}: {
  retentionDays: 7 | 30 | 90 | 365;
  onRetentionChange: (v: 7 | 30 | 90 | 365) => void;
  onManageIdentities: () => void;
  onManageDevices: () => void;
  screenshotWarnEnabled: boolean;
  onToggleScreenshotWarn: (v: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔒 端到端加密</Text>
        <Text style={styles.cardDesc}>所有消息、照片、语音均使用军用级 AES-256 加密（传输 TLS + 静态 KMS）。</Text>
        <Text style={styles.badge}>已开启 · 始终保护</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>🛡️ 防截图提醒</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: screenshotWarnEnabled }}
            onPress={() => onToggleScreenshotWarn(!screenshotWarnEnabled)}
            style={[styles.switch, screenshotWarnEnabled && styles.switchOn]}
          >
            <View style={[styles.dot, screenshotWarnEnabled && styles.dotOn]} />
          </Pressable>
        </View>
        <Text style={styles.cardDesc}>您发送的图片和位置，对方截图时您将立即收到通知。</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>👤 多身份模式</Text>
        <Text style={styles.cardDesc}>工作号 / 私人号 / 备用号（7天后自动销毁）隔离会话与未读。</Text>
        <Pressable onPress={onManageIdentities} style={styles.action}>
          <Text style={styles.actionText}>管理身份</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>⏱️ 消息保留时间</Text>
        <View style={styles.chips}>
          {([7, 30, 90, 365] as const).map((v) => (
            <Pressable key={v} onPress={() => onRetentionChange(v)} style={[styles.chip, retentionDays === v && styles.chipActive]}>
              <Text style={[styles.chipText, retentionDays === v && styles.chipTextActive]}>{v}天</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.cardDesc}>到期自动清理（场景/订单/优惠券消息不受影响）。</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>📱 设备管理</Text>
        <Text style={styles.cardDesc}>最多 2 台设备同时在线，新登录自动踢出最旧设备。</Text>
        <Pressable onPress={onManageDevices} style={styles.action}>
          <Text style={styles.actionText}>查看我的设备</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, padding: 14 },
  cardTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  cardDesc: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  badge: { alignSelf: "flex-start", backgroundColor: "#E8F5E9", borderRadius: 999, color: "#2E7D32", fontSize: 11, fontWeight: "800", marginTop: 8, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  switch: { backgroundColor: "#E9E5EC", borderRadius: 999, height: 28, justifyContent: "center", padding: 2, width: 48 },
  switchOn: { backgroundColor: color.proxyPurple },
  dot: { backgroundColor: color.white, borderRadius: 12, height: 24, width: 24 },
  dotOn: { alignSelf: "flex-end" },
  chips: { flexDirection: "row", gap: 8, marginTop: 10 },
  chip: { backgroundColor: "#F4F1F6", borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: "#EEE3FF", borderColor: color.proxyPurple },
  chipText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  chipTextActive: { color: "#5822A4" },
  action: { alignSelf: "flex-start", backgroundColor: color.ink, borderRadius: 10, marginTop: 10, paddingHorizontal: 12, paddingVertical: 8 },
  actionText: { color: color.white, fontSize: 11, fontWeight: "800" },
});
