import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NEXT_STEP_TARGETS,
  NextStepsProtocolError,
  PROFILE_EDIT_ROUTE,
  isNextStepTarget,
  parseNextSteps,
  targetToRoute
} from "./next-steps";

// NEXT-STEPS-001：首页那张「下一步」卡与 `/nudge/<TARGET>` 深链共用的那份映射。
//
// 这一族钉三件事：
//   1. 解析 fail-closed —— 形状不对**抛**，不返回半个结果。读不出来时界面什么都不画，
//      所以解析层绝不能「尽力返回一点」；
//   2. 四个 target 都落到**真的有那一页**的落点，落点不存在就返回 undefined；
//   3. 落点真的存在（反向臂读源码）：把那几页删了/改名了，这里立刻红 ——
//      「编一个看起来差不多的页面」是这一族最容易犯、也最难发现的错。

const read = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

// 服务端 BuildSteps(State{}) 的真实 payload（apps/api-go/internal/guidance/guidance.go）。
const profileStep = { id: "complete_profile", title: "完善资料", reason: "发动态和发需求都需要先有名字和头像", target: "EDIT_PROFILE", done: false };
const brandNew = {
  steps: [
    profileStep,
    { id: "first_post", title: "发第一条动态", reason: "你还没发过动态", target: "COMPOSE_POST", done: false },
    { id: "first_demand", title: "发布第一个需求", reason: "你还没发过需求", target: "PUBLISH_DEMAND", done: false },
    { id: "join_activity", title: "参加一个活动", reason: "你还没参加过活动", target: "BROWSE_ACTIVITIES", done: false }
  ],
  next: profileStep,
  doneCount: 0,
  total: 4
};

describe("NEXT-STEPS-001 解析（fail-closed）", () => {
  it("服务端那份 payload 原样读出来", () => {
    const parsed = parseNextSteps(brandNew);
    expect(parsed.steps).toHaveLength(4);
    expect(parsed.doneCount).toBe(0);
    expect(parsed.total).toBe(4);
    expect(parsed.next?.id).toBe("complete_profile");
    expect(parsed.next?.target).toBe("EDIT_PROFILE");
    // 已完成的步骤也在列表里（done=true），界面自己决定画不画。
    expect(parsed.steps.filter((step) => step.done)).toHaveLength(0);
  });

  it("全都做完了时 next 是 null（不是 undefined、也不是空对象）", () => {
    const parsed = parseNextSteps({ ...brandNew, next: null, doneCount: 4 });
    expect(parsed.next).toBeNull();
  });

  it("空集合是 [] —— steps 缺成 null 仍然是协议异常（空 ≠ 读不出来）", () => {
    expect(parseNextSteps({ steps: [], next: null, doneCount: 0, total: 0 }).steps).toEqual([]);
    expect(() => parseNextSteps({ ...brandNew, steps: null })).toThrow(NextStepsProtocolError);
  });

  it("形状不对就抛，绝不返回半个结果", () => {
    const broken: ReadonlyArray<unknown> = [
      null,
      "steps",
      [],
      {},
      { ...brandNew, steps: "four" },
      { ...brandNew, doneCount: "0" },
      { ...brandNew, total: null },
      { ...brandNew, steps: [{ id: "complete_profile" }] },
      { ...brandNew, steps: [profileStep, "first_post"] },
      { ...brandNew, next: { id: "x" } },
      { ...brandNew, next: profileStep.target },
      { ...brandNew, steps: [{ ...profileStep, done: "false" }] },
      { ...brandNew, steps: [{ ...profileStep, id: "  " }] },
      { ...brandNew, steps: [{ ...profileStep, title: "" }] },
      { ...brandNew, steps: [{ ...profileStep, target: "" }] }
    ];
    for (const body of broken) {
      expect(() => parseNextSteps(body), JSON.stringify(body)).toThrow(NextStepsProtocolError);
    }
  });

  // 服务端将来加了第五种 target 时，那一步**不画**（落点没有），而不是把整份读模型
  // 丢掉 —— 丢掉的话连本来跳得动的那三步也一起没了。
  it("未知的 target 保留在读模型里，但落点查不到（那一步不画）", () => {
    const parsed = parseNextSteps({
      ...brandNew,
      steps: [...brandNew.steps, { id: "invite_team", title: "邀请同伴", reason: "还没邀请过", target: "INVITE_TEAM", done: false }]
    });
    expect(parsed.steps).toHaveLength(5);
    expect(parsed.steps[4]?.target).toBe("INVITE_TEAM");
    expect(targetToRoute("INVITE_TEAM")).toBeUndefined();
  });
});

