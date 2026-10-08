// NEXT-STEPS-001（2026-10-08）：服务端 GetNextSteps 的读模型 + 目标 → App 内目的地。
//
// 两件事都在这个纯模块里，界面只消费结果：
//
//   parseNextSteps —— fail-closed 解析。形状不对就**抛**，调用方 catch 之后什么都不显示。
//     引导卡是这个产品里最容易变成半句话的地方（标题在、原因在、按钮点不动），
//     宁可没有这张卡，也不要一张说了一半的卡。
//
//   targetToRoute —— 服务端只给 target 标识，不给 App 内部路由
//     （apps/api-go/internal/guidance/guidance.go 开头就是这么写的）。这里只登记
//     **真的有那一页**的落点；登记不了的返回 undefined，调用方就不画那一步。硬塞一个
//     「看起来差不多」的页面就是编目的地 —— NOTIF-DEEPLINK-ROUTE-001 的同一条道理。
import type { MarketTab } from "./market-fixtures";

/** 服务端认识的四种引导目标（apps/api-go/internal/guidance/guidance.go）。 */
export const NEXT_STEP_TARGETS = ["EDIT_PROFILE", "COMPOSE_POST", "PUBLISH_DEMAND", "BROWSE_ACTIVITIES"] as const;

export type NextStepTarget = (typeof NEXT_STEP_TARGETS)[number];

/** 一步引导。title / reason 是**服务端**下发的内容，不是界面文案，所以不进字典。 */
export type NextStep = {
  id: string;
  title: string;
  reason: string;
  target: string;
  done: boolean;
};

export type NextSteps = {
  steps: ReadonlyArray<NextStep>;
  next: NextStep | null;
  doneCount: number;
  total: number;
};

export class NextStepsProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NextStepsProtocolError";
  }
}

export function isNextStepTarget(value: unknown): value is NextStepTarget {
  return typeof value === "string" && (NEXT_STEP_TARGETS as ReadonlyArray<string>).includes(value);
}

/**
 * 「我的 → 个人管理」子页（me.tsx 里那一屏有「编辑资料」按钮，进去就是编辑器）。
 * 引导的 EDIT_PROFILE 落点就是它 —— 页面早就存在，这里只是登记它。
 */
export const PROFILE_EDIT_ROUTE = "personalmanage";

/**
 * App 内真实存在的落点。三个 kind 对应三条已有的导航，不是新的路由系统：
 *   feed     → 动态 tab（发帖按钮与发布器就在那一屏）
 *   market   → 市场 tab 的某一页（发布需求向导在 OPPORTUNITY，活动列表在 ACTIVITY）
 *   meSubPage→ 「我的」里的某个子页
 */
export type NextStepDestination =
  | { kind: "feed" }
  | { kind: "market"; tab: MarketTab }
  | { kind: "meSubPage"; route: string };

/**
 * target → 落点。**没有对应页面时返回 undefined**，调用方必须自己决定「没有这一页
 * 怎么办」，不能拿一个空串路由去跳。
 */
export function targetToRoute(target: string): NextStepDestination | undefined {
  switch (target) {
    case "EDIT_PROFILE":
      return { kind: "meSubPage", route: PROFILE_EDIT_ROUTE };
    case "COMPOSE_POST":
      return { kind: "feed" };
    case "PUBLISH_DEMAND":
      return { kind: "market", tab: "OPPORTUNITY" };
    case "BROWSE_ACTIVITIES":
      return { kind: "market", tab: "ACTIVITY" };
    default:
      return undefined;
  }
}

function parseStep(value: unknown, where: string): NextStep {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NextStepsProtocolError(`${where} 不是对象`);
  }
  const item = value as Record<string, unknown>;
  const id = item.id;
  const title = item.title;
  const reason = item.reason;
  const target = item.target;
  const done = item.done;
  // id / title / target 空串与缺字段同义：空串 id 会让「按 id 去重」失效，
  // 空 target 则没有落点 —— 两种都当协议异常，而不是「有就先用着」。
  if (typeof id !== "string" || id.trim() === "") throw new NextStepsProtocolError(`${where}.id 缺失`);
  if (typeof title !== "string" || title.trim() === "") throw new NextStepsProtocolError(`${where}.title 缺失`);
  if (typeof reason !== "string") throw new NextStepsProtocolError(`${where}.reason 缺失`);
  if (typeof target !== "string" || target.trim() === "") throw new NextStepsProtocolError(`${where}.target 缺失`);
  if (typeof done !== "boolean") throw new NextStepsProtocolError(`${where}.done 缺失`);
  // target 不在已知四种里**不抛**：那是「服务端加了一步 App 还没学会跳」，落点由
  // targetToRoute 决定（返回 undefined ⇒ 那一步不画）。抛在这里会把**整个**读模型
  // 丢掉，包括那三步本来就跳得动的。
  return { id, title, reason, target, done };
}

/**
 * GetNextSteps 的 operationRef body → 读模型。
 *
 * fail-closed：`steps` 必须是数组（空是 `[]`，`null` 是协议异常 —— 空集合与读不出来
 * 必须能区分），`doneCount` / `total` 必须是有限数，`next` 为 null 或一个合法步骤。
 */
export function parseNextSteps(body: unknown): NextSteps {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NextStepsProtocolError("next steps 响应不是对象");
  }
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.steps)) throw new NextStepsProtocolError("next steps 响应缺少 steps 数组");
  const steps = raw.steps.map((entry, index) => parseStep(entry, `steps[${index}]`));
  const next = raw.next === undefined || raw.next === null ? null : parseStep(raw.next, "next");
  const doneCount = raw.doneCount;
  const total = raw.total;
  if (typeof doneCount !== "number" || !Number.isFinite(doneCount)) {
    throw new NextStepsProtocolError("next steps 响应缺少 doneCount");
  }
  if (typeof total !== "number" || !Number.isFinite(total)) {
    throw new NextStepsProtocolError("next steps 响应缺少 total");
  }
  return { steps, next, doneCount, total };
}