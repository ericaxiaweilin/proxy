import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { color, shadows } from "../theme";
import type { ActiveContext } from "../uiplan/types";
import type { Voucher, VoucherFamily, VoucherRedemption, VoucherSettlementState } from "../voucher-client";
import { VoucherClient } from "../voucher-client";
import { defaultVoucherValidity } from "../voucher-validity";
// VOUCHER-PRESET-001（2026-10-01，用户「商家的发卷 现在要输入一堆 改为预设好 默认
// 标准值。商家点击创建就可以」）：标准券的取值收在预设表里，商家点一下就填好，
// 不必先想清楚这张券在哪能用才能按创建。
import { DEFAULT_PRESET_ID, VOUCHER_PRESETS, defaultPresetForFamily, voucherPresetById } from "../voucher-presets";
import { PaginatedModuleShell, tabsToPagerPages } from "../architecture/paginated-module";
import { ProxyBackGlyph, ProxyEmptyState, ProxyLoading } from "../components/proxy-foundation";

type Screen = "LIST" | "DETAIL" | "REDEEM" | "SETTLEMENT" | "SUCCESS" | "CREATE";
type VoucherTab = "AVAILABLE" | "USED" | "EXPIRED";

const FAMILY: Record<VoucherFamily, { label: string; tag: string; foreground: string; soft: string; pale: string; action: string }> = {
  COFFEE: { label: "咖啡券", tag: "COFFEE VOUCHER", foreground: "#6D4934", soft: "#F4EDE7", pale: "#FBF8F4", action: "使用礼券" },
  EXPERIENCE: { label: "体验券", tag: "EXPERIENCE VOUCHER", foreground: "#2F7D62", soft: "#EAF4EF", pale: "#F7FBF8", action: "选择时间 / 预约" },
  ACTIVITY: { label: "活动券", tag: "ACTIVITY VOUCHER", foreground: "#A46A42", soft: "#F6EDE6", pale: "#FBF7F3", action: "报名 / 预约" }
};

function money(value: number): string { return new Intl.NumberFormat("en-US").format(value); }
function dateText(date: string): string { return date.slice(5).replace("-", "/"); }
function stateLabel(status: Voucher["status"]): string { return status === "AVAILABLE" ? "可用" : status === "EXPIRED" ? "已过期" : status === "REDEEMED" ? "已核销" : "已结算"; }

// These marks are deliberately local, simple vector-like RN views. They are
// the Voucher Core family system, not an app/logo replacement or emoji.
function VoucherFamilyMark({ family, size = 34 }: { family: VoucherFamily; size?: number }): React.JSX.Element {
  const tint = FAMILY[family].foreground;
  if (family === "COFFEE") {
    return <View style={{ height: size, width: size }}><View style={[styles.coffeeCup, { borderColor: tint, borderRadius: size * .12, borderWidth: Math.max(2, size * .075), height: size * .46, left: size * .16, top: size * .43, width: size * .53 }]} /><View style={[styles.coffeeHandle, { borderColor: tint, borderRadius: size * .18, borderWidth: Math.max(2, size * .075), height: size * .24, left: size * .62, top: size * .49, width: size * .24 }]} />{[.24, .46, .68].map((x) => <View key={x} style={[styles.steam, { backgroundColor: tint, height: size * .25, left: size * x, top: size * .08, width: Math.max(2, size * .06) }]} />)}</View>;
  }
  if (family === "EXPERIENCE") {
    return <View style={{ height: size, width: size }}><View style={[styles.sun, { backgroundColor: tint, height: size * .22, right: size * .12, top: size * .08, width: size * .22 }]} /><View style={[styles.mountainOne, { borderBottomColor: tint, borderLeftWidth: size * .18, borderRightWidth: size * .18, borderBottomWidth: size * .38, bottom: size * .1, left: size * .02 }]} /><View style={[styles.mountainTwo, { borderBottomColor: tint, borderLeftWidth: size * .2, borderRightWidth: size * .2, borderBottomWidth: size * .48, bottom: size * .1, left: size * .28 }]} /></View>;
  }
  return <View style={{ height: size, width: size }}><View style={[styles.personHead, { backgroundColor: tint, height: size * .25, left: size * .17, top: size * .13, width: size * .25 }]} /><View style={[styles.personHead, { backgroundColor: tint, height: size * .25, right: size * .17, top: size * .13, width: size * .25 }]} /><View style={[styles.personBody, { borderColor: tint, borderRadius: size * .28, borderWidth: Math.max(2, size * .07), bottom: size * .11, height: size * .37, left: size * .05, width: size * .46 }]} /><View style={[styles.personBody, { borderColor: tint, borderRadius: size * .28, borderWidth: Math.max(2, size * .07), bottom: size * .11, height: size * .37, right: size * .05, width: size * .46 }]} /></View>;
}

