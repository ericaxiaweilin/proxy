import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MOMENT_TEMPLATES, momentStartPrice } from "../demand-moments";

// DEMAND-WIZARD-CARD-001: 发布需求卡片右侧那一格画什么。
//
// 2026-10-06 用户：「我给你的原型基本要对齐啊 …… 有距离 有大概接单时间 移除1:1
// 因为概念理解复杂 变成起步价格」。原型卡片是 item-top（名字 | 价格）/ item-desc /
// item-bottom（tags | meta）—— 价格贴在**标题那一行**的右端，不是另起一个侧栏。
//
// 此前卡面右侧是一个独立侧栏：上格是 `defaultRatio`（`1:1`），下格是
// `defaultTime`（`今晚 19:00`）。1:1 要用户先懂「几个人对几个人」才读得懂，撤掉；
// 「今晚 19:00」是个**具体时刻**，换成模板时长（这类 Moment 大概要多久）。
//
// 这条钉守的是「1:1 和具体时刻别再回到卡面上」，以及「价格真的挂在标题那一行」。
// ⚠️ 反面断言只落在**渲染出来的节点**上（`item.xxx` / `styles.xxx`），不裸查「1:1」
// 或「今晚 19:00」—— 这段注释和组件里的注释都写着那些字，裸查会被自己的注释喂红
// （本仓有前科）。
describe("DEMAND-WIZARD-CARD-001 发布需求卡片右侧那一格", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );
  // 只取 Moment 那一段渲染。专业服务行是同文件里另一段，仍然用 catalogSide ——
  // 那一段不在这次改动的范围内，所以不能拿整份文件做反面断言。
  const momentRow = wizard.slice(
    wizard.indexOf("{moments.map((item) => {"),
    wizard.indexOf("{moments.length === 0")
  );

  it("切片切到了真正的 Moment 行（切空会让下面几条静默变成空断言）", () => {
    expect(momentRow.length).toBeGreaterThan(400);
    expect(momentRow).toContain("pickTemplate(item)");
  });

  it("1:1 与具体时刻不再画在卡面上", () => {
    expect(momentRow).not.toContain("item.defaultRatio");
    expect(momentRow).not.toContain("item.defaultTime");
    expect(momentRow).not.toContain("styles.catalogSideRatio");
    expect(momentRow).not.toContain("styles.catalogSideTime");
  });

  it("起步价挂在标题那一行的右端，时长在底行", () => {
    // 价格和标题同一个 flex 行（momentTop）—— 不是原来那个独立侧栏。
    expect(momentRow).toContain("styles.momentTop");
    expect(momentRow).toContain("styles.momentPriceNum");
    expect(momentRow).toContain("momentStartPrice(item)");
    // 底行：tags 在左，时长靠 marginLeft:auto 推到右端（momentMeta）。
    expect(momentRow).toContain("styles.momentBottom");
    expect(momentRow).toContain("item.defaultDuration");
  });

  it("起步价：有价才挂标签，面议不挂", () => {
    // 「面议 / 起步价」自相矛盾 —— 面议类模板的 unit 必须是空串。
    // 只钉这条规则，不钉标签的具体用词：用户以后想把「起步价」换成别的词，这里不该红。
    for (const template of MOMENT_TEMPLATES) {
      const start = momentStartPrice(template);
      expect(start.amount, `${template.title} 的起步价是空的`).not.toBe("");
      if (template.defaultPrice.trim() === "") {
        expect(start.unit, `${template.title} 是面议，不该挂起步价标签`).toBe("");
      } else {
        expect(start.unit, `${template.title} 有价却没挂起步价标签`).not.toBe("");
      }
    }
  });
});
