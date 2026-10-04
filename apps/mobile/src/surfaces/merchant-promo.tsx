import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color, foundation } from "../theme";
import { ProxyBackGlyph } from "../components/proxy-foundation";
import type { PromoBenefit, PromoQuote, PromoStats, SupplyClient } from "../supply-client";

// MERCHANT-CREATOR-PROMO-001：商家侧专属营销码管理 —— 绑定优惠 + 店员报码 +
// 看战绩。 brought in as its own surface（merchant-me 已经 1500+ 行，不再塞）。
//
// 四块：①战绩头（报码单数/店员确认新客/归因金额/让利金额，全是报码行里数出来的）；
// ②绑定优惠（码 + 直减金额 + 适用范围 + 有效期）；③报码核销（输码+金额+新客勾）；
// ④按码战绩榜。优惠是商家承诺（平台记录、收银台执行），第一版不碰 voucher 域。
export function MerchantPromoSurface({ supply, merchantId, onBack }: {
  supply: SupplyClient;
  merchantId: string;
  onBack: () => void;
}): React.JSX.Element {
  const [benefits, setBenefits] = useState<PromoBenefit[]>([]);
  const [stats, setStats] = useState<PromoStats | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  // 绑定表单
  const [bindCode, setBindCode] = useState("");
  const [bindValue, setBindValue] = useState("");
  const [bindScope, setBindScope] = useState("");
  const [bindDays, setBindDays] = useState(30);
  const [bindSending, setBindSending] = useState(false);
  const [bindError, setBindError] = useState<string | undefined>(undefined);
  // 报码表单
  const [quoteCode, setQuoteCode] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [quoteFirstVisit, setQuoteFirstVisit] = useState(false);
  const [quoteSending, setQuoteSending] = useState(false);
  const [quoteError, setQuoteError] = useState<string | undefined>(undefined);
  const [quoteResult, setQuoteResult] = useState<string | undefined>(undefined);

  const reload = useCallback(async (): Promise<void> => {
    setLoadError(undefined);
    try {
      const [list, computed] = await Promise.all([
        supply.listMerchantBenefits({ merchantId }),
        supply.merchantPromoStats({ merchantId }),
      ]);
      setBenefits(list);
      setStats(computed);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "专属码数据没读出来");
    }
  }, [supply, merchantId]);
  useEffect(() => { void reload(); }, [reload]);

  const validUntilOf = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const bind = async (): Promise<void> => {
    if (bindSending) return;
    const faceValue = Number(bindValue.replace(/[^\d]/g, ""));
    if (!Number.isInteger(faceValue) || faceValue <= 0) {
      setBindError("直减金额填一下（VND 数字）");
      return;
    }
    if (bindScope.trim() === "") {
      setBindError("适用范围写一下（比如：全场饮品）");
      return;
    }
    setBindSending(true);
    setBindError(undefined);
    try {
      await supply.bindPromoBenefit({
        merchantId, code: bindCode, faceValueVnd: faceValue,
        scopeName: bindScope.trim(), validUntil: validUntilOf(bindDays),
      });
      setBindCode("");
      setBindValue("");
      setBindScope("");
      await reload();
    } catch (e) {
      setBindError(e instanceof Error ? e.message : "绑定没成功，稍后重试");
    } finally {
      setBindSending(false);
    }
  };

  const quote = async (): Promise<void> => {
    if (quoteSending) return;
    if (quoteCode.trim() === "") {
      setQuoteError("码填一下（顾客报的专属码）");
      return;
    }
    let amount = 0;
    if (quoteAmount.trim() !== "") {
      amount = Number(quoteAmount.replace(/[^\d]/g, ""));
      if (!Number.isInteger(amount) || amount <= 0) {
        setQuoteError("金额填 VND 数字，空着就是没记单");
        return;
      }
    }
    setQuoteSending(true);
    setQuoteError(undefined);
    setQuoteResult(undefined);
    try {
      const result = await supply.quotePromoCode({
        merchantId, code: quoteCode, amountVnd: amount, firstVisit: quoteFirstVisit,
      });
      setQuoteResult(`已减 ${result.faceValueVnd.toLocaleString()} VND（${result.scopeName}）· 已记到 ${result.quote.agentId} 头上`);
      setQuoteCode("");
      setQuoteAmount("");
      setQuoteFirstVisit(false);
      await reload();
    } catch (e) {
      setQuoteError(e instanceof Error ? e.message : "报码没成功，稍后重试");
    } finally {
      setQuoteSending(false);
    }
  };

  const vnd = (n: number): string => `${n.toLocaleString()} VND`;
  return (
    <View>
      <Pressable onPress={onBack} accessibilityLabel="返回 Creator 经营" style={s.backRow}>
        <ProxyBackGlyph />
        <Text selectable style={s.back}>返回</Text>
      </Pressable>
      <Text selectable style={s.title}>专属营销码</Text>
      <Text selectable style={s.sub}>Creator 的 UGC 挂码，顾客到店报码拿优惠，每一笔都记到她头上。</Text>
      {loadError ? <Text selectable style={s.error}>{loadError}</Text> : null}
      {/* 战绩头：报码行里数出来的，不编。 */}
      <View style={s.statsRow}>
        <View style={s.stat}><Text selectable style={s.statValue}>{stats?.quotes ?? "—"}</Text><Text selectable style={s.statLabel}>报码单数</Text></View>
        <View style={s.stat}><Text selectable style={s.statValue}>{stats?.firstVisits ?? "—"}</Text><Text selectable style={s.statLabel}>店员确认新客</Text></View>
        <View style={s.stat}><Text selectable style={s.statValue}>{stats ? vnd(stats.attributedVnd) : "—"}</Text><Text selectable style={s.statLabel}>归因金额</Text></View>
        <View style={s.stat}><Text selectable style={s.statValue}>{stats ? vnd(stats.discountGivenVnd) : "—"}</Text><Text selectable style={s.statLabel}>让利金额</Text></View>
      </View>
      {/* 绑定优惠 */}
      <Text selectable style={s.secTitle}>绑定优惠</Text>
      <Text selectable style={s.hint}>码是 creator 认领的（比如 LINH88），你认她这个码，给直减 + 范围 + 有效期。</Text>
      <TextInput onChangeText={setBindCode} placeholder="专属码（比如 LINH88）" placeholderTextColor={color.muted} style={s.input} value={bindCode} autoCapitalize="characters" />
      <TextInput keyboardType="number-pad" onChangeText={setBindValue} placeholder="直减金额 VND（比如 50000）" placeholderTextColor={color.muted} style={s.input} value={bindValue} />
      <TextInput onChangeText={setBindScope} placeholder="适用范围（比如：全场饮品）" placeholderTextColor={color.muted} style={s.input} value={bindScope} />
      <View style={s.chipRow}>
        {[30, 60, 90].map((days) => (
          <Pressable key={days} onPress={() => setBindDays(days)} style={[s.chip, bindDays === days && s.chipOn]} accessibilityLabel={`有效期${days}天`}>
            <Text selectable style={[s.chipText, bindDays === days && s.chipTextOn]}>{`${days}天（至 ${validUntilOf(days).slice(5)}）`}</Text>
          </Pressable>
        ))}
      </View>
      {bindError ? <Text selectable style={s.error}>{bindError}</Text> : null}
      <Pressable disabled={bindSending} onPress={() => void bind()} style={s.primary} accessibilityLabel="绑定优惠"><Text selectable style={s.primaryText}>{bindSending ? "绑定中…" : "绑定优惠"}</Text></Pressable>
      {/* 已绑列表 */}
      {benefits.map((benefit) => (
        <View key={`${benefit.merchantId}/${benefit.code}`} style={s.card}>
          <Text selectable style={s.cardTitle}>{benefit.code}</Text>
          <Text selectable style={s.meta}>
            {`直减 ${benefit.faceValueVnd.toLocaleString()} VND · ${benefit.scopeName} · 至 ${benefit.validUntil} · ${benefit.status === "ACTIVE" ? "生效中" : "已停用"}`}
          </Text>
          <Text selectable style={s.meta}>
            {`战绩 ${stats?.byCode[benefit.code]?.quotes ?? 0} 单 · 新客 ${stats?.byCode[benefit.code]?.firstVisits ?? 0} 人 · 归因 ${vnd(stats?.byCode[benefit.code]?.attributedVnd ?? 0)}`}
          </Text>
        </View>
      ))}
      {/* 报码核销 */}
      <Text selectable style={s.secTitle}>报码核销</Text>
      <Text selectable style={s.hint}>顾客报码，输码 + 单子金额，问一句是不是第一次来（新客就勾上，顾客自述，平台不核身份）。</Text>
      <TextInput onChangeText={setQuoteCode} placeholder="专属码" placeholderTextColor={color.muted} style={s.input} value={quoteCode} autoCapitalize="characters" />
      <TextInput keyboardType="number-pad" onChangeText={setQuoteAmount} placeholder="单子金额 VND（可空）" placeholderTextColor={color.muted} style={s.input} value={quoteAmount} />
      <Pressable onPress={() => setQuoteFirstVisit((v) => !v)} style={[s.chip, quoteFirstVisit && s.chipOn]} accessibilityLabel="新客">
        <Text selectable style={[s.chipText, quoteFirstVisit && s.chipTextOn]}>{quoteFirstVisit ? "✓ 新客（顾客自述首访）" : "新客？"}</Text>
      </Pressable>
      {quoteError ? <Text selectable style={s.error}>{quoteError}</Text> : null}
      {quoteResult ? <Text selectable style={s.ok}>{quoteResult}</Text> : null}
      <Pressable disabled={quoteSending} onPress={() => void quote()} style={s.primary} accessibilityLabel="报码"><Text selectable style={s.primaryText}>{quoteSending ? "报码中…" : "报码 · 落归因"}</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  backRow: { alignItems: "center", flexDirection: "row", gap: 2, marginBottom: 4 },
  back: { color: color.muted, fontSize: 14, fontWeight: "700" },
  title: { color: color.ink, fontSize: 20, fontWeight: "900" },
  sub: { color: color.muted, fontSize: 12, marginTop: 2 },
  error: { color: foundation.danger, fontSize: 12, marginTop: 6 },
  ok: { color: foundation.success, fontSize: 13, fontWeight: "700", marginTop: 6 },
  statsRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  stat: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, padding: 10 },
  statValue: { color: color.ink, fontSize: 15, fontWeight: "900" },
  statLabel: { color: color.muted, fontSize: 11, marginTop: 2 },
  secTitle: { color: color.ink, fontSize: 15, fontWeight: "800", marginTop: 16 },
  hint: { color: color.muted, fontSize: 12, marginTop: 2 },
  input: { backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, color: color.ink, fontSize: 14, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { backgroundColor: color.surface, borderRadius: 999, marginTop: 8, paddingHorizontal: 13, paddingVertical: 8 },
  chipOn: { backgroundColor: color.ink },
  chipText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  chipTextOn: { color: color.white },
  primary: { alignItems: "center", backgroundColor: color.lime, borderRadius: 12, marginTop: 10, paddingVertical: 12 },
  primaryText: { color: color.ink, fontSize: 14, fontWeight: "900" },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 8, padding: 12 },
  cardTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  meta: { color: color.muted, fontSize: 12, marginTop: 2 },
});
