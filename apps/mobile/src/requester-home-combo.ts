/**
 * HOME-FORYOU-POOL-001 —— 「为你组合 For You」的**可用组合池**。
 *
 * 用户口径（2026-09-26）：「这个 home 的 for you 要好好做，这属于 n*n 维度覆盖，
 * 核心目的是减少用户选择，随机根据用户的 location 推荐可用资源组合池」。
 *
 * ## 为什么要建池子
 * 原来的做法是**四个轴各自取模**（人 / 时间 / 活动 / 场地 四个独立 index，
 * `requester-home.tsx` 的 personIndex / timeIndex / activityIndex / placeIndex），
 * 于是能配出根本不成立的组合：
 *   - 活动**不在**那个场地办（活动挂 `realitySceneId`，场地是另一条独立轴）；
 *   - 时间**不是**那场活动的时间（`distinctTimes` 是从活动时间派生的，但取模独立）。
 *
 * 仓库自己也知道这一点：首页聊天框的「咖啡」指令
 * （`requester-home.tsx:728-740`）就是**手工**把 人 / 活动 / 场地 三个轴联动的。
 * 这个模块把那套手工联动一般化成池子 —— 不是新发明，是把已有的正确做法推广开。
 *
 * ## 「可用」的唯一真相源
 * 活动上的 `realitySceneId` / `venueName`：活动只在自己真正举办的那个场地里可用。
 * 匹配口径与 `requester-home.tsx:1236` 的活动选择器**逐字一致**
 * （`s.id === a.realitySceneId || s.name === a.venueName`）—— 同一份数据只能有一个
 * 判定，两处口径不同就会出现「选择器里说能选、池子里说不可用」。
 *
 * ## 「根据 location」今天只能做到就近
 * ⚠️ `RequesterHome` 的 props **没有** viewer 城市/区域（只有 `viewerAccountId` /
 * `isGuest` / 一堆 client；顶部那块 LocationContext 是以 `topContext: ReactNode`
 * 塞进来的，值在父层，这里拿不到）。所以「根据 location」在当前数据下只能用
 * **`person.distanceM` 就近**来表达，不能凭空编一个城市名去匹配 `scene.area`。
 * 要做到「按用户所在城市筛场地」，得让父层把城市值传进来（见下面的 `pickNearby`
 * 注释）。这是**数据缺口**，不是实现偷懒。
 */

/** 池子里一个场地。结构类型 —— 调用方传 `SceneBrief` 进来即可，无需转换。 */
export type ComboScene = {
  id: string;
  name: string;
  area: string;
  imageUrl: string;
};

/** 池子里一个活动。`realitySceneId` / `venueName` 是「可用」的判据。 */
export type ComboActivity = {
  activityId: string;
  title: string;
  venueName: string;
  time: string;
  realitySceneId?: string | undefined;
};

/** 池子里一个人。`distanceM` 是今天唯一可用的 location 信号。 */
export type ComboPerson = {
  id: string;
  name: string;
  distanceM?: number | undefined;
};

/** 一个**成立的**组合：场地 → 在该场地办的活动 → 时间取自该活动 → （可选）一个人。 */
export type Combo = {
  /** 稳定标识，用来做 React key / 去重，以及「这次不要重复上一个」的比较。 */
  key: string;
  scene: ComboScene;
  activity: ComboActivity;
  person?: ComboPerson | undefined;
  /** 冗余一份方便直接渲染：**永远**等于 `activity.time`，不是独立轴。 */
  time: string;
};

/** 就近随机的默认档位：在最近的前 N 个组合里随机，而不是全池均匀随机。 */
export const NEARBY_BAND = 6;

/**
 * 活动在哪个场地办。`realitySceneId` 优先，退回 `venueName` 同名匹配。
 * 口径与 `requester-home.tsx:1236` 的活动选择器一致（大小写敏感、不做 trim 折叠）。
 * 找不到 ⇒ `undefined`（**不猜**：宁可这个活动不进池子）。
 */
