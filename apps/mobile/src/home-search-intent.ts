// Home search intent matcher — 全站搜索 + 模型对话合一（Home Search/Conversation v3 对齐）。
//
// 输入框里的同一句话，先走这里做全站实体意图匹配（人 / 时间 / 活动 / 场景）：
//   - 命中“整组换 / 配一套” → remix
//   - 命中“换人 / 换场景 / 换活动 / 改时间” → exchange 单格
//   - 命中具体人名 / 活动名 / 场景名 / 时段 → lookup，返回候选（点选套入四宫格）
//   - 什么都没命中 → 返回空候选的 lookup，调用方继续走原有模型对话管线。
//
// 纯函数、无 React 依赖，便于 vitest 直测。所有候选都来自调用方传入的
// 真实数据（推荐人 / 店铺活动 / 场景列表），这里不造任何演示数据。

export type HomeSearchSlot = "person" | "time" | "activity" | "place";

export interface HomeSearchSuggestion {
  slot: HomeSearchSlot;
  // 实体 id（person id / activityId / scene id），time 槽存时段原文
  id: string;
  // 展示主文本
  label: string;
  // 展示副文本（地点 / 简介），可省
  detail?: string;
}

export type HomeSearchIntent =
  | { kind: "remix" }
  | { kind: "exchange"; slot: HomeSearchSlot }
  | { kind: "lookup"; query: string; suggestions: ReadonlyArray<HomeSearchSuggestion> };

interface HomeSearchEntity {
  slot: HomeSearchSlot;
  id: string;
  label: string;
  detail?: string;
  keywords: string[];
}

export interface HomeSearchIndex {
  people: ReadonlyArray<HomeSearchEntity>;
  activities: ReadonlyArray<HomeSearchEntity>;
  scenes: ReadonlyArray<HomeSearchEntity>;
  times: ReadonlyArray<HomeSearchEntity>;
}

