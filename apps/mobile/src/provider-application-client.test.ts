import { describe, expect, it } from "vitest";
import {
  ProviderApplicationError, fetchProviderApplication, providerApplicationErrorText, providerApplicationFieldErrors,
  providerApplicationStatusCard, type ProviderApplication,
} from "./provider-application-client";

const base: ProviderApplication = {
  applicationId: "papp_1", displayName: "Linh", phoneVerified: false, city: "河内", serviceAreas: ["hn"], languages: ["VI"], capabilities: [],
  intro: "hello", photoAssetIds: [], status: "SUBMITTED", source: "APP", createdAt: "2026-09-24T00:00:00Z",
};

describe("PROVIDER-APPLY-001 client", () => {
  it("maps every invalid field to plain words", () => {
    expect(providerApplicationFieldErrors(["profile_avatar", "selfie"])).toEqual(["先在「个人管理」设置头像", "请上传手持证件的自拍"]);
    expect(providerApplicationFieldErrors(["something_new"])).toEqual(["有信息不合格，请检查后再提交"]);
    expect(providerApplicationErrorText(new ProviderApplicationError("invalid_fields", ["real_name", "birth_year"]))).toBe("请填写 2–40 字的真实姓名；出生年份不对（需年满 18 岁）");
    expect(providerApplicationErrorText(new Error("x"))).toBe("暂时没连上服务，稍后再试。");
  });

  it("status card per state; withdrawn or none shows the form", () => {
    expect(providerApplicationStatusCard(null)).toBeNull();
    expect(providerApplicationStatusCard({ ...base, status: "WITHDRAWN" })).toBeNull();
    expect(providerApplicationStatusCard(base)?.canWithdraw).toBe(true);
    expect(providerApplicationStatusCard({ ...base, status: "REJECTED", rejectReason: "照片太暗" })).toMatchObject({ detail: "原因：照片太暗", canReapply: true });
    expect(providerApplicationStatusCard({ ...base, status: "APPROVED", source: "BACKFILL" })?.detail).toContain("补录");
  });

  it("reads null application and server errors with fields", async () => {
    const ok = { request: async () => ({ status: 200, json: async () => ({ application: null, options: { languages: ["VI"] } }) }) };
    const view = await fetchProviderApplication(ok);
    expect(view.application).toBeNull();
    expect(view.options.minAge).toBe(18);
    expect(view.terms).toBeNull();
    const bad = { request: async () => ({ status: 422, json: async () => ({ error: "invalid_fields", fields: ["city"] }) }) };
    await expect(fetchProviderApplication(bad)).rejects.toMatchObject({ code: "invalid_fields", fields: ["city"] });
  });
});

describe("ORDER-CENTER-STATS-001 order panel", () => {
  it("rates render as — without a denominator, never a fake 0% or 100%", async () => {
    const { formatRate, permissionLine, fetchProviderStats } = await import("./provider-application-client");
    expect(formatRate(null)).toBe("—");
    expect(formatRate(0.756)).toBe("76%");
    expect(permissionLine("APPROVED")).toEqual({ text: "已认证 · 可接单", canApply: false });
    expect(permissionLine("NONE").canApply).toBe(true);
    const ok = { request: async () => ({ status: 200, json: async () => ({ permission: "SUBMITTED", stats: { completed: 0, cancelledByMe: 0, onTime: 0, completionRate: null, onTimeRate: null, repeatClients: 0, complaints: 0, openComplaints: 0 } }) }) };
    expect((await fetchProviderStats(ok)).permission).toBe("SUBMITTED");
  });
});
