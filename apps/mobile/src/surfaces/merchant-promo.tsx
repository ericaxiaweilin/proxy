import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { color, foundation } from "../theme";
import { ProxyBackGlyph } from "../components/proxy-foundation";
import type { PromoAutoBenefit, PromoBenefit, PromoStats, SupplyClient } from "../supply-client";
import { parsePromoQr } from "../supply-client";

// MERCHANT-CREATOR-PROMO-001：商家侧专属营销码管理 —— 自动档 + 绑定优惠 +
// 店员报码（扫码/手输）+ 看战绩。brought in as its own surface（merchant-me
// 已经 1500+ 行，不再塞）。
//
// 四块：①战绩头（报码行里数出来的）；②自动档（开一次，以后免逐个绑）；
// ③绑定优惠（选人即选码，也允许手填码）；④报码核销（扫码/输码+金额+新客勾）。
// 优惠是商家承诺（平台记录、收银台执行），第一版不碰 voucher 域。
export function MerchantPromoSurface({ supply, merchantId, creators, onBack }: {
  supply: SupplyClient;
  merchantId: string;
  // 人才库里有码的人（agentId + 名字 + 专属码）：绑定时选人即选码，不用手抄。
  creators: Array<{ agentId: string; name: string; promoCode: string }>;
  onBack: () => void;
}): React.JSX.Element {
  const [benefits, setBenefits] = useState<PromoBenefit[]>([]);
  const [auto, setAuto] = useState<PromoAutoBenefit | undefined>(undefined);
  const [stats, setStats] = useState<PromoStats | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  // 绑定表单
  const [bindCode, setBindCode] = useState("");
  const [bindCreatorName, setBindCreatorName] = useState("");
  const [bindValue, setBindValue] = useState("");
  const [bindScope, setBindScope] = useState("");
  const [bindDays, setBindDays] = useState(30);
  const [bindSending, setBindSending] = useState(false);
  const [bindError, setBindError] = useState<string | undefined>(undefined);
  // 自动档表单
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoValue, setAutoValue] = useState("");
  const [autoScope, setAutoScope] = useState("");
  const [autoDays, setAutoDays] = useState(30);
  const [autoSending, setAutoSending] = useState(false);
  const [autoError, setAutoError] = useState<string | undefined>(undefined);
  // 报码表单
  const [quoteCode, setQuoteCode] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [quoteFirstVisit, setQuoteFirstVisit] = useState(false);
  const [quoteSending, setQuoteSending] = useState(false);
  const [quoteError, setQuoteError] = useState<string | undefined>(undefined);
  const [quoteResult, setQuoteResult] = useState<string | undefined>(undefined);
  const [scanning, setScanning] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const reload = useCallback(async (): Promise<void> => {
    setLoadError(undefined);
    try {
      const [listed, computed] = await Promise.all([
        supply.listMerchantBenefits({ merchantId }),
        supply.merchantPromoStats({ merchantId }),
      ]);
      setBenefits(listed.benefits);
      setAuto(listed.autoBenefit);
      if (listed.autoBenefit) {
        setAutoEnabled(listed.autoBenefit.enabled);
        setAutoValue(listed.autoBenefit.faceValueVnd > 0 ? String(listed.autoBenefit.faceValueVnd) : "");
        setAutoScope(listed.autoBenefit.scopeName);
        setAutoDays(listed.autoBenefit.validityDays > 0 ? listed.autoBenefit.validityDays : 30);
      }
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
      setBindCreatorName("");
      setBindValue("");
      setBindScope("");
      await reload();
    } catch (e) {
      setBindError(e instanceof Error ? e.message : "绑定没成功，稍后重试");
    } finally {
      setBindSending(false);
    }
  };

  // 自动档保存：开着要有完整的默认（金额+范围+天数），关掉只传 enabled=false。
  const saveAuto = async (): Promise<void> => {
    if (autoSending) return;
    if (autoEnabled) {
      const faceValue = Number(autoValue.replace(/[^\d]/g, ""));
      if (!Number.isInteger(faceValue) || faceValue <= 0) {
        setAutoError("默认直减金额填一下（VND 数字）");
        return;
      }
      if (autoScope.trim() === "") {
        setAutoError("默认适用范围写一下");
        return;
      }
    }
    setAutoSending(true);
    setAutoError(undefined);
    try {
      const faceValue = Number(autoValue.replace(/[^\d]/g, ""));
      await supply.setAutoPromoBenefit({
        merchantId,
        enabled: autoEnabled,
        ...(autoEnabled ? {
          faceValueVnd: Number.isInteger(faceValue) && faceValue > 0 ? faceValue : 0,
          scopeName: autoScope.trim(),
          validityDays: autoDays,
        } : {}),
      });
      await reload();
    } catch (e) {
      setAutoError(e instanceof Error ? e.message : "自动档没保存成功，稍后重试");
    } finally {
      setAutoSending(false);
    }
  };

  // 扫码报码：扫 creator 的专属码二维码（PROXY-PROMO:码），形状不对直接说，
  // 不把乱码填进输入框。扫到只填框，减多少钱还是点"报码"才落（两步确认）。
  const handleScanned = (data: string): void => {
    const code = parsePromoQr(data);
    if (!code) {
      setQuoteError("扫到的不是专属码，重扫她的码");
      return;
    }
    setQuoteError(undefined);
    setQuoteCode(code);
    setScanning(false);
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
      {/* 自动档：开一次，以后没绑过的码来报码自动按默认建绑定 ——
          不用逐个码手工绑。关掉只停以后自动建，已经建出来的不受影响。 */}
      <Text selectable style={s.secTitle}>自动归因</Text>
      <Text selectable style={s.hint}>{auto?.enabled ? `开着：没绑过的码来报码，自动按默认减 ${auto.faceValueVnd.toLocaleString()} VND（${auto.scopeName}）` : "没开：每个码都要手工绑优惠才认。"}</Text>
      <Pressable onPress={() => setAutoEnabled((v) => !v)} style={[s.chip, autoEnabled && s.chipOn]} accessibilityLabel="自动归因开关">
        <Text selectable style={[s.chipText, autoEnabled && s.chipTextOn]}>{autoEnabled ? "✓ 自动归因开" : "自动归因关"}</Text>
      </Pressable>
      {autoEnabled ? (<>
        <TextInput keyboardType="number-pad" onChangeText={setAutoValue} placeholder="默认直减 VND" placeholderTextColor={color.muted} style={s.input} value={autoValue} />
        <TextInput onChangeText={setAutoScope} placeholder="默认适用范围" placeholderTextColor={color.muted} style={s.input} value={autoScope} />
        <View style={s.chipRow}>
          {[30, 60, 90].map((days) => (
            <Pressable key={days} onPress={() => setAutoDays(days)} style={[s.chip, autoDays === days && s.chipOn]} accessibilityLabel={`默认有效期${days}天`}>
              <Text selectable style={[s.chipText, autoDays === days && s.chipTextOn]}>{`${days}天`}</Text>
            </Pressable>
          ))}
        </View>
      </>) : null}
      {autoError ? <Text selectable style={s.error}>{autoError}</Text> : null}
      <Pressable disabled={autoSending} onPress={() => void saveAuto()} style={s.primary} accessibilityLabel="保存自动档"><Text selectable style={s.primaryText}>{autoSending ? "保存中…" : "保存自动档"}</Text></Pressable>
      {/* 绑定优惠 */}
      <Text selectable style={s.secTitle}>绑定优惠</Text>
      <Text selectable style={s.hint}>从人才库选人即选码（她的专属码自动填上），再给直减 + 范围 + 有效期；人不在库里就手填码。</Text>
      {creators.length > 0 ? (
        <View style={s.chipRow}>
          {creators.map((creator) => (
            <Pressable key={creator.agentId} onPress={() => { setBindCode(creator.promoCode); setBindCreatorName(creator.name); }} style={[s.chip, bindCode === creator.promoCode && creator.promoCode !== "" && s.chipOn]} accessibilityLabel={`绑定${creator.name}的码`}>
              <Text selectable style={[s.chipText, bindCode === creator.promoCode && creator.promoCode !== "" && s.chipTextOn]}>{`${creator.name} · ${creator.promoCode}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {bindCreatorName !== "" ? <Text selectable style={s.meta}>绑给 {bindCreatorName}（{bindCode}）</Text> : null}
      <TextInput onChangeText={(text) => { setBindCode(text); setBindCreatorName(""); }} placeholder="专属码（比如 LINH88）" placeholderTextColor={color.muted} style={s.input} value={bindCode} autoCapitalize="characters" />
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
      {/* 已绑列表：来源标出来（手动绑的 / 自动进来的），账上分得清。 */}
      {benefits.map((benefit) => (
        <View key={`${benefit.merchantId}/${benefit.code}`} style={s.card}>
          <Text selectable style={s.cardTitle}>{benefit.code}</Text>
          <Text selectable style={s.meta}>
            {`直减 ${benefit.faceValueVnd.toLocaleString()} VND · ${benefit.scopeName} · 至 ${benefit.validUntil} · ${benefit.status === "ACTIVE" ? "生效中" : "已停用"} · ${benefit.source === "AUTO" ? "自动" : "手动"}`}
          </Text>
          <Text selectable style={s.meta}>
            {`战绩 ${stats?.byCode[benefit.code]?.quotes ?? 0} 单 · 新客 ${stats?.byCode[benefit.code]?.firstVisits ?? 0} 人 · 归因 ${vnd(stats?.byCode[benefit.code]?.attributedVnd ?? 0)}`}
          </Text>
        </View>
      ))}
      {/* 报码核销：扫她的码二维码，或手输码。扫到只填框，点报码才落（两步确认）。 */}
      <Text selectable style={s.secTitle}>报码核销</Text>
      <Text selectable style={s.hint}>顾客报码，输码 + 单子金额，问一句是不是第一次来（新客就勾上，顾客自述，平台不核身份）。</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <TextInput onChangeText={setQuoteCode} placeholder="专属码" placeholderTextColor={color.muted} style={s.input} value={quoteCode} autoCapitalize="characters" />
        </View>
        <Pressable onPress={() => setScanning((v) => !v)} style={[s.chip, scanning && s.chipOn]} accessibilityLabel="扫码报码">
          <Text selectable style={[s.chipText, scanning && s.chipTextOn]}>扫码</Text>
        </Pressable>
      </View>
      {scanning ? (
        cameraPermission?.granted ? (
          <View style={s.cameraWrap}>
            <CameraView
              style={s.cameraView}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={(result) => handleScanned(result.data)}
            />
            <Text selectable style={s.hint}>对准她的专属码二维码即可识别</Text>
          </View>
        ) : (
          <View>
            <Text selectable style={s.hint}>{cameraPermission ? "需要相机权限才能扫码" : "相机权限未决定"}</Text>
            {!cameraPermission?.granted ? (
              <Pressable onPress={() => void requestCameraPermission()} style={s.primary} accessibilityLabel="允许使用相机"><Text selectable style={s.primaryText}>允许使用相机</Text></Pressable>
            ) : null}
          </View>
        )
      ) : null}
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
  cameraWrap: { marginTop: 8 },
  cameraView: { borderRadius: 12, height: 220, overflow: "hidden" },
});
