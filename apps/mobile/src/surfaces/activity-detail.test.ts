import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { activityAIDisclosure, activityAIPersonaName, activityMoneySummary } from "./activity-detail-model";

describe("activity detail responsibility and money direction", () => {
  it("shows the direction label before the amount", () => {
    expect(activityMoneySummary({ price: "500,000₫", priceLabel: "参加后你可获得" })).toBe("参加后你可获得 · 500,000₫");
  });

  it("states that generated content is reviewed and AI cannot transact", () => {
    const disclosure = activityAIDisclosure({
      aiStatus: "AI_GENERATED",
      aiActorKind: "PLATFORM_AI",
      aiPersonaName: "平台 AI 小美"
    });
    expect(disclosure).toContain("发布方审核并承担责任");
    expect(disclosure).toContain("AI 不能报名、接单或收付款");
  });

  it("does not add an AI disclosure to human-authored activity", () => {
    expect(activityAIDisclosure({ aiStatus: "NONE" })).toBeUndefined();
  });
});

// AI 标注的显示侧（2026-09-21 产品决定「AI 做的就标注，法规要求要满足」）。
//
// 契约（packages/contracts/src/index.ts 的 ActivitySchema 注释）承诺的是
//   「aiStatus != NONE 时客户端**必**显示 AI 标注 + persona 头像 + 名字」。
// persona 名字是补充信息：schema 里 `z.string().min(1).optional()`，服务端
// `omitempty`，wire 允许缺。所以标注**不能**挂在名字上 —— 名字一缺，标注整块
// 消失，界面就把 AI 生成的内容当成人做的呈现。那正是 2026-09-21 修掉的形状。
//
// 下面第一段钉判定口径，第二段钉归属名的兜底不编造，第三段钉三个列表渲染点
// 真的走了它 —— 只测纯函数的话，把渲染点改回 `&& item.aiPersonaName` 照样全绿。
describe("AI 标注：aiStatus != NONE 就必须有标注，与 persona 名字无关", () => {
  it("名字缺省 + 无 actorKind：仍然给出标注（不得返回 undefined）", () => {
    const disclosure = activityAIDisclosure({ aiStatus: "AI_GENERATED" });
    expect(disclosure).toBeDefined();
    expect(disclosure).toContain("发布方审核并承担责任");
  });

  it("AI_ASSISTED 同样必须标注", () => {
    expect(activityAIDisclosure({ aiStatus: "AI_ASSISTED" })).toBeDefined();
  });

  it("人做的（NONE）不标注 —— 即使带着 persona 名字也不标", () => {
    expect(activityAIDisclosure({ aiStatus: "NONE", aiPersonaName: "平台 AI 小美" })).toBeUndefined();
  });
});

describe("AI 标注的归属名：兜底只做事实级归因，不编造 persona", () => {
  it("服务端给了名字就用服务端的名字（不覆盖具体企划名）", () => {
    expect(activityAIPersonaName({ aiPersonaName: "平台 AI 小美 · 周末企划", aiActorKind: "PLATFORM_AI" }))
      .toBe("平台 AI 小美 · 周末企划");
  });

  it("缺名字 + PLATFORM_AI → 「平台 AI 小美」（actorKind 说了是平台 AI，这是事实）", () => {
    expect(activityAIPersonaName({ aiActorKind: "PLATFORM_AI" })).toBe("平台 AI 小美");
  });

  it("缺名字 + USER_TWIN → 「用户分身」（是本人的分身，不是平台的人）", () => {
    expect(activityAIPersonaName({ aiActorKind: "USER_TWIN" })).toBe("用户分身");
  });

  it("缺名字 + 未知/其他 actorKind → 中性「AI 助理」，不指认任何具体角色", () => {
    expect(activityAIPersonaName({})).toBe("AI 助理");
    expect(activityAIPersonaName({ aiActorKind: "USER_ASSISTANT" })).toBe("AI 助理");
  });
});

describe("AI 标注：三个列表渲染点不得再把标注挂到 aiPersonaName 上", () => {
  const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const stripComments = (code: string): string =>
    code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const surfaces: Record<string, string> = {
    "tasks.tsx": stripComments(read("./tasks.tsx")),
    "me-orders.tsx": stripComments(read("./me-orders.tsx"))
  };

  for (const [name, code] of Object.entries(surfaces)) {
    it(`${name}: 导入共享的归属名助手`, () => {
      expect(code).toContain('from "./activity-detail-model"');
    });

    it(`${name}: 标注只挂 aiStatus，不再挂 aiPersonaName`, () => {
      // 存在的那个闸门：证明标注本身还在（不是被整块删掉）。
      expect(code).toContain('item.aiStatus !== "NONE" ?');
      // 修掉的形状：名字一缺，标注整块消失。
      expect(code).not.toMatch(/aiStatus !== "NONE"\s*&&\s*\w+\.aiPersonaName/);
      // 也不许绕过助手自己写兜底 —— 会跟 activityAIPersonaName 漂移成两套口径。
      expect(code).not.toMatch(/aiPersonaName\s*\?\?/);
    });
  }
});
