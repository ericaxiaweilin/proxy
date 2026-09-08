import { describe, expect, it } from "vitest";
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
