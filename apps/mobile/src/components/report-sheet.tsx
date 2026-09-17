import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { REPORT_REASONS, type ModerationClient, type ReportReason, type ReportTargetType } from "../moderation-client";
import { color } from "../theme";
import { ProxyLoading } from "./proxy-foundation";

// COMP-REPORT-002: 举报原因选择弹层（各举报入口共用）。
//
// 抽出来而不是每个界面抄一份，是因为入口会越加越多（消息 → 账号 →
// 交易 …），抄三份就一定会有一份忘记更新理由清单。
//
// 两个刻意的设计：
//   1. SOLICITATION 与 MINOR_SAFETY 排在清单最前（见 moderation-client 的
//      REPORT_REASONS）—— 用户慌的时候要一眼找到，不该让他翻九行。
//   2. 失败一定显示出来，并且区分「没登录」和「没成功」。显示「已受理」
//      而实际没写进库，比没有举报功能更糟：用户以为平台收到了。
export function ReportSheet({
  moderation,
  targetType,
  targetId,
  title,
  subtitle,
  onClose,
  onDone
}: {
  moderation: ModerationClient;
  targetType: ReportTargetType;
  targetId: string;
  title: string;
  subtitle?: string | undefined;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(reason: ReportReason): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await moderation.reportTarget(targetType, targetId, reason);
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      // 登录态问题不能说成网络问题，否则用户会一直重试。
      setError(/session|signed|sign in|auth|401|403/i.test(message) ? "请先登录后再举报。" : "举报没有提交成功，请检查连接后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable accessibilityLabel="关闭举报" onPress={() => { if (!busy) onClose(); }} style={styles.scrim}>
      <Pressable onPress={() => undefined} style={styles.sheet}>
        <View style={styles.grab} />
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        {error ? <Text style={styles.error} accessibilityLabel="举报失败">{error}</Text> : null}
        {REPORT_REASONS.map((item) => (
          <Pressable
            key={item.reason}
            accessibilityLabel={`举报原因 ${item.label}`}
            disabled={busy}
            onPress={() => { void submit(item.reason); }}
            style={styles.item}
          >
            <Text style={styles.itemText}>{item.label}</Text>
          </Pressable>
        ))}
        {busy ? <ProxyLoading tone="muted" style={{ marginVertical: 12 }} /> : null}
        <Pressable accessibilityLabel="取消举报" disabled={busy} onPress={onClose} style={styles.item}>
          <Text style={[styles.itemText, styles.cancel]}>取消</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, alignItems: "center", backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: color.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 20, paddingHorizontal: 16, paddingTop: 10, width: "100%" },
  grab: { alignSelf: "center", backgroundColor: color.line, borderRadius: 2, height: 4, marginBottom: 12, width: 36 },
  title: { color: color.ink, fontSize: 15, fontWeight: "800", marginBottom: 4 },
  subtitle: { color: color.muted, fontSize: 11, marginBottom: 8 },
  error: { color: "#C62828", fontSize: 12, marginBottom: 8 },
  item: { paddingVertical: 13 },
  itemText: { color: color.ink, fontSize: 14 },
  cancel: { color: color.muted, fontWeight: "700" }
});
