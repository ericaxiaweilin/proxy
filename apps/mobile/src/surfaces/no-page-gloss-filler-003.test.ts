import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// NO-PAGE-GLOSS-FILLER-003（2026-10-09）：「解释性废话」清扫第三批 —— 商家 Home 的
// `sectionHint` 那一层（承接 358 / 359，把 359 里刻意留下的待办做完）。
//
// 判据在 359 里被卡住过一次：这一层里有 `Scene Supply` / `Creator` 这些**产品自己的名词**，
// 当时判断「哪些算产品词得产品定」⇒ 本轮不动。这次回去查了证据，发现**可分**：
//
//   · 原型/设计参考里**没有任何一条**是这几句 —— `docs/design/` 下搜 `Forecast` /
//     `Scene Package` / `HOT / COOL` 只命中 `BASELINE_CHANGELOG.md`：一条是我自己在 359
//     写的待办，另一条是 Revision 55 用中文描述版式（「HOT/COOL 位」）。**不是设计元素。**
//   · `Scene Package` 在本文件第 9 行的注释里被自己称作
//     `(Scene Package placeholder for now)` —— 是实现期的占位名，不是产品词。
//   · `HOT / COOL menu` 里的 **COOL 全仓没有实现**：只有 `is_hot`（迁移 158）/ `HotBadge`，
//     没有 `is_cool`、没有 COOL 徽章。这句是**过期的承诺**（同 357 的 `bdash.desc` 一类），
//     不只是废话 —— 所以这条不是口味问题。
//
// **判据（这轮才定下来的那条线）**：
//   · **gloss = 给已经有名字的东西再起第二个名字**（`Forecast` 就在 `未来需求` 旁边）⇒ 删。
//   · **label = 那个东西唯一的名字**（`Scene Supply` 是那个信号格的唯一标签）⇒ 留。
//   所以本轮**不动** `Scene Supply`（信号格 label）与 `OPERATING PLAN · 发布前确认`
//   （确认单的抬头）—— 它们是命名，不是解释。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const bh = stripComments(readFileSync(here("./business-home.tsx"), "utf8"));

// **不带引号**地钉（带引号 / 模板串 / 放进数组都挡得住）；再加一遍 `deConcat` ——
// 因为 `not.toContain` 是纯子串判定，`"Fore" + "cast"` 这种拼接**不抹就漏**（反向注入实测到过）。
// 残余上限：`["F","o","r"].join("")` 这种刻意打散仍挡不住 —— 但那不是现实里的失败模式。
const deConcat = (s: string): string => s.replace(/["'`]\s*\+\s*["'`]/g, "");
const bhFlat = deConcat(bh);

const GLOSSES: ReadonlyArray<string> = [
  "实时状态 → 未来状态", // 经营脉搏：把「这个面板讲什么」又讲了一遍
  "Forecast", // 未来需求：同一个东西的第二个名字
  "Scene Package", // 高价值场景：实现期的占位名（见本文件第 9 行注释）
  "HOT / COOL menu" // 招牌与在售：版式批注口吻 + COOL 从未实现（过期承诺）
];

describe("NO-PAGE-GLOSS-FILLER-003 商家 Home 的英文/复述型 sectionHint 已清", () => {
  it("四条字面量一条不剩（剥注释 + 抹掉拼接黏合处）", () => {
    for (const gloss of GLOSSES) {
      expect(bh, `business-home.tsx 里「${gloss}」又回来了`).not.toContain(gloss);
      expect(bhFlat, `business-home.tsx 里「${gloss}」被拼接着加回来了`).not.toContain(gloss);
    }
  });

  it("sectionHint 这一层还在 —— 删的是四条废话，不是整个图层", () => {
    expect(bh).toContain("styles.sectionHint");
    expect(bh).toContain('sectionHint: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 }');
  });

  it("反证：留下的是**期间 / 状态 / 诚实断言**，不是解释", () => {
    // 期间：数字是「近 N 天」的。
    expect(bh).toContain("近 ${operatingHome.outcome.windowDays} 天");
    // 状态：这条建议是低置信的 —— 置信度披露，删了就是藏。
    expect(bh).toContain("低置信策略");
    // 诚实断言：这一块只有本商家的动作（MERCHANT-R35-OPERATING-FLOW-001 在钉）。
    expect(bh).toContain("只显示本商家动作");
    // 期间：待处理是「今天」的。
    expect(bh).toContain(">今天</Text>");
  });

  it("四个 section 标题都还在（删的是灰字，不是标题）", () => {
    for (const title of ["经营脉搏", "未来需求", "高价值场景", "招牌与在售"]) {
      expect(bh, `标题「${title}」被连带删掉了`).toContain(title);
    }
  });

  it("反证：HOT 是真的 —— 删掉的是标签，徽章必须还在", () => {
    expect(bh).toContain("HotBadge");
    expect(bh).toContain("m.isHot");
  });

  it("负向：COOL 全仓没有实现，不许写回用户可见文案", () => {
    // 这条现在绿，是因为 COOL 在实现里根本不存在（只有 is_hot / 迁移 158）。
    // 将来真做了 COOL，应该是**先有 is_cool / 徽章**，再回来把这条钉改成正向。
    expect(bh).not.toContain("COOL");
  });
});
