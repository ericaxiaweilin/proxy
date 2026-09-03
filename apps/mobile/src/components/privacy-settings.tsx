// R16.10-P1-F: privacy settings surface (Vietnam PDP 91/2025/QH15
// Art. 31/32 + PRD v1.4 LC-15). The component renders three actions
// the user can take to exercise their data rights:
//
//   1. Download my data   — POST /v1/privacy/export then GET
//      /v1/privacy/me, with a small progress indicator.
//   2. Request account deletion   — POST /v1/privacy/delete, with
//      a confirmation sheet and a 30-day grace countdown.
//   3. Cancel a pending delete   — visible only if there is an
//      in-flight delete request; POST /v1/privacy/cancel.
//
// The component is intentionally dumb: it takes a PrivacyClient and
// surfaces state up via onStateChange so the parent surface (me.tsx)
// can navigate the user to the in-app privacy history when needed.
// Errors are surfaced inline so the user can retry without leaving
// the page; the parent surface does not need to handle them.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import type {
  PrivacyClient,
  PrivacyExportEnvelope,
  PrivacyRequest
} from "../privacy-client";
import { activeRequestOf, formatDate, kindLabel, statusLabel } from "./privacy-settings-helpers";

export type PrivacySettingsProps = {
  client: PrivacyClient;
  // Optional override for tests: when set, the component skips the
  // initial GET /v1/privacy/requests so unit tests can stay
  // deterministic. Production never sets this.
  skipInitialFetch?: boolean;
};

// Re-export the helpers so existing imports of
// `PrivacySettings` from this file still see them. Tests should
// import directly from privacy-settings-helpers.ts to avoid
// pulling in react-native.
export { formatDate, kindLabel, statusLabel };

