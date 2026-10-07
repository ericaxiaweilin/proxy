import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DEMAND-TIMESLOT-002（2026-10-07，用户给原型 deepseek_html_20261007：
// 「时间用滚轮的」）：001 那版下拉列表换成 iOS 滚轮 + 底部弹层（取消 / 开始时间 /
// 确定，中间高亮条，点选 + 滚选，松手吸附）。档位还是 06:00–22:00 半小时一档，
// 行只写 HH:MM，「今晚」这类词照旧不上界面。
//
// 这条钉守的是「滚轮别丢、别长回输入框」：谁把弹层拆了、把 TextInput 摆回来，
// 或把中文时间词写回渲染层，这里先红。断言只落在精确写法上 ——
// 注释里也写着这些词，裸名会被自己的注释喂红（本仓有前科）。
describe("DEMAND-TIMESLOT-002 时间段是滚轮弹层，不是输入框", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );
  // 从渲染出来的「时间段」标题切到下一个渲染标题「时长」—— 触发器整段在里面。
  const section = wizard.slice(wizard.indexOf("}>时间段"), wizard.indexOf("}>时长"));
  const moments = readFileSync(
    fileURLToPath(new URL("../demand-moments.ts", import.meta.url)),
    "utf8"
  );

  it("切片切到了真正的触发器段（切空会让下面几条静默变成空断言）", () => {
    expect(section.length).toBeGreaterThan(200);
    expect(section).toContain('testID="demand-timeslot"');
  });

  it("触发器开滚轮弹层：取消 / 开始时间 / 确定，临时值确认才写回", () => {
    expect(section).toContain("WheelSheet");
    expect(section).toContain("onConfirm");
    expect(section).toContain("onCancel");
    expect(wizard).toContain("开始时间");
    expect(wizard).toContain('"取消"');
    expect(wizard).toContain('"确定"');
  });

  it("滚轮认得出：高亮条 + 吸附 + 点选直达 + 开局定位", () => {
    expect(wizard).toContain("timeWheelHighlight");
    expect(wizard).toContain("snapToInterval");
    // DEMAND-DURATION-001 起滚轮由时间段独享改为共用（WheelSheet 吃 options 参数），
    // 时间这处传的还是 06:00–22:00 那组档位。
    expect(wizard).toContain("options.map");
    expect(section).toContain("options={TIME_SLOT_OPTIONS}");
    expect(wizard).toContain("scrollTo({ y:");
  });

  it("输入框不回来，「今晚」不写回渲染层，旧下拉菜单样式清掉", () => {
    // 反面只精确到旧写法：时间输入框的占位曾是模板的 defaultTime 表达式；
    // 001 那版内滚菜单用到的两处也该没了（滚轮自带定位，不需要它们）。
    expect(section).not.toContain("placeholder={template?.defaultTime}");
    expect(section).not.toContain("今晚");
    expect(wizard).not.toContain("nestedScrollEnabled");
    expect(wizard).not.toContain("headcountMenuList");
  });

  it("档位还是 06:00–22:00 半小时一档", () => {
    expect(moments).toContain("TIME_SLOT_MIN_HOUR = 6");
    expect(moments).toContain("TIME_SLOT_MAX_HOUR = 22");
  });
});
