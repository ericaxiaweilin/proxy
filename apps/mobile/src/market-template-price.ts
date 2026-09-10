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
