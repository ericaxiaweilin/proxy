import { describe, expect, it } from "vitest";
import { formatClaimNumber } from "../claim-number";

// AGENT-CLAIM-NUMBER-001: 接单编号展示口径。编号由服务端注册时顺序分配
// （1 起、无跳号），客户端只负责展示：至少 3 位零填充；未分配一律空串，
// 调用方整行隐藏，不画“--”也不画 0。
describe("AGENT-CLAIM-NUMBER-001 formatClaimNumber", () => {
  it("pads to at least 3 digits", () => {
    expect(formatClaimNumber(1)).toBe("001");
    expect(formatClaimNumber(9)).toBe("009");
    expect(formatClaimNumber(12)).toBe("012");
    expect(formatClaimNumber(100)).toBe("100");
    expect(formatClaimNumber(1000)).toBe("1000");
    expect(formatClaimNumber(10000000)).toBe("10000000");
  });

  it("returns empty for unallocated or out-of-range input", () => {
    expect(formatClaimNumber(0)).toBe("");
    expect(formatClaimNumber(-3)).toBe("");
    expect(formatClaimNumber(10000001)).toBe("");
    expect(formatClaimNumber(1.5)).toBe("");
    expect(formatClaimNumber(undefined)).toBe("");
    expect(formatClaimNumber(null)).toBe("");
    expect(formatClaimNumber("12")).toBe("");
    expect(formatClaimNumber(Number.NaN)).toBe("");
  });
});
