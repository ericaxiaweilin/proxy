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
    expect(orders).toContain("client.startExecution(detail.orderId)");
    expect(orders).toContain('detail.lifecycle === "EXECUTING"');
    expect(orders).toContain("pickOutcomePhoto()");
    expect(orders).toContain("submitCompletion(detail.orderId)");
    expect(orders).toContain("client.recordOutcome(orderId");
    expect(orders).toContain("client.recordSatisfaction(detail.orderId");
  });

  it("stays lean: one path per transition, evidence folds into completion", () => {
    // 打卡跟开始执行是同一个状态跃迁，只留一键；证据并进确认完成（可选照片）。
    expect(orders).not.toContain("checkinMarket");
    expect(orders).not.toContain('accessibilityLabel="到场打卡"');
    expect(orders).not.toContain("submitEvidencePhoto(");
    expect(orders).not.toContain("记录结果并完成");
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
