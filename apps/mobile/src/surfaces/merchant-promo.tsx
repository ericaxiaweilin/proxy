import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { ProxyBackGlyph } from "../components/proxy-foundation";
import { ProxyQrCode } from "../components/proxy-qr-code";
import {
  parseCouponQr,
  parsePromoQr,
  promoQrValue,
  type PairPromoStats,
  type PairPromoView,
  type PromoChange,
  type PromoSuggestion,
  type SupplyClient,
} from "../supply-client";
import { formatPromoTerms, formatWan, promoReasonLine, templateTerms, PROMO_TEMPLATES } from "../merchant-promo-format";

// MERCHANT-CREATOR-PROMO-002（2026-10-04，用户：「给所有 creator-商家开发一套专属优惠码系统，
// 对于 n 商家 n creator 开发专属唯一的优惠码，有利于激励，让 creator 商家成长，而不是简单的
// 满 x 减 y」；原型 docs/design/references/Proxy_Creator_Promo_20261004_bc214e.html
// 「带到店新客 - 可手动调整折扣」）。
//
// 一对（本店, creator）一个唯一码，**系统自动发**（打开页面时服务端给本店市场里在服务的
// creator 补齐，条款按系统建议起步）。用户 2026-10-04：「商家唯一操作就是选择下单或者调整
// 系统自动的折扣值，对商家要简单，复杂留给后端」—— 所以卡片上只有「选择下单」「调整折扣」
// 两个操作，「查看依据」是说明行上的只读链接。这一页照原型：
//   ① 整店四个数：到店新客 / 累计核销 / 累计发券 / 核销转化率（服务端从发券行和核销行里数）；
//   ② 达人专属折扣（按新客数排序）：条款大字、系统建议 / 手动调整标签、专属码、四个数、
//      「查看依据」「调整折扣」；
//   ③ 调整折扣弹层：快捷模板 + 门槛 / 面额 / 展示文案 / 生效范围 / 有效期 / 调整原因（留痕）；
//   ④ 查看依据弹层：建议折扣、生成方式、参考维度（没有数据的维度如实写「暂无」）+ 调整记录；
//   ⑤ 码详情：二维码，顾客用 Proxy「扫一扫」领券；
//   ⑥ 核销：扫顾客的券（新客由系统判定）或输码（新客看店员勾选）。
// 原型上没有、这里也不编的：粉丝数等依据只在服务端有数据时显示，否则写明「暂无」。

const VALIDITY: Array<{ days: number; label: string }> = [
  { days: 30, label: "30 天" }, { days: 60, label: "60 天" }, { days: 90, label: "90 天" }, { days: 0, label: "长期有效" },
];

type Sheet =
  | { kind: "adjust"; view: PairPromoView }
  | { kind: "basis"; view: PairPromoView; suggestion?: PromoSuggestion | undefined; changes?: PromoChange[] | undefined; error?: string | undefined }
  | { kind: "code"; view: PairPromoView };

