import { describe, expect, it } from "vitest";

import {
  NEARBY_BAND,
  buildCombinationPool,
  orderByProximity,
  pickNearby,
  sceneIdOfActivity,
  seedFrom,
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
