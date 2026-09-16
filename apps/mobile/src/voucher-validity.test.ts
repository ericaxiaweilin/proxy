import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultVoucherValidity } from "./voucher-validity.js";

describe("defaultVoucherValidity", () => {
  it("starts today and ends 30 days later", () => {
    const v = defaultVoucherValidity(new Date(2026, 8, 7, 15, 30));
    expect(v.validFrom).toBe("2026-09-07");
    expect(v.validUntil).toBe("2026-10-07");
    expect(v.fromLabel).toBe("2026/09/07");
    expect(v.untilLabel).toBe("2026/10/07");
  });
  it("rolls over month boundaries", () => {
    const v = defaultVoucherValidity(new Date(2026, 0, 31));
    expect(v.validFrom).toBe("2026-01-31");
    expect(v.validUntil).toBe("2026-03-02");
  });
  it("never produces a hardcoded 2026-08 window", () => {
    const v = defaultVoucherValidity(new Date());
    expect(v.validFrom).not.toBe("2026-08-21");
    expect(v.validUntil).not.toBe("2026-08-31");
    expect(Date.parse(v.validUntil)).toBeGreaterThan(Date.parse(v.validFrom));
  });
});

// VOUCHER-SETTLEMENT-FAKE-STATE-001: 结算页以前在服务端没返回状态时**预填三条**，
// 其中第一条是「已核销 · 完成」，副标题还写着消费已被商家确认。于是一张根本没核销
// 过的券被渲染成已核销完成 —— 没有数据却渲染成了成功。
describe("VOUCHER-SETTLEMENT-FAKE-STATE-001", () => {
  const source = readFileSync(fileURLToPath(new URL("./surfaces/voucher.tsx", import.meta.url)), "utf8");

  it("never pre-fills settlement states the server did not return", () => {
    // 反向钉：那三条预填状态不许回来（注意钉的是字面量写法，
    // 渲染分支里的 `status === "COMPLETED"` 是另一回事）。
    expect(source).not.toContain('status:"COMPLETED"');
    expect(source).not.toContain('status:"CHECKING"');
    // 正向：没有记录就走空态。
    expect(source).toContain("states.length ?");
    expect(source).toContain("还没有核销与结算记录");
  });

  it("does not offer a redemption result for a voucher that was never redeemed", () => {
    // 以前只要不是 REDEEMED 就给「查看核销结果」，而那一屏写的是核销成功 ——
    // 一张 EXPIRED 的券点进去也会看到「核销成功」。
    expect(source).toContain('selected.status === "SETTLED" ? <Pressable');
    expect(source).toContain("这张礼券没有核销结果");
  });
});
