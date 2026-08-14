import { describe, expect, it } from "vitest";
import { buildTaskDraftChanges, createInitialNeedForm, describeNeed, validateNeedForm } from "./requester-experience";

describe("requester experience form contract", () => {
  it("translates a human need into the canonical demand payload", () => {
    const form = {
      ...createInitialNeedForm(new Date("2026-08-14T00:00:00Z")),
      sourceInput: "需要两位现场人员接待来宾并维持签到秩序",
      location: "District 1 venue",
      quantity: "2",
      budget: "120"
    };
    expect(validateNeedForm(form)).toEqual({});
    const changes = buildTaskDraftChanges(form);
    expect(changes.slotGroups).toEqual([{ roleId: "EVENT_ASSISTANT", quantity: 2, mustCapabilities: [] }]);
    expect(changes.budget?.amountMinor).toBe(12_000);
    expect(changes.confirmation).toBeUndefined();
    expect(describeNeed(form)).toContain("2 人");
  });

  it("requires explicit publish confirmation only at the confirmation step", () => {
    const form = {
      ...createInitialNeedForm(new Date("2026-08-14T00:00:00Z")),
      sourceInput: "需要一位现场人员协助活动执行",
      location: "District 1 venue"
    };
    const changes = buildTaskDraftChanges(form, {
      scopeConfirmed: true,
      materialChangePolicyConfirmed: true,
      fundingAuthorizationConfirmed: true,
      maxBudgetMinor: 8_000
    });
    expect(changes.confirmation?.fundingAuthorizationConfirmed).toBe(true);
    expect(changes.draftProgress).toBe(100);
  });

  it("rejects an invalid time range and vague intent", () => {
    const form = { ...createInitialNeedForm(), sourceInput: "帮忙", location: "A", startTime: "12:00", endTime: "09:00" };
    expect(validateNeedForm(form)).toMatchObject({ sourceInput: expect.any(String), location: expect.any(String), timeRange: expect.any(String) });
  });
});
