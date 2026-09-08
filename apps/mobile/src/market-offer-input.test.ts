import { describe, expect, it } from "vitest";
import { buildSlotOfferInput } from "./market-fixtures.js";

describe("buildSlotOfferInput (real-applicant fast offer)", () => {
  it("builds input from a real applicant id and formatted amount", () => {
    const r = buildSlotOfferInput("opp_1", "user_002", "1,200,000₫");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toEqual({
      taskId: "opp_1",
      slotId: "opp_1_slot_1",
      agentId: "user_002",
      agreedCompensation: 1200000
    });
  });
  it("accepts a plain digit amount", () => {
    const r = buildSlotOfferInput("opp_1", "user_002", "500000");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.agreedCompensation).toBe(500000);
  });
  it("rejects empty amount", () => {
    const r = buildSlotOfferInput("opp_1", "user_002", "");
    expect(r.ok).toBe(false);
  });
  it("rejects zero amount", () => {
    const r = buildSlotOfferInput("opp_1", "user_002", "0₫");
    expect(r.ok).toBe(false);
  });
  it("rejects missing applicant id (no hardcoded demo agent)", () => {
    expect(buildSlotOfferInput("opp_1", "", "1200000").ok).toBe(false);
    expect(buildSlotOfferInput("opp_1", "   ", "1200000").ok).toBe(false);
  });
  it("rejects missing task id", () => {
    expect(buildSlotOfferInput("", "user_002", "1200000").ok).toBe(false);
  });
  it("rejects amounts below the 100,000 VND opportunity floor", () => {
    expect(buildSlotOfferInput("opp_1", "user_002", "99,999").ok).toBe(false);
    expect(buildSlotOfferInput("opp_1", "user_002", "50,000₫").ok).toBe(false);
  });
  it("accepts the 100,000 VND floor boundary", () => {
    const r = buildSlotOfferInput("opp_1", "user_002", "100,000");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.agreedCompensation).toBe(100_000);
  });
  it("accepts the 10M VND ceiling boundary and rejects above it", () => {
    expect(buildSlotOfferInput("opp_1", "user_002", "10000000").ok).toBe(true);
    expect(buildSlotOfferInput("opp_1", "user_002", "10000001").ok).toBe(false);
  });
});
