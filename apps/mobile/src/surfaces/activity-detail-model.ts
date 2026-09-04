import type { Activity } from "@proxy/contracts";

export function activityMoneySummary(activity: Pick<Activity, "price" | "priceLabel">): string {
  return `${activity.priceLabel} · ${activity.price}`;
}

export function activityAIDisclosure(activity: Pick<Activity, "aiStatus" | "aiActorKind" | "aiPersonaName">): string | undefined {
  if (activity.aiStatus === "NONE") return undefined;
  const assistant = activity.aiPersonaName ?? (activity.aiActorKind === "PLATFORM_AI" ? "平台 AI 小美" : "AI 助理");
  if (activity.aiStatus === "AI_GENERATED") return `${assistant}生成 · 发布方审核并承担责任 · AI 不能报名、接单或收付款`;
  return `${assistant}辅助整理 · 发布方承担责任`;
}
