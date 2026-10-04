// MERCHANT-CREATOR-PROMO-002：专属码页面的纯格式化（没有 RN 依赖，边界能被单元测试真的断言）。
import type { PairPromoView } from "./supply-client";

// 「10万」「2.5万」「8000」：原型的金额都按万写（满50万减10万）。
export function formatWan(vnd: number): string {
  if (!Number.isFinite(vnd) || vnd <= 0) return "0";
  if (vnd >= 10_000) {
    const wan = vnd / 10_000;
    return Number.isInteger(wan) ? `${wan}万` : `${wan.toFixed(1).replace(/\.0$/, "")}万`;
  }
  return vnd.toLocaleString();
}

// 「满50万减10万」/「无门槛减5万」—— 和服务端 DefaultDisplayText 同一个说法。
export function formatPromoTerms(minSpendVnd: number, faceValueVnd: number): string {
  return minSpendVnd > 0 ? `满${formatWan(minSpendVnd)}减${formatWan(faceValueVnd)}` : `无门槛减${formatWan(faceValueVnd)}`;
}

// 原型「快捷模板」三档。
const TEMPLATE_TERMS: Array<{ minSpendVnd: number; faceValueVnd: number }> = [
  { minSpendVnd: 0, faceValueVnd: 30_000 },
  { minSpendVnd: 300_000, faceValueVnd: 50_000 },
  { minSpendVnd: 500_000, faceValueVnd: 100_000 },
];
export const PROMO_TEMPLATES: string[] = TEMPLATE_TERMS.map((t) => formatPromoTerms(t.minSpendVnd, t.faceValueVnd));
export function templateTerms(index: number): { minSpendVnd: number; faceValueVnd: number } {
  return TEMPLATE_TERMS[Math.max(0, Math.min(TEMPLATE_TERMS.length - 1, index))]!;
}

// 卡片上那一行「为什么是这个折扣」：
//   系统建议 → 「基于 1.2w（中腰部）· 垂类覆盖餐饮 自动生成」（只列有数据的维度）；
//   手动调整 → 「系统建议 10%，已被商家手动改为无门槛减5万：原因」。
export function promoReasonLine(view: PairPromoView): string {
  const { promo } = view;
  const pct = promo.suggestion.percentBp > 0 ? `${(promo.suggestion.percentBp / 100).toFixed(promo.suggestion.percentBp % 100 === 0 ? 0 : 1)}%` : "";
  if (promo.mode === "MANUAL") {
    const now = promo.terms.displayText || formatPromoTerms(promo.terms.minSpendVnd, promo.terms.faceValueVnd);
    const note = view.lastChange?.note || promo.note;
    return `${pct ? `系统建议 ${pct}，` : ""}已被商家手动改为 ${now}${note ? `：${note}` : ""}`;
  }
  const known = promo.suggestion.basis.filter((b) => b.available).map((b) => `${b.label} ${b.value}`);
  if (known.length === 0) return `数据还不够，按基准${pct ? ` ${pct}` : ""}起步；有核销后建议会更准`;
  return `基于 ${known.join(" · ")} 自动生成`;
}
