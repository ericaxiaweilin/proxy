import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DEMAND-TIMESLOT-001（2026-10-07，用户：「不要写今晚 …… 时间下拉就可以
// 06:00-22:00，支持 m 精度」）：「时间段」自由输入换成 06:00–22:00 半小时一档的
// 下拉，跟「你们几人」同一套触发器 + 菜单语言（33 档菜单 CAP 高度内部滚）。
// 常态只占一行小框，「今晚」这类词到此为止。
//
// 这条钉守的是「别长回输入框、别写回今晚」：谁把 TextInput 摆回来，
// 或把中文时间词写回渲染层，这里先红。断言只落在精确写法上 ——
// 注释里也写着这些词，裸名会被自己的注释喂红（本仓有前科）。
describe("DEMAND-TIMESLOT-001 时间段是下拉选择，不是输入框", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );
  // 从渲染出来的「时间段」标题切到下一个渲染标题「时长」—— 下拉整段在里面。
  const section = wizard.slice(wizard.indexOf("}>时间段"), wizard.indexOf("}>时长"));
  const moments = readFileSync(
    fileURLToPath(new URL("../demand-moments.ts", import.meta.url)),
    "utf8"
  );

  it("切片切到了真正的下拉段（切空会让下面几条静默变成空断言）", () => {
    expect(section.length).toBeGreaterThan(200);
    expect(section).toContain('testID="demand-timeslot"');
  });

  it("常态只有触发器（值 + caret），选项收在下拉里", () => {
    expect(section).toContain("TIME_SLOT_OPTIONS.map");
    expect(section).toContain('"▾"');
    expect(section).toContain('"▴"');
    expect(section).toContain("setTimeOpen(false)");
  });

  it("输入框不回来，「今晚」不写回渲染层", () => {
    // 反面只精确到这一段的旧写法：时间输入框的占位曾是模板的 defaultTime 表达式。
    expect(section).not.toContain("placeholder={template?.defaultTime}");
    expect(section).not.toContain("今晚");
  });

  it("档位 06:00–22:00 半小时一档，菜单 CAP 高度内部滚", () => {
    expect(moments).toContain("TIME_SLOT_MIN_HOUR = 6");
    expect(moments).toContain("TIME_SLOT_MAX_HOUR = 22");
    expect(section).toContain("headcountMenuList");
    expect(section).toContain("nestedScrollEnabled");
  });
});
