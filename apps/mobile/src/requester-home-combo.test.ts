import { describe, expect, it } from "vitest";

import {
  NEARBY_BAND,
  buildCombinationPool,
  detectComboConflicts,
  orderByProximity,
  pickNearby,
  sceneIdOfActivity,
  seedFrom,
  stripAreaSuffix,
  activitiesAtCoffeeShops,
  detectOrderConflict,
  isCoffeeShopScene,
  type Combo,
  type ComboActivity,
  type ComboPerson,
  type ComboScene,
} from "./requester-home-combo";

/**
 * HOME-FORYOU-POOL-001。用户报的是「home 的 for you 要好好做」——它属于
 * n*n 维度覆盖，核心目的是减少用户选择、随机按 location 推可用资源组合池。
 *
 * 这里钉的是**池子的不变量**，不是 UI 长什么样。核心一条：
 * **池子里每一个组合都必须成立** —— 活动真的在那个场地办、时间真的是那场活动的时间。
 * 原实现四个轴各自取模，这条不成立，所以能配出「活动不在这个场地办」的组合。
 */

const SCENES: ComboScene[] = [
  { id: "sc_bean", name: "Bean There", area: "Quận 1", imageUrl: "bean.png" },
  { id: "sc_lake", name: "Hồ Tây", area: "Tây Hồ", imageUrl: "lake.png" },
  { id: "sc_hall", name: "Nhà Văn Hóa", area: "Quận 3", imageUrl: "hall.png" },
];

const ACTIVITIES: ComboActivity[] = [
  // 按 realitySceneId 挂到 Bean There
  { activityId: "a_coffee", title: "喝咖啡", venueName: "Bean There", time: "周六下午", realitySceneId: "sc_bean" },
  // 只靠 venueName 同名匹配到 Hồ Tây（realitySceneId 缺省）
  { activityId: "a_walk", title: "散步", venueName: "Hồ Tây", time: "周六傍晚", realitySceneId: undefined },
  // 场地根本没接进来 —— 这条**不该**进池子
  { activityId: "a_ghost", title: "神秘活动", venueName: "不存在的地方", time: "周日上午", realitySceneId: "sc_missing" },
];

const PEOPLE: ComboPerson[] = [
  { id: "u_linh", name: "Linh", distanceM: 800 },
  { id: "u_an", name: "An", distanceM: 2400 },
  // 没有坐标 —— 必须沉底，不能冒充「就在楼下」
  { id: "u_mo", name: "Mơ", distanceM: undefined },
];

