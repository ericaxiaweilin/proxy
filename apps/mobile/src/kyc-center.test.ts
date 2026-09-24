import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { capabilityRows, kycHomeAction } from "./kyc-center-model";

// KYC-CENTER-001 —— 接单中心（原型 deepseek_html_20260924_807348「接单中心 ·
// KYC + 履约流程」）。首页/进度/履约安全三段的数字全部来自真接口；
// 没有数据源的原型字段（Face ID 比对、短信验证码、24h 时效、评分、热榜、
// 出图墙、N 位出图）一律不做，行为断言 + 源码钉双保险。
describe("KYC-CENTER-001 home CTA follows the real application state", () => {
  it("routes each KYC state to the right screen", () => {
    expect(kycHomeAction(undefined)).toEqual({ label: "开始", view: "form" });
    expect(kycHomeAction("SUBMITTED")).toEqual({ label: "查看进度", view: "progress" });
    expect(kycHomeAction("APPROVED")).toEqual({ label: "查看", view: "trust" });
    expect(kycHomeAction("REJECTED")).toEqual({ label: "重试", view: "form" });
    expect(kycHomeAction("WITHDRAWN")).toEqual({ label: "开始", view: "form" });
  });

  it("maps passport capabilities to honest states without inventing groups", () => {
    expect(capabilityRows(undefined)).toEqual([]);
    const rows = capabilityRows({
      profile: { agentId: "a", name: "", bio: "", languages: [], serviceAreas: [], status: "" },
      capabilities: [
        { capability: "中文沟通", declared: true, verified: true },
        { capability: "摄影", declared: true, verified: false },
      ],
      verifications: [{ id: "v1", capability: "摄影", status: "PENDING" }],
      availability: [],
    });
    expect(rows).toEqual([
      { capability: "中文沟通", state: "verified", detail: "已通过平台验证" },
      { capability: "摄影", state: "reviewing", detail: "核验中" },
    ]);
  });
});

describe("KYC-CENTER-001 screens read live data, never demo values", () => {
  const center = readFileSync(new URL("./surfaces/kyc-center.tsx", import.meta.url), "utf8");

  it("home/trust read stats, passport and application from the session backend", () => {
    expect(center).toContain("fetchProviderApplication(sessionAuthClient)");
    expect(center).toContain("fetchProviderStats(sessionAuthClient)");
    expect(center).toContain("getAgentPassport()");
    expect(center).toContain("formatRate(");
  });

  it("progress polls only while submitted and stops on terminal states", () => {
    expect(center).toContain('if (view !== "progress") return;');
    expect(center).toContain('appView?.application?.status !== "SUBMITTED"');
    expect(center).toContain("}, 5000);");
  });

  it("does not ship the prototype's unfunded promises", () => {
    const code = center.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/Face ID|faceId|FaceId/);
    expect(code).not.toMatch(/24 小时|24小时/);
    expect(code).not.toMatch(/自动比对|自动通道/);
    expect(code).not.toMatch(/1234|任意 4 位/);
  });

  it("unknown states render dashes or honest errors, never zeros", () => {
    expect(center).toContain('"—"');
    expect(center).toContain("inlineError");
  });
});
