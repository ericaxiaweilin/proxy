import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DEMAND-SPECS-SKELETON-001（2026-10-07，用户看完确认下单原型 deepseek_html_20261006：
// 「还不如用这个原型的」—— 取范围是页面骨架）：规格步按原型套编号分段
// （1 选场景 / 2 时间与人数 / 3 价格 / 4 备注）+ 底部汇总条（一行当前选择 + 价格）
// + 确认发布。控件保留已定的（滚轮 / 下拉 / 直接约），配色照旧去粉。
//
// 这条钉守的是骨架：谁把分段拆回散标题、把汇总和按钮搬回滚动流里，这里先红。
// 断言只落在精确写法上 —— 注释里也写着这些词，裸名会被自己的注释喂红（本仓有前科）。
describe("DEMAND-SPECS-SKELETON-001 规格步是编号分段 + 底部汇总条", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );

  it("四段编号分段：选场景 / 时间与人数 / 价格 / 备注", () => {
    expect(wizard).toContain("SpecsSection");
    // DEMAND-SCENE-MAP-001 起第 1 段标题按有无列表切换（有列表才叫选场景）。
    // 断言按**逐个 prop** 落，不写成 `no={1} title=...` 一整串：第 1 段的 hint 槽
    // 从 DEMAND-NOISE-TRIM-001 起是个多行 ReactNode，`no` 与 `title` 已被挤到两行
    // 上 —— 行内连串断言会假红（2026-10-07 实测踩到）。钉要守的是「这四段在、编号
    // 与标题对得上」，不是「props 写在同一行」。
    expect(wizard).toContain("no={1}");
    expect(wizard).toContain('title={sceneBinding ? "选场景" : "地点"}');
    expect(wizard).toContain('title="时间与人数"');
    expect(wizard).toContain('title="价格"');
    expect(wizard).toContain('title="备注"');
    // 徽是 ink 数字徽，不是原型的粉色。
    expect(wizard).toContain("specStepBadge");
  });

  it("分段顺序即页面顺序：场景 → 人时 → 价格 → 备注", () => {
    // 排序锚用 title（唯一、且与 prop 顺序/换行无关），不用行内连串 —— 同上的假红。
    const order = [
      'title={sceneBinding ? "选场景" : "地点"}',
      'title="时间与人数"',
      'title="价格"',
      'title="备注"',
    ].map((marker) => wizard.indexOf(marker));
    for (const [i, pos] of order.entries()) {
      expect(pos).toBeGreaterThan(-1);
      if (i > 0) expect(pos).toBeGreaterThan(order[i - 1]!);
    }
  });

  it("底部汇总条：一行当前选择 + 价格，按钮收在条里", () => {
    expect(wizard).toContain("styles.specsBottomBar");
    expect(wizard).toContain("bottomSummary");
    // 顶上的规格摘要盒撤了 —— 当前选择一页只讲一遍（底部条里）。
    expect(wizard).not.toContain("styles.specSummary");
  });
});
