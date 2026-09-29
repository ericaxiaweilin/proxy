import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import { useI18n } from "../i18n";
import { nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import { ProxyBackGlyph } from "../components/proxy-foundation";
import { ProxyIcon } from "../components/proxy-icon";
import { WalletClient } from "../wallet-client";
import { VoucherClient, type Voucher } from "../voucher-client";
import type { ExchangeItem, GetWalletResult, RechargePackage, WalletEntry, WalletProvider } from "@proxy/contracts";

// WALLET-001 钱包（原型 docs/design/references/Proxy_Wallet_20260929_0a2f07.html，
// 5 页流：home / topup / bean / ticket / history，页内 state 切换）。
//
// 对齐原型、数据诚实的分界（逐条有出处）：
// - 版式/顺序/文案跟原型走：三资产 hero、4 常用功能、热门充值、8折 banner、
//   topup 套餐+渠道、bean 兑换三行、券列表、交易分组。营销文案（8折/限时3天/
//   渠道折扣）是产品口径，原样呈现，兑现靠后端活动与渠道配置（见下）。
// - 数字只读服务端 GetWallet：余额/套餐价格/兑换比率/券计数/交易记录。
//   没有数据源的一律不画数：VIP 只显示生效状态+到期日（“VIP 3”这种等级没有
//   规则来源，不编号码）；应付金额、处理中分组、客服入口没有数据源，不画。
// - 金豆兑券 voucher_gift 没出资池时保持 disabled（Voucher 域合规边界）。
type WalletPage = "home" | "topup" | "bean" | "ticket" | "history";
type HistoryTab = "all" | "DIAMOND" | "BEAN" | "TICKET";

export function WalletSurface({ onBack, onOpenVouchers }: {
  onBack: () => void;
  onOpenVouchers: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const wallet = useMemo(() => new WalletClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore }), []);
  const vouchers = useMemo(() => new VoucherClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore }), []);
  const [page, setPage] = useState<WalletPage>("home");
  const [snapshot, setSnapshot] = useState<GetWalletResult | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<WalletEntry[]>([]);
  const [myVouchers, setMyVouchers] = useState<Voucher[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<string | undefined>(undefined);
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<HistoryTab>("all");
  const scrollRef = useRef<ScrollView>(null);
  // 请求排队：慢请求（比如 voucher 列表卡住）后返回时，不许覆盖更新的数据。
  // 之前这里有个真坑——充值成功后的刷新如果被更早发出的慢请求压哨覆盖，
  // 余额就一直显示旧 0，用户只能再点一次（于是出现 1 秒内两笔同样入账）。
  const loadSeq = useRef(0);
  const hasSnapshotRef = useRef(false);

  const load = useCallback(async () => {
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    setLoading(true);
    setError(undefined);
    try {
      const [walletResult, entriesResult, voucherList] = await Promise.all([
        wallet.getWallet(),
        wallet.listEntries(50),
        vouchers.list().catch(() => [] as Voucher[]),
      ]);
      if (loadSeq.current !== seq) return;
      hasSnapshotRef.current = true;
      setSnapshot(walletResult);
      setEntries(entriesResult.entries);
      setMyVouchers(voucherList);
      setSelectedPackage((prev) => prev ?? walletResult.rechargePackages[0]?.id);
    } catch (e) {
      if (loadSeq.current !== seq) return;
      setError(e instanceof Error ? e.message : t("walletLoadFailed"));
      // 已有快照时刷新失败不能静默吞掉——否则用户看到的是过期余额。
      if (hasSnapshotRef.current) setNotice(e instanceof Error ? e.message : t("walletLoadFailed"));
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  }, [t, vouchers, wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  function go(next: WalletPage): void {
    setNotice(undefined);
    setPage(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  async function confirmRecharge(pack: RechargePackage | undefined, provider: WalletProvider | undefined): Promise<void> {
    if (!pack || !provider || busy) return;
    if (!provider.enabled) {
      setNotice(t("providerUnconfigured"));
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await wallet.confirmRecharge(pack.id, provider.id);
      // 服务端回的即时余额先落本地（刷新随后对账；就算刷新被旧请求覆盖，
      // 余额也不会闪回 0）。
      setSnapshot((prev) => (prev ? { ...prev, diamonds: result.diamonds, beans: result.beans } : prev));
      setNotice(t("rechargeSuccess"));
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("rechargeFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function exchange(item: ExchangeItem): Promise<void> {
    if (busy) return;
    if (!item.enabled) {
      setNotice(item.disabledHint || t("exchangeUnavailable"));
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await wallet.exchangeBeans(item.id);
      setSnapshot((prev) => (prev ? { ...prev, diamonds: result.diamonds, beans: result.beans } : prev));
      setNotice(t("exchangeSuccess"));
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("exchangeFailed"));
    } finally {
      setBusy(false);
    }
  }

  const now = Date.now();
  const activeVouchers = myVouchers.filter((v) => v.status === "AVAILABLE" && Date.parse(v.validUntil) > now);
  const expiringVouchers = activeVouchers.filter((v) => Date.parse(v.validUntil) - now < 7 * 24 * 3600 * 1000);
  const expiring24 = activeVouchers.filter((v) => Date.parse(v.validUntil) - now < 24 * 3600 * 1000);
  const expiredCount = myVouchers.filter((v) => v.status === "EXPIRED" || Date.parse(v.validUntil) <= now).length;
  const selectedPack = snapshot?.rechargePackages.find((p) => p.id === selectedPackage);
  const selectedProv = snapshot?.providers.find((p) => p.id === selectedProvider);

  function exchangeTitleOf(item: ExchangeItem): string {
    if (item.kind === "DIAMONDS") return t("exchangeDiamonds");
    if (item.kind === "VIP_DAYS") return t("exchangeVip", { n: item.amount });
    return t("exchangeVoucher");
  }

  function exchangeDescOf(item: ExchangeItem): string {
    if (item.kind === "DIAMONDS") return t("exchangeDiamondsDesc");
    if (item.kind === "VIP_DAYS") return t("exchangeVipDesc");
    return t("exchangeVoucherDesc");
  }

  function exchangeRateOf(item: ExchangeItem): string {
    if (item.kind === "DIAMONDS") return t("exchangeRateDiamonds", { cost: item.costBeans.toLocaleString(), n: 1 });
    if (item.kind === "VIP_DAYS") return t("exchangeRateVip", { cost: item.costBeans.toLocaleString(), n: item.amount });
    return t("exchangeRateVoucher", { cost: item.costBeans.toLocaleString(), n: item.amount });
  }

  function groupEntries(): Array<[string, WalletEntry[]]> {
    const list = entries.filter((e) => historyTab === "all" || e.currency === historyTab);
    const groups = new Map<string, WalletEntry[]>();
    for (const e of list) {
      const label = dayLabelOf(e.createdAt);
      const arr = groups.get(label);
      if (arr) arr.push(e);
      else groups.set(label, [e]);
    }
    return [...groups.entries()];
  }

  function providerOffText(id: string): string {
    if (id === "MOMO") return t("payOffMomo");
    if (id === "ZALOPAY") return t("payOffZalo");
    if (id === "BANKCARD") return t("payOffCard");
    if (id === "IAP") return t("payOffIap");
    return t("comingSoon");
  }

  function reasonLabel(reason: string): string {
    switch (reason) {
      case "RECHARGE_CREDIT": return t("entryRecharge");
      case "RECHARGE_REVERSAL": return t("entryReversal");
      case "EXCHANGE_OUT": return t("entryExchangeOut");
      case "EXCHANGE_IN": return t("entryExchangeIn");
      case "GRANT": return t("entryGrant");
      case "SPEND": return t("entrySpend");
      case "CHECKIN_REWARD": return t("entryCheckin");
      default: return reason;
    }
  }

  function entryLine(e: WalletEntry): string {
    const sign = e.delta >= 0 ? "+" : "−";
    const unit = e.currency === "DIAMOND" ? t("diamonds") : t("beans");
    return `${sign}${Math.abs(e.delta)} ${unit}`;
  }

  function dayLabelOf(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const startOf = (x: Date): Date => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    const diff = Math.round((startOf(today).getTime() - startOf(d).getTime()) / 86400000);
    if (diff <= 0) return t("todayTx");
    if (diff === 1) return t("yesterdayTx");
    return t("earlierTx");
  }

  function timeOf(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  if (loading && !snapshot) {
    return (
      <View style={styles.root}>
        <Text selectable style={styles.loading}>{t("walletLoading")}</Text>
      </View>
    );
  }
  if (error && !snapshot) {
    return (
      <View style={styles.root}>
        <Text selectable style={styles.error}>{error}</Text>
        <Pressable accessibilityLabel={t("retry")} onPress={() => void load()} style={styles.retryBtn}>
          <Text selectable style={styles.retryText}>{t("retry")}</Text>
        </Pressable>
      </View>
    );
  }

  const diamonds = snapshot?.diamonds ?? 0;
  const beans = snapshot?.beans ?? 0;
  const vipActive = snapshot?.vip.active === true;

  return (
    <View style={styles.root}>
      {page === "home" ? (
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            <Pressable accessibilityLabel={t("backShort")} onPress={onBack} style={styles.backBtn}>
              <ProxyBackGlyph />
            </Pressable>
            <Text selectable style={styles.title}>{t("walletTitle")}</Text>
            <View style={styles.vipBadge}>
              <ProxyIcon color="#5B3A00" name="star" size={12} />
              <Text selectable style={styles.vipText}>VIP{vipActive ? ` · ${t("vipValid")}` : ""}</Text>
            </View>
          </View>

          {/* hero：三资产（钻石/金豆/券，数全是服务端的）。 */}
          <View style={styles.hero}>
            <Pressable accessibilityLabel={t("diamonds")} onPress={() => go("topup")} style={styles.asset}>
              <ProxyIcon color={color.white} name="diamond" size={26} />
              <Text selectable style={styles.assetLabel}>{t("diamonds")}</Text>
              <Text selectable style={styles.assetValue}>{diamonds.toLocaleString()}</Text>
              <Text selectable style={styles.assetSub}>{t("diamondsLocked")}</Text>
              <View style={styles.assetBtn}><Text selectable style={styles.assetBtnText}>{t("recharge")}</Text></View>
            </Pressable>
            <Pressable accessibilityLabel={t("beans")} onPress={() => go("bean")} style={styles.asset}>
              <ProxyIcon color={color.white} name="coin" size={26} />
              <Text selectable style={styles.assetLabel}>{t("beans")}</Text>
              <Text selectable style={styles.assetValue}>{beans.toLocaleString()}</Text>
              <Text selectable style={styles.assetSub}>{t("beansExchangeable")}</Text>
              <View style={styles.assetBtn}><Text selectable style={styles.assetBtnText}>{t("exchange")}</Text></View>
            </Pressable>
            <Pressable accessibilityLabel={t("voucherPack")} onPress={() => go("ticket")} style={styles.asset}>
              <ProxyIcon color={color.white} name="ticket" size={26} />
              <Text selectable style={styles.assetLabel}>{t("voucherPackUnit")}</Text>
              <Text selectable style={styles.assetValue}>{t("voucherCountN", { n: activeVouchers.length })}</Text>
              <Text selectable style={styles.assetSub}>{t("voucherExpiringN", { n: expiringVouchers.length })}</Text>
              <View style={styles.assetBtn}><Text selectable style={styles.assetBtnText}>{t("viewAction")}</Text></View>
            </Pressable>
          </View>
          {expiring24.length > 0 ? (
            <View style={styles.alert}>
              <Text selectable style={styles.alertText}>{t("expiringAlert", { n: expiring24.length })}</Text>
              <Pressable accessibilityLabel={t("viewAction")} onPress={onOpenVouchers}>
                <Text selectable style={styles.alertAction}>{t("useNow")}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* 常用功能：充值/兑换/券包/记录（页内路由）。 */}
          <Text selectable style={styles.sectionTitle}>{t("commonFuncs")}</Text>
          <View style={styles.funcGrid}>
            <Pressable accessibilityLabel={t("recharge")} onPress={() => go("topup")} style={styles.func}>
              <ProxyIcon color={color.ink} name="plus" size={22} />
              <Text selectable style={styles.funcLabel}>{t("recharge")}</Text>
            </Pressable>
            <Pressable accessibilityLabel={t("exchange")} onPress={() => go("bean")} style={styles.func}>
              <ProxyIcon color={color.ink} name="remix" size={22} />
              <Text selectable style={styles.funcLabel}>{t("exchange")}</Text>
            </Pressable>
            <Pressable accessibilityLabel={t("voucherPack")} onPress={() => go("ticket")} style={styles.func}>
              <ProxyIcon color={color.ink} name="ticket" size={22} />
              <Text selectable style={styles.funcLabel}>{t("voucherPack")}</Text>
            </Pressable>
            <Pressable accessibilityLabel={t("records")} onPress={() => go("history")} style={styles.func}>
              <ProxyIcon color={color.ink} name="clock" size={22} />
              <Text selectable style={styles.funcLabel}>{t("records")}</Text>
            </Pressable>
          </View>

          {/* 热门充值：服务端套餐（钻石数+赠送+VNĐ 全下发）+ 更多进充值页。 */}
          <View style={styles.sectionHeadRow}>
            <Text selectable style={styles.sectionTitle}>{t("hotRecharge")}</Text>
            <Pressable accessibilityLabel={t("moreAction")} onPress={() => go("topup")}>
              <Text selectable style={styles.moreLink}>{t("moreAction")} ›</Text>
            </Pressable>
          </View>
          <View style={styles.packsRow}>
            {(snapshot?.rechargePackages ?? []).map((p) => (
              <Pressable
                key={p.id}
                accessibilityLabel={`${p.diamonds}+${p.bonusDiamonds} ${t("diamonds")}`}
                onPress={() => { setSelectedPackage(p.id); go("topup"); }}
                style={styles.packCard}
              >
                {p.tag ? <Text selectable style={styles.packTag}>{p.tag}</Text> : null}
                <Text selectable style={styles.packAmount}>{p.diamonds.toLocaleString()}</Text>
                <Text selectable style={styles.packUnit}>{t("diamonds")}</Text>
                <Text selectable style={styles.packBonus}>+{p.bonusDiamonds.toLocaleString()} {t("bonusGift")}</Text>
                <Text selectable style={styles.packPrice}>₫{p.priceVND.toLocaleString()}</Text>
              </Pressable>
            ))}
          </View>

          {/* 金豆兑券 banner（产品营销位，进金豆中心）。 */}
          <Pressable accessibilityLabel={t("beanExchangeOff")} onPress={() => go("bean")} style={styles.banner}>
            <View style={styles.bannerCopy}>
              <Text selectable style={styles.bannerTitle}>{t("beanExchangeOff")}</Text>
              <Text selectable style={styles.bannerSub}>{t("beanExchangeOffSub")}</Text>
            </View>
            <Text selectable style={styles.bannerGo}>{t("joinNow")}</Text>
          </Pressable>
          {notice ? <Text selectable style={styles.notice}>{notice}</Text> : null}
        </ScrollView>
      ) : null}

      {page === "topup" ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.navRow}>
            <Pressable accessibilityLabel={t("backShort")} onPress={() => go("home")} style={styles.backBtn}>
              <ProxyBackGlyph />
            </Pressable>
            <Text selectable style={styles.navTitle}>{t("topupTitle")}</Text>
            <Pressable accessibilityLabel={t("topupHelp")} onPress={() => setNotice(t("diamondsLocked"))} style={styles.helpBtn}>
              <Text selectable style={styles.helpText}>?</Text>
            </Pressable>
          </View>
          <View style={styles.topupBalance}>
            <ProxyIcon color={color.ink} name="diamond" size={20} />
            <Text selectable style={styles.topupBalanceText}>{t("diamondBalance", { n: diamonds.toLocaleString() })}</Text>
          </View>
          <Text selectable style={styles.sectionTitle}>{t("selectPlan")}</Text>
          <View style={styles.packsRow}>
            {(snapshot?.rechargePackages ?? []).map((p) => {
              const on = p.id === selectedPackage;
              return (
                <Pressable
                  key={p.id}
                  accessibilityLabel={`${p.diamonds}+${p.bonusDiamonds} ${t("diamonds")}`}
                  onPress={() => { setSelectedPackage(p.id); setNotice(undefined); }}
                  style={[styles.packCard, on && styles.packCardOn]}
                >
                  {p.tag ? <Text selectable style={styles.packTag}>{p.tag}</Text> : null}
                  <Text selectable style={[styles.packAmount, on && styles.packAmountOn]}>{(p.diamonds + p.bonusDiamonds).toLocaleString()}</Text>
                  <Text selectable style={[styles.packUnit, on && styles.packUnitOn]}>{t("diamonds")}</Text>
                  <Text selectable style={[styles.packBonus, on && styles.packBonusOn]}>+{p.bonusDiamonds.toLocaleString()} {t("bonusGift")}</Text>
                  <Text selectable style={[styles.packPrice, on && styles.packPriceOn]}>₫{p.priceVND.toLocaleString()}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text selectable style={styles.sectionTitle}>{t("payMethods")}</Text>
          <View style={styles.providerList}>
            {(snapshot?.providers ?? []).map((p) => (
              <Pressable
                key={p.id}
                accessibilityLabel={p.name}
                disabled={!p.enabled}
                onPress={() => { setSelectedProvider(p.id); setNotice(undefined); }}
                style={[styles.providerRow, p.id === selectedProvider && styles.providerRowOn, !p.enabled && styles.providerRowOff]}
              >
                <View style={styles.providerCopy}>
                  <Text selectable style={[styles.providerName, !p.enabled && styles.providerNameOff]}>{p.name}</Text>
                  <Text selectable style={styles.providerNote}>{providerOffText(p.id)}</Text>
                </View>
                {!p.enabled ? <Text selectable style={styles.providerOff}>{t("comingSoon")}</Text> : null}
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityLabel={t("confirmRecharge")}
            disabled={busy || !selectedPack || !selectedProv}
            onPress={() => void confirmRecharge(selectedPack, selectedProv)}
            style={[styles.cta, (busy || !selectedPack || !selectedProv) && styles.ctaDisabled]}
          >
            <Text selectable style={styles.ctaText}>
              {selectedPack && selectedProv ? t("confirmRechargeWith", { amount: (selectedPack.diamonds + selectedPack.bonusDiamonds).toLocaleString(), provider: selectedProv.name }) : t("confirmRecharge")}
            </Text>
          </Pressable>
          {notice ? <Text selectable style={styles.notice}>{notice}</Text> : null}
        </ScrollView>
      ) : null}

      {page === "bean" ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.navRow}>
            <Pressable accessibilityLabel={t("backShort")} onPress={() => go("home")} style={styles.backBtn}>
              <ProxyBackGlyph />
            </Pressable>
            <Text selectable style={styles.navTitle}>{t("beanCenter")}</Text>
            <Pressable accessibilityLabel={t("records")} onPress={() => go("history")}>
              <Text selectable style={styles.moreLink}>{t("records")}</Text>
            </Pressable>
          </View>
          <View style={styles.beanBalance}>
            <ProxyIcon color={color.ink} name="coin" size={22} />
            <Text selectable style={styles.beanBalanceText}>{t("myBeans", { n: beans.toLocaleString() })}</Text>
          </View>
          <Text selectable style={styles.legalText}>{t("beanLegal")}</Text>
          <Text selectable style={styles.sectionTitle}>{t("exchange")}</Text>
          {(snapshot?.exchangeCatalog ?? []).map((item) => (
            <Pressable
              key={item.id}
              accessibilityLabel={exchangeTitleOf(item)}
              disabled={busy || !item.enabled}
              onPress={() => void exchange(item)}
              style={[styles.exchangeRow, !item.enabled && styles.exchangeRowOff]}
            >
              <View style={styles.exchangeCopy}>
                <Text selectable style={styles.exchangeTitle}>{exchangeTitleOf(item)}</Text>
                <Text selectable style={styles.exchangeDesc}>{exchangeDescOf(item)}</Text>
                <Text selectable style={styles.exchangeRate}>{exchangeRateOf(item)}</Text>
                {!item.enabled && item.disabledHint ? <Text selectable style={styles.exchangeHint}>{item.disabledHint}</Text> : null}
              </View>
              <Text selectable style={styles.exchangeArrow}>›</Text>
            </Pressable>
          ))}
          <Text selectable style={styles.agencyNote}>{t("agencySettlement")}</Text>
          {notice ? <Text selectable style={styles.notice}>{notice}</Text> : null}
        </ScrollView>
      ) : null}

      {page === "ticket" ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.navRow}>
            <Pressable accessibilityLabel={t("backShort")} onPress={() => go("home")} style={styles.backBtn}>
              <ProxyBackGlyph />
            </Pressable>
            <Text selectable style={styles.navTitle}>{t("myVouchers")}</Text>
            <Pressable accessibilityLabel={t("voucherRules")} onPress={() => setRulesOpen((open) => !open)}>
              <Text selectable style={styles.moreLink}>{t("voucherRules")}</Text>
            </Pressable>
          </View>
          {rulesOpen ? <Text selectable style={styles.rulesNote}>{t("voucherRulesNote")}</Text> : null}
          <View style={styles.ticketCounts}>
            <View style={styles.ticketCountBox}>
              <Text selectable style={styles.ticketCountValue}>{activeVouchers.length}</Text>
              <Text selectable style={styles.ticketCountLabel}>{t("ticketValid")}</Text>
            </View>
            <View style={styles.ticketCountBox}>
              <Text selectable style={styles.ticketCountValue}>{expiredCount}</Text>
              <Text selectable style={styles.ticketCountLabel}>{t("ticketExpired")}</Text>
            </View>
          </View>
          {activeVouchers.map((v) => {
            const urgent = Date.parse(v.validUntil) - now < 24 * 3600 * 1000;
            return (
              <View key={v.voucherId} style={styles.ticketCard}>
                <View style={styles.ticketCopy}>
                  <Text selectable style={styles.ticketName}>{v.scopeName} · {v.displayValue.toLocaleString()}₫</Text>
                  <Text selectable style={styles.ticketMeta}>{v.scopeDetail}</Text>
                  <Text selectable style={styles.ticketMeta}>{t("validUntilX", { date: v.validUntil.slice(0, 10) })}</Text>
                  {urgent ? <Text selectable style={styles.ticketUrgent}>{t("expiringSoon")}</Text> : null}
                </View>
                <Pressable accessibilityLabel={t("useNow")} onPress={onOpenVouchers} style={styles.ticketUse}>
                  <Text selectable style={styles.ticketUseText}>{t("useNow")}</Text>
                </Pressable>
              </View>
            );
          })}
          {activeVouchers.length === 0 ? <Text selectable style={styles.emptyRecords}>{t("noVouchers")}</Text> : null}
        </ScrollView>
      ) : null}

      {page === "history" ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.navRow}>
            <Pressable accessibilityLabel={t("backShort")} onPress={() => go("home")} style={styles.backBtn}>
              <ProxyBackGlyph />
            </Pressable>
            <Text selectable style={styles.navTitle}>{t("records")}</Text>
            <View style={styles.backBtn} />
          </View>
          <View style={styles.tabsRow}>
            {([
              ["all", t("filterAllType")],
              ["DIAMOND", t("diamonds")],
              ["BEAN", t("beans")],
              ["TICKET", t("voucherPackUnit")],
            ] as Array<[HistoryTab, string]>).map(([id, label]) => (
              <Pressable key={id} accessibilityLabel={label} onPress={() => setHistoryTab(id)} style={[styles.tabChip, historyTab === id && styles.tabChipOn]}>
                <Text selectable style={[styles.tabText, historyTab === id && styles.tabTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {historyTab === "TICKET" ? (
            activeVouchers.length === 0 ? <Text selectable style={styles.emptyRecords}>{t("noVouchers")}</Text> : null
          ) : null}
          {historyTab === "TICKET" ? activeVouchers.map((v) => (
            <View key={v.voucherId} style={styles.recordRow}>
              <View style={styles.recordCopy}>
                <Text selectable style={styles.recordReason}>{v.scopeName}</Text>
                <Text selectable style={styles.recordDate}>{t("validUntilX", { date: v.validUntil.slice(0, 10) })}</Text>
              </View>
              <Text selectable style={styles.recordAmount}>1 {t("voucherPackUnit")}</Text>
            </View>
          )) : (
            groupEntries().map(([day, items]) => (
              <View key={day}>
                <Text selectable style={styles.dayLabel}>{day}</Text>
                {items.map((e) => (
                  <View key={e.id} style={styles.recordRow}>
                    <View style={styles.recordCopy}>
                      <Text selectable style={styles.recordReason}>{reasonLabel(e.reason)}</Text>
                      <Text selectable style={styles.recordDate}>{timeOf(e.createdAt)}</Text>
                    </View>
                    <Text selectable style={[styles.recordAmount, e.delta < 0 && styles.recordAmountOut]}>{entryLine(e)}</Text>
                  </View>
                ))}
              </View>
            ))
          )}
          {historyTab !== "TICKET" && entries.length === 0 ? <Text selectable style={styles.emptyRecords}>{t("noRecords")}</Text> : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 40, paddingHorizontal: 16, paddingTop: 8 },
  loading: { color: color.muted, fontSize: 13 },
  error: { color: color.error, fontSize: 13, marginBottom: 12, textAlign: "center" },
  retryBtn: { borderColor: color.line, borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: color.ink, fontSize: 14, fontWeight: "800" },
  topRow: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 8 },
  backBtn: { alignItems: "center", height: 38, justifyContent: "center", width: 38 },
  title: { color: color.ink, fontSize: 22, fontWeight: "900" },
  vipBadge: { alignItems: "center", backgroundColor: "#FDE68A", borderRadius: 999, flexDirection: "row", gap: 4, marginLeft: 4, paddingHorizontal: 10, paddingVertical: 5 },
  vipText: { color: "#5B3A00", fontSize: 11, fontWeight: "800" },
  hero: { backgroundColor: color.ink, borderRadius: 22, flexDirection: "row", marginTop: 8, paddingHorizontal: 8, paddingVertical: 16 },
  asset: { alignItems: "center", flex: 1, gap: 2 },
  assetLabel: { color: color.white, fontSize: 12, fontWeight: "700" },
  assetValue: { color: color.white, fontSize: 19, fontVariant: ["tabular-nums"], fontWeight: "900" },
  assetSub: { color: color.white, fontSize: 10, fontWeight: "600", opacity: 0.7 },
  assetBtn: { backgroundColor: color.white, borderRadius: 999, marginTop: 6, paddingHorizontal: 14, paddingVertical: 6 },
  assetBtnText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  alert: { alignItems: "center", backgroundColor: "#FEF3C7", borderColor: "#FED7AA", borderRadius: 12, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingHorizontal: 12, paddingVertical: 10 },
  alertText: { color: color.ink, fontSize: 12, fontWeight: "700", flex: 1 },
  alertAction: { color: color.violet, fontSize: 12, fontWeight: "800", marginLeft: 8 },
  sectionTitle: { color: color.ink, fontSize: 16, fontWeight: "900", marginBottom: 8, marginTop: 20 },
  sectionHeadRow: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginTop: 20 },
  sectionHeadRowTitle: { color: color.ink, fontSize: 16, fontWeight: "900" },
  moreLink: { color: color.muted, fontSize: 12, fontWeight: "700" },
  funcGrid: { flexDirection: "row", gap: 8 },
  func: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, gap: 6, paddingVertical: 12 },
  funcLabel: { color: color.ink, fontSize: 12, fontWeight: "700" },
  packsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  packCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1.5, paddingVertical: 12, width: "23%" },
  packCardOn: { backgroundColor: color.ink, borderColor: color.ink },
  packTag: { color: color.violet, fontSize: 11, fontWeight: "800" },
  packAmount: { color: color.ink, fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "900", marginTop: 2 },
  packAmountOn: { color: color.white },
  packUnit: { color: color.muted, fontSize: 10, fontWeight: "700" },
  packUnitOn: { color: color.white },
  packBonus: { color: color.violet, fontSize: 11, fontWeight: "700", marginTop: 2 },
  packBonusOn: { color: color.white },
  packPrice: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 4 },
  packPriceOn: { color: color.white },
  banner: { alignItems: "center", backgroundColor: "#6D28D9", borderRadius: 18, flexDirection: "row", justifyContent: "space-between", marginTop: 16, paddingHorizontal: 18, paddingVertical: 16 },
  bannerCopy: { flex: 1 },
  bannerTitle: { color: color.white, fontSize: 15, fontWeight: "900" },
  bannerSub: { color: color.white, fontSize: 11, fontWeight: "600", marginTop: 4, opacity: 0.85 },
  bannerGo: { color: color.white, fontSize: 13, fontWeight: "800", marginLeft: 8 },
  navRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  navTitle: { color: color.ink, fontSize: 17, fontWeight: "800" },
  helpBtn: { alignItems: "center", height: 38, justifyContent: "center", width: 38 },
  helpText: { color: color.muted, fontSize: 18, fontWeight: "700" },
  topupBalance: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 12 },
  topupBalanceText: { color: color.ink, fontSize: 15, fontWeight: "800" },
  providerList: { gap: 8 },
  providerRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1.5, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  providerRowOn: { borderColor: color.ink },
  providerRowOff: { opacity: 0.55 },
  providerCopy: { flex: 1 },
  providerName: { color: color.ink, fontSize: 14, fontWeight: "800" },
  providerNameOff: { color: color.muted },
  providerNote: { color: color.muted, fontSize: 11, fontWeight: "600", marginTop: 2 },
  providerOff: { color: color.muted, fontSize: 12, fontWeight: "800" },
  cta: { alignItems: "center", backgroundColor: color.ink, borderRadius: 14, justifyContent: "center", marginTop: 12, minHeight: 50 },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: color.white, fontSize: 14, fontWeight: "800" },
  notice: { color: color.muted, fontSize: 12, fontWeight: "700", marginTop: 8, textAlign: "center" },
  beanBalance: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 12 },
  beanBalanceText: { color: color.ink, fontSize: 17, fontWeight: "900" },
  legalText: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 16, marginTop: 8 },
  exchangeRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", marginBottom: 8, padding: 14 },
  exchangeRowOff: { opacity: 0.65 },
  exchangeCopy: { flex: 1 },
  exchangeTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  exchangeDesc: { color: color.muted, fontSize: 12, fontWeight: "600", marginTop: 2 },
  exchangeRate: { color: color.ink, fontSize: 13, fontWeight: "800", marginTop: 6 },
  exchangeHint: { color: color.violet, fontSize: 11, fontWeight: "700", marginTop: 4 },
  exchangeArrow: { color: color.muted, fontSize: 20, fontWeight: "700", marginLeft: 8 },
  agencyNote: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 16, marginTop: 4 },
  ticketCounts: { flexDirection: "row", gap: 10, marginTop: 12 },
  ticketCountBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 12 },
  ticketCountValue: { color: color.ink, fontSize: 20, fontVariant: ["tabular-nums"], fontWeight: "900" },
  ticketCountLabel: { color: color.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  ticketCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", marginTop: 8, padding: 14 },
  ticketCopy: { flex: 1 },
  ticketName: { color: color.ink, fontSize: 14, fontWeight: "800" },
  ticketMeta: { color: color.muted, fontSize: 12, fontWeight: "600", marginTop: 2 },
  ticketUrgent: { color: color.violet, fontSize: 11, fontWeight: "800", marginTop: 4 },
  ticketUse: { backgroundColor: color.ink, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  ticketUseText: { color: color.white, fontSize: 13, fontWeight: "800" },
  rulesNote: { color: color.muted, fontSize: 12, fontWeight: "600", lineHeight: 18, marginTop: 8 },
  ghostBtn: { alignItems: "center", borderColor: color.line, borderRadius: 12, borderWidth: 1, paddingVertical: 12 },
  ghostBtnText: { color: color.ink, fontSize: 14, fontWeight: "800" },
  tabsRow: { flexDirection: "row", gap: 8, marginBottom: 4, marginTop: 12 },
  tabChip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  tabChipOn: { backgroundColor: color.ink, borderColor: color.ink },
  tabText: { color: color.muted, fontSize: 12, fontWeight: "700" },
  tabTextOn: { color: color.white },
  dayLabel: { color: color.muted, fontSize: 12, fontWeight: "800", marginBottom: 2, marginTop: 12 },
  emptyRecords: { color: color.muted, fontSize: 12, paddingVertical: 8 },
  recordRow: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  recordCopy: { flex: 1 },
  recordReason: { color: color.ink, fontSize: 13, fontWeight: "800" },
  recordDate: { color: color.muted, fontSize: 11, fontWeight: "600", marginTop: 2 },
  recordAmount: { color: color.ink, fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "800" },
  recordAmountOut: { color: color.muted },
});
