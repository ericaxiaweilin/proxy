import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { color } from "../theme";
import { ProxyQrCode } from "./proxy-qr-code";
import { promoQrValue, type PromoCode, type PromoStats, type SupplyClient } from "../supply-client";

// MERCHANT-CREATOR-PROMO-001：专属营销码认领区（Creator 给自己认码）。
//
// 码她自己选好记的（LINH88 这类，UGC 里挂自己的名字传播才顺），服务端只做
// 形状 + 全局唯一校验（linh88 == LINH88，不许占两次），一人同时只持一个。
// 下面直接印她的战绩（带来几单/新客几人/归因多少）—— 带没带新客从报码数里
// 数出来，不用她自己说。提交走 supply.claimPromoCode —— 只能认领自己的，
// 服务端按 principal 校验，别人的 agentId 传过去会被 AGENT_NOT_OWNED 拒掉。
export function PromoCodeSection({ agentId, supply, onError }: {
  agentId: string;
  supply: SupplyClient;
  onError: (message: string) => void;
}): React.JSX.Element {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [stats, setStats] = useState<PromoStats | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [list, computed] = await Promise.all([
        supply.listMyPromoCodes(),
        supply.myPromoStats(),
      ]);
      setCodes(list.filter((c) => c.agentId === agentId));
      setStats(computed);
    } catch (e) {
      onError(e instanceof Error ? e.message : "专属码没读出来");
    }
  }, [supply, agentId, onError]);
  useEffect(() => { void reload(); }, [reload]);

  const active = codes.find((c) => c.status === "ACTIVE");

  async function claim(): Promise<void> {
    const code = draft.trim();
    if (!code || busy) return;
    setBusy(true);
    try {
      await supply.claimPromoCode({ agentId, code });
      setDraft("");
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : "认领失败");
    } finally {
      setBusy(false);
    }
  }

  async function disable(): Promise<void> {
    if (!active || busy) return;
    setBusy(true);
    try {
      await supply.disablePromoCode({ code: active.code });
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : "停用失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      <Text selectable style={styles.title}>专属营销码</Text>
      {active ? (
        <>
          <Text selectable style={styles.code} testID="creator-promo-code">{active.code}</Text>
          {/* 专属码二维码：UGC 里挂这个图，顾客到店店员扫码即报码 ——
              码体就是 PROXY-PROMO:码，报码框认它（也认手抄的裸码）。 */}
          <View style={styles.qrRow} testID="creator-promo-qr">
            <ProxyQrCode size={132} value={promoQrValue(active.code)} />
            <Text selectable style={[styles.hint, styles.qrHint]}>顾客到店，店员扫这个码即报码拿优惠 —— 每一笔都记到你头上。</Text>
          </View>
          <Text selectable style={styles.stats}>
            {`带来 ${stats?.quotes ?? 0} 单 · 新客 ${stats?.firstVisits ?? 0} 人 · 归因 ${(stats?.attributedVnd ?? 0).toLocaleString()} VND`}
          </Text>
          <Pressable accessibilityLabel="停用专属码" disabled={busy} onPress={() => void disable()} style={styles.unlink}>
            <Text selectable style={styles.unlinkText}>停用（换码先停旧的）</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text selectable style={styles.hint}>还没认领 —— 选个好记的（4–16 位字母数字，比如 LINH88），商家认了这个码，你的 UGC 才算带新客。</Text>
          <Text selectable style={styles.label}>我的专属码</Text>
          <TextInput
            autoCapitalize="characters"
            onChangeText={setDraft}
            value={draft}
            placeholder="例如 LINH88"
            placeholderTextColor={color.muted}
            style={styles.input}
          />
          <Pressable accessibilityLabel="认领专属码" disabled={busy || draft.trim() === ""} onPress={() => void claim()} style={[styles.add, (busy || draft.trim() === "") && styles.addDisabled]}>
            <Text selectable style={styles.addText}>{busy ? "保存中…" : "认领"}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, gap: 6, marginTop: 12, padding: 12 },
  title: { color: color.ink, fontSize: 13, fontWeight: "800" },
  code: { color: color.ink, fontSize: 22, fontWeight: "900", letterSpacing: 1, marginTop: 2 },
  qrRow: { alignItems: "center", flexDirection: "row", gap: 12, marginTop: 8 },
  qrHint: { flex: 1, minWidth: 0 },
  hint: { color: color.muted, fontSize: 11, lineHeight: 16 },
  stats: { color: color.ink, fontSize: 12, fontWeight: "700", marginTop: 2 },
  label: { color: color.muted, fontSize: 11, fontWeight: "800", marginTop: 4 },
  input: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, color: color.ink, fontSize: 13, fontWeight: "700", height: 44, paddingHorizontal: 12 },
  add: { alignItems: "center", backgroundColor: color.ink, borderRadius: 12, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
  addDisabled: { opacity: 0.5 },
  addText: { color: color.white, fontSize: 13, fontWeight: "800" },
  unlink: { alignSelf: "flex-start", borderColor: color.line, borderRadius: 999, borderWidth: 1, marginTop: 6, paddingHorizontal: 10, paddingVertical: 6 },
  unlinkText: { color: color.muted, fontSize: 11, fontWeight: "800" },
});
