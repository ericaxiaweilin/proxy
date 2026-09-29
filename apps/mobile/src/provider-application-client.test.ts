import { describe, expect, it } from "vitest";
import {
  ProviderApplicationError, fetchProviderApplication, formatPhoneInput, phoneDigitsError, providerApplicationErrorText, providerApplicationFieldErrors,
  providerApplicationStatusCard, type ProviderApplication,
} from "./provider-application-client";

const base: ProviderApplication = {
  applicationId: "papp_1", displayName: "Linh", phoneVerified: false, city: "河内", serviceAreas: ["hn"], languages: ["VI"], capabilities: [],
  intro: "hello", photoAssetIds: [], status: "SUBMITTED", source: "APP", createdAt: "2026-09-24T00:00:00Z",
};

describe("PROVIDER-APPLY-001 client", () => {
  it("maps every invalid field to plain words", () => {
    expect(providerApplicationFieldErrors(["profile_avatar", "phone_not_verified"])).toEqual(["先在「个人管理」设置头像", "请先验证手机号（获取验证码并输入正确的码）"]);
    expect(providerApplicationFieldErrors(["something_new"])).toEqual(["有信息不合格，请检查后再提交"]);
    expect(providerApplicationErrorText(new ProviderApplicationError("invalid_fields", ["real_name", "birth_date"]))).toBe("请填写 2–40 字的真实姓名；出生日期不对（格式 2001-05-20，需年满 18 岁）");
    expect(providerApplicationErrorText(new Error("x"))).toBe("暂时没连上服务，稍后再试。");
  });

  it("status card per state; withdrawn or none shows the form", () => {
    expect(providerApplicationStatusCard(null)).toBeNull();
    expect(providerApplicationStatusCard({ ...base, status: "WITHDRAWN" })).toBeNull();
    expect(providerApplicationStatusCard(base)?.canWithdraw).toBe(true);
    expect(providerApplicationStatusCard({ ...base, status: "REJECTED", rejectReason: "照片太暗" })).toMatchObject({ detail: "原因：照片太暗", canReapply: true });
    expect(providerApplicationStatusCard({ ...base, status: "APPROVED", source: "BACKFILL" })?.detail).toContain("补录");
  });

  it("phone digits: VN local 10 or +84 plus 9, nothing else", () => {
    expect(phoneDigitsError("")).toBe("请填写手机号");
    expect(phoneDigitsError("0912345678")).toBeUndefined();
    expect(phoneDigitsError("0912 345 678")).toBeUndefined();
    expect(phoneDigitsError("+84 912 345 678")).toBeUndefined();
    expect(phoneDigitsError("091234567")).toBe("手机号填 10 位，以 0 开头");
    expect(phoneDigitsError("1912345678")).toBe("手机号填 10 位，以 0 开头");
    expect(phoneDigitsError("+84 912 345 67")).toBe("越南手机号是 +84 开头，后面 9 位");
    expect(phoneDigitsError("+86 1312345678")).toBe("越南手机号是 +84 开头，后面 9 位");
  });

  it("phone input auto-groups digits", () => {
    expect(formatPhoneInput("0912345678")).toBe("0912 345 678");
    expect(formatPhoneInput("0912")).toBe("0912");
    expect(formatPhoneInput("+84912345678")).toBe("+84 912 345 678");
    expect(formatPhoneInput("0912-345-678")).toBe("0912 345 678");
    expect(formatPhoneInput("091234567890")).toBe("0912 345 678");
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

describe("KYC-PHONE-ONLY-001 phone verification client", () => {
  it("requests a challenge and reports server-side rejection with the right code", async () => {
    const { requestPhoneVerification, verifyPhoneVerification } = await import("./provider-application-client");
    const ok = { request: async () => ({ status: 200, json: async () => ({ challengeId: "pphc_1", expiresAt: "2026-09-27T12:00:00Z" }) }) };
    expect(await requestPhoneVerification(ok, "0912345678")).toEqual({ challengeId: "pphc_1", expiresAt: "2026-09-27T12:00:00Z" });
    const verified = { request: async () => ({ status: 200, json: async () => ({ verified: true, phone: "+84912345678" }) }) };
    expect(await verifyPhoneVerification(verified, "pphc_1", "123456")).toBe(true);
    const rejected = { request: async () => ({ status: 422, json: async () => ({ error: "phone_challenge_invalid" }) }) };
    await expect(verifyPhoneVerification(rejected, "pphc_1", "000000")).rejects.toMatchObject({ code: "phone_challenge_invalid" });
    expect(providerApplicationErrorText(new ProviderApplicationError("phone_challenge_invalid"))).toBe("验证码错误或已过期，请重新获取。");
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

describe("ORDER-PERMISSION-KYC-003 review pipeline", () => {
  it("lists only steps that really happen, and follows the status", async () => {
    const { kycPipeline } = await import("./provider-application-client");
    const titles = kycPipeline(null).map((step) => step.title);
    expect(titles).toEqual(["资料提交", "运营审核", "KYC 通过"]);
    expect(titles.join()).not.toMatch(/Face ID|自动比对/);
    // KYC-PHONE-ONLY-001：审核步骤描述的是手机验证 + 声明，不再提证件/自拍比对。
    expect(kycPipeline(null).map((step) => step.hint).join()).not.toMatch(/证件|自拍|身份证/);
    expect(kycPipeline({ ...base, status: "SUBMITTED" }).map((step) => step.state)).toEqual(["done", "active", "pending"]);
    expect(kycPipeline({ ...base, status: "REJECTED" })[2]?.state).toBe("failed");
  });
});