export function sceneIdOfActivity(
  activity: ComboActivity,
  scenes: readonly ComboScene[]
): string | undefined {
  if (activity.realitySceneId) {
    const byId = scenes.find((scene) => scene.id === activity.realitySceneId);
    if (byId) return byId.id;
  }
  const venue = activity.venueName;
  if (!venue) return undefined;
  return scenes.find((scene) => scene.name === venue)?.id;
}

/**
 * 建池子：**活动 × 场地**先做可用性 join，再和人对齐。
 *
 * 注意这里的维度关系不是「四轴笛卡尔积」—— 那正是原来的 bug。真正自由的是
 * 「哪个活动」（它自己带着场地和时间），人是在**已成立的组合**上再挂的一个可选轴。
 * 所以池子大小 = 可用活动数 × 人数（没人时 = 可用活动数）。
 *
 * 活动落在未知场地 ⇒ 不进池子（不编场地）。场地/活动为空 ⇒ 空池子（UI 自己兜底）。
 */
export function buildCombinationPool(
  scenes: readonly ComboScene[],
  activities: readonly ComboActivity[],
  people: readonly ComboPerson[]
): Combo[] {
  const pool: Combo[] = [];
  for (const activity of activities) {
    const sceneId = sceneIdOfActivity(activity, scenes);
    if (!sceneId) continue;
    const scene = scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) continue;
    if (people.length === 0) {
      pool.push({ key: `${scene.id}|${activity.activityId}`, scene, activity, time: activity.time });
      continue;
    }
    for (const person of people) {
      pool.push({
        key: `${scene.id}|${activity.activityId}|${person.id}`,
        scene,
        activity,
        person,
        time: activity.time,
      });
    }
  }
  return pool;
}

/**
 * 就近优先排序：按人的 `distanceM` 升序，**没坐标的排最后**。
 *
 * 没坐标 ≠ 很近。原实现里 `distanceM` 缺省被当成 0，于是「没有坐标的人」冒充
 * 「就在你楼下」（PERSON-DISTANCE-ZERO-001 就是修这个）。这里同一条规矩：
 * `undefined` 一律沉底，绝不参与「就近」。
 *
 * 稳定排序（同距离保持原相对次序），这样同一个 seed 的结果可复现、可断言。
 */
export function orderByProximity(pool: readonly Combo[]): Combo[] {
  return pool
    .map((combo, index) => ({ combo, index }))
    .sort((a, b) => {
      const da = a.combo.person?.distanceM;
      const db = b.combo.person?.distanceM;
      if (da === undefined && db === undefined) return a.index - b.index;
      if (da === undefined) return 1;
      if (db === undefined) return -1;
      if (da === db) return a.index - b.index;
      return da - db;
    })
    .map((entry) => entry.combo);
}

/**
 * 随机取一个组合：**只在最近的一档里随机**。
 *
 * 全池均匀随机会把 3km 外的组合和楼下的组合等概率推给你 —— 那不叫「根据 location」。
 * 所以先就近排序，再在最近的前 `band` 个里按 seed 取一个。
 *
 * ⚠️ 这是「就近」，不是「按城市」。父层把 viewer 城市传进来之后，正确的做法是
 * 先用城市过滤 `scene.area`，再走这条就近逻辑 —— 两层叠加，而不是二选一。
 *
 * `seed` 取 `Math.abs(Math.trunc(seed))`，负数/小数都能用；池子空则 `undefined`。
 */
export function pickNearby(
  pool: readonly Combo[],
  seed: number,
  band: number = NEARBY_BAND
): Combo | undefined {
  const ordered = orderByProximity(pool);
  if (ordered.length === 0) return undefined;
  const size = Math.max(1, Math.min(Math.trunc(band) || NEARBY_BAND, ordered.length));
  const at = Math.abs(Math.trunc(seed)) % size;
  return ordered[at];
}

/**
 * 把任意字符串折成一个整数种子。
 *
 * 用途：首屏要「随机」，但不能每次 render 都换一个（会闪、也会让 React 每次重排）。
 * 所以用**一个每 mount 固定一次的随机数**做种子，见 `requester-home.tsx` 的
 * `forYouSeedRef`。这个函数只是给「同一个人/同一台设备想要稳定随机」的场景用。
 */
export function seedFrom(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return hash;
}
