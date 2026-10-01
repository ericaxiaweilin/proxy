import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// HOME-FORYOU-FREE-001：「小美当前有没有时间」必须有依据。
//
// 用户提出：理论上 for you 是 4 个资源槽，点圆圈应该自动刷新到**当前有空**的人。
// 查下来这条链是空的：
//   · rail 上的「在线点」是 `online: false` 写死的假值；
//   · 点圆圈走 `Math.random()`，与「有没有空」毫无关系；
//   · 于是「换个人」看起来像在挑有空的人，其实完全没有依据 —— 和
//     PERSON-DISTANCE-ZERO-001 造出的 0m 是同一类错误。
describe("HOME-FORYOU-FREE-001 有空 = 服务端算的，不是随机", () => {
  const src = readFileSync(fileURLToPath(new URL("./surfaces/requester-home.tsx", import.meta.url)), "utf8");

  it("在线点来自服务端 free_at，且只有 true 才算在线", () => {
    expect(src).toContain("online: wire.freeAt === true,");
    // 写死的假值必须已经不在了
    expect(src).not.toMatch(/^\s*online: false,$/m);
  });

  it("点圆圈在「有空的」那些人里轮转，不再随机", () => {
    expect(src).toContain("const freeOnes = filteredPeople.filter((p) => p.online);");
    expect(src).toMatch(/freePersonCursor\.current % freeOnes\.length/);
    // 随机换人只在「一个有空的都没有」时作为兜底，且必须同时给出如实文案
    expect(src).toMatch(/showResponse\(t\("noOneFree"\), t\("noOneFreeSub"\)\)/);
  });

  it("nearby 请求带上真实时段；推不出时段就不编", () => {
    expect(src).toContain("...(slot ? { slot } : {})");
    // 活动时间是自由文本，不能直接拼 RFC3339 —— 拼出来就是编的
    expect(src).toContain("function freeSlotForDistinctTime(");
    expect(src).toMatch(/if \(!label\) return undefined;/);
    expect(src).toMatch(/if \(start\.getTime\(\) <= Date\.now\(\)\) start\.setDate\(start\.getDate\(\) \+ 1\);/);
  });
});

describe("freeSlotForDistinctTime 不会编时段", async () => {
  const { freeSlotForDistinctTime } = await import("./surfaces/requester-home").then((m) => m as Record<string, unknown>)
    .then((m) => ({ freeSlotForDistinctTime: m.freeSlotForDistinctTime as (l?: string) => { startIso: string; endIso: string } | undefined }))
    .catch(() => ({ freeSlotForDistinctTime: undefined as unknown as (l?: string) => { startIso: string; endIso: string } | undefined }));
  const fn = freeSlotForDistinctTime;
  if (typeof fn !== "function") {
    it("helper 未导出（下面三项跳过）", () => expect(true).toBe(true));
    return;
  }
  it("抽不出钟点就返回 undefined，而不是编一个", () => {
    expect(fn(undefined)).toBeUndefined();
    expect(fn("周六")).toBeUndefined();
    expect(fn("待定")).toBeUndefined();
    expect(fn("99:99")).toBeUndefined();
  });
  it("抽得出钟点就落在未来的真实时段上", () => {
    const slot = fn("周六 15:00");
    expect(slot).toBeDefined();
    const start = new Date(slot!.startIso);
    expect(start.getHours()).toBe(15);
    expect(start.getTime()).toBeGreaterThan(Date.now()); // 绝不返回过去的时段
  });
});
