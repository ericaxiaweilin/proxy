import type { Activity } from "@proxy/contracts";

export function activityMoneySummary(activity: Pick<Activity, "price" | "priceLabel">): string {
  return `${activity.priceLabel} · ${activity.price}`;
}

// AI 标注的**归属名** —— activity 面上唯一来源。
//
// 契约的承诺（packages/contracts/src/index.ts 的 ActivitySchema 注释）：
//   「aiStatus != NONE 时客户端**必**显示 AI 标注 + persona 头像 + 名字」。
// 注意主语：必显示的是**标注**；persona 三件是补充信息，schema 里是
// `z.string().min(1).optional()` —— wire 允许缺名字（服务端 `omitempty`）。
// 所以标注**不能**挂在名字上：名字一缺，标注就整块消失，界面把 AI 生成的内容
// 当成人做的呈现。那正是 2026-09-21 修掉的那个形状。
//
// 名字缺省时的兜底只做**事实级**归因，不编造具体 persona：
//   PLATFORM_AI → 「平台 AI 小美」（平台 AI 角色，assets/ai-personas/INDEX.md）
//   USER_TWIN   → 「用户分身」（是**本人**的分身，不是平台的人）
//   其余/未知    → 「AI 助理」（中性，不指认任何具体角色）
export function activityAIPersonaName(activity: Pick<Activity, "aiActorKind" | "aiPersonaName">): string {
  if (activity.aiPersonaName) return activity.aiPersonaName;
  switch (activity.aiActorKind) {
    case "PLATFORM_AI":
      return "平台 AI 小美";
    case "USER_TWIN":
      return "用户分身";
    default:
      return "AI 助理";
  }
}

export function activityAIDisclosure(activity: Pick<Activity, "aiStatus" | "aiActorKind" | "aiPersonaName">): string | undefined {
  if (activity.aiStatus === "NONE") return undefined;
  const assistant = activityAIPersonaName(activity);
  if (activity.aiStatus === "AI_GENERATED") return `${assistant}生成 · 发布方审核并承担责任 · AI 不能报名、接单或收付款`;
  return `${assistant}辅助整理 · 发布方承担责任`;
}
