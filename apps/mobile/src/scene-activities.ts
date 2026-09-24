// SCENE-EVENT-SIGNUP-001: 场景详情上的「这里的活动 / 报名」。
//
// 这一块存在的理由：场景详情原来只有三个**发布**动作（邀请真人 / 发布机会 /
// 发布活动），用户只能"发起"，看不到这个场景上已经有什么活动、也没法报名。
// 活动域本身是真的（activity.activities + activity.participants，报名有名额、
// 有事务），所以这里**不新造一套报名机制**，直接复用 ActivityClient。
//
// 逻辑放在独立 .ts 里是因为 tsx 组件 import 不进 vitest（react-native /
// react-native-maps）。只有纯函数才测得到。

export type SceneActivity = {
  activityId: string;
  title: string;
  time: string;
  // people 是服务端**从 joined/capacity 推出来**的展示串（SCENE-ACTIVITY-
  // LINK-001）。它不再是写死常量，但仍然只是展示用 —— 判断能不能报名一律
  // 看 joined / capacity 这两个数，不解析 people 字符串。
  people: string;
  joined: number;
  // 契约里 capacity 是可选的；没有 = 这条活动不设名额，不是"名额为 0"。
  capacity?: number | undefined;
  // 老数据没有这个字段。没有就是"不属于任何场景"，不猜。
  realitySceneId?: string | undefined;
};

export function isSceneActivity(value: unknown): value is SceneActivity {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Record<keyof SceneActivity, unknown>>;
  return typeof item.activityId === "string" && item.activityId.length > 0 &&
    typeof item.title === "string" &&
    typeof item.time === "string" &&
    typeof item.people === "string" &&
    typeof item.joined === "number" && Number.isFinite(item.joined) &&
    (item.capacity === undefined || (typeof item.capacity === "number" && Number.isFinite(item.capacity))) &&
    (item.realitySceneId === undefined || typeof item.realitySceneId === "string");
}

// 名额。契约里可选，缺 = 不设名额（0，不是"满"）。
function capacityOf(activity: SceneActivity): number {
  return activity.capacity ?? 0;
}

// 取属于某个场景的活动。没有 realitySceneId 的活动不属于任何场景，
// 一律排除 —— 不"就近猜一个场景"。
export function activitiesAtScene<T extends { realitySceneId?: string | undefined }>(
  activities: readonly T[],
  sceneId: string
): T[] {
  if (sceneId === "") return [];
  return activities.filter((activity) => activity.realitySceneId === sceneId);
}

// 能不能报名：只看数字。名额满就是满，不因为"看起来还有"就放行。
export function canSignUp(activity: SceneActivity): boolean {
  const capacity = capacityOf(activity);
  // capacity <= 0 表示这条活动不设名额，随时可报。
  if (capacity <= 0) return true;
  return activity.joined < capacity;
}

export function activitySignupLabel(activity: SceneActivity): string {
  const capacity = capacityOf(activity);
  // 不设名额的活动没有"还有几个位"这回事，说出来就是编数字。
  if (capacity <= 0) return "不限名额";
  if (!canSignUp(activity)) return `名额已满（${activity.joined} / ${capacity}）`;
  return `${activity.joined} / ${capacity} 人 · 可报名`;
}

/**
 * 列表状态。"没有活动" / "取不到" / "正在取" 必须是**三种不同的说法** ——
 * 本仓的规则是：没有数据、没权限、查无此记录、失败，任何两种都不许长得一样。
 * 把"取不到"显示成"还没有活动"，用户会以为这里真的没活动。
 */
export type SceneActivityFeedState = "LOADING" | "EMPTY" | "ERROR" | "READY" | "SIGNED_OUT";

export type SceneActivityFeed = {
  state: SceneActivityFeedState;
  items: SceneActivity[];
};

export function sceneActivityFeed(items: SceneActivity[], state: SceneActivityFeedState): SceneActivityFeed {
  // 有内容就是 READY：拿 ERROR 当"顺带提示"会让人以为列表是空的。
  if (items.length > 0) return { state: "READY", items };
  // 读完了但一条都没有 = EMPTY，不是 READY —— 否则整块只剩个标题（SCENE-ACTIVITY-EMPTY-001）。
  return { state: state === "READY" ? "EMPTY" : state, items: [] };
}

export function sceneActivityFeedText(feed: SceneActivityFeed): string {
  switch (feed.state) {
    case "LOADING": return "正在读取这里的活动…";
    case "ERROR": return "活动列表暂时取不到，请稍后重试。";
    case "EMPTY": return "这里还没有人发起活动 —— 你可以发起第一个。";
    // 没登录是"没权限"，不是"没数据"。说成"还没有活动"会让人以为这地方冷清。
    case "SIGNED_OUT": return "登录后才能看到这里的活动并报名。";
    default: return "";
  }
}
