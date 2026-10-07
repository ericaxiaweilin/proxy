import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DEMAND-DURATION-001（2026-10-07，用户：「时长也用滚轮 1H-8H就可以」）：
// 「时长」三颗 chips 换成跟时间段同一个滚轮弹层（标题「时长」，1–8 小时）。
// 常态只占一行小框，默认 2 小时。
//
// 这条钉守的是「滚轮别丢、别长回 chips」：谁把弹层拆了、把三颗摆回来，这里先红。
// 断言只落在精确写法上 —— 注释里也写着这些词，裸名会被自己的注释喂红（本仓有前科）。
describe("DEMAND-DURATION-001 时长是滚轮弹层，不是三颗 chips", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );
  // 从「时长」这一行的触发器切到下一个渲染标题「预计服务价」—— 触发器整段在里面。
  // （偏好行被 DEMAND-PREFS-REMOVE-001 删了，「场景偏好」已不在文件里；
  //  用带 "}>" 前缀的精确写法：裸词会先撞到 publish 里那句报错文案。）
  // DEMAND-INFO-CARD-001 起行是「左 label + 右 值」的紧凑卡行，`}>时长` 落在 testID
  // **之后**（label 是 Pressable 的子节点）⇒ 锚换成行自己的 accessibilityLabel。
  // 两个锚都显式判空：indexOf 找不到返回 -1，`slice(x, -1)` 会**静默切到文件末尾**。
  const start = wizard.indexOf('accessibilityLabel="选择时长"');
  const end = wizard.indexOf("}>预计服务价");
  const section = start >= 0 && end > start ? wizard.slice(start, end) : "";
  const moments = readFileSync(
    fileURLToPath(new URL("../demand-moments.ts", import.meta.url)),
    "utf8"
  );

  it("切片切到了真正的触发器段（切空会让下面几条静默变成空断言）", () => {
    expect(section.length).toBeGreaterThan(200);
    expect(section).toContain('testID="demand-duration"');
  });

  it("触发器开滚轮弹层：标题「时长」，1–8 小时，确认才写回", () => {
    expect(section).toContain("WheelSheet");
    expect(section).toContain('title="时长"');
    expect(section).toContain("options={DURATION_OPTIONS}");
    expect(section).toContain("normalizeDuration(specs.duration)");
    expect(section).toContain("onConfirm");
    expect(section).toContain("onCancel");
  });

  it("三颗 chips 不回来", () => {
    // 反面只精确到旧写法：那排按模板值渲染的行。
    expect(section).not.toContain("DURATIONS.map");
  });

  it("档位 1–8 小时，默认 2 小时", () => {
    expect(moments).toContain("DURATION_MIN_HOURS = 1");
    expect(moments).toContain("DURATION_MAX_HOURS = 8");
    expect(moments).toContain('DEFAULT_DURATION = "2 小时"');
  });

  it("DEMAND-SPECS-ORDER-001 人数 / 时间 / 时长在地点 + 地图之后，不在顶部", () => {
    // 渲染顺序即页面顺序：先挑地方（场景段 + 地点），再定人时时长。
    const order = ["}>地点", 'testID="demand-headcount"', 'testID="demand-timeslot"', 'testID="demand-duration"', "}>预计服务价"]
      .map((marker) => wizard.indexOf(marker));
    for (const [i, pos] of order.entries()) {
      expect(pos).toBeGreaterThan(-1);
      if (i > 0) expect(pos).toBeGreaterThan(order[i - 1]!);
    }
  });

  it("DEMAND-PREFS-REMOVE-001 偏好行不在页面上，死代码不留", () => {
    // 偏好行整段移除：渲染标题、选项循环、切换函数、选项常量都不许回来。
    // 反面只精确到渲染写法与代码标识（注释里的 tombstone 不算）。
    // （默认偏好还在数据层随发布走，见 demand-moments 的 defaultSpecsFor ——
    //  这里只钉页面上不再摆这一行。）
    expect(wizard).not.toContain("}>场景偏好");
    expect(wizard).not.toContain("PREF_OPTIONS");
    expect(wizard).not.toContain("togglePref");
  });
});
