import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { color } from "../theme";
import { ProxyQrCode } from "./proxy-qr-code";
import { promoQrValue, type MerchantCreatorPromo, type PairPromoStats, type PromoCode, type PromoStats, type SupplyClient } from "../supply-client";
import { formatPromoTerms, formatWan } from "../merchant-promo-format";

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
  // MERCHANT-CREATOR-PROMO-002：各家店给我发的专属码（一店一码）+ 每个码的战绩。
  const [pairPromos, setPairPromos] = useState<Array<{ promo: MerchantCreatorPromo; stats: PairPromoStats }>>([]);
  const [openCode, setOpenCode] = useState<string | undefined>(undefined);
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
    try {
      setPairPromos((await supply.listMyMerchantPromos({ agentId })).promos);
    } catch {
      // 各家店的码没读出来不挡个人码这一块。
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
            <Text selectable style={[styles.hint, styles.qrHint]}>这是你的个人码。商家给你发专属码时会用它做前缀（比如 {active.code}-WORKSHOP），你在各家店的码都带着自己的名字。</Text>
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
      <Text selectable style={[styles.title, { marginTop: 10 }]}>各家店给我的专属码</Text>
      {pairPromos.length === 0 ? (
        <Text selectable style={styles.hint}>还没有商家给你发专属码。商家在「Creator 经营 → 带到店新客」里给你生成后，会出现在这里。</Text>
      ) : pairPromos.map(({ promo, stats: st }) => (
        <Pressable key={promo.code} onPress={() => setOpenCode((cur) => (cur === promo.code ? undefined : promo.code))} style={styles.pairRow} accessibilityLabel={`查看${promo.merchantName}专属码`} testID={`creator-pair-promo-${promo.code}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text selectable style={styles.pairCode}>{promo.code}</Text>
            <Text selectable style={styles.pairTerms}>{promo.terms.displayText || formatPromoTerms(promo.terms.minSpendVnd, promo.terms.faceValueVnd)}</Text>
          </View>
          <Text selectable style={styles.hint}>{`${promo.merchantName || "商家"} · ${promo.terms.validUntil ? `至 ${promo.terms.validUntil}` : "长期有效"}${promo.status === "ACTIVE" ? "" : " · 已停用"}`}</Text>
          <Text selectable style={styles.stats}>{`新客 ${st.newCustomers} · 核销 ${st.redeemed} · 发券 ${st.issued} · 消费 ${formatWan(st.spendVnd)}`}</Text>
          {openCode === promo.code ? (
            <View style={styles.qrRow}>
              <ProxyQrCode size={132} value={promoQrValue(promo.code)} />
              <Text selectable style={[styles.hint, styles.qrHint]}>贴在你给这家店做的内容里：顾客用 Proxy 扫一扫领券，到店出示券核销，每一位新客都记到你头上。</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pairRow: { backgroundColor: "#F9F9FB", borderRadius: 12, gap: 3, marginTop: 6, padding: 10 },
  pairCode: { color: color.ink, fontSize: 13, fontWeight: "900", letterSpacing: 0.5 },
  pairTerms: { color: "#FF3B30", fontSize: 13, fontWeight: "900" },
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