describe("HOME-FORYOU-POOL-001 可用组合池", () => {
  it("活动只在自己真正举办的那个场地里可用", () => {
    expect(sceneIdOfActivity(ACTIVITIES[0]!, SCENES)).toBe("sc_bean");
    // realitySceneId 缺省时退回 venueName 同名
    expect(sceneIdOfActivity(ACTIVITIES[1]!, SCENES)).toBe("sc_lake");
    // 两边都对不上 ⇒ 不猜
    expect(sceneIdOfActivity(ACTIVITIES[2]!, SCENES)).toBeUndefined();
  });

  it("场地接不进来的活动不进池子 —— 宁可池子小，也不配一个点进去没有的组合", () => {
    const pool = buildCombinationPool(SCENES, ACTIVITIES, PEOPLE);
    expect(pool.some((combo) => combo.activity.activityId === "a_ghost")).toBe(false);
  });

  it("池子里每个组合都成立：场地 = 活动举办地，时间 = 那场活动的时间", () => {
    const pool = buildCombinationPool(SCENES, ACTIVITIES, PEOPLE);
    expect(pool.length).toBeGreaterThan(0);
    for (const combo of pool) {
      // 场地和活动是**联动**的，不是两条独立轴各取模 —— 这就是原 bug 的反向钉。
      expect(combo.scene.id).toBe(sceneIdOfActivity(combo.activity, SCENES));
      // 时间是活动的属性，不是第四条独立轴。
      expect(combo.time).toBe(combo.activity.time);
    }
  });

  it("维度是 可用活动 × 人，不是四轴笛卡尔积", () => {
    const pool = buildCombinationPool(SCENES, ACTIVITIES, PEOPLE);
    // 2 个可用活动 × 3 个人
    expect(pool).toHaveLength(2 * 3);
    expect(new Set(pool.map((combo) => combo.key)).size).toBe(pool.length);
  });

  it("一个人都没有时，池子退化成「可用活动」本身，而不是空池子", () => {
    const pool = buildCombinationPool(SCENES, ACTIVITIES, []);
    expect(pool).toHaveLength(2);
    expect(pool.every((combo) => combo.person === undefined)).toBe(true);
    expect(pool.every((combo) => combo.time === combo.activity.time)).toBe(true);
  });

  it("场地或活动为空 ⇒ 空池子，不抛异常", () => {
    expect(buildCombinationPool([], ACTIVITIES, PEOPLE)).toEqual([]);
    expect(buildCombinationPool(SCENES, [], PEOPLE)).toEqual([]);
    expect(pickNearby([], 0)).toBeUndefined();
  });

  it("就近排序：升序、没坐标的沉底、同距离保持原次序", () => {
    const pool = buildCombinationPool(SCENES, ACTIVITIES, PEOPLE);
    const ordered = orderByProximity(pool);
    expect(ordered).toHaveLength(pool.length);
    const distances = ordered.map((combo) => combo.person?.distanceM);
    // 池子是「活动在外、人在内」建的，所以两个可用活动各带一份同样的距离序列：
    // 就近排序后 = 800, 800, 2400, 2400，然后两个没坐标的（每个活动一个）一律沉底。
    expect(distances).toEqual([800, 800, 2400, 2400, undefined, undefined]);
    // 原池子没被动过（纯函数）
    expect(pool).toHaveLength(ordered.length);
  });

  it("随机只在最近的一档里发生，不是全池均匀随机", () => {
    const pool = buildCombinationPool(SCENES, ACTIVITIES, PEOPLE);
    const nearestTwo = orderByProximity(pool).slice(0, 2).map((combo) => combo.key);
    // 扫一圈种子：一个都不许落到「最近一档」之外
    for (let seed = 0; seed < 40; seed += 1) {
      const picked = pickNearby(pool, seed, 2);
      expect(picked).toBeDefined();
      expect(nearestTwo).toContain(picked!.key);
    }
    // 而且档位内真的在变（不是永远第一个）
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) seen.add(pickNearby(pool, seed, 2)!.key);
    expect(seen.size).toBe(2);
  });

  it("档位大于池子时覆盖全池；同一个 seed 结果可复现", () => {
    const pool: Combo[] = buildCombinationPool(SCENES, ACTIVITIES, PEOPLE);
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) seen.add(pickNearby(pool, seed, 999)!.key);
    expect(seen.size).toBe(pool.length);
    expect(pickNearby(pool, 7, 999)!.key).toBe(pickNearby(pool, 7, 999)!.key);
  });

  it("默认档位是 6，负数/小数种子也能用", () => {
    expect(NEARBY_BAND).toBe(6);
    const pool = buildCombinationPool(SCENES, ACTIVITIES, PEOPLE);
    expect(pickNearby(pool, -3)).toBeDefined();
    expect(pickNearby(pool, 2.9)).toBe(pickNearby(pool, 2));
  });

  it("seedFrom 稳定且区分不同输入", () => {
    expect(seedFrom("u_linh")).toBe(seedFrom("u_linh"));
    expect(seedFrom("u_linh")).not.toBe(seedFrom("u_an"));
    expect(Number.isInteger(seedFrom("u_linh"))).toBe(true);
  });
});

/**
 * HOME-FORYOU-CONFLICT-001。用户报的是「for you」四宫格的"自由切换"
 * （人/时间/活动/地点各自独立锁定/更换）被"活动是主轴"这条派生规则悄悄
 * 吃掉了：锁了地点/时间之后再换活动，显示值会跟着活动静默改掉，用户看
 * 不出冲突。这里钉的是"检测到冲突就报出来"这个纯函数，不是四宫格 UI
 * 本身（那部分在 requester-home.tsx，用检测结果来禁用「选择」+ 显示提示）。
 */