describe("NEXT-STEPS-001 target → App 内落点", () => {
  it("四个 target 都有落点", () => {
    expect(targetToRoute("EDIT_PROFILE")).toEqual({ kind: "meSubPage", route: PROFILE_EDIT_ROUTE });
    expect(targetToRoute("COMPOSE_POST")).toEqual({ kind: "feed" });
    expect(targetToRoute("PUBLISH_DEMAND")).toEqual({ kind: "market", tab: "OPPORTUNITY" });
    expect(targetToRoute("BROWSE_ACTIVITIES")).toEqual({ kind: "market", tab: "ACTIVITY" });
  });

  it("服务端那四个常量一个都不漏、也不多", () => {
    // 与 apps/api-go/internal/guidance/guidance.go 的四个常量一一对应。
    expect([...NEXT_STEP_TARGETS]).toEqual(["EDIT_PROFILE", "COMPOSE_POST", "PUBLISH_DEMAND", "BROWSE_ACTIVITIES"]);
    for (const target of NEXT_STEP_TARGETS) expect(targetToRoute(target), target).toBeDefined();
  });

  it("认不出来的 target 返回 undefined，不返回一个空路由", () => {
    for (const junk of ["", "  ", "EDIT_PROFILE ", "edit_profile", "COMPOSE", "MARKET", "__proto__"]) {
      expect(targetToRoute(junk), JSON.stringify(junk)).toBeUndefined();
    }
    expect(isNextStepTarget("EDIT_PROFILE")).toBe(true);
    expect(isNextStepTarget("NOPE")).toBe(false);
    expect(isNextStepTarget(1)).toBe(false);
  });
});

// 反向臂：落点必须**真的存在**。这里读源码而不是相信映射表 —— 那一页被改名或删掉时
// 这里会红，而映射表自己会一直绿着，点进去才发现是死路。
describe("NEXT-STEPS-001 落点真的存在（反向臂）", () => {
  it("EDIT_PROFILE 落在「我的 → 个人管理」那一屏，它上面有编辑资料的入口", () => {
    const subPages = read("./surfaces/me-sub-pages.ts");
    const me = read("./surfaces/me.tsx");
    expect(subPages, "个人管理子页没了").toContain(`${PROFILE_EDIT_ROUTE}: {`);
    expect(me).toContain(`subPage.route === "${PROFILE_EDIT_ROUTE}"`);
    expect(me).toContain('accessibilityLabel="编辑资料"');
  });

  it("COMPOSE_POST 落在动态 —— 发布器就在那一屏", () => {
    const feed = read("./surfaces/feed.tsx");
    expect(feed).toContain("function toggleEmbeddedComposer");
    expect(feed).toContain("<ComposerV2Screen");
  });

  it("PUBLISH_DEMAND 落在市场的机会页 —— 发布需求向导只在那儿开", () => {
    const market = read("./surfaces/market.tsx");
    expect(market).toContain('demandWizardOpen && pageTab === "OPPORTUNITY"');
  });

  it("BROWSE_ACTIVITIES 落在市场的活动页 —— 活动列表在那儿", () => {
    const market = read("./surfaces/market.tsx");
    expect(market).toContain('pageTab === "OPPORTUNITY" ?');
    expect(market).toContain("visibleActivities.length === 0");
  });
});