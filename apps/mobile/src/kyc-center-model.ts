// kyc-center-model.ts — 接单中心纯逻辑（KYC-CENTER-001）。
//
// 独立成纯 TS：单测跑在纯 node，直接拉 tsx 会把 react-native 的 flow 语法
// 喂给 rollup 炸掉（TWIN-INSIGHT-AVATAR-001 同一个坑）。
import type { AgentPassport } from "./supply-client";
import type { ProviderApplicationStatus } from "./provider-application-client";

/** 首页 CTA 路由（纯函数）：KYC 状态 → 文案 + 去向。 */
export function kycHomeAction(
  status: ProviderApplicationStatus | undefined,
): { label: string; view: "form" | "progress" | "trust" } {
  switch (status) {
    case "APPROVED":
      return { label: "查看", view: "trust" };
    case "SUBMITTED":
      return { label: "查看进度", view: "progress" };
    case "REJECTED":
      return { label: "重试", view: "form" };
    default:
      return { label: "开始", view: "form" };
  }
}

export type SkillRow = {
  capability: string;
  state: "verified" | "reviewing" | "declared";
  detail: string;
};

/** 能力行映射（纯函数）：verified 优先；有 PENDING 核验 → 审核中；其余已声明。
 * 不分组编类目 —— 服务端能力名是自由串，分组即编造。 */
export function capabilityRows(passport: AgentPassport | undefined): SkillRow[] {
  if (!passport) return [];
  return passport.capabilities.map((item) => {
    if (item.verified) {
      return { capability: item.capability, state: "verified" as const, detail: "已通过平台验证" };
    }
    const pending = passport.verifications.some(
      (v) => v.capability === item.capability && v.status === "PENDING",
    );
    if (pending) {
      return { capability: item.capability, state: "reviewing" as const, detail: "核验中" };
    }
    return { capability: item.capability, state: "declared" as const, detail: "已声明，待验证" };
  });
}
