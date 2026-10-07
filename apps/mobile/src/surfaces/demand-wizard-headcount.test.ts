import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DEMAND-HEADCOUNT-003（2026-10-07，用户：「搞成下拉选择框的 …… 不要做成让客户
// 增大摩擦力的视觉」）：「你们几人」六颗常驻 chips 太重，换成贴着触发按钮的下拉
// （SCENE-PICKER-FILTER-ANCHORED-004 同款语言：触发器 + caret，选项行 + ✓，
// 选即收）。常态只占一行小框，默认 1 人，上限 6 人（数据层 HEADCOUNT_OPTIONS）。
//
// 这条钉守的是「别长回常驻六颗」：谁把选项行铺回页面常驻展示，这里先红。
// 断言只落在渲染代码的精确写法上 —— 注释里也写着 chips/caret 这些词，
// 裸名会被自己的注释喂红（本仓有前科）。
describe("DEMAND-HEADCOUNT-003 你们几人是下拉选择，不是常驻六颗", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );
  // 从渲染出来的「你们几人」标题切到下一个渲染标题「时间段」—— 下拉整段在里面。
  const section = wizard.slice(wizard.indexOf("}>你们几人"), wizard.indexOf("}>约定见面时间"));
  const moments = readFileSync(
    fileURLToPath(new URL("../demand-moments.ts", import.meta.url)),
    "utf8"
  );

  it("切片切到了真正的下拉段（切空会让下面几条静默变成空断言）", () => {
    expect(section.length).toBeGreaterThan(200);
    expect(section).toContain('testID="demand-headcount"');
  });

  it("常态只有触发器（值 + caret），六颗选项不常驻", () => {
    // 触发器：当前值 + 开合 caret。
    expect(section).toContain("headcountTrigger");
    expect(section).toContain('"▾"');
    expect(section).toContain('"▴"');
    // 反面：上一版那排常驻 chips（chipRow 裹着 testID 整排铺开）不许回来。
    expect(section).not.toContain('style={styles.chipRow} testID="demand-headcount"');
  });

  it("选项只有 1–6，当前项打 ✓，选即收起", () => {
    expect(section).toContain("HEADCOUNT_OPTIONS.map");
    expect(section).toContain("styles.headcountCheck");
    expect(section).toContain("setHeadcountOpen(false)");
    expect(moments).toContain('HEADCOUNT_OPTIONS = ["1", "2", "3", "4", "5", "6"]');
  });

  it("默认 1 人", () => {
    expect(moments).toContain('DEFAULT_HEADCOUNT = "1"');
    expect(section).toContain("normalizeHeadcount(specs.ratio)");
  });
});
