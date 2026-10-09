import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ME-NO-HINTS-001（2026-10-09）：「我的」页的分组副标题（hint）整体删除。
//
// 用户原话：「把解释性的废话全部删除 不只这个功能 其它的解释废话移除」。
// 那些副标题渲染成分组标题旁边那行小字，讲的是**设计意图**而不是用户需要的信息 ——
// 最刺眼的一条写着「原始设计：发展 builder，小美与用户推荐商铺进入体系」。
//
// 三层一起删：
//   · 契约 `ExperienceMenuSectionSchema.hint`（packages/contracts，`.strict()`，
//     所以服务端再下发就是整包校验失败；有 contracts 侧的单测守着）
//   · 服务端 `menuSection.Hint`（apps/api-go/internal/experience）
//   · 移动端 `MenuSection.hint` + 渲染 + `styles.sectionHint`
//
// 本文件钉的是**移动端本地 persona 那一路** —— 它不经过契约（`effectiveSections`
// 在 managedSections 为空时直接用 `persona.sections`），而类型也拦不住「把字段加
// 回去」：加回字段就能编译过。所以这里直接读源码。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const meCode = stripComments(readFileSync(here("./me.tsx"), "utf8"));
const meTypesCode = stripComments(readFileSync(here("./me-types.ts"), "utf8"));
const meStylesCode = stripComments(readFileSync(here("./me-styles.ts"), "utf8"));

describe("ME-NO-HINTS-001 分组副标题不再出现在「我的」页", () => {
  it("MenuSection 类型里没有 hint 字段", () => {
    expect(meTypesCode).not.toMatch(/\bhint\s*:/);
  });

  it("me.tsx 的分组定义里没有 hint 键", () => {
    // ⚠️ 只钉 `hint:` 这个**键**。me.tsx 里另有一个 `hint={...}` —— 那是二维码放大
    // 那张 sheet 的操作提示（「把屏幕朝向对方即可扫描」），是有用的操作说明，
    // 不是解释性废话，故意留着。
    expect(meCode).not.toMatch(/\bhint\s*:/);
    expect(meCode).toContain("hint={"); // 反证：上面那条不是因为整个文件都没 hint 才过的
  });

  it("渲染与样式里的分组副标题一并消失", () => {
    expect(meCode).not.toContain("section.hint");
    expect(meCode).not.toContain("sectionHint");
    expect(meStylesCode).not.toContain("sectionHint");
  });
});
