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

// ---------------------------------------------------------------------------
// HOME-FORYOU-CONFLICT-001（2026-09-28，用户："最大的问题还是自由切换被
// 派生了 我们是自由切换 如果有资源冲突 要的就是提示 点击选择不能下一步
// 提示换 目前是派生了"）。
//
// `requester-home.tsx` 的四宫格没有走上面这套池子——人/时间/活动/地点
// 仍是四条独立 index，可以分别锁定、分别换（这是产品要的"自由切换"）。
// 但"活动是主轴"这条规矩（见文件头注）意味着：锁了地点/时间之后再换活动，
// 显示的地点/时间会**跟着活动静默改掉**，锁定形同虚设，用户看不出发生了
// 什么——这就是"被派生了"。
//
// 这里不改"自由切换"本身（那是要保留的行为），只加一层诚实的冲突检测：
// 锁定的地点/时间和当前活动的真实场地/时间不一致时，报出来，调用方据此
// 阻止进入下一步、提示用户换一个，而不是放任派生把冲突焐没了。
// ---------------------------------------------------------------------------

export type ComboConflict =
  | { slot: "place"; lockedSceneName: string; activitySceneName: string | undefined }
  | { slot: "time"; lockedTime: string; activityTime: string };

/**
 * 检查锁定的地点/时间是否和当前活动的真实场地/时间冲突。
 *
 * 只在"真的锁了"时才检查——没锁的轴本来就该跟着活动走，那不叫冲突，叫
 * 设计好的默认行为。活动没有可判定的场地（`sceneIdOfActivity` 返回
 * `undefined`）时也不报地点冲突：那种情况本来就退回 placeIndex 兜底，
 * 不存在"活动要求某个地点"这件事可比较。
 */
export function detectComboConflicts(
  activity: ComboActivity | undefined,
  scenes: readonly ComboScene[],
  locked: { place?: ComboScene | undefined; time?: string | undefined }
): ComboConflict[] {
  if (!activity) return [];
  const out: ComboConflict[] = [];
  if (locked.place) {
    const activitySceneId = sceneIdOfActivity(activity, scenes);
    if (activitySceneId !== undefined && activitySceneId !== locked.place.id) {
      out.push({
        slot: "place",
        lockedSceneName: locked.place.name,
        activitySceneName: scenes.find((scene) => scene.id === activitySceneId)?.name,
      });
    }
  }
  if (locked.time && activity.time && locked.time !== activity.time) {
    out.push({ slot: "time", lockedTime: locked.time, activityTime: activity.time });
  }
  return out;
}

/**
 * HOME-FORYOU-DEDUP-001：店名常带「· 区域」后缀（"Three Beans · Cầu Giấy"），
 * 地点格已经单独显示区域，场景格就去掉这段重复的后缀。区域对不上就原样返回。
 */
export function stripAreaSuffix(venueName: string, area: string | undefined): string {
  const trimmedArea = area?.trim();
  if (!trimmedArea) return venueName;
  const match = venueName.match(/^(.*?)\s*[·•・]\s*(.+)$/);
  if (!match || match[2]!.trim() !== trimmedArea || !match[1]!.trim()) return venueName;
  return match[1]!.trim();
}

/**
 * HOME-FORYOU-SCENE-001（用户「商业场所是活动的承载场景 比如xx咖啡店 目前主要做
 * 咖啡店就可以」）：场景格只从「挂在真实咖啡店场景上的活动」里选。
 * 没挂到真实场景的活动（自由填写店名，如「岚庭餐厅 · 西湖」）没有承载场景，
 * 配出来地点对不上，不进四宫格。
 */
export function isCoffeeShopScene(scene: { category?: string | undefined; type?: string | undefined }): boolean {
  return scene.category === "商家" && (scene.type ?? "").includes("咖啡");
}

