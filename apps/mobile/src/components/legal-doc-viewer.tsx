// R16.9 in-app fullscreen legal doc viewer. Fetches the Terms /
// Privacy text from /v1/legal/{kind} on the API server and renders it
// in a scrollable modal. The user must be able to actually read the
// text BEFORE the consent checkbox is enabled; we explicitly do not
// rely on "the link works" a promise or an external browser.
//
// SETTINGS-LEGALDOCS-001（2026-10-01，用户：「服务隐私也没做 … 要做 基本功能」）：
// 这个组件原先是 native-app.tsx 里的**模块私有函数**，只被登录页的同意勾选
// 用到 —— 设置页那 9 行里的「服务协议与隐私政策」因此是个空的承诺。挪成独立
// 组件后两处共用同一份实现，也不用在 me.tsx 里再抄一遍条款渲染。
//
// 文案全部走字典（i18n）：设置页那一行本身就是多语言入口，条款标题/关闭/
// 加载中/加载失败都不该写死中文。
import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import { LegalDocClient, type LegalDoc, type LegalDocKind } from "../legal-doc";
import { LegalDocRenderer } from "../legal-doc-render";
import { ProxyLoading } from "./proxy-foundation";
import { localApiBaseUrl } from "../native-clients";
import { useI18n } from "../i18n";

export type LegalDocViewerProps = {
  kind: LegalDocKind;
  onClose: () => void;
};

export function LegalDocViewer({ kind, onClose }: LegalDocViewerProps): React.JSX.Element {
  // SETTINGS-LEGALDOCS-001：条款页也可能被非中文用户打开，标题/关闭/加载态/
  // 失败态都不该写死中文 —— 而设置页那一行本身就是多语言入口。
  const { t } = useI18n();
  const [doc, setDoc] = useState<LegalDoc | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(undefined);
    setDoc(null);
    new LegalDocClient({ baseUrl: localApiBaseUrl })
      .load(kind)
      .then((loaded) => {
        if (!cancelled) setDoc(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent={false} visible>
      <View style={styles.legalScreen}>
        <View style={styles.legalHeader}>
          <Text selectable style={styles.legalHeaderTitle}>{t(kind === "terms" ? "legalTermsTitle" : "legalPrivacyTitle")} (v{doc?.version ?? "1.1"})</Text>
          <Pressable disabled={busy} onPress={onClose} style={styles.legalCloseBtn}><Text selectable style={styles.legalCloseBtnText}>{t("close")}</Text></Pressable>
        </View>
        {busy ? (
          <View style={styles.legalBusy}><ProxyLoading tone="violet" label={t("consentLoading")} /></View>
        ) : error ? (
          <View style={styles.legalErrorBlock}>
            <Text selectable style={styles.legalErrorTitle}>{t("legalLoadFailedTitle")}</Text>
            <Text selectable style={styles.legalErrorBody}>{error}</Text>
            <Text selectable style={styles.legalErrorHint}>{t("legalLoadFailedHint")}</Text>
          </View>
        ) : doc ? (
          <ScrollView contentContainerStyle={styles.legalScroll}>
            <Text selectable style={styles.legalTitle}>{doc.title}</Text>
            <Text selectable style={styles.legalMeta}>{t("legalMeta", { locale: doc.locale, date: doc.updatedAt.slice(0, 10) })}</Text>
            {/* R15.x+: 用 LegalDocRenderer 替换平铺 Text — 渲染 serif
                + 15pt + 1.6 lineHeight + heading + 列表 + TOC。 */}
            <LegalDocRenderer content={doc.content} />
            <Text selectable style={styles.legalFooter}>{t("legalDraftFooter")}</Text>
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  legalScreen: { backgroundColor: color.white, flex: 1, paddingTop: 50 },
  legalHeader: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  legalHeaderTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  legalCloseBtn: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  legalCloseBtnText: { color: color.ink, fontSize: 13, fontWeight: "700" },
  legalBusy: { alignItems: "center", flex: 1, justifyContent: "center" },
  legalBusyText: { color: color.muted, fontSize: 13, marginTop: 8 },
  legalErrorBlock: { padding: 24 },
  legalErrorTitle: { color: color.ink, fontSize: 16, fontWeight: "800", marginBottom: 8 },
  legalErrorBody: { color: color.muted, fontSize: 13, marginBottom: 12 },
  legalErrorHint: { color: color.ink, fontSize: 12, lineHeight: 18 },
  legalScroll: { padding: 20, paddingBottom: 60 },
  legalTitle: { color: color.ink, fontFamily: Platform.select({ ios: "New York", android: "serif", default: "serif" }), fontSize: 22, fontWeight: "900", marginBottom: 6 },
  legalMeta: { color: color.muted, fontSize: 12, marginBottom: 16 },
  // legalBody 由 LegalDocRenderer 负责 (serif + 15pt + 1.6)。本样式
  // 保留以防其它代码路径 fallback。
  legalBody: { color: color.ink, fontFamily: Platform.select({ ios: "New York", android: "serif", default: "serif" }), fontSize: 15, lineHeight: 24 },
  legalFooter: { color: color.muted, fontFamily: Platform.select({ ios: "New York", android: "serif", default: "serif" }), fontSize: 12, fontStyle: "italic", lineHeight: 20, marginTop: 24 },
});