describe("HOME-FORYOU-CONFLICT-001 锁定轴与活动的冲突检测", () => {
  it("什么都没锁 ⇒ 永远没有冲突，即便活动和「当前显示」的地点/时间不一样", () => {
    expect(detectComboConflicts(ACTIVITIES[0], SCENES, {})).toEqual([]);
    expect(detectComboConflicts(undefined, SCENES, { place: SCENES[1], time: "随便" })).toEqual([]);
  });

  it("锁定的地点和活动真实场地一致 ⇒ 没有冲突", () => {
    // a_coffee 挂在 sc_bean（见 SCENES/ACTIVITIES 顶部定义）。
    expect(detectComboConflicts(ACTIVITIES[0], SCENES, { place: SCENES[0] })).toEqual([]);
  });

  it("锁定的地点和活动真实场地不一致 ⇒ 报 place 冲突，带上双方场地名", () => {
    // a_coffee 在 sc_bean 办，但地点锁在 sc_lake。
    const conflicts = detectComboConflicts(ACTIVITIES[0], SCENES, { place: SCENES[1] });
    expect(conflicts).toEqual([{ slot: "place", lockedSceneName: "Hồ Tây", activitySceneName: "Bean There" }]);
  });

  it("活动本身没有可判定的场地时，锁地点不报冲突——那种情况本来就退回 placeIndex 兜底", () => {
    // a_ghost 的 realitySceneId 指向一个不存在的场地，sceneIdOfActivity 返回 undefined。
    expect(detectComboConflicts(ACTIVITIES[2], SCENES, { place: SCENES[0] })).toEqual([]);
  });

  it("锁定的时间和活动真实时间不一致 ⇒ 报 time 冲突", () => {
    const conflicts = detectComboConflicts(ACTIVITIES[0], SCENES, { time: "周日上午" });
    expect(conflicts).toEqual([{ slot: "time", lockedTime: "周日上午", activityTime: "周六下午" }]);
  });

  it("地点和时间同时锁定且都冲突 ⇒ 两条都报，顺序固定（place 在前）", () => {
    const conflicts = detectComboConflicts(ACTIVITIES[0], SCENES, { place: SCENES[1], time: "周日上午" });
    expect(conflicts).toEqual([
      { slot: "place", lockedSceneName: "Hồ Tây", activitySceneName: "Bean There" },
      { slot: "time", lockedTime: "周日上午", activityTime: "周六下午" },
    ]);
  });

  it("锁定时间正好等于活动时间 ⇒ 没有冲突（哪怕地点冲突同时存在）", () => {
    const conflicts = detectComboConflicts(ACTIVITIES[0], SCENES, { place: SCENES[1], time: "周六下午" });
    expect(conflicts).toEqual([{ slot: "place", lockedSceneName: "Hồ Tây", activitySceneName: "Bean There" }]);
  });
});

describe("HOME-FORYOU-DEDUP-001 stripAreaSuffix", () => {
  it("drops the trailing area when it matches the place tile's area", () => {
    expect(stripAreaSuffix("Three Beans · Cầu Giấy", "Cầu Giấy")).toBe("Three Beans");
  });
  it("keeps the name when the area differs or is missing", () => {
    expect(stripAreaSuffix("木光咖啡 · 还剑郡", "Cầu Giấy")).toBe("木光咖啡 · 还剑郡");
    expect(stripAreaSuffix("Three Beans · Cầu Giấy", undefined)).toBe("Three Beans · Cầu Giấy");
    expect(stripAreaSuffix("Three Beans", "Cầu Giấy")).toBe("Three Beans");
  });
});