function Back({ onPress, label = "礼品券" }: { onPress: () => void; label?: string }): React.JSX.Element {
  return <Pressable onPress={onPress} style={styles.back}><ProxyBackGlyph /><Text selectable style={styles.backText}>{label}</Text></Pressable>;
}

function VoucherCard({ voucher, onPress }: { voucher: Voucher; onPress: () => void }): React.JSX.Element {
  const family = FAMILY[voucher.family];
  return <Pressable onPress={onPress} style={[styles.voucherCard, { backgroundColor: family.pale }]}>
    <View style={styles.cardTop}><Text selectable style={styles.cardFamily}>{family.tag}</Text><View style={styles.familyTag}><Text selectable style={styles.familyTagText}>{voucher.family}</Text></View></View>
    <View style={[styles.markBox, { backgroundColor: "rgba(255,255,255,.62)" }]}><VoucherFamilyMark family={voucher.family} size={39} /></View>
    <Text selectable style={styles.cardAmount}>{money(voucher.displayValue)} <Text selectable style={styles.amountCurrency}>VND</Text></Text>
    <View style={styles.cardFoot}><View style={styles.cardScope}><Text selectable style={styles.scopeTitle}>{voucher.scopeName}</Text><Text selectable style={styles.scopeDetail}>{voucher.scopeDetail}</Text></View><View><Text selectable style={styles.expiryDate}>{dateText(voucher.validUntil)}</Text><Text selectable style={styles.expiryLabel}>有效期至</Text></View></View>
  </Pressable>;
}

// 动态核销码展示：之前是一个确定性装饰图形、扫它无意义，还会被当成
// 真 QR 扫。现在直接放大展示服务端下发的 dynamicCode，商家按码核销。

function VoucherListPage({ vouchers, busy, error, tab, onOpen }: { vouchers: Voucher[]; busy: boolean; error?: string | undefined; tab: VoucherTab; onOpen: (voucher: Voucher) => void }): React.JSX.Element {
  const visible = vouchers.filter((voucher) => (tab === "AVAILABLE" ? voucher.status === "AVAILABLE" : tab === "USED" ? voucher.status === "REDEEMED" || voucher.status === "SETTLED" : voucher.status === "EXPIRED"));
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {busy ? <ProxyLoading tone="brand" style={styles.spinner} /> : null}
      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      <View style={styles.cards}>
        {visible.map((voucher) => (
          <VoucherCard key={voucher.voucherId} voucher={voucher} onPress={() => onOpen(voucher)} />
        ))}
        {!busy && visible.length === 0 ? (
          <ProxyEmptyState title={tab === "AVAILABLE" ? "暂无可用礼品券" : "这里还没有记录"} sub="礼品券的邀请来源与 CRM 归因留在消息和后台，不挤进券面。" />
        ) : null}
      </View>
    </ScrollView>
  );
}

