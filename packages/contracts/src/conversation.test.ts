import { describe, expect, it } from "vitest";
import { AssistantStatusSchema, parseAssistantStatus } from "./conversation";

// COMP-AI-MINOR-001（聊天侧）：五个状态必须各是一个值。
// 这条测的是「别把 GATED 并进 FAILED/UNAVAILABLE」这个决定本身 ——
// 一旦有人为了省事把 GATED 从枚举里删掉，这里立刻红。
describe("AssistantStatusSchema", () => {
  it("keeps GATED as its own status, not folded into FAILED or UNAVAILABLE", () => {
    expect(AssistantStatusSchema.safeParse("GATED").success).toBe(true);
    expect(AssistantStatusSchema.safeParse("FAILED").success).toBe(true);
    expect(AssistantStatusSchema.safeParse("UNAVAILABLE").success).toBe(true);
    expect(AssistantStatusSchema.safeParse("RESPONDED").success).toBe(true);
    expect(AssistantStatusSchema.safeParse("NOT_REQUESTED").success).toBe(true);
  });

  it("rejects an unknown status instead of guessing one", () => {
    expect(AssistantStatusSchema.safeParse("MINOR_BLOCKED").success).toBe(false);
    expect(AssistantStatusSchema.safeParse("").success).toBe(false);
    expect(AssistantStatusSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("parseAssistantStatus", () => {
  it("narrows the wire value the server actually sends", () => {
    expect(parseAssistantStatus("GATED")).toBe("GATED");
    expect(parseAssistantStatus("RESPONDED")).toBe("RESPONDED");
  });

  it("returns undefined for anything unknown, so a future status renders as silence rather than a wrong error", () => {
    expect(parseAssistantStatus("SOMETHING_NEW")).toBeUndefined();
    expect(parseAssistantStatus(undefined)).toBeUndefined();
    expect(parseAssistantStatus(42)).toBeUndefined();
    expect(parseAssistantStatus({ status: "GATED" })).toBeUndefined();
  });
});