describe("HOME-FORYOU-SCENE-001 场景格只选挂在真实咖啡店上的活动", () => {
  const scenes = [
    { id: "threebeans", name: "Three Beans · Cầu Giấy", area: "Cầu Giấy", imageUrl: "", category: "商家", type: "咖啡 · 动态场景" },
    { id: "hoankiem", name: "Hồ Hoàn Kiếm", area: "Hoàn Kiếm", imageUrl: "", category: "景点", type: "公共景点 · 湖边" },
  ];
  it("recognises coffee-shop scenes by category + type", () => {
    expect(isCoffeeShopScene(scenes[0]!)).toBe(true);
    expect(isCoffeeShopScene(scenes[1]!)).toBe(false);
  });
  it("keeps activities hosted at a coffee shop, drops unlinked venues and non-shop scenes", () => {
    const acts = [
      { activityId: "cup", title: "周日杯测小聚", venueName: "Three Beans · Cầu Giấy", time: "周日", realitySceneId: "threebeans" },
      { activityId: "byname", title: "拉花体验", venueName: "Three Beans · Cầu Giấy", time: "周六" },
      { activityId: "lake", title: "湖边散步", venueName: "Hồ Hoàn Kiếm", time: "周六", realitySceneId: "hoankiem" },
      { activityId: "free", title: "周五一起吃新菜", venueName: "岚庭餐厅 · 西湖", time: "周五" },
    ];
    expect(activitiesAtCoffeeShops(acts, scenes).map((a) => a.activityId)).toEqual(["cup", "byname"]);
  });
});

describe("HOME-FORYOU-ORDER-GUARD-001 下单前资源冲突检查", () => {
  const mine = [
    { activityId: "cup", title: "周日杯测小聚", time: "周日 10:00–11:30", orderNo: "100260927150535000001" },
    { activityId: "old", title: "已取消那单", time: "周五 18:30–20:30", cancelled: true },
  ];
  it("blocks ordering the same activity twice", () => {
    // f8977240：旧单 companionId 缺失时**不**再判 ALREADY_ORDERED（否则旧单会把用户
    // 永久锁死）。本 fixture 的旧单没有 companionId ⇒ 掉到时间比对 ⇒ TIME_TAKEN。
    // 仍然拦住（这单确实占了周日这个时段），但**理由**变了。
    //
    // 已裁决（2026-10-01，我拍板，依据在 requester-home-combo.ts 321-322 的注释）：
    // 同一场活动 + 新同行人，**维持** TIME_TAKEN 拦截，不把同一 activityId 从时间
    // 比对里排除。理由：服务端 (activity, actor) 只有一行，同场再下单会**沿用原
    // 编号并刷新票面** —— 也就是无声改写原同行人正等着的那张票，而不是"多下一单"。
    // 放行的正确路径是显式的：先取消旧单（真状态转移），再带新同行人下单。
    // 客户端现在把挡路的**那一单**说清楚（HOME-FORYOU-CONFLICT-DETAIL-001，
    // orderConflictTime 带时段 + 标题），「先取消那一单」从口号变成可执行。
    // f8977240 真正修的病（companionId 缺失 ⇒ 误判"没换人" ⇒ 永久锁死）依然修着。
    expect(detectOrderConflict({ activityId: "cup", time: "周日 10:00–11:30" }, mine)).toEqual({ kind: "TIME_TAKEN", title: "周日杯测小聚", time: "周日 10:00–11:30", orderNo: "100260927150535000001" });
  });
  it("blocks a different activity in a time slot I already hold", () => {
    expect(detectOrderConflict({ activityId: "latte", time: " 周日 10:00–11:30 " }, mine)).toEqual({ kind: "TIME_TAKEN", title: "周日杯测小聚", time: "周日 10:00–11:30", orderNo: "100260927150535000001" });
  });
  it("ignores cancelled orders, other times and blank times", () => {
    expect(detectOrderConflict({ activityId: "x", time: "周五 18:30–20:30" }, mine)).toBeUndefined();
    expect(detectOrderConflict({ activityId: "old", time: "周五 18:30–20:30" }, mine)).toBeUndefined();
    expect(detectOrderConflict({ activityId: "x", time: "周六 09:00" }, mine)).toBeUndefined();
    expect(detectOrderConflict({ activityId: "x", time: "" }, mine)).toBeUndefined();
  });
});
