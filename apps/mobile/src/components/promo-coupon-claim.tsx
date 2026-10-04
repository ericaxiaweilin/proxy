import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color } from "../theme";
import { nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import { couponQrValue, SupplyClient, type PromoCoupon } from "../supply-client";
import { formatPromoTerms } from "../merchant-promo-format";
import { ProxyQrCode } from "./proxy-qr-code";

// MERCHANT-CREATOR-PROMO-002：顾客「扫一扫」扫到达人在某家店的专属码 → 领券。
// 这是「发券」数的唯一来源：每人每码一张（再领返回原来那张，不重复计数）。
// 领到后直接给出券的二维码（PROXY-COUPON:券号）—— 到店出示，店员扫它核销，
// 新客由系统按顾客身份判定（不靠店员问一句）。
export function PromoCouponClaim({ code }: { code: string }): React.JSX.Element {
  const [supply] = useState(() => new SupplyClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore }));
  const [busy, setBusy] = useState(false);
  const [coupon, setCoupon] = useState<PromoCoupon | undefined>(undefined);
  const [already, setAlready] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function claim(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await supply.claimPromoCoupon({ code });
      setCoupon(result.coupon);
      setAlready(result.alreadyClaimed);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setError(/promo_benefit_expired/.test(message) ? "这张券已过期或商家已停用"
        : /promo_not_found/.test(message) ? "没找到这个专属码"
          : /principal|sign|session|customer_required/i.test(message) ? "登录后才能领券"
            : "领券没成功，稍后重试");
    } finally {
      setBusy(false);
    }
  }

  const terms = coupon?.promo?.terms;
  return (
    <View style={styles.box}>
      <Text selectable style={styles.title}>{`达人专属码 · ${code}`}</Text>
      {coupon ? (
        <>
          <Text selectable style={styles.terms}>{terms ? (terms.displayText || formatPromoTerms(terms.minSpendVnd, terms.faceValueVnd)) : "专属优惠"}</Text>
          <Text selectable style={styles.note}>{`${coupon.promo?.merchantName || "商家"} · ${coupon.promo?.creatorName || "达人"} 专享${terms?.validUntil ? ` · 至 ${terms.validUntil}` : " · 长期有效"}${already ? " · 你之前已经领过这张" : ""}`}</Text>
          <View style={styles.qr}><ProxyQrCode size={168} value={couponQrValue(coupon.couponId)} /></View>
          <Text selectable style={styles.note}>到店结账时出示这个码，店员扫码核销。</Text>
        </>
      ) : (
        <>
          <Text selectable style={styles.note}>这是达人在某家店的专属码，领一张券到店使用。</Text>
          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityLabel="领取专属券" disabled={busy} onPress={() => void claim()} style={[styles.btn, busy && { opacity: 0.6 }]}>
            <Text selectable style={styles.btnText}>{busy ? "领取中…" : "领取专属券"}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", gap: 6, marginTop: 8 },
  title: { color: color.ink, fontSize: 13, fontWeight: "800" },
  terms: { color: "#FF3B30", fontSize: 22, fontWeight: "900" },
  note: { color: color.muted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  error: { color: "#FF3B30", fontSize: 12 },
  qr: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginVertical: 6, padding: 12 },
  btn: { alignItems: "center", backgroundColor: "#D0F55C", borderRadius: 12, marginTop: 6, minHeight: 44, justifyContent: "center", paddingHorizontal: 24 },
  btnText: { color: "#111111", fontSize: 14, fontWeight: "800" },
});
