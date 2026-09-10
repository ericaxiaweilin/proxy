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
