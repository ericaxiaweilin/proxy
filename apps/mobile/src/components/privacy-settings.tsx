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
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { documentDirectory, writeAsStringAsync } from "expo-file-system/legacy";
import { color } from "../theme";
import type {
  PrivacyClient,
  PrivacyExportEnvelope,
  PrivacyRequest
} from "../privacy-client";
import { activeRequestOf, exportCopyFileName, formatDate, kindLabel, sessionStatusLabel, statusLabel, truncateId } from "./privacy-settings-helpers";
import { ProxyLoading } from "./proxy-foundation";

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
  // PRIVACY-EXPORT-INSPECT-001: 导出不能只给计数 —— 访问权要的是可检查的副本。
  const [showExportDetail, setShowExportDetail] = useState(false);
  const [saveState, setSaveState] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "saved"; name: string } | { kind: "failed"; message: string }>({ kind: "idle" });

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
      "依据《个人数据保护法》91/2025/QH15 第 32 条, 你有 30 天宽限期撤回请求. 30 天后, 你的账号资料与登录信息会被永久删除, 账号被匿名化 —— 你将无法再登录。交易 / 税务 / 安全 / 同意记录按法律要求继续保留。",
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

  // 把刚拿到的副本写成 JSON 文件并打开系统分享面板 —— 用户从那里"存储到
  // 文件"即完成下载（7 天下载期承诺的落点）。文件留在应用文档目录，
  // 分享被取消也不影响已写好的副本。
  const onSaveCopy = useCallback(async () => {
    if (!exportData || busy !== null) return;
    setBusy("save");
    setSaveState({ kind: "saving" });
    try {
      const name = exportCopyFileName(new Date());
      const uri = `${documentDirectory ?? ""}${name}`;
      if (!documentDirectory) throw new Error("no document directory");
      await writeAsStringAsync(uri, JSON.stringify(exportData, null, 2));
      await Share.share({ url: uri, message: "Proxy 个人数据副本" });
      setSaveState({ kind: "saved", name });
    } catch {
      setSaveState({ kind: "failed", message: "副本没存下来 —— 文件没写出来或分享被中断，请重试。" });
    } finally {
      setBusy(null);
    }
  }, [exportData, busy]);

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text selectable style={styles.cardTitle}>📦 下载我的数据</Text>
        <Text selectable style={styles.cardDesc}>依据《个人数据保护法》第 31 条, 你可以随时导出 Proxy 保存的个人数据副本。导出请求生成后, 你有 7 天下载期。</Text>
        {activeExport ? (
          <Text selectable style={styles.badge}>导出请求处理中 · {statusLabel(activeExport.status)}</Text>
        ) : (
          <Pressable
            onPress={onDownload}
            disabled={busy !== null}
            accessibilityRole="button"
            style={[styles.cta, busy !== null && styles.ctaDisabled]}
          >
            {busy === "export" ? (
              <ProxyLoading tone="onDark" />
            ) : (
              <Text selectable style={styles.ctaText}>生成我的数据副本</Text>
            )}
          </Pressable>
        )}
        {exportData && (
          <View style={styles.exportSummary}>
            <Text selectable style={styles.exportLine}>账号: {exportData.data.account.id}</Text>
            <Text selectable style={styles.exportLine}>会话数: {exportData.data.sessions.length}</Text>
            <Text selectable style={styles.exportLine}>设备数: {exportData.data.devices.length}</Text>
            <Text selectable style={styles.exportLine}>已记录的同意: {exportData.data.consents.length}</Text>
            <Text selectable style={styles.exportLine}>生成时间: {formatDate(exportData.generatedAt)}</Text>
            <Text selectable style={styles.exportFootnote}>依据: {exportData.legalBasis}</Text>
            <View style={styles.exportActions}>
              <Pressable
                onPress={() => setShowExportDetail((v) => !v)}
                accessibilityLabel={showExportDetail ? "收起数据明细" : "查看数据明细"}
                style={styles.ctaSecondary}
              >
                <Text selectable style={styles.ctaSecondaryText}>{showExportDetail ? "‹ 收起明细" : "查看明细 ›"}</Text>
              </Pressable>
              <Pressable
                onPress={() => void onSaveCopy()}
                disabled={busy !== null}
                accessibilityLabel="保存副本到文件"
                style={[styles.ctaSecondary, busy !== null && styles.ctaDisabled]}
              >
                <Text selectable style={styles.ctaSecondaryText}>{busy === "save" ? "保存中…" : "保存副本到文件"}</Text>
              </Pressable>
            </View>
            {saveState.kind === "saved" ? (
              <Text selectable style={styles.exportLine}>已存为 {saveState.name}，可从刚才的分享面板存到"文件"。</Text>
            ) : null}
            {saveState.kind === "failed" ? (
              <Text selectable style={styles.errorText}>{saveState.message}</Text>
            ) : null}
            {showExportDetail ? (
              <View style={styles.exportDetail}>
                <Text selectable style={styles.exportDetailTitle}>会话（{exportData.data.sessions.length}）</Text>
                {exportData.data.sessions.length === 0 ? <Text selectable style={styles.exportLine}>暂无会话记录。</Text> : null}
                {exportData.data.sessions.map((s) => (
                  <Text selectable key={s.id} style={styles.exportLine}>
                    {truncateId(s.id)} · {sessionStatusLabel(s.status)} · 设备 {truncateId(s.deviceId)}
                  </Text>
                ))}
                <Text selectable style={styles.exportDetailTitle}>设备（{exportData.data.devices.length}）</Text>
                {exportData.data.devices.length === 0 ? <Text selectable style={styles.exportLine}>暂无设备记录。</Text> : null}
                {exportData.data.devices.map((d) => (
                  <Text selectable key={d.id} style={styles.exportLine}>
                    {truncateId(d.id)} · {d.platform || "未知平台"} · {sessionStatusLabel(d.status)}
                  </Text>
                ))}
                <Text selectable style={styles.exportDetailTitle}>同意记录（{exportData.data.consents.length}）</Text>
                {exportData.data.consents.length === 0 ? <Text selectable style={styles.exportLine}>暂无同意记录。</Text> : null}
                {exportData.data.consents.map((c, index) => (
                  <Text selectable key={`${c.docKind}-${c.docVersion}-${index}`} style={styles.exportLine}>
                    {c.docKind} · 版本 {c.docVersion} · {formatDate(c.acceptedAt)}{c.required ? " · 必需" : ""}
                  </Text>
                ))}
                <Text selectable style={styles.exportDetailTitle}>历史请求（{exportData.history.length}）</Text>
                {exportData.history.length === 0 ? <Text selectable style={styles.exportLine}>暂无历史请求。</Text> : null}
                {exportData.history.map((r) => (
                  <Text selectable key={r.id} style={styles.exportLine}>
                    {kindLabel(r.kind)} · {statusLabel(r.status)} · {formatDate(r.requestedAt)}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text selectable style={styles.cardTitle}>🗑️ 请求删除账号</Text>
        <Text selectable style={styles.cardDesc}>30 天宽限期内你可以随时撤回。30 天后, 你的账号资料 (姓名 / 简介 / 头像 / 登录手机或邮箱 / 设备与登录会话) 会被永久删除, 账号被匿名化且无法再登录。交易 / 税务 / 安全 / 同意记录按法律要求保留。</Text>
        {activeDelete ? (
          <View>
            <Text selectable style={styles.badge}>删除请求已提交 · {statusLabel(activeDelete.status)}</Text>
            <Text selectable style={styles.exportLine}>预计完成: {formatDate(activeDelete.erasedAt)}</Text>
            <Pressable
              onPress={() => onCancelDelete(activeDelete.id)}
              disabled={busy !== null}
              accessibilityRole="button"
              style={[styles.ctaSecondary, busy !== null && styles.ctaDisabled]}
            >
              {busy === "cancel:" + activeDelete.id ? (
                <ProxyLoading tone="onLight" />
              ) : (
                <Text selectable style={styles.ctaSecondaryText}>撤回删除请求</Text>
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
              <ProxyLoading tone="onDark" />
            ) : (
              <Text selectable style={styles.ctaDangerText}>提交删除请求</Text>
            )}
          </Pressable>
        )}
      </View>

      {history.length > 0 && (
        <View style={styles.card}>
          <Text selectable style={styles.cardTitle}>🕘 请求历史</Text>
          {history.map((req) => (
            <View key={req.id} style={styles.historyRow}>
              <Text selectable style={styles.historyKind}>{kindLabel(req.kind)}</Text>
              <Text selectable style={styles.historyMeta}>{statusLabel(req.status)} · {formatDate(req.requestedAt)}</Text>
            </View>
          ))}
        </View>
      )}

      {error && (
        <View style={styles.errorCard}>
          <Text selectable style={styles.errorText}>{error}</Text>
          <Pressable onPress={refresh} style={styles.ctaSecondary}>
            <Text selectable style={styles.ctaSecondaryText}>重试</Text>
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
  exportActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  exportDetail: { gap: 3, marginTop: 8 },
  exportDetailTitle: { color: color.ink, fontSize: 12, fontWeight: "700", marginTop: 6 },
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