export function activitiesAtCoffeeShops<A extends ComboActivity>(
  activities: readonly A[],
  scenes: readonly (ComboScene & { category?: string | undefined; type?: string | undefined })[]
): A[] {
  const shopIds = new Set(scenes.filter(isCoffeeShopScene).map((scene) => scene.id));
  return activities.filter((activity) => {
    const sceneId = sceneIdOfActivity(activity, scenes);
    return sceneId !== undefined && shopIds.has(sceneId);
  });
}

/** 我手上已有的一单（ListMyActivities 的 joined + joinOrders 合成）。 */
export type ExistingOrder = {
  activityId: string;
  title: string;
  time: string;
  orderNo?: string | undefined;
  cancelled?: boolean | undefined;
  // HOME-FORYOU-ORDER-007：这一单的同行人 id。
  //
  // 没有它，判重只能按 activityId 判 —— 于是「换一个同行人再下同一场活动」被判成
  // 重复下单，界面把那个新用户显示成灰色 + 「这一单你已经下过了」。而那个新用户
  // 根本没下过单。服务端（activity 仓储的 companionChanged）已经改成看同行人，
  // 客户端不改的话服务端放行、界面照样不给下单 —— 一半修好不算修好。
  //
  // 只用 id，不用名字：名字会改，改了名就绕开判重等于没有判重。
  companionId?: string | undefined;
};

export type OrderConflict =
  | { kind: "ALREADY_ORDERED"; orderNo?: string | undefined }
  | { kind: "TIME_TAKEN"; title: string; time: string; orderNo?: string | undefined };

/**
 * HOME-FORYOU-ORDER-GUARD-001（用户「确认下单后 收到 recipe 再次返回 home 可以同参数
 * 再次下单 这个违法基本资源冲突逻辑 要做守卫和检查提示」）：下单前的资源冲突检查。
 *   - 这场活动我已经下过单（没取消）→ ALREADY_ORDERED，不能重复下。
 *   - 同一个时间段我已经有另一单（没取消）→ TIME_TAKEN，人不能同时在两处。
 * 时间是活动自己写的自由文本（不是可解析的时间戳），只能按原文相等判断同一档，
 * 不去猜两段文字是不是重叠。空时间不参与判断。
 */
export function detectOrderConflict(
  // companionId 是这次要带的同行人（HOME-FORYOU-ORDER-007）。
  activity: { activityId: string; time: string; companionId?: string | undefined },
  existing: readonly ExistingOrder[]
): OrderConflict | undefined {
  const live = existing.filter((order) => !order.cancelled);
  // 同一场活动 + **同一个同行人** ⇒ 重复下单。换了同行人就是新的一单。
  //
  // 拿不到旧单的同行人（历史数据没有这个字段）时仍然判重 —— 与服务端
  // companionChanged 的保守策略一致：宁可误报重复，也不能因为缺数据放行重复下单。
  const wanted = activity.companionId ?? "";
  // 同一场活动 + **已知同一个同行人** ⇒ 重复下单。
  //
  // 旧单的同行人**缺失**（票面快照是 NULL，票面快照功能之前下的单）时按
  // "换了人"处理，允许继续下单。第一版我写的是反的（缺失 ⇒ 判重），理由是
  // "拿不到证据就保守" —— 结果**把这个用户永久锁死了**：库里所有旧单都没有快照，
  // 于是他在任何一个自己下过单的活动上，选任何新同行人都被判「已经下过了」。
  // 新同行人根本没下过单，那条提示是假的，而用户再也无法和任何新的人下单。
  //
  // 真实重复下单的代价是一张票（服务端同活动同 actor 只有一行，会沿用原编号并
  // 刷新票面）；误判重复下单的代价是**永久锁死**。两者不对称，所以要往放行那边偏。
  const same = live.find((order) =>
    order.activityId === activity.activityId &&
    order.companionId !== undefined &&
    order.companionId === wanted
  );
  if (same) return { kind: "ALREADY_ORDERED", orderNo: same.orderNo };
  const time = activity.time.trim();
  if (!time) return undefined;
  const clash = live.find((order) => order.time.trim() === time);
  return clash ? { kind: "TIME_TAKEN", title: clash.title, time: clash.time, orderNo: clash.orderNo } : undefined;
}