export interface HomeSearchIndexInput {
  people: ReadonlyArray<{ id: string; name: string; bio: string }>;
  activities: ReadonlyArray<{ id: string; title: string; venueName: string }>;
  scenes: ReadonlyArray<{ id: string; name: string; area: string; type: string }>;
  times: ReadonlyArray<string>;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function matchEntity(entity: HomeSearchEntity, query: string): boolean {
  for (const keyword of entity.keywords) {
    const k = normalize(keyword);
    if (!k) continue;
    if (k.includes(query) || query.includes(k)) return true;
  }
  return false;
}

// 意图动词顺序很重要：“换个地方”是 place，“换个人”是 person，
// 必须先判带宾语词根的槽位，再落到泛化的“换/改”。
const REMIX_PATTERN = /(配一套|随便配|帮我配|整组换|都换|来一套)/;
const PLACE_PATTERN = /((地方|场景|地点|太远|有点远).{0,6}(换|改|看看|找))|((换|改|找).{0,4}(地方|场景|地点))|^(太远|有点远)/;
const TIME_PATTERN = /((时间|几点|时段|时候).{0,6}(换|改|调成|定))|((换|改|调成|定).{0,4}(时间|几点|时段|时候))|改成(早上|中午|下午|晚上|今晚|明天|周末)/;
const ACTIVITY_PATTERN = /((活动|项目|玩法).{0,6}(换|改))|((换|改).{0,4}(活动|项目|玩法))/;
const PERSON_PATTERN = /((人|搭子|人选|她|他).{0,6}(换|改))|((换|改|换掉|不要|换个).{0,6}(人|搭子|人选|会中文))|(不要\s*\S+，?\s*换)/;

export function matchHomeSearchIntent(rawQuery: string, index: HomeSearchIndex): HomeSearchIntent {
  const query = normalize(rawQuery);
  if (!query) return { kind: "lookup", query: "", suggestions: [] };
  if (REMIX_PATTERN.test(query)) return { kind: "remix" };
  if (PLACE_PATTERN.test(query)) return { kind: "exchange", slot: "place" };
  if (TIME_PATTERN.test(query)) return { kind: "exchange", slot: "time" };
  if (ACTIVITY_PATTERN.test(query)) return { kind: "exchange", slot: "activity" };
  if (PERSON_PATTERN.test(query)) return { kind: "exchange", slot: "person" };

  const q = query.length >= 1 ? query : "";
  if (!q) return { kind: "lookup", query, suggestions: [] };
  const suggestions: HomeSearchSuggestion[] = [];
  // 原型 v3 的候选顺序：人 → 时间 → 活动 → 场景。单字查询只在
  // 实体名完全匹配时命中，避免噪声。
  const loose = q.length >= 2;
  for (const group of [index.people, index.times, index.activities, index.scenes]) {
    for (const entity of group) {
      const hit = loose ? matchEntity(entity, q) : normalize(entity.label) === q;
      if (hit) {
        suggestions.push({ slot: entity.slot, id: entity.id, label: entity.label, ...(entity.detail ? { detail: entity.detail } : {}) });
        if (suggestions.length >= 8) return { kind: "lookup", query, suggestions };
      }
    }
  }
  return { kind: "lookup", query, suggestions };
}

function buildEntity<T extends Omit<HomeSearchEntity, "detail"> & { detail?: string }>(entity: T): HomeSearchEntity {
  return entity.detail ? entity : { slot: entity.slot, id: entity.id, label: entity.label, keywords: entity.keywords };
}

export function buildHomeSearchIndex(input: HomeSearchIndexInput): HomeSearchIndex {
  return {
    people: input.people.map((p) => buildEntity({
      slot: "person" as const,
      id: p.id,
      label: p.name,
      ...(p.bio ? { detail: p.bio } : {}),
      keywords: [p.name, p.bio]
    })),
    activities: input.activities.map((a) => buildEntity({
      slot: "activity" as const,
      id: a.id,
      label: a.title,
      ...(a.venueName ? { detail: a.venueName } : {}),
      keywords: [a.title, a.venueName]
    })),
    scenes: input.scenes.map((s) => buildEntity({
      slot: "place" as const,
      id: s.id,
      label: s.name,
      ...([s.area, s.type].filter(Boolean).join(" · ") ? { detail: [s.area, s.type].filter(Boolean).join(" · ") } : {}),
      keywords: [s.name, s.area, s.type]
    })),
    times: input.times.map((t) => ({
      slot: "time" as const,
      id: t,
      label: t,
      keywords: [t]
    }))
  };
}

// HOME-PEOPLE-SEARCH-001: 本地 people 索引只是推荐预览（fixture），
// 不是全站用户 —— 新注册的真人不在里面，搜名字永远搜不到。query 够长
// （≥2 码点，与服务端 MinProfileSearchQuery 同口径）且调用方有
// ProfileClient 时，Home 必须再走一遍服务端全站人物搜索。
// 本地有没有命中都不拦服务端：本地名和真人可能同名，拦了会藏人。
export function shouldSearchServerPeople(rawQuery: string, hasClient: boolean): boolean {
  if (!hasClient) return false;
  return [...(rawQuery || "").trim()].length >= 2;
}

// HOME-PEOPLE-SEARCH-RACE-001（2026-09-30，用户 P0：「我在 home 搜索 linh，
// 点击搜索按钮，搜索内容自动擦除了，没有弹出任何搜索结果」）。
//
// 全站结果只在**用户真的换了查询词**时才作废。清空输入框不是新查询 ——
// 它是这次搜索的收尾：home-search-dock 的 handleSend 在 onExecute 之后会
// 调 onChangeText("") 清掉输入框，Home 那个「查询一改，全站结果即过期」的
// effect 会把这当成一次新查询，于是把**同一次提交刚发出的请求**一起作废。
// 结果是被 seq 守卫丢掉的（`if (serverPeopleSeq.current !== seq) return`）：
// 请求发出去了、答案也回来了，但没人写进 state —— 结果列表永远不出现，
// 失败态也永远不出现（连「重试」按钮都渲染不出来），用户只看到输入框被
// 擦干净。判据因此是「非空」，不是「变了」。
export function shouldExpireServerPeopleResults(nextQuery: string): boolean {
  return nextQuery.trim() !== "";
}
