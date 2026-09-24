import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ORDER-EXEC-001 —— 订单明细以前只有"返回列表"：OFFERED 卡死，EXECUTING 走不到
// COMPLETED，COMPLETED 评不了分。明细页按 lifecycle 逐态出真按钮，全部走命令。
describe("ORDER-EXEC-001 order detail drives the lifecycle", () => {
  const orders = readFileSync(new URL("./surfaces/me-orders.tsx", import.meta.url), "utf8");

  it("each lifecycle state renders its real actions", () => {
    expect(orders).toContain('detail.lifecycle === "OFFERED"');
    expect(orders).toContain("client.confirmCooperation(detail.orderId)");
    expect(orders).toContain('detail.lifecycle === "CONFIRMED"');
    expect(orders).toContain("client.checkInOrder(detail.orderId");
    expect(orders).toContain('detail.lifecycle === "EXECUTING"');
    expect(orders).toContain("pickOutcomePhoto()");
    expect(orders).toContain("submitCompletion(detail.orderId, detail.lifecycle)");
    expect(orders).toContain("client.recordOutcome(orderId");
    expect(orders).toContain("client.recordSatisfaction(detail.orderId");
  });

  it("arrival follows the consumption scenario, not a generic start", () => {
    // PRD Ch11：到场是信任锚（agent 到场举证，requester 可确认到场），
    // 开工是另一个节拍。UI 只给出场这一条路，不摆两条。
    expect(orders).toContain('accessibilityLabel="确认到场"');
    expect(orders).not.toContain('accessibilityLabel="开始执行"');
    expect(orders).toContain("client.recordOutcome(orderId");
  });

  it("flow tiers by amount: small orders skip arrival and settlement forms", () => {
    // ORDER-TIER-001：小单步骤多就是阻碍。500K 以下短流程（确认→完成→评价），
    // 到场/结算表单不出现；服务端强制过 EXECUTING，小单点确认完成时自动先开工。
    expect(orders).toContain("SMALL_ORDER_AMOUNT_VND = 500_000");
    expect(orders).toContain("isSmallOrder");
    expect(orders).toContain('detail.lifecycle === "CONFIRMED" && !isSmallOrder');
    expect(orders).toContain("isSmallOrder && detail.lifecycle === \"CONFIRMED\"");
    expect(orders).toContain("!isSmallOrder");
  });

  it("satisfaction is requester-only and settlement is DIRECT-only", () => {
    expect(orders).toContain('detail.lifecycle === "COMPLETED" && detail.viewerRole === "REQUESTER"');
    expect(orders).toContain('detail.snapshot.settlementMode === "DIRECT_SETTLEMENT"');
    expect(orders).toContain("client.recordSettlement(detail.orderId");
  });

  it("evidence needs a real photo pipeline, not a fake button", () => {
    expect(orders).toContain("mediaClient?: MediaClient | undefined");
    expect(orders).toContain("mediaClient.uploadImage(");
    const me = readFileSync(new URL("./surfaces/me.tsx", import.meta.url), "utf8");
    expect(me).toContain("<MyOrdersSurface client={fulfillment} moderation={moderation} mediaClient={mediaClient}");
  });

  it("server rejections translate to human words via one translator", () => {
    expect(orders).toContain("humanOrderError(");
    expect(orders).toContain("只有需求方能评价");
    expect(orders).toContain("当前状态不能做这个操作");
    // 拒绝码只允许出现在翻译器内部（匹配用），不允许直接上屏。
    const withoutTranslator = orders.replace(/function humanOrderError[\s\S]*?\n  \}/, "");
    expect(withoutTranslator).not.toMatch(/NOT_CHECKINABLE|NOT_EXECUTABLE|NOT_COMPLETED|ONLY_REQUESTER_RATES/);
  });
});
