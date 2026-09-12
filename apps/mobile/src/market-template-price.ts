// OPP-TEMPLATE-001: template cards quote prices in K shorthand
// ("200K"); the publish form wants the full VND string ("200,000₫").
// Single converter so the prefill can never drift between cards.
export function templatePriceToVND(price: string): string {
  const match = /^(\d+(?:\.\d+)?)K$/.exec(price.trim());
  const group = match?.[1];
  if (!group) return price;
  const value = Math.round(Number.parseFloat(group) * 1000);
  return `${value.toLocaleString("en-US")}₫`;
}

// OPP-SUGGEST-001: map the wire error codes of SuggestOpportunityTemplate
// to user-facing hints. Unknown codes get a generic retry line — the
// card grid stays the fallback path.
export function describeSuggestError(message: string): string {
  if (/AI_NOT_CONFIGURED/i.test(message)) return "智能生成暂未开放，请从下面卡片里选。";
  if (/SUGGESTION_NO_MATCH/i.test(message)) return "没有匹配的场景，换个说法或直接选卡片。";
  if (/SUGGESTION_MALFORMED/i.test(message)) return "生成结果异常，请手选卡片。";
  return "生成失败，请手选卡片。";
}

// ---- OPP-CATALOG-001 (R58): publish-flow engine math ----------------
// All pure functions over the server catalog payload (types imported
// as minimal structural shapes so the module stays import-light).

/** Structural slice of MomentPolicyInfo the math needs. */
export interface MomentPolicyLite {
  ratio: string;
  ratioText: string;
  fixed: boolean;
}

/** Structural slice of MomentPricingRule the math needs. */
export interface MomentPricingLite {
  duration?: Record<string, number>;
  time?: Record<string, number>;
  group?: Record<string, number>;
  perPair?: boolean;
}

/** One priced add-on line in the dynamic price breakdown. */
export interface PriceAddOn {
  label: string;
  amount: number;
}

/** Selected Moment spec driving the dynamic price. */
export interface MomentSelection {
  group: string;
  time: string;
  duration: string;
}

/**
 * groupCount parses the customer headcount out of a group chip like
 * "2 人" / "3–4 人" (takes the upper bound — that's the capacity the
 * providers must cover).
 */
export function groupCount(group: string): number {
  const matches = [...group.matchAll(/\d+/g)].map((m) => m[0]);
  if (matches.length === 0) return 1;
  return Number.parseInt(matches[matches.length - 1] ?? "1", 10);
}

/**
 * requiredProviderCount — R58 pairing math. A fixed 1:1 Moment needs
 * one provider per customer (multi-pair merge); anything else needs a
 * single provider (the group rides together).
 */
export function requiredProviderCount(group: string, policy: MomentPolicyLite | undefined): number {
  if (!policy) return 1;
  return policy.fixed && policy.ratio === "1:1" ? groupCount(group) : 1;
}

/**
 * momentPriceQuote — the R58 dynamic price engine.
 * base + duration/time/group deltas + preference add-ons; per-pair
 * cards multiply by the provider count. Returns per-unit and total so
 * the breakdown can show both lines.
 */
export function momentPriceQuote(
  baseK: number,
  selection: MomentSelection,
  pricing: MomentPricingLite | undefined,
  prefAdds: number[],
  providers: number
): { perUnit: number; total: number; addOns: PriceAddOn[] } {
  const addOns: PriceAddOn[] = [];
  const d = pricing?.duration?.[selection.duration] ?? 0;
  if (d !== 0) addOns.push({ label: selection.duration, amount: d });
  const t = pricing?.time?.[selection.time] ?? 0;
  if (t !== 0) addOns.push({ label: selection.time, amount: t });
  const g = pricing?.group?.[selection.group] ?? 0;
  if (g !== 0) addOns.push({ label: selection.group, amount: g });
  for (const add of prefAdds) {
    if (add !== 0) addOns.push({ label: "偏好", amount: add });
  }
  const perUnit = baseK + addOns.reduce((sum, x) => sum + x.amount, 0);
  const total = pricing?.perPair ? perUnit * providers : perUnit;
  return { perUnit, total, addOns };
}

/**
 * quoteToVND — K-shorthand total to the full VND string the publish
 * form sends on the wire.
 */
export function quoteToVND(totalK: number): string {
  const vnd = totalK * 1000;
  return `${vnd.toLocaleString("en-US")}₫`;
}

/**
 * formatTraceId — R58 success-screen trace id: PX-<type>-<yymmdd>-XXXX.
 * type is N (公开需求) / O (定向邀约). Client-side display id for the
 * copy button; the wire keeps the server opportunity id untouched.
 */
export function formatTraceId(type: "N" | "O" | "A", at: Date = new Date()): string {
  const yy = String(at.getFullYear()).slice(-2);
  const mm = String(at.getMonth() + 1).padStart(2, "0");
  const dd = String(at.getDate()).padStart(2, "0");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 4; i += 1) {
    tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `PX-${type}-${yy}${mm}${dd}-${tail}`;
}
