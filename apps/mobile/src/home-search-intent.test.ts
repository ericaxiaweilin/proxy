import { describe, expect, it } from "vitest";
import { buildHomeSearchIndex, matchHomeSearchIntent, shouldExpireServerPeopleResults, shouldSearchServerPeople } from "./home-search-intent";

function makeIndex() {
  return buildHomeSearchIndex({
    people: [
      { id: "u_linh", name: "Linh", bio: "胶片 / 街拍 / 河内老城" },
      { id: "u_mai", name: "Mai", bio: "会中文 / 人像" }
    ],
    activities: [
      { id: "act_1", title: "周六新店开业", venueName: "Three Beans" },
      { id: "act_2", title: "周末摄影散步", venueName: "还剑湖" }
    ],
    scenes: [
      { id: "threebeans", name: "Three Beans", area: "还剑湖", type: "咖啡店" },
      { id: "westlake", name: "西湖", area: "西湖", type: "场景" }
    ],
    times: ["周六 15:30", "今晚 19:00"]
  });
}

describe("matchHomeSearchIntent", () => {
  it("empty query returns empty lookup", () => {
    expect(matchHomeSearchIntent("", makeIndex())).toEqual({ kind: "lookup", query: "", suggestions: [] });
    expect(matchHomeSearchIntent("   ", makeIndex())).toEqual({ kind: "lookup", query: "", suggestions: [] });
  });

  it("detects remix phrasing", () => {
    expect(matchHomeSearchIntent("帮我配一套", makeIndex())).toEqual({ kind: "remix" });
    expect(matchHomeSearchIntent("随便配", makeIndex())).toEqual({ kind: "remix" });
    expect(matchHomeSearchIntent("整组换", makeIndex())).toEqual({ kind: "remix" });
  });

  it("routes exchange intents to the right slot", () => {
    expect(matchHomeSearchIntent("这个人太远 换个地方", makeIndex())).toEqual({ kind: "exchange", slot: "place" });
    expect(matchHomeSearchIntent("太远", makeIndex())).toEqual({ kind: "exchange", slot: "place" });
    expect(matchHomeSearchIntent("时间改晚上", makeIndex())).toEqual({ kind: "exchange", slot: "time" });
    expect(matchHomeSearchIntent("改成今晚", makeIndex())).toEqual({ kind: "exchange", slot: "time" });
    expect(matchHomeSearchIntent("换个活动", makeIndex())).toEqual({ kind: "exchange", slot: "activity" });
    expect(matchHomeSearchIntent("不要 Linh，换一个会中文的", makeIndex())).toEqual({ kind: "exchange", slot: "person" });
  });

  it("looks up people by name (case-insensitive, whitespace-insensitive)", () => {
    const out = matchHomeSearchIntent("linh", makeIndex());
    expect(out.kind).toBe("lookup");
    if (out.kind !== "lookup") return;
    expect(out.suggestions[0]).toEqual({ slot: "person", id: "u_linh", label: "Linh", detail: "胶片 / 街拍 / 河内老城" });
  });

  it("looks up scenes and activities by keyword", () => {
    const out = matchHomeSearchIntent("three", makeIndex());
    expect(out.kind).toBe("lookup");
    if (out.kind !== "lookup") return;
    expect(out.suggestions.some((s) => s.slot === "place" && s.id === "threebeans")).toBe(true);
    expect(out.suggestions.some((s) => s.slot === "activity" && s.id === "act_1")).toBe(true);
  });

  it("single-character query only matches exact label", () => {
    const out = matchHomeSearchIntent("湖", makeIndex());
    expect(out.kind).toBe("lookup");
    if (out.kind !== "lookup") return;
    // “湖”不是任何实体名的精确匹配，不应产生候选
    expect(out.suggestions).toEqual([]);
  });

  it("returns empty suggestions when nothing matches (falls through to conversation)", () => {
    const out = matchHomeSearchIntent("帮我写一首诗", makeIndex());
    expect(out.kind).toBe("lookup");
    if (out.kind !== "lookup") return;
    expect(out.suggestions).toEqual([]);
  });

  it("caps suggestions at 8", () => {
    const big = buildHomeSearchIndex({
      people: Array.from({ length: 12 }, (_, i) => ({ id: `u_${i}`, name: `User${i}`, bio: "" })),
      activities: [],
      scenes: [],
      times: []
    });
    const out = matchHomeSearchIntent("user", big);
    if (out.kind !== "lookup") return;
    expect(out.suggestions.length).toBeLessThanOrEqual(8);
  });
});

describe("HOME-PEOPLE-SEARCH-001 shouldSearchServerPeople", () => {
  it("asks the server for queries of 2+ code points when a client exists", () => {
    expect(shouldSearchServerPeople("nguyen", true)).toBe(true);
    expect(shouldSearchServerPeople("林夏", true)).toBe(true);
    expect(shouldSearchServerPeople("@ng", true)).toBe(true);
  });

  it("never asks without a client (guests keep the old local-only flow)", () => {
    expect(shouldSearchServerPeople("nguyen", false)).toBe(false);
  });

  it("does not burn a network round-trip on too-short queries (server would 400)", () => {
    expect(shouldSearchServerPeople("n", true)).toBe(false);
    expect(shouldSearchServerPeople(" ", true)).toBe(false);
    expect(shouldSearchServerPeople("", true)).toBe(false);
    // 一个汉字是 1 个码点：按字节数会把单字放过去，服务端按 rune 拒绝。
    expect(shouldSearchServerPeople("林", true)).toBe(false);
  });
});

// HOME-PEOPLE-SEARCH-RACE-001（2026-09-30，用户 P0：「我在 home 搜索 linh，
// 点击搜索按钮，搜索内容自动擦除了，没有弹出任何搜索结果」）。
//
// 提交搜索时输入框会被清空（home-search-dock 的 handleSend 在 onExecute 之后
// 调 onChangeText("")）。Home 里「查询一改，全站结果即过期」的 effect 原来是
// **无条件**作废：它把这次清空当成新查询，于是把同一次提交刚发出的请求一起
// 作废（seq 一变，回来的答案被守卫丢掉）。症状是输入框被擦干净、结果列表和
// 失败态都不出现，连「重试」按钮都渲染不出来。
//
// 这条钉钉的是判据本身：空查询不是新查询，只有非空的新词才让旧结果过期。
describe("HOME-PEOPLE-SEARCH-RACE-001 shouldExpireServerPeopleResults", () => {
  it("does NOT expire results when the box is cleared (that is the submit tail, not a new query)", () => {
    // 这一条就是回归本体：改成无条件作废（return true）这里立刻红。
    expect(shouldExpireServerPeopleResults("")).toBe(false);
    expect(shouldExpireServerPeopleResults("   ")).toBe(false);
  });

  it("DOES expire results when the user types a new term", () => {
    // 反方向也要钉住，否则把函数改成恒 false 会「修好」上面那条、
    // 却让上一个词的人永远挂在新查询下面（原注释要防的就是这个）。
    expect(shouldExpireServerPeopleResults("linh")).toBe(true);
    expect(shouldExpireServerPeopleResults("  linh  ")).toBe(true);
    expect(shouldExpireServerPeopleResults("n")).toBe(true);
  });
});
