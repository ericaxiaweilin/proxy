import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ORDER-FLOW-COPY-001（2026-09-29，用户：「下单接单的流程 还有页面很多废话 一起修改优化」）。
// 下单 / 接单 / 订单页上的说明文字有三类问题，这里逐类钉住不许回来：
//   1. 开发口吻印给用户（「报价 UI 不在这屏」「活动读模型」「来自 fulfillment 真实读模型」）；
//   2. 复述页面上已经有的东西（价格条已有区间，又开一个盒子解释区间；发布页两处重复解释 100,000 保底）；
//   3. 不真实或空的说明（「平台托管付款」对线下结算单是错的；「还没有评估」的空盒）。
// 只看会渲染给用户的代码：去掉 /* */ 与整行 // 注释（注释里可以解释为什么删掉某句话）。
const source = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("ORDER-FLOW-COPY-001 filler and dev-speak stay out of the order flow", () => {
  const market = source("./surfaces/market.tsx");
  const orders = source("./surfaces/me-orders.tsx");
  const execution = source("./surfaces/order-execution.tsx");
  const quote = source("./surfaces/opportunity-quote-sheet.tsx");

  it("opportunity detail / publish / select pages carry no dev-speak or restated copy", () => {
    for (const filler of [
      "不让详情页同时承担", "平台托管付款", "CREATE DEMAND", "预览小美视角", "申请制，不把任何人直接上架",
      "活动读模型", "本人确认合作", "低于 100,000 VND 不能发布", "价格只属于这次需求", "AI 助理不能代确认",
      "偏好环境仅用于匹配", "接单需要实名 + 证件",
    ]) expect(market, filler).not.toContain(filler);
  });

  it("the recommendation box is only drawn when there is a real reason", () => {
    expect(market).toContain("{whyRows.length > 0 ? (");
    expect(market).not.toContain("为什么推荐给你");
  });

  it("my-orders states things once, in people-language", () => {
    for (const filler of ["订单编号是订单全生命周期", "按约完成率只算", "准时和范围如实勾选", "取消后不可恢复"]) expect(orders, filler).not.toContain(filler);
    // 结算方式走 settlementLabel，不把枚举印出来。
    expect(orders).toContain("settlementLabel(order.snapshot.settlementMode)");
    expect(orders).not.toMatch(/\["结算", order\.snapshot\.settlementMode/);
    expect(execution).toContain("settlementLabel(detail.snapshot.settlementMode)");
  });

  it("check-in is one field and one tap (the meeting place doubles as the market id)", () => {
    expect(orders).not.toContain("checkinMarket");
    expect(orders).toContain("marketId: checkinPlace.trim()");
  });

  it("the legacy execution page shows the order number, not an id fragment or a dev subtitle", () => {
    expect(execution).not.toContain("orderId.slice(0, 8)");
    expect(execution).not.toContain("真实读模型");
    expect(execution).toContain("detail.orderNo || detail.orderId");
  });

  it("the quote sheet is header, what/when/where, optional range, input, presets, submit", () => {
    for (const filler of ["为这一类订单提交你的报价", "你的报价是私密的", "参考区间只供你锚定", "当前参考区间"]) expect(quote, filler).not.toContain(filler);
    expect(quote).toContain("提交报价");
  });
});