export function MerchantPromoSurface({ supply, merchantId, merchantName, marketId, creators, onBack, onOpenStore, onSelectCreator }: {
  supply: SupplyClient;
  merchantId: string;
  merchantName: string;
  // 本店所在市场：服务端按它自动给这个市场里在服务的 creator 发码。
  marketId: string;
  // 人才库里的 creator（只用来取头像）。
  creators: Array<{ agentId: string; name: string; photoUri?: string | undefined }>;
  onBack: () => void;
  // 「选择下单」：进这位 creator 的主页走现有的邀约下单流程。
  onSelectCreator?: ((agentId: string) => void) | undefined;
  // 门店资料里没填品类时，跳去「店铺」页填（品类只在那里维护一处）。
  onOpenStore?: (() => void) | undefined;
}): React.JSX.Element {
  const [views, setViews] = useState<PairPromoView[]>([]);
  const [totals, setTotals] = useState<PairPromoStats | undefined>(undefined);
  const [conversionBp, setConversionBp] = useState(-1);
  const [storeInfo, setStoreInfo] = useState<{ category: string; raw: string } | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [sheet, setSheet] = useState<Sheet | undefined>(undefined);
  // 调整折扣表单
  const [minSpend, setMinSpend] = useState("");
  const [faceValue, setFaceValue] = useState("");
  const [displayText, setDisplayText] = useState("");
  const [scopeAll, setScopeAll] = useState(false);
  const [validity, setValidity] = useState(30);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState<string | undefined>(undefined);
  // 核销
  const [redeemCode, setRedeemCode] = useState("");
  const [couponId, setCouponId] = useState<string | undefined>(undefined);
  const [amount, setAmount] = useState("");
  const [clerkNew, setClerkNew] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | undefined>(undefined);
  const [redeemResult, setRedeemResult] = useState<string | undefined>(undefined);
  const [scanning, setScanning] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const reload = useCallback(async (): Promise<void> => {
    setLoadError(undefined);
    try {
      const listed = await supply.listMerchantCreatorPromos({ merchantId, marketId, merchantName });
      setViews(listed.promos);
      setTotals(listed.totals);
      setConversionBp(listed.conversionBp);
      setStoreInfo({ category: listed.storeCategory, raw: listed.storeCategoryRaw });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "专属码数据没读出来");
    }
  }, [supply, merchantId, marketId, merchantName]);
  useEffect(() => { void reload(); }, [reload]);

  const photoOf = (agentId: string): string | undefined => creators.find((c) => c.agentId === agentId)?.photoUri;

  const openAdjust = (view: PairPromoView): void => {
    const t = view.promo.terms;
    setMinSpend(t.minSpendVnd > 0 ? String(t.minSpendVnd) : "");
    setFaceValue(String(t.faceValueVnd));
    setDisplayText(t.displayText);
    setScopeAll(t.scope === "STORE_ALL" || t.category === "");
    setValidity(t.validUntil === "" ? 0 : 30);
    setNote("");
    setSheetError(undefined);
    setSheet({ kind: "adjust", view });
  };

  const openBasis = (view: PairPromoView): void => {
    setSheet({ kind: "basis", view });
    supply.merchantCreatorPromoBasis({ merchantId, code: view.promo.code })
      .then((basis) => setSheet((cur) => (cur?.kind === "basis" && cur.view.promo.code === view.promo.code ? { ...cur, suggestion: basis.suggestion, changes: basis.changes } : cur)))
      .catch((e: unknown) => setSheet((cur) => (cur?.kind === "basis" ? { ...cur, error: e instanceof Error ? e.message : "依据没读出来" } : cur)));
  };

  const applyTemplate = (index: number): void => {
    const t = templateTerms(index);
    setMinSpend(t.minSpendVnd > 0 ? String(t.minSpendVnd) : "");
    setFaceValue(String(t.faceValueVnd));
    setDisplayText(formatPromoTerms(t.minSpendVnd, t.faceValueVnd));
  };

  const saveAdjust = async (view: PairPromoView, applySuggestion: boolean): Promise<void> => {
    if (saving) return;
    const face = Number(faceValue.replace(/[^\d]/g, ""));
    const min = minSpend.trim() === "" ? 0 : Number(minSpend.replace(/[^\d]/g, ""));
    if (!applySuggestion) {
      if (!Number.isInteger(face) || face <= 0) { setSheetError("优惠面额填 VND 数字"); return; }
      if (!Number.isInteger(min) || min < 0) { setSheetError("使用门槛填 VND 数字，空着就是无门槛"); return; }
      if (min > 0 && min < face) { setSheetError("门槛不能低于面额（满的要比减的多）"); return; }
    }
    setSaving(true);
    setSheetError(undefined);
    try {
      await supply.adjustMerchantCreatorPromo(applySuggestion
        ? { merchantId, code: view.promo.code, applySuggestion: true, note: note.trim() }
        : {
          merchantId, code: view.promo.code, minSpendVnd: min, faceValueVnd: face,
          displayText: displayText.trim() || formatPromoTerms(min, face),
          scope: scopeAll ? "STORE_ALL" : "STORE_CATEGORY", validityDays: validity, note: note.trim(),
        });
      setSheet(undefined);
      await reload();
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : "没保存成功，稍后重试");
    } finally {
      setSaving(false);
    }
  };

  // 扫码：顾客券（PROXY-COUPON:）→ 凭券核销；达人专属码（PROXY-PROMO:）→ 输码核销。
  const handleScanned = (data: string): void => {
    const coupon = parseCouponQr(data);
    if (coupon) {
      setCouponId(coupon);
      setRedeemCode("");
      setRedeemError(undefined);
      setScanning(false);
      return;
    }
    const code = parsePromoQr(data);
    if (code) {
      setCouponId(undefined);
      setRedeemCode(code);
      setRedeemError(undefined);
      setScanning(false);
      return;
    }
    setRedeemError("扫到的不是专属券 / 专属码，重扫一下");
  };

  const redeem = async (): Promise<void> => {
    if (redeeming) return;
    if (!couponId && redeemCode.trim() === "") { setRedeemError("扫顾客的券，或输达人专属码"); return; }
    const amt = amount.trim() === "" ? 0 : Number(amount.replace(/[^\d]/g, ""));
    if (!Number.isInteger(amt) || amt < 0) { setRedeemError("消费金额填 VND 数字"); return; }
    setRedeeming(true);
    setRedeemError(undefined);
    setRedeemResult(undefined);
    try {
      const result = await supply.quotePromoCode({
        merchantId, code: redeemCode.trim().toUpperCase(), amountVnd: amt, firstVisit: clerkNew,
        ...(couponId ? { couponId } : {}),
      });
      const isNew = result.quote.firstVisit;
      setRedeemResult(`已减 ${formatWan(result.faceValueVnd)} VND（${result.scopeName}）· ${isNew ? "新客" : "老客"}${couponId ? "（系统按顾客身份判定）" : "（店员确认）"} · 记到达人头上`);
      setRedeemCode("");
      setCouponId(undefined);
      setAmount("");
      setClerkNew(false);
      await reload();
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setRedeemError(redeemErrorText(message, views, redeemCode));
    } finally {
      setRedeeming(false);
    }
  };

  const conversion = conversionBp < 0 ? "—" : `${Math.round(conversionBp / 100)}%`;
  // 本店品类：服务端从门店资料读的（店主在「店铺」里填的那个）。
  const storeCategory = storeInfo?.category ?? "";
  return (
    <View>
      <View style={s.subHeader}>
        <Pressable onPress={onBack} accessibilityLabel="返回 Creator 经营" style={s.backBtn}><ProxyBackGlyph /></Pressable>
        <View style={{ flex: 1 }}>
          <Text selectable style={s.h1}>带到店新客</Text>
          <Text selectable style={s.sub}>{`${storeCategory ? `${storeCategory}` : "达人"}专属折扣 · 可逐个达人调整`}</Text>
        </View>
      </View>
      {loadError ? <Text selectable style={s.error}>{loadError}</Text> : null}

      <View style={s.dashGrid}>
        <Dash value={totals ? totals.newCustomers.toLocaleString() : "—"} label="本店到店新客" />
        <Dash value={totals ? totals.redeemed.toLocaleString() : "—"} label="本店累计核销" />
        <Dash value={totals ? totals.issued.toLocaleString() : "—"} label="本店累计发券" />
        <Dash value={conversion} label="核销转化率" />
      </View>

      {storeInfo && storeInfo.category === "" ? (
        <View style={s.notice}>
          <Text selectable style={s.noticeText}>本店资料里还没填品类：专属码先按「本店全部品类」发，系统建议也算不了内容垂直度和同品类平均。在「店铺」里填上品类后会自动用上。</Text>
          {onOpenStore ? <Pressable onPress={onOpenStore} style={[s.btnAction, { marginTop: 8 }]} accessibilityLabel="去店铺填品类"><Text selectable style={s.btnText}>去店铺填品类</Text></Pressable> : null}
        </View>
      ) : null}
      <View style={s.sectionTitle}>
        <Text selectable style={s.h2}>达人专属折扣</Text>
        <Text selectable style={s.sectionHint}>按新客数排序</Text>
      </View>
      {views.length === 0 && !loadError ? <Text selectable style={s.hint}>本店所在城市暂时没有在服务的达人，有达人入驻后系统会自动给 TA 发本店专属码。</Text> : null}
      {views.map((view) => (
        <PromoCard
          key={view.promo.code}
          view={view}
          photoUri={photoOf(view.promo.agentId)}
          onCode={() => setSheet({ kind: "code", view })}
          onBasis={() => openBasis(view)}
          onAdjust={() => openAdjust(view)}
          onSelect={onSelectCreator ? () => onSelectCreator(view.promo.agentId) : undefined}
        />
      ))}

      <View style={s.sectionTitle}>
        <Text selectable style={s.h2}>核销</Text>
        <Text selectable style={s.sectionHint}>扫顾客的券更准</Text>
      </View>
      <Text selectable style={s.hint}>扫顾客券包里的专属券：新客由系统按顾客身份判定。顾客没领券、只报达人的码：输码，新客问一句再勾。</Text>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <TextInput
          onChangeText={(text) => { setRedeemCode(text); setCouponId(undefined); }}
          placeholder={couponId ? "已扫到顾客的券" : "达人专属码（如 AN-WORKSHOP）"}
          placeholderTextColor={P.sub}
          style={[s.input, { flex: 1 }]}
          value={redeemCode}
          autoCapitalize="characters"
        />
        <Pressable onPress={() => setScanning((v) => !v)} style={[s.chip, scanning && s.chipOn]} accessibilityLabel="扫码核销">
          <Text selectable style={[s.chipText, scanning && s.chipTextOn]}>扫码</Text>
        </Pressable>
      </View>
      {couponId ? <Text selectable style={s.meta}>{`凭券核销 · ${couponId}`}</Text> : null}
      {scanning ? (cameraPermission?.granted ? (
        <View style={s.cameraWrap}>
          <CameraView style={s.cameraView} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(result) => handleScanned(result.data)} />
        </View>
      ) : (
        <Pressable onPress={() => void requestCameraPermission()} style={[s.btnAction, s.btnPrimary]} accessibilityLabel="允许使用相机"><Text selectable style={s.btnText}>允许使用相机</Text></Pressable>
      )) : null}
      <TextInput keyboardType="number-pad" onChangeText={setAmount} placeholder="消费金额 VND（有门槛的必须填）" placeholderTextColor={P.sub} style={s.input} value={amount} />
      {!couponId ? (
        <Pressable onPress={() => setClerkNew((v) => !v)} style={[s.chip, clerkNew && s.chipOn, { alignSelf: "flex-start" }]} accessibilityLabel="新客">
          <Text selectable style={[s.chipText, clerkNew && s.chipTextOn]}>{clerkNew ? "✓ 新客（顾客自述首次到店）" : "新客？"}</Text>
        </Pressable>
      ) : null}
      {redeemError ? <Text selectable style={s.error}>{redeemError}</Text> : null}
      {redeemResult ? <Text selectable style={s.ok}>{redeemResult}</Text> : null}
      <Pressable disabled={redeeming} onPress={() => void redeem()} style={[s.btnAction, s.btnPrimary, { marginTop: 10 }]} accessibilityLabel="核销">
        <Text selectable style={s.btnText}>{redeeming ? "核销中…" : "核销"}</Text>
      </Pressable>

      <Modal animationType="slide" transparent visible={sheet !== undefined} onRequestClose={() => setSheet(undefined)}>
        {/* 背景和弹层是兄弟节点：弹层包在可点的 Pressable 里会吃掉滑动，ScrollView 不收缩时
            长表单（调整折扣）被 maxHeight 裁掉、底部按钮够不着（CONTENT-TASK-001 实机发现）。 */}
        <View style={s.modalRoot}>
          <Pressable style={s.backdrop} onPress={() => setSheet(undefined)} accessibilityLabel="关闭" />
          <View style={s.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled" style={s.sheetScroll}>
              {sheet?.kind === "adjust" ? (
                <View>
                  <Text selectable style={s.sheetTitle}>调整折扣</Text>
                  <Text selectable style={s.sub}>{`${sheet.view.promo.creatorName} · ${sheet.view.promo.code}`}</Text>
                  <Text selectable style={s.label}>快捷模板（一键套用，也可下方手动微调）</Text>
                  <View style={s.chipRow}>
                    {PROMO_TEMPLATES.map((tpl, i) => (
                      <Pressable key={tpl} onPress={() => applyTemplate(i)} style={s.chip} accessibilityLabel={`套用${tpl}`}>
                        <Text selectable style={s.chipText}>{tpl}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text selectable style={s.hint}>修改后的折扣会立即绑定到该达人的专属码。</Text>
                  <Text selectable style={s.label}>使用门槛（VND，空 = 无门槛）</Text>
                  <TextInput keyboardType="number-pad" onChangeText={setMinSpend} placeholder="比如 500000" placeholderTextColor={P.sub} style={s.input} value={minSpend} />
                  <Text selectable style={s.label}>优惠面额（VND）</Text>
                  <TextInput keyboardType="number-pad" onChangeText={setFaceValue} placeholder="比如 100000" placeholderTextColor={P.sub} style={s.input} value={faceValue} />
                  <Text selectable style={s.label}>折扣展示文案</Text>
                  <TextInput onChangeText={setDisplayText} placeholder={formatPromoTerms(Number(minSpend) || 0, Number(faceValue) || 0)} placeholderTextColor={P.sub} style={s.input} value={displayText} />
                  <Text selectable style={s.label}>生效范围</Text>
                  <View style={s.segmented}>
                    {sheet.view.promo.terms.category ? (
                      <Pressable onPress={() => setScopeAll(false)} style={[s.segment, !scopeAll && s.segmentOn]}><Text selectable style={[s.segmentText, !scopeAll && s.segmentTextOn]}>{`仅本店 · ${sheet.view.promo.terms.category}类`}</Text></Pressable>
                    ) : null}
                    <Pressable onPress={() => setScopeAll(true)} style={[s.segment, scopeAll && s.segmentOn]}><Text selectable style={[s.segmentText, scopeAll && s.segmentTextOn]}>本店全部品类</Text></Pressable>
                  </View>
                  <Text selectable style={s.label}>有效期</Text>
                  <View style={s.chipRow}>
                    {VALIDITY.map((v) => (
                      <Pressable key={v.days} onPress={() => setValidity(v.days)} style={[s.chip, validity === v.days && s.chipOn]} accessibilityLabel={`有效期${v.label}`}>
                        <Text selectable style={[s.chipText, validity === v.days && s.chipTextOn]}>{v.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text selectable style={s.label}>调整原因（可选，记录留痕，方便团队回看）</Text>
                  <TextInput onChangeText={setNote} placeholder="比如：她粉丝偏年轻，改成无门槛" placeholderTextColor={P.sub} style={s.input} value={note} />
                  {sheetError ? <Text selectable style={s.error}>{sheetError}</Text> : null}
                  <Pressable disabled={saving} onPress={() => void saveAdjust(sheet.view, false)} style={[s.btnAction, s.btnPrimary, { marginTop: 8 }]} accessibilityLabel="保存并应用"><Text selectable style={s.btnText}>{saving ? "保存中…" : "保存并应用"}</Text></Pressable>
                  <Pressable disabled={saving} onPress={() => void saveAdjust(sheet.view, true)} style={[s.btnAction, { marginTop: 8 }]} accessibilityLabel="恢复系统建议"><Text selectable style={s.btnText}>恢复系统建议</Text></Pressable>
                  <Pressable onPress={() => setSheet(undefined)} style={[s.btnAction, { marginTop: 8 }]} accessibilityLabel="取消"><Text selectable style={s.btnText}>取消</Text></Pressable>
                </View>
              ) : null}
              {sheet?.kind === "basis" ? <BasisSheet sheet={sheet} /> : null}
              {sheet?.kind === "code" ? (
                <View style={{ alignItems: "center" }}>
                  <Text selectable style={s.sheetTitle}>{sheet.view.promo.code}</Text>
                  <Text selectable style={s.sub}>{`${sheet.view.promo.creatorName} 在 ${sheet.view.promo.merchantName || "本店"} 的专属码`}</Text>
                  <View style={s.qrBig}><ProxyQrCode value={promoQrValue(sheet.view.promo.code)} size={200} /></View>
                  <Text selectable style={s.terms}>{sheet.view.promo.terms.displayText || formatPromoTerms(sheet.view.promo.terms.minSpendVnd, sheet.view.promo.terms.faceValueVnd)}</Text>
                  <Text selectable style={s.hint}>{`顾客用 Proxy「扫一扫」扫这个码领券，到店出示券核销。${sheet.view.promo.terms.validUntil ? `有效期至 ${sheet.view.promo.terms.validUntil}` : "长期有效"}。`}</Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function redeemErrorText(message: string, views: PairPromoView[], code: string): string {
  if (/promo_below_min_spend|PROMO_BELOW_MIN_SPEND/.test(message)) {
    const min = views.find((v) => v.promo.code === code.trim().toUpperCase())?.promo.terms.minSpendVnd ?? 0;
    return min > 0 ? `这单没到门槛：满 ${formatWan(min)} VND 才能减` : "这单没到这张券的消费门槛，先填消费金额";
  }
  if (/coupon_already_redeemed|COUPON_ALREADY_REDEEMED/.test(message)) return "这张券已经核销过了（一张券只能用一次）";
  if (/promo_other_merchant|PROMO_OTHER_MERCHANT/.test(message)) return "这是别家店的专属码 / 券，本店不能核销";
  if (/promo_benefit_expired|PROMO_BENEFIT_EXPIRED/.test(message)) return "这个专属码已过期或已停用";
  if (/promo_not_found|PROMO_NOT_FOUND|coupon_not_found|COUPON_NOT_FOUND/.test(message)) return "没找到这个码 / 券，核对一下";
  if (/duplicate_quote|DUPLICATE_QUOTE/.test(message)) return "同一个码一分钟内刚核销过，确认不是重复点了";
  return message || "核销没成功，稍后重试";
}

function Dash({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <View style={s.dashItem}>
      <Text selectable style={s.dashValue}>{value}</Text>
      <Text selectable style={s.dashLabel}>{label}</Text>
    </View>
  );
}

// 照片地址在、但图加载失败（2026-10-04 模拟器实测 Thao / Yen 的卡整块空白）：退回首字母。
function Avatar({ name, photoUri }: { name: string; photoUri?: string | undefined }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  return photoUri && !broken
    ? <Image cachePolicy="memory-disk" contentFit="cover" onError={() => setBroken(true)} source={{ uri: photoUri }} style={s.avatar} transition={0} />
    : <View style={[s.avatar, s.avatarFallback]}><Text selectable style={s.avatarText}>{name.slice(0, 1).toUpperCase()}</Text></View>;
}

function PromoCard({ view, photoUri, onCode, onBasis, onAdjust, onSelect }: {
  view: PairPromoView;
  photoUri?: string | undefined;
  onCode: () => void;
  onBasis: () => void;
  onAdjust: () => void;
  onSelect?: (() => void) | undefined;
}): React.JSX.Element {
  const { promo, stats } = view;
  const t = promo.terms;
  const manual = promo.mode === "MANUAL";
  const disabled = promo.status !== "ACTIVE";
  return (
    <View style={[s.card, disabled && { opacity: 0.55 }]}>
      <View style={s.cardHeader}>
        <View style={s.creatorRow}>
          <Avatar name={promo.creatorName} photoUri={photoUri} />
          <View>
            <Text selectable style={s.creatorName}>{promo.creatorName}</Text>
            <Text selectable style={s.creatorHandle}>{disabled ? "已停用" : t.validUntil ? `至 ${t.validUntil}` : "长期有效"}</Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text selectable style={s.discountSmall}>{t.minSpendVnd > 0 ? `满${formatWan(t.minSpendVnd)}减` : "无门槛减"}</Text>
          <Text selectable style={s.discountValue}>{formatWan(t.faceValueVnd)}</Text>
          <Text selectable style={s.discountDetail}>{t.scope === "STORE_ALL" ? "VND · 本店全部品类" : `VND · 本店${t.category}`}</Text>
          <Text selectable style={[s.status, manual ? s.statusManual : s.statusAuto]}>{manual ? "✋ 手动调整" : "🤖 系统建议"}</Text>
        </View>
      </View>
      <Pressable onPress={onBasis} style={s.reasonLine} accessibilityLabel={`查看${promo.creatorName}的折扣依据`}>
        <View style={s.dot} />
        <Text selectable style={s.reasonText}>{promoReasonLine(view)}</Text>
        <Text style={s.reasonLink}>依据 ›</Text>
      </Pressable>
      <Pressable onPress={onCode} style={s.qrBox} accessibilityLabel={`查看${promo.code}码详情`}>
        <View style={s.qrSmall}><ProxyQrCode value={promoQrValue(promo.code)} size={40} logo={false} /></View>
        <View style={{ flex: 1 }}>
          <Text selectable style={s.qrCode}>{promo.code}</Text>
          <Text selectable style={s.qrSub}>点击查看码详情</Text>
        </View>
        <Text style={s.qrArrow}>›</Text>
      </Pressable>
      <View style={s.codeStats}>
        <Stat value={stats.newCustomers.toLocaleString()} label="新客" tone="new" />
        <Stat value={stats.redeemed.toLocaleString()} label="核销" />
        <Stat value={stats.issued.toLocaleString()} label="发券" />
        <Stat value={formatWan(stats.spendVnd)} label="消费" tone="money" />
      </View>
      <View style={s.cardActions}>
        {onSelect ? <Pressable onPress={onSelect} style={[s.btnAction, s.btnPrimary]} accessibilityLabel={`选择${promo.creatorName}下单`}><Text selectable style={s.btnText}>选择下单</Text></Pressable> : null}
        <Pressable onPress={onAdjust} style={s.btnAction} accessibilityLabel={`调整${promo.creatorName}的折扣`}><Text selectable style={s.btnText}>调整折扣</Text></Pressable>
      </View>
    </View>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: "new" | "money" }): React.JSX.Element {
  return (
    <View style={s.statItem}>
      <Text selectable style={[s.statValue, tone === "new" && { color: P.ok }, tone === "money" && { color: P.danger }]}>{value}</Text>
      <Text selectable style={s.statLabel}>{label}</Text>
    </View>
  );
}

function BasisSheet({ sheet }: { sheet: Extract<Sheet, { kind: "basis" }> }): React.JSX.Element {
  const promo = sheet.view.promo;
  const suggestion = sheet.suggestion;
  return (
    <View>
      <Text selectable style={s.sheetTitle}>折扣依据</Text>
      <Text selectable style={s.sub}>{`${promo.creatorName} · ${promo.terms.displayText || formatPromoTerms(promo.terms.minSpendVnd, promo.terms.faceValueVnd)}`}</Text>
      {sheet.error ? <Text selectable style={s.error}>{sheet.error}</Text> : null}
      {!suggestion && !sheet.error ? <Text selectable style={s.hint}>按当前数据重算中…</Text> : null}
      {suggestion ? (
        <>
          <BasisRow label="建议折扣" value={`${(suggestion.percentBp / 100).toFixed(suggestion.percentBp % 100 === 0 ? 0 : 1)}%`} />
          <BasisRow label="生成方式" value={promo.mode === "MANUAL" ? "✋ 商家手动调整" : "🤖 系统建议"} />
          <BasisRow label="生效范围" value={promo.terms.scope === "STORE_ALL" ? "本店全部品类" : `仅本店 · ${promo.terms.category}类`} />
          <Text selectable style={[s.label, { marginTop: 14 }]}>参考维度</Text>
          {suggestion.basis.map((b) => (
            <BasisRow key={b.key} label={b.label} value={b.value} muted={!b.available} effect={b.available && b.effectBp !== 0 ? `${b.effectBp > 0 ? "+" : ""}${(b.effectBp / 100).toFixed(1)}%` : undefined} />
          ))}
          <BasisRow label="系统建议" value={`${(suggestion.percentBp / 100).toFixed(1)}% · ${formatPromoTerms(suggestion.minSpendVnd, suggestion.faceValueVnd)}`} strong />
        </>
      ) : null}
      {sheet.changes && sheet.changes.length > 0 ? (
        <>
          <Text selectable style={[s.label, { marginTop: 14 }]}>调整记录</Text>
          {sheet.changes.slice().reverse().map((c) => (
            <Text key={c.id} selectable style={s.meta}>{`${c.changedAt.slice(0, 10)} · ${formatPromoTerms(c.before.minSpendVnd, c.before.faceValueVnd)} → ${formatPromoTerms(c.after.minSpendVnd, c.after.faceValueVnd)}${c.note ? ` · ${c.note}` : ""}`}</Text>
          ))}
        </>
      ) : null}
    </View>
  );
}

function BasisRow({ label, value, muted, effect, strong }: { label: string; value: string; muted?: boolean; effect?: string | undefined; strong?: boolean }): React.JSX.Element {
  return (
    <View style={s.basisRow}>
      <Text selectable style={s.basisLabel}>{label}</Text>
      <Text selectable style={[s.basisValue, muted && { color: P.sub }, strong && { fontWeight: "900" }]}>{value}{effect ? `  ${effect}` : ""}</Text>
    </View>
  );
}

// 原型配色（docs/design/references/Proxy_Creator_Promo_20261004_bc214e.html :root）。
const P = { bg: "#F4F5F7", text: "#111111", sub: "#86868B", accent: "#D0F55C", ok: "#34C759", danger: "#FF3B30", border: "#EAEAEA", soft: "#F9F9FB" };

const s = StyleSheet.create({
  subHeader: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 16 },
  backBtn: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: P.border, borderRadius: 20, borderWidth: 1, height: 40, justifyContent: "center", width: 40 },
  h1: { color: P.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },
  h2: { color: P.text, fontSize: 16, fontWeight: "800" },
  sub: { color: P.sub, fontSize: 11, marginTop: 2 },
  hint: { color: P.sub, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  meta: { color: P.sub, fontSize: 11, marginTop: 4 },
  label: { color: "#333333", fontSize: 12, fontWeight: "700", marginBottom: 8, marginTop: 10 },
  error: { color: P.danger, fontSize: 12, marginVertical: 6 },
  ok: { color: "#1E8E3E", fontSize: 12, fontWeight: "700", marginVertical: 6 },
  dashGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 8 },
  dashItem: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: P.border, borderRadius: 20, borderWidth: 1, flexBasis: "47%", flexGrow: 1, padding: 16 },
  dashValue: { color: P.text, fontSize: 22, fontWeight: "800", marginBottom: 4 },
  dashLabel: { color: P.sub, fontSize: 12, fontWeight: "500" },
  sectionTitle: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginBottom: 12, marginTop: 18 },
  sectionHint: { color: P.sub, fontSize: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  chip: { backgroundColor: "#FFFFFF", borderColor: P.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: "#1A1A1E", borderColor: "#1A1A1E" },
  chipText: { color: P.text, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: "#FFFFFF" },
  card: { backgroundColor: "#FFFFFF", borderColor: P.border, borderRadius: 20, borderWidth: 1, marginBottom: 12, padding: 16 },
  cardHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  creatorRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  avatar: { borderRadius: 20, height: 40, width: 40 },
  avatarFallback: { alignItems: "center", backgroundColor: P.accent, justifyContent: "center" },
  avatarText: { color: P.text, fontSize: 16, fontWeight: "800" },
  creatorName: { color: P.text, fontSize: 15, fontWeight: "800" },
  creatorHandle: { color: P.sub, fontSize: 11 },
  discountSmall: { color: P.sub, fontSize: 11, fontWeight: "700", marginBottom: 2 },
  discountValue: { color: P.danger, fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  discountDetail: { color: P.sub, fontSize: 11, marginTop: 4 },
  status: { borderRadius: 4, fontSize: 11, fontWeight: "700", marginTop: 4, overflow: "hidden", paddingHorizontal: 6, paddingVertical: 2 },
  statusAuto: { backgroundColor: "rgba(100,210,255,0.15)", color: "#0071E3" },
  statusManual: { backgroundColor: "rgba(255,149,0,0.15)", color: "#B36B00" },
  reasonLine: { alignItems: "center", backgroundColor: P.soft, borderRadius: 10, flexDirection: "row", gap: 6, marginBottom: 12, paddingHorizontal: 10, paddingVertical: 8 },
  dot: { backgroundColor: P.ok, borderRadius: 2, height: 4, width: 4 },
  reasonText: { color: P.sub, flex: 1, fontSize: 11, lineHeight: 15 },
  reasonLink: { color: "#0071E3", fontSize: 11, fontWeight: "700" },
  qrBox: { alignItems: "center", backgroundColor: P.soft, borderRadius: 12, flexDirection: "row", gap: 12, marginBottom: 12, padding: 10 },
  qrSmall: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#EEEEEE", borderRadius: 8, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  qrCode: { color: P.text, fontSize: 13, fontWeight: "800", letterSpacing: 0.5 },
  qrSub: { color: P.sub, fontSize: 11, marginTop: 3 },
  qrArrow: { color: "#CCCCCC", fontSize: 16 },
  codeStats: { borderTopColor: "#F0F0F0", borderTopWidth: 1, flexDirection: "row", paddingTop: 12 },
  statItem: { alignItems: "center", flex: 1 },
  statValue: { color: P.text, fontSize: 15, fontWeight: "800" },
  statLabel: { color: P.sub, fontSize: 11, marginTop: 3 },
  cardActions: { borderTopColor: "#F0F0F0", borderTopWidth: 1, flexDirection: "row", gap: 8, marginTop: 12, paddingTop: 12 },
  btnAction: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: P.border, borderRadius: 10, borderWidth: 1, flex: 1, padding: 10 },
  btnPrimary: { backgroundColor: P.accent, borderColor: P.accent },
  btnText: { color: P.text, fontSize: 12, fontWeight: "700" },
  notice: { backgroundColor: "#FFF8E6", borderColor: "#FFE1A6", borderRadius: 14, borderWidth: 1, marginTop: 4, padding: 12 },
  noticeText: { color: "#7A5A00", fontSize: 12, lineHeight: 17 },
  pendingRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: P.border, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 12 },
  input: { backgroundColor: P.soft, borderColor: P.border, borderRadius: 12, borderWidth: 1, color: P.text, fontSize: 14, height: 44, marginBottom: 8, paddingHorizontal: 14 },
  segmented: { backgroundColor: "#F0F0F5", borderRadius: 12, flexDirection: "row", padding: 3 },
  segment: { alignItems: "center", borderRadius: 10, flex: 1, paddingVertical: 9 },
  segmentOn: { backgroundColor: "#FFFFFF" },
  segmentText: { color: P.sub, fontSize: 12, fontWeight: "700" },
  segmentTextOn: { color: P.text },
  modalRoot: { backgroundColor: "rgba(0,0,0,0.35)", flex: 1, justifyContent: "flex-end" },
  backdrop: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  sheetScroll: { flexShrink: 1 },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%", padding: 20, paddingBottom: 34 },
  sheetTitle: { color: P.text, fontSize: 16, fontWeight: "800" },
  qrBig: { backgroundColor: "#FFFFFF", borderColor: P.border, borderRadius: 16, borderWidth: 1, marginVertical: 16, padding: 14 },
  terms: { color: P.danger, fontSize: 20, fontWeight: "900", marginBottom: 8 },
  basisRow: { borderBottomColor: "#F2F2F2", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 9 },
  basisLabel: { color: P.sub, fontSize: 12 },
  basisValue: { color: P.text, flexShrink: 1, fontSize: 12, fontWeight: "700", marginLeft: 12, textAlign: "right" },
  cameraWrap: { borderRadius: 14, height: 220, marginBottom: 8, overflow: "hidden" },
  cameraView: { flex: 1 },
});
