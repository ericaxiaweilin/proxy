import { describe, expect, it } from "vitest";
import { CommandEnvelopeSchema } from "./index.js";

describe("command envelope", () => {
  it("rejects a command without idempotency", () => {
    const result = CommandEnvelopeSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts a canonical command envelope", () => {
    const result = CommandEnvelopeSchema.safeParse({
      commandId: "cmd_001",
      commandType: "FinalizeObservationSet",
      commandVersion: 1,
      actor: { type: "USER", id: "user_001" },
      principal: { type: "BUSINESS", id: "business_001" },
      target: { type: "ObservationSet", id: "obsset_001" },
      idempotencyKey: "idem_obsset_001",
      authContext: { sessionId: "session_001" },
      purpose: "outcome_observation",
      correlationId: "corr_001",
      requestedAt: "2026-08-14T00:00:00.000Z",
      payload: {}
    });
    expect(result.success).toBe(true);
  });
});
