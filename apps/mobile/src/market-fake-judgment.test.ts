import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// MARKET-FAKE-JUDGMENT-001: 服务端没有匹配引擎（发布时直接写死一个百分比），
// 也没有对个人发布者的核验流程（发布时无条件写 verified=true）。客户端据此渲染出
// 「N% 匹配」标签和「发布方已验证」的勾，外加一整盒写死的 AI 结论。
// 服务端行为由 apps/api-go 的 TestPublishDoesNotFabricateMatchOrVerification /
// TestPublishMarksVerifiedOnlyWithMerchantMembership 覆盖；这里钉的是展示侧。
describe("MARKET-FAKE-JUDGMENT-001", () => {
  const card = readFileSync(fileURLToPath(new URL("./surfaces/r37-opportunity-card.tsx", import.meta.url)), "utf8");
  const detail = readFileSync(fileURLToPath(new URL("./surfaces/market.tsx", import.meta.url)), "utf8");

  it("the card hides the match badge when the server has no match score", () => {
    // 以前缺省值是 "0%" —— 把"没算过"显示成"0% 匹配"。
    expect(card).not.toContain('opportunity.match ?? "0%"');
    // 空串 = 没有匹配度，这时候不渲染那个标签。
    expect(card).toContain('const fit = (opportunity.match ?? "").trim();');
    expect(card).toContain('{fit !== "" ? <View style={styles.fitTag}>');
  });

  it("the detail never renders the match score", () => {
    // 服务端现在把 match 留空；展示侧也不该再拿它造句。
    expect(detail).not.toContain("opportunity.match");
  });

  it("the verification line says what was actually verified", () => {
    expect(detail).toContain("商家身份已验证");
  });

  it("the judgment box no longer states hardcoded conclusions", () => {
    // 正向：改成如实说明这一版还没有评估。
    expect(detail).toContain("这一版还没有评估");
    // 反向：那三条写死的结论不许回来。
    expect(detail).not.toContain("你的组合满足硬条件");
    expect(detail).not.toContain("不建议低于预算");
    expect(detail).not.toContain("值得考虑");
  });
});