export function PrivacySettings({ client, skipInitialFetch }: PrivacySettingsProps): React.JSX.Element {
  const [exportData, setExportData] = useState<PrivacyExportEnvelope | null>(null);
  const [history, setHistory] = useState<PrivacyRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await client.listRequests();
      setHistory(list.requests);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [client]);

  useEffect(() => {
    if (skipInitialFetch) return;
    void refresh();
  }, [refresh, skipInitialFetch]);

  const onDownload = useCallback(async () => {
    setBusy("export");
    setError(null);
    try {
      // The R16.10 server-side flow creates the request then returns
      // immediately; we then pull the assembled export via /me so the
      // user sees their actual data.
      await client.requestExport({ legalBasis: "PDP-91/2025/QH15-Art31" });
      const data = await client.fetchMe();
      setExportData(data);
      await refresh();
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("PRIVACY_REQUEST_ACTIVE")) {
        setError("你已经有进行中的数据导出请求，请稍候或查看历史。");
      } else {
        setError(message);
      }
    } finally {
      setBusy(null);
    }
  }, [client, refresh]);

  const onDelete = useCallback(() => {
    Alert.alert(
      "请求删除账号?",
      "依据《个人数据保护法》91/2025/QH15 第 32 条, 你有 30 天宽限期撤回请求. 30 天后, 你的个人数据将被永久删除 (法律要求保存的记录除外).",
      [
        { text: "取消", style: "cancel" },
        {
          text: "提交删除请求",
          style: "destructive",
          onPress: async () => {
            setBusy("delete");
            setError(null);
            try {
              await client.requestDelete({ reason: "user_initiated" });
              await refresh();
            } catch (err) {
              const message = (err as Error).message;
              if (message.includes("PRIVACY_REQUEST_ACTIVE")) {
                setError("你已经有进行中的删除请求。可以在下方撤回，或等待 30 天后完成。");
              } else {
                setError(message);
              }
            } finally {
              setBusy(null);
            }
          }
        }
      ]
    );
  }, [client, refresh]);

  const onCancelDelete = useCallback(async (requestId: string) => {
    setBusy("cancel:" + requestId);
    setError(null);
    try {
      await client.cancelRequest({ requestId, reason: "user_initiated" });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [client, refresh]);

  const activeDelete = activeRequestOf(history, "delete");
  const activeExport = activeRequestOf(history, "export");

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📦 下载我的数据</Text>
        <Text style={styles.cardDesc}>依据《个人数据保护法》第 31 条, 你可以随时导出 Proxy 保存的个人数据副本。导出请求生成后, 你有 7 天下载期。</Text>
        {activeExport ? (
          <Text style={styles.badge}>导出请求处理中 · {statusLabel(activeExport.status)}</Text>
        ) : (
          <Pressable
            onPress={onDownload}
            disabled={busy !== null}
            accessibilityRole="button"
            style={[styles.cta, busy !== null && styles.ctaDisabled]}
          >
            {busy === "export" ? (
              <ActivityIndicator color={color.white} />
            ) : (
              <Text style={styles.ctaText}>生成我的数据副本</Text>
            )}
          </Pressable>
        )}
        {exportData && (
          <View style={styles.exportSummary}>
            <Text style={styles.exportLine}>账号: {exportData.data.account.id}</Text>
            <Text style={styles.exportLine}>会话数: {exportData.data.sessions.length}</Text>
            <Text style={styles.exportLine}>设备数: {exportData.data.devices.length}</Text>
            <Text style={styles.exportLine}>已记录的同意: {exportData.data.consents.length}</Text>
            <Text style={styles.exportLine}>生成时间: {formatDate(exportData.generatedAt)}</Text>
            <Text style={styles.exportFootnote}>依据: {exportData.legalBasis}</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>🗑️ 请求删除账号</Text>
        <Text style={styles.cardDesc}>30 天宽限期内你可以随时撤回。30 天后, 你的个人数据将被永久删除 (法律要求保存的交易 / 安全 / 税务记录除外)。</Text>
        {activeDelete ? (
          <View>
            <Text style={styles.badge}>删除请求已提交 · {statusLabel(activeDelete.status)}</Text>
            <Text style={styles.exportLine}>预计完成: {formatDate(activeDelete.erasedAt)}</Text>
            <Pressable
              onPress={() => onCancelDelete(activeDelete.id)}
              disabled={busy !== null}
              accessibilityRole="button"
              style={[styles.ctaSecondary, busy !== null && styles.ctaDisabled]}
            >
              {busy === "cancel:" + activeDelete.id ? (
                <ActivityIndicator color={color.ink} />
              ) : (
                <Text style={styles.ctaSecondaryText}>撤回删除请求</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={onDelete}
            disabled={busy !== null}
            accessibilityRole="button"
            style={[styles.ctaDanger, busy !== null && styles.ctaDisabled]}
          >
            {busy === "delete" ? (
              <ActivityIndicator color={color.white} />
            ) : (
              <Text style={styles.ctaDangerText}>提交删除请求</Text>
            )}
          </Pressable>
        )}
      </View>

      {history.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🕘 请求历史</Text>
          {history.map((req) => (
            <View key={req.id} style={styles.historyRow}>
              <Text style={styles.historyKind}>{kindLabel(req.kind)}</Text>
              <Text style={styles.historyMeta}>{statusLabel(req.status)} · {formatDate(req.requestedAt)}</Text>
            </View>
          ))}
        </View>
      )}

      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={refresh} style={styles.ctaSecondary}>
            <Text style={styles.ctaSecondaryText}>重试</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 16 },
  card: {
    backgroundColor: color.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: color.line
  },
  cardTitle: { fontSize: 16, fontWeight: "600", color: color.ink, marginBottom: 8 },
  cardDesc: { fontSize: 13, lineHeight: 20, color: color.muted, marginBottom: 12 },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#EEE3FF",
    color: color.proxyPurple,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4
  },
  cta: {
    backgroundColor: color.ink,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center"
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: color.white, fontSize: 14, fontWeight: "600" },
  ctaSecondary: {
    backgroundColor: color.white,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 12,
    borderWidth: 1,
    borderColor: color.line
  },
  ctaSecondaryText: { color: color.ink, fontSize: 13, fontWeight: "600" },
  ctaDanger: {
    backgroundColor: "#c0392b",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center"
  },
  ctaDangerText: { color: color.white, fontSize: 14, fontWeight: "600" },
  exportSummary: { marginTop: 12, gap: 4 },
  exportLine: { fontSize: 12, color: color.muted },
  exportFootnote: { fontSize: 11, color: color.muted, fontStyle: "italic", marginTop: 6 },
  historyRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  historyKind: { fontSize: 13, color: color.ink, fontWeight: "500" },
  historyMeta: { fontSize: 12, color: color.muted },
  errorCard: {
    backgroundColor: "#fff5f5",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#c0392b"
  },
  errorText: { color: "#c0392b", fontSize: 12, marginBottom: 8 }
});