export function VoucherSurface({ client, context, onBack }: { client: VoucherClient; context: ActiveContext; onBack: () => void }): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("LIST");
  const [tab, setTab] = useState<VoucherTab>("AVAILABLE");
  const [pagerPage, setPagerPage] = useState<number | undefined>(undefined);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [selected, setSelected] = useState<Voucher>();
  const [redemption, setRedemption] = useState<VoucherRedemption>();
  const [settlement, setSettlement] = useState<VoucherSettlementState[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  // VOUCHER-PRESET-001：全部从预设起步，商家不碰任何输入框也能直接创建。
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [family, setFamily] = useState<VoucherFamily>(voucherPresetById(DEFAULT_PRESET_ID)?.family ?? "COFFEE");
  const [value, setValue] = useState(String(voucherPresetById(DEFAULT_PRESET_ID)?.displayValue ?? 50_000));
  const [quantity, setQuantity] = useState(String(voucherPresetById(DEFAULT_PRESET_ID)?.quantity ?? 20));
  const [scope, setScope] = useState(voucherPresetById(DEFAULT_PRESET_ID)?.scopeName ?? "本店");
  // 默认有效期今天起 30 天（动态）。之前写死 2026-08-21 → 2026-08-31，
  // 过期后发的券上架即 EXPIRED（服务端按 validUntil < today 置过期）。
  const [validity] = useState(() => defaultVoucherValidity());

  async function reload(): Promise<void> { setBusy(true); setError(undefined); try { setVouchers(await client.list()); } catch { setError("礼品券暂时无法加载，请稍后重试。"); } finally { setBusy(false); } }
  useEffect(() => { void reload(); }, []);
  useEffect(() => { const handle = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(handle); }, []);
  const visible = vouchers.filter((voucher) => tab === "AVAILABLE" ? voucher.status === "AVAILABLE" : tab === "USED" ? voucher.status === "REDEEMED" || voucher.status === "SETTLED" : voucher.status === "EXPIRED");
  const availableCount = vouchers.filter((voucher) => voucher.status === "AVAILABLE").length;

  async function openVoucher(voucher: Voucher): Promise<void> { setSelected(voucher); setScreen("DETAIL"); setError(undefined); try { setSelected(await client.get(voucher.voucherId)); } catch { setError("无法读取礼品券详情。"); } }
  async function startRedeem(): Promise<void> { if (!selected) return; setBusy(true); setError(undefined); try { const result = await client.openRedemption(selected.voucherId); setSelected(result.voucher); setRedemption(result.redemption); setScreen("REDEEM"); } catch { setError("动态核销凭证暂时无法生成，请稍后重试。"); } finally { setBusy(false); } }
  async function confirmRedeem(): Promise<void> { if (!redemption) return; setBusy(true); setError(undefined); try { const result = await client.confirmRedemption(redemption.redemptionId); setSelected(result.voucher); const status = await client.settlement(result.voucher.voucherId); setSettlement(status.states); setScreen("SETTLEMENT"); await reload(); } catch { setError("核销未完成。请确认商家已在有效时间内确认。 "); } finally { setBusy(false); } }
  async function settle(): Promise<void> { if (!selected) return; setBusy(true); setError(undefined); try { const result = await client.settle(selected.voucherId); setSelected(result.voucher); setScreen("SUCCESS"); await reload(); } catch { setError("结算状态暂时无法更新。"); } finally { setBusy(false); } }
  // VOUCHER-PRESET-001：选预设 = 把一整套标准值填进去（类型 / 面值 / 数量 /
  // 适用范围 / 核销时段 / 最低消费 / 每人限领）。商家随后仍可逐项改。
  function applyPreset(id: string): void {
    const preset = voucherPresetById(id);
    if (!preset) return;
    setPresetId(id);
    setFamily(preset.family);
    setValue(String(preset.displayValue));
    setQuantity(String(preset.quantity));
    setScope(preset.scopeName);
    setError(undefined);
  }
  /** 换类型时落到该类型的标准预设，避免"点了咖啡却留着活动券的数值"。 */
  function applyFamily(next: VoucherFamily): void {
    setFamily(next);
    applyPreset(defaultPresetForFamily(next).id);
  }

  async function issue(): Promise<void> {
    const preset = voucherPresetById(presetId) ?? defaultPresetForFamily(family);
    const displayValue = Number(value.replace(/[^0-9]/g, "")) || preset.displayValue;
    const issuedQuantity = Number(quantity.replace(/[^0-9]/g, "")) || preset.quantity;
    /* VOUCHER-PRESET-001：适用范围不再是必填。留空就回落到预设的「本店」——
       商家发自己店里的券，本来就不该被逼着先编一个地名。
       原来这里硬要求 scope.trim()，而 scope 初始是空串，于是「创建」一按就报
       「请填写权益价值、数量和适用范围」—— 一张标准咖啡券是商家最常发的东西。 */
    const scopeText = scope.trim() || preset.scopeName;
    if (!displayValue || !issuedQuantity) {
      setError("请填写权益价值和数量。");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const split = scopeText.split("·").map((part) => part.trim());
      const created = await client.create({
        family,
        displayValue,
        quantity: issuedQuantity,
        validFrom: validity.validFrom,
        validUntil: validity.validUntil,
        scopeName: split[0] || preset.scopeName,
        /* scopeDetail 不再兜底成某个城市名：券面会印上这个地名，而商家从没要求过。
           空就是空；商家自己填「店名 · 城市」时它自然会出现。 */
        scopeDetail: split.slice(1).join(" · "),
        redeemTimeWindow: preset.redeemTimeWindow,
        minimumSpend: preset.minimumSpend,
        perPersonLimit: preset.perPersonLimit
      });
      setSelected(created.voucher);
      setTab("AVAILABLE");
      setScreen("DETAIL");
      await reload();
    } catch {
      setError("礼品券未创建。请检查发行额度或网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  if (screen === "DETAIL" && selected) { const definition = FAMILY[selected.family]; return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><Back onPress={() => { setError(undefined); setScreen("LIST"); }} /><Text selectable style={styles.pageTitle}>礼券详情</Text><Text selectable style={styles.pageSub}>权益凭证，不是营销海报。</Text><View style={styles.detailCard}><View style={[styles.detailHero, { backgroundColor: definition.soft }]}><View style={styles.cardTop}><Text selectable style={styles.cardFamily}>{definition.tag}</Text><View style={styles.familyTag}><Text selectable style={styles.familyTagText}>{selected.family}</Text></View></View><View style={styles.bigMark}><VoucherFamilyMark family={selected.family} size={52} /></View><Text selectable style={styles.detailAmount}>{money(selected.displayValue)} <Text selectable style={styles.amountCurrency}>VND</Text></Text></View><View style={styles.detailBody}><View style={styles.keyGrid}>{[["适用范围", `${selected.scopeName} · ${selected.scopeDetail}`], ["有效期至", selected.validUntil.replaceAll("-", "/")], ["使用时段", selected.redeemTimeWindow], ["最低消费", selected.minimumSpend], ["每人限用", `${selected.perPersonLimit} 张`], ["礼券编号", selected.voucherId]].map(([key, val]) => <View key={key} style={styles.keyValue}><Text selectable style={styles.keyLabel}>{key}</Text><Text selectable style={styles.keyText}>{val}</Text></View>)}</View><Text selectable style={styles.rules}>不可提现 · 不兑换现金 · 不找零 · 不可购买其他礼券 · 默认不可转售或自由转让 · 过期按发行规则处理</Text><Text selectable style={styles.issuer}>发行方：{selected.issuerLabel ?? "Proxy"}</Text>{selected.status === "AVAILABLE" ? <Pressable onPress={() => void startRedeem()} style={styles.primary}><Text selectable style={styles.primaryText}>{definition.action}</Text></Pressable> : <Pressable onPress={() => { void client.settlement(selected.voucherId).then((x) => { setSettlement(x.states); setScreen("SETTLEMENT"); }).catch(() => setError("无法读取结算状态。")); }} style={styles.primary}><Text selectable style={styles.primaryText}>查看核销与结算</Text></Pressable>}</View></View>{error ? <Text selectable style={styles.error}>{error}</Text> : null}</ScrollView></View>; }

  if (screen === "REDEEM" && selected && redemption) { const seconds = Math.max(0, Math.ceil((Date.parse(redemption.expiresAt) - now) / 1000)); return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><Back label="礼券详情" onPress={() => setScreen("DETAIL")} /><Text selectable style={styles.pageTitle}>使用礼券</Text><Text selectable style={styles.pageSub}>动态核销凭证。出示核销码不等于结算。</Text><View style={styles.redeem}><View style={styles.codeBox}><Text selectable style={styles.codeBig}>{redemption.dynamicCode}</Text><Text selectable style={styles.codeHint}>出示此码给商家核销</Text></View><Text selectable style={styles.timer}>{seconds > 0 ? `动态码 · ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")} 后刷新` : "动态码已失效"}</Text><View style={styles.ticketLine}><View><Text selectable style={styles.ticketTitle}>{FAMILY[selected.family].tag} · {money(selected.displayValue)} VND</Text><Text selectable style={styles.ticketSub}>{selected.scopeName} · 有效期 {dateText(selected.validUntil)}</Text></View><View style={styles.activeTag}><Text selectable style={styles.activeTagText}>{seconds > 0 ? "ACTIVE" : "EXPIRED"}</Text></View></View><Pressable disabled={seconds === 0 || busy} onPress={() => void confirmRedeem()} style={[styles.primary, (seconds === 0 || busy) && styles.primaryDisabled]}><Text selectable style={styles.primaryText}>{busy ? "处理中…" : "模拟商家确认核销"}</Text></Pressable><Text selectable style={styles.p0Note}>仅限本地 P0 测试：不会创建支付、余额或真实商家账本。</Text><Pressable onPress={() => setScreen("DETAIL")} style={styles.subtle}><Text selectable style={styles.subtleText}>取消</Text></Pressable></View>{error ? <Text selectable style={styles.error}>{error}</Text> : null}</ScrollView></View>; }

  if (screen === "SETTLEMENT" && selected) { // 服务端没有返回状态时不许预填：以前会给一张没核销过的券显示「已核销 · 完成」。
    const states = settlement; return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><Back label="礼券详情" onPress={() => setScreen("DETAIL")} /><Text selectable style={styles.pageTitle}>核销与结算</Text><Text selectable style={styles.pageSub}>核销、风控和结算是三个不同事实。</Text>{states.length ? <View style={styles.stateList}>{states.map((item) => <View key={item.name} style={styles.stateRow}><View><Text selectable style={styles.stateName}>{item.name}</Text><Text selectable style={styles.stateDesc}>{item.name === "REDEEMED" ? "商家已确认真实消费" : item.name === "RISK_CHECK" ? "平台正在核验规则与证据" : "通过 Gate 后才进入商家账本"}</Text></View><View style={[styles.stateBadge, item.status === "COMPLETED" || item.status === "PASSED" || item.status === "SETTLED" ? styles.stateGood : styles.stateWait]}><Text selectable style={styles.stateBadgeText}>{item.status === "COMPLETED" ? "完成" : item.status === "CHECKING" ? "检查中" : item.status === "PENDING" ? "待结算" : item.status}</Text></View></View>)}</View> : <View style={styles.empty}><Text selectable style={styles.emptyTitle}>还没有核销与结算记录</Text><Text selectable style={styles.emptyText}>服务端没有返回这一张礼券的核销 / 风控 / 结算状态。这里只显示真实记录，不预填。</Text></View>}<View style={styles.policy}><Text selectable style={styles.policyTitle}>结算 Gate</Text><Text selectable style={styles.policyText}>异常模式会使结算暂缓，但不会在消费者页面暴露内部风控分数或原因。</Text></View>{selected.status === "REDEEMED" ? <Pressable disabled={busy} onPress={() => void settle()} style={[styles.primary, busy && styles.primaryDisabled]}><Text selectable style={styles.primaryText}>{busy ? "处理中…" : "模拟风控通过并结算"}</Text></Pressable> : selected.status === "SETTLED" ? <Pressable onPress={() => setScreen("SUCCESS")} style={styles.primary}><Text selectable style={styles.primaryText}>查看核销结果</Text></Pressable> : <ProxyEmptyState title="这张礼券没有核销结果" sub={`券当前状态：${stateLabel(selected.status)}。只有真实核销并结算过的礼券才有结果可看。`} />}{error ? <Text selectable style={styles.error}>{error}</Text> : null}</ScrollView></View>; }

  if (screen === "SUCCESS" && selected) return <View style={styles.root}><ScrollView contentContainerStyle={styles.success}><View style={styles.check}><Text selectable style={styles.checkText}>✓</Text></View><Text selectable style={styles.successTitle}>核销成功</Text><Text selectable style={styles.successText}>礼券已经完成核销并通过结算 Gate。资金拆分留在账本，不会变成可提现余额。</Text><View style={styles.receipt}><Text selectable style={styles.receiptTitle}>{FAMILY[selected.family].tag} · {money(selected.displayValue)} VND</Text><Text selectable style={styles.receiptText}>{selected.scopeName}</Text><Text selectable style={styles.receiptText}>结算状态 · SETTLED</Text></View><Pressable onPress={() => { setScreen("LIST"); setTab("USED"); }} style={styles.primary}><Text selectable style={styles.primaryText}>完成</Text></Pressable></ScrollView></View>;

  if (screen === "CREATE") return <View style={styles.root}><ScrollView contentContainerStyle={styles.content}><Back onPress={() => setScreen("LIST")} /><Text selectable style={styles.pageTitle}>创建礼券</Text><Text selectable style={styles.pageSub}>商家 / Creator / Agent 使用同一发行模型；权限与额度由服务端控制。</Text><Text selectable style={styles.fieldLabel}>类型</Text><View style={styles.chips}>{(Object.keys(FAMILY) as VoucherFamily[]).map((item) => <Pressable key={item} onPress={() => applyFamily(item)} style={[styles.chip, family === item && styles.chipActive]}><Text selectable style={[styles.chipText, family === item && styles.chipTextActive]}>{FAMILY[item].label}</Text></Pressable>)}</View><Text selectable style={styles.fieldLabel}>标准预设 <Text selectable style={styles.fieldHint}>点一下填好，可再改</Text></Text><View style={styles.chips}>{VOUCHER_PRESETS.map((preset) => <Pressable key={preset.id} onPress={() => applyPreset(preset.id)} style={[styles.chip, presetId === preset.id && styles.chipActive]}><Text selectable style={[styles.chipText, presetId === preset.id && styles.chipTextActive]}>{preset.label}</Text></Pressable>)}</View><Text selectable style={styles.presetHint}>{voucherPresetById(presetId)?.hint}</Text><Text selectable style={styles.fieldLabel}>权益价值 <Text selectable style={styles.fieldHint}>VND</Text></Text><TextInput keyboardType="number-pad" onChangeText={setValue} value={value} style={styles.input} /><Text selectable style={styles.fieldLabel}>数量 <Text selectable style={styles.fieldHint}>受发行额度限制</Text></Text><TextInput keyboardType="number-pad" onChangeText={setQuantity} value={quantity} style={styles.input} /><Text selectable style={styles.fieldLabel}>适用范围 <Text selectable style={styles.fieldHint}>留空 = 本店</Text></Text><TextInput onChangeText={setScope} value={scope} placeholder="本店（可填「店名 · 城市」）" placeholderTextColor={color.muted} style={styles.input} /><View style={styles.dateRow}><View style={styles.dateBox}><Text selectable style={styles.dateValue}>{validity.fromLabel}</Text><Text selectable style={styles.dateLabel}>开始</Text></View><View style={styles.dateBox}><Text selectable style={styles.dateValue}>{validity.untilLabel}</Text><Text selectable style={styles.dateLabel}>结束</Text></View></View><View style={styles.policy}><Text selectable style={styles.policyTitle}>按标准预设的核销规则</Text><Text selectable style={styles.policyText}>核销时段 {voucherPresetById(presetId)?.redeemTimeWindow} · 最低消费 {voucherPresetById(presetId)?.minimumSpend} · 每人限领 {voucherPresetById(presetId)?.perPersonLimit} 张 · 有效期 {validity.fromLabel} – {validity.untilLabel}</Text></View><View style={styles.policy}><Text selectable style={styles.policyTitle}>Proxy 固定规则</Text><Text selectable style={styles.policyText}>不可提现 / 不兑换现金 / 不找零；不可购买其他礼券；默认不可转售或自由转让；核销必须有真实场景证据。</Text></View><View style={styles.budget}><Text selectable style={styles.budgetLabel}>预计发行预算</Text><Text selectable style={styles.budgetValue}>{money((Number(value.replace(/[^0-9]/g, "")) || 0) * (Number(quantity.replace(/[^0-9]/g, "")) || 0))} VND</Text></View><Pressable disabled={busy} onPress={() => void issue()} style={[styles.primary, busy && styles.primaryDisabled]}><Text selectable style={styles.primaryText}>{busy ? "创建中…" : `创建 ${quantity || "0"} 张${FAMILY[family].label}`}</Text></Pressable>{error ? <Text selectable style={styles.error}>{error}</Text> : null}</ScrollView></View>;

  // 纯审核视觉（tabs）+ 架构层滑动：视觉 100% R3 已审，交互由 PaginatedModuleShell 统一注入
  // 后续 动态/市场 等所有分页模块同理在此加 pages 即可，无需各自 import Pager
  const pagerPages = tabsToPagerPages<VoucherTab>({
    tabs: ["AVAILABLE", "USED", "EXPIRED"] as const,
    activeTab: tab,
    titleOf: (t) => (t === "AVAILABLE" ? `可用 ${availableCount}` : t === "USED" ? "已使用" : "已过期"),
    renderPage: (t) => <VoucherListPage vouchers={vouchers} busy={busy} error={error} tab={t} onOpen={(v) => void openVoucher(v)} />,
  });
  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <View style={styles.listHead}>
          <View>
            <Back label="我的" onPress={onBack} />
            <Text selectable style={styles.pageTitle}>我的礼品券</Text>
            <Text selectable style={styles.pageSub}>统一权益卡面；礼品券不属于钱包余额。</Text>
          </View>
          {context === "BUSINESS" ? (
            <Pressable onPress={() => { setError(undefined); setScreen("CREATE"); }} style={styles.createButton}>
              <Text selectable style={styles.createButtonText}>创建礼券</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.tabs}>
          {(["AVAILABLE", "USED", "EXPIRED"] as VoucherTab[]).map((item) => (
            <Pressable
              key={item}
              onPress={() => {
                setTab(item);
                setPagerPage(["AVAILABLE", "USED", "EXPIRED"].indexOf(item));
              }}
              style={[styles.tab, tab === item && styles.tabActive]}
            >
              <Text selectable style={[styles.tabText, tab === item && styles.tabTextActive]}>
                {item === "AVAILABLE" ? `可用 ${availableCount}` : item === "USED" ? "已使用" : "已过期"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <PaginatedModuleShell
        definition={{ id: "voucher", pages: pagerPages, initialPage: ["AVAILABLE", "USED", "EXPIRED"].indexOf(tab) }}
        page={pagerPage}
        onPageChange={(index) => {
          setTab(index === 1 ? "USED" : index === 2 ? "EXPIRED" : "AVAILABLE");
          setPagerPage(undefined);
        }}
        onExit={onBack}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 }, content: { padding: 18, paddingBottom: 28 }, back: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", marginBottom: 9, minHeight: 22 }, backText: { color: color.magenta, fontSize: 11, fontWeight: "800" }, pageTitle: { color: color.ink, fontSize: 23, fontWeight: "900", letterSpacing: -.5 }, pageSub: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 5 }, listHead: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" }, createButton: { backgroundColor: color.ink, borderRadius: 12, marginTop: 22, paddingHorizontal: 10, paddingVertical: 8 }, createButtonText: { color: color.white, fontSize: 11, fontWeight: "900" }, tabs: { borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 19, marginTop: 18 }, tab: { borderBottomColor: "transparent", borderBottomWidth: 2, paddingBottom: 10 }, tabActive: { borderBottomColor: color.ink }, tabText: { color: "#9A9298", fontSize: 11, fontWeight: "800" }, tabTextActive: { color: color.ink }, spinner: { marginTop: 32 }, cards: { gap: 12, marginTop: 17 }, voucherCard: { borderColor: color.line, borderRadius: 21, borderWidth: 1, minHeight: 202, overflow: "hidden", padding: 16, ...shadows.card }, cardTop: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" }, cardFamily: { color: color.ink, fontSize: 11, fontWeight: "900", letterSpacing: -.2 }, familyTag: { backgroundColor: "rgba(255,255,255,.7)", borderColor: "rgba(0,0,0,.06)", borderRadius: 999, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 4 }, familyTagText: { color: "#5E575D", fontSize: 11, fontWeight: "900" }, markBox: { alignItems: "center", borderRadius: 17, height: 55, justifyContent: "center", marginLeft: "auto", marginTop: 15, width: 55 }, cardAmount: { color: color.ink, fontSize: 24, fontWeight: "900", letterSpacing: -.6, marginTop: -3 }, amountCurrency: { fontSize: 11, letterSpacing: 0 }, cardFoot: { alignItems: "flex-end", borderTopColor: "rgba(0,0,0,.08)", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingTop: 11 }, cardScope: { flex: 1, paddingRight: 8 }, scopeTitle: { color: color.ink, fontSize: 11, fontWeight: "800" }, scopeDetail: { color: color.muted, fontSize: 11, marginTop: 3 }, expiryDate: { color: color.ink, fontSize: 11, fontWeight: "800", textAlign: "right" }, expiryLabel: { color: color.muted, fontSize: 11, marginTop: 3 }, coffeeCup: { position: "absolute" }, coffeeHandle: { position: "absolute" }, steam: { borderRadius: 99, position: "absolute", transform: [{ rotate: "18deg" }] }, sun: { borderRadius: 99, position: "absolute" }, mountainOne: { borderLeftColor: "transparent", borderRightColor: "transparent", position: "absolute" }, mountainTwo: { borderLeftColor: "transparent", borderRightColor: "transparent", position: "absolute" }, personHead: { borderRadius: 99, position: "absolute" }, personBody: { position: "absolute" }, detailCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 23, borderWidth: 1, marginTop: 18, overflow: "hidden", ...shadows.card }, detailHero: { minHeight: 183, padding: 20 }, bigMark: { alignItems: "center", backgroundColor: "rgba(255,255,255,.66)", borderRadius: 21, height: 70, justifyContent: "center", marginLeft: "auto", marginTop: 17, width: 70 }, detailAmount: { color: color.ink, fontSize: 29, fontWeight: "900", letterSpacing: -.8, marginTop: -4 }, detailBody: { padding: 20 }, keyGrid: { flexDirection: "row", flexWrap: "wrap" }, keyValue: { borderBottomColor: color.line, borderBottomWidth: 1, minHeight: 57, paddingRight: 9, paddingVertical: 11, width: "50%" }, keyLabel: { color: color.muted, fontSize: 11, marginBottom: 5 }, keyText: { color: color.ink, fontSize: 11, fontWeight: "700", lineHeight: 15 }, rules: { color: "#7D757B", fontSize: 11, lineHeight: 15, marginTop: 15 }, issuer: { color: color.muted, fontSize: 11, marginTop: 9 }, primary: { alignItems: "center", backgroundColor: "#1C191D", borderRadius: 14, justifyContent: "center", marginTop: 17, minHeight: 47, paddingHorizontal: 12 }, primaryDisabled: { opacity: .55 }, primaryText: { color: color.white, fontSize: 11, fontWeight: "900" }, error: { color: color.error, fontSize: 11, lineHeight: 15, marginTop: 12 }, redeem: { alignItems: "center", paddingTop: 12 }, codeBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 22, borderWidth: 1, marginTop: 14, paddingVertical: 22, width: "100%", ...shadows.card }, codeBig: { color: color.ink, fontSize: 30, fontWeight: "900", letterSpacing: 3 }, codeHint: { color: color.muted, fontSize: 11, marginTop: 8 }, timer: { color: "#4D785F", fontSize: 11, fontWeight: "900", marginTop: 14 }, ticketLine: { alignItems: "center", borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 18, padding: 13, textAlign: "left", width: "100%" }, ticketTitle: { color: color.ink, fontSize: 11, fontWeight: "900" }, ticketSub: { color: color.muted, fontSize: 11, marginTop: 4 }, activeTag: { backgroundColor: "#E8F5EE", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 5 }, activeTagText: { color: "#347657", fontSize: 11, fontWeight: "900" }, p0Note: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 10, textAlign: "center" }, subtle: { paddingVertical: 15 }, subtleText: { color: "#6C656B", fontSize: 11, fontWeight: "800" }, stateList: { gap: 8, marginTop: 19 }, stateRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", padding: 13, ...shadows.card }, stateName: { color: color.ink, fontSize: 11, fontWeight: "900" }, stateDesc: { color: color.muted, fontSize: 11, marginTop: 4 }, stateBadge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 5 }, stateGood: { backgroundColor: "#E8F5EE" }, stateWait: { backgroundColor: "#F7EFE3" }, stateBadgeText: { color: "#685A4A", fontSize: 11, fontWeight: "900" }, policy: { backgroundColor: "#F8F6F7", borderRadius: 16, marginTop: 15, padding: 13 }, policyTitle: { color: color.ink, fontSize: 11, fontWeight: "900" }, policyText: { color: "#7B747A", fontSize: 11, lineHeight: 15, marginTop: 6 }, success: { alignItems: "center", flexGrow: 1, justifyContent: "center", padding: 28 }, check: { alignItems: "center", backgroundColor: "#2F7D62", borderRadius: 99, height: 70, justifyContent: "center", width: 70 }, checkText: { color: color.white, fontSize: 34, fontWeight: "700" }, successTitle: { color: color.ink, fontSize: 24, fontWeight: "900", marginTop: 18 }, successText: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 8, textAlign: "center" }, receipt: { alignSelf: "stretch", backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, marginTop: 20, padding: 15, ...shadows.card }, receiptTitle: { color: color.ink, fontSize: 11, fontWeight: "900" }, receiptText: { color: color.muted, fontSize: 11, marginTop: 5 }, presetHint: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 16, marginTop: 4 }, fieldLabel: { color: "#625B61", fontSize: 11, fontWeight: "900", marginTop: 18 }, fieldHint: { color: "#AAA2A8", fontWeight: "600" }, chips: { flexDirection: "row", gap: 7, marginTop: 8 }, chip: { backgroundColor: "#F7F4F6", borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 }, chipActive: { backgroundColor: color.ink, borderColor: color.ink }, chipText: { color: "#6D666C", fontSize: 11, fontWeight: "900" }, chipTextActive: { color: color.white }, input: { backgroundColor: color.white, borderColor: color.line, borderRadius: 13, borderWidth: 1, color: color.ink, fontSize: 12, fontWeight: "800", height: 46, marginTop: 7, paddingHorizontal: 12 }, dateRow: { flexDirection: "row", gap: 9, marginTop: 17 }, dateBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 13, borderWidth: 1, flex: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 13 }, dateValue: { color: color.ink, fontSize: 11, fontWeight: "800" }, dateLabel: { color: color.muted, fontSize: 11 }, budget: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 17 }, budgetLabel: { color: color.muted, fontSize: 11 }, budgetValue: { color: color.ink, fontSize: 15, fontWeight: "900" }, empty: { backgroundColor: "#FAF8F9", borderRadius: 15, padding: 15 }, emptyTitle: { color: color.ink, fontSize: 11, fontWeight: "900" }, emptyText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 5 }
});
