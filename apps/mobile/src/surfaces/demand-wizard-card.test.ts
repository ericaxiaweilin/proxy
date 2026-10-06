import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MOMENT_ACTION_ID, MOMENT_TEMPLATES, momentDistanceLabel, momentMetaLine, momentStartPrice } from "../demand-moments";
import { ACTION_SCENE_KEYWORDS } from "../scene-category-entries";
import type { SceneSpot } from "../activity-create-form";

// DEMAND-WIZARD-CARD-001: 发布需求卡片右侧那一格画什么。
//
// 2026-10-06 用户：「我给你的原型基本要对齐啊 …… 有距离 有大概接单时间 移除1:1
// 因为概念理解复杂 变成起步价格」。原型卡片是 item-top（名字 | 价格）/ item-desc /
// item-bottom（tags | meta）—— 价格贴在**标题那一行**的右端，不是另起一个侧栏。
//
// 此前卡面右侧是一个独立侧栏：上格是 `defaultRatio`（`1:1`），下格是
// `defaultTime`（`今晚 19:00`）。1:1 要用户先懂「几个人对几个人」才读得懂，撤掉；
// 底行换成「距离 · 大概时长」。
//
// 距离那一格**不编数**：用户在被问到数据源时选的是「接真实距离」，所以距离是
// 「你的定位 → 这类 Moment 最近的真实场景」算出来的（见 momentDistanceLabel）。
//
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

  it("起步价挂在标题那一行的右端，底行是「距离 · 时长」", () => {
    // 价格和标题同一个 flex 行（momentTop）—— 不是原来那个独立侧栏。
    expect(momentRow).toContain("styles.momentTop");
    expect(momentRow).toContain("styles.momentPriceNum");
    expect(momentRow).toContain("momentStartPrice(item)");
    // 底行：tags 在左，meta 靠 marginLeft:auto 推到右端（momentMeta）。
    expect(momentRow).toContain("styles.momentBottom");
    expect(momentRow).toContain("momentMetaLine(distance, item)");
    // 距离来自真实定位 + 真实场景目录，不是写死的数。
    expect(momentRow).toContain("momentDistances[item.id]");
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

describe("DEMAND-WIZARD-CARD-001 距离是算出来的，不是编的", () => {
  const hanoi = { latitude: 21.0288, longitude: 105.8525 };
  const spot = (over: Partial<SceneSpot>): SceneSpot => ({
    id: "s", name: "", type: "", category: "", area: "", imageUrl: "",
    latitude: Number.NaN, longitude: Number.NaN,
    ...over
  });
  // 关键词命中 coffee 的归属词「咖啡」（ACTION_SCENE_KEYWORDS）。
  const cafe = spot({ id: "c1", name: "Cafe Giang", type: "咖啡", area: "还剑湖", latitude: 21.0285, longitude: 105.8530 });

  it("有定位 + 有真实场景 → 按原型口径给出距离", () => {
    // 同一片街区，几十米级 —— 口径就是 formatShopDistance（不足 1km 写米）。
    expect(momentDistanceLabel([cafe], "coffee", hanoi)).toMatch(/^\d+m$/);
  });

  it("取最近的那个场景，不是列表里第一个", () => {
    const far = spot({ id: "c2", name: "Cafe 远", type: "咖啡", latitude: 21.20, longitude: 106.00 });
    // 数组顺序反着来，结果必须一样 —— 否则就是「拿第一个」而不是「拿最近的」。
    expect(momentDistanceLabel([far, cafe], "coffee", hanoi))
      .toBe(momentDistanceLabel([cafe], "coffee", hanoi));
    expect(momentDistanceLabel([far, cafe], "coffee", hanoi))
      .not.toBe(momentDistanceLabel([far], "coffee", hanoi));
  });

  it("拿不到距离就返回空串，一个数都不编", () => {
    // 没定位 —— 不拿河内市中心当「你的位置」。
    expect(momentDistanceLabel([cafe], "coffee", undefined)).toBe("");
    // 这一类没有归属词（打球 / 城市协助的 action id 目前就没有）—— 如实返回空。
    expect(momentDistanceLabel([cafe], "ballgame", hanoi)).toBe("");
    // 脏坐标 —— 不算，也不当成 0。
    expect(momentDistanceLabel([spot({ id: "bad", name: "咖啡", type: "咖啡" })], "coffee", hanoi)).toBe("");
    // 空目录。
    expect(momentDistanceLabel([], "coffee", hanoi)).toBe("");
  });

  it("人在 50km 外就不写距离（shopCardDistance 的 FAR_AWAY 口径）", () => {
    // 河内 → 胡志明市约 1100km：直线距离是真的，但对用户毫无意义。
    expect(momentDistanceLabel([cafe], "coffee", { latitude: 10.7769, longitude: 106.7009 })).toBe("");
  });

  it("底行 = 距离 · 时长；没距离就只剩时长", () => {
    const coffee = MOMENT_TEMPLATES.find((item) => item.id === "coffee")!;
    expect(momentMetaLine("1.2km", coffee)).toBe(`1.2km · ${coffee.defaultDuration}`);
    expect(momentMetaLine("", coffee)).toBe(coffee.defaultDuration);
  });
});

// DEMAND-WIZARD-LOCATION-001（2026-10-06 用户「缺少距离字段」）：算得对不等于看得见。
//
// 上面那组钉的是 momentDistanceLabel / momentMetaLine 的**算法**，它们全绿的时候，
// 用户截图里五张卡的底行仍然只剩时长 —— 因为这一屏取定位时用了 getCurrentFix 的
// 默认值（requestPermission: false）：没授权时 helper 第一行就返回 undefined，
// origin 恒为 undefined，每条模板的距离都算成空串。模拟器的 TCC.db 里连一条
// kTCCServiceLocation 都没有，正说明这一屏从来没弹过授权框。
//
// 兄弟屏 hot-scenes / scene-shop-directory 都是挂载时 requestPermission: true；
// 这一屏对齐它们。DEVICE-LOCATION-003 里 helper 的默认值仍归 device-location.test.ts
// 钉（那条默认值是给开屏那次用的），本文件只钉**这一屏有没有问**。
describe("DEMAND-WIZARD-LOCATION-001 距离那一格必须真的问得到定位", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );

  it("挂载时取定位必须带 requestPermission: true", () => {
    expect(wizard).toContain("getCurrentFix(expoLocationApi, { requestPermission: true })");
  });

  it("不许退回不带 options 的裸调用（那正是「永远没有距离」的写法）", () => {
    // 裸调用 = 括号紧跟在 expoLocationApi 后面，一个 options 都没有。
    expect(wizard).not.toContain("getCurrentFix(expoLocationApi)");
  });

  it("没定位时仍旧不编距离（拿到 undefined 就走原有回退，不塞假坐标）", () => {
    // 断言的是「setOrigin 只在 fix 为真时执行」，不是「一定 setOrigin」。
    expect(wizard).toContain("if (!cancelled && fix) setOrigin(");
  });
});

// DEMAND-MOMENT-BINDING-001（2026-10-06 用户：「骑行绑定人 不是场景 …… 就2种
// 一种是时间+距离 一种是时间」）。
//
// 底行只有两种形状，哪一种由模板的 `binding` 决定。此前「骑行没有距离」是
// **归属词恰好没命中**的副产品 —— 目录里哪天加一条骑行场景，它就会突然冒出距离，
// 跟「绑定人」这条口径相反。所以这里钉的不是「骑行现在显示什么」（那是数据），
// 而是「骑行绑人 ⇒ 目录里放什么都一个距离都不画」（那是口径）。
describe("DEMAND-MOMENT-BINDING-001 绑定场景 / 绑定人", () => {
  const hanoi = { latitude: 21.0288, longitude: 105.8525 };
  const spot = (over: Partial<SceneSpot>): SceneSpot => ({
    id: "s", name: "", type: "", category: "", area: "", imageUrl: "",
    latitude: Number.NaN, longitude: Number.NaN,
    ...over
  });

  it("每个模板都声明了 binding，且只有 scene / person 两种", () => {
    expect(MOMENT_TEMPLATES.length).toBeGreaterThan(0);
    for (const template of MOMENT_TEMPLATES) {
      expect(["scene", "person"], `${template.title} 的 binding 不认识`).toContain(template.binding);
    }
  });

  it("骑行绑定人：就算目录里有一条骑行场景，也一个距离都不画", () => {
    const bike = spot({ id: "b1", name: "西湖骑行绿道", type: "骑行 · 绿道", area: "西湖", latitude: 21.055, longitude: 105.82 });
    expect(momentDistanceLabel([bike], "ride", hanoi)).toBe("");
  });

  it("绑定人的模板拿不到距离，绑定场景的照旧拿得到", () => {
    const personBound = MOMENT_TEMPLATES.filter((item) => item.binding === "person");
    expect(personBound.map((item) => item.id)).toContain("ride");
    for (const template of personBound) {
      // 关键：尽量给一个**能命中它自己归属词**的场景（骑行就给骑行场景），
      // 这样唯一能拦住距离的就是 binding —— 否则这条钉会靠「关键词恰好不匹配」
      // 蒙过去（注入验证时实测过：给咖啡场景，撤掉守卫它照样绿）。
      const words = ACTION_SCENE_KEYWORDS[MOMENT_ACTION_ID[template.id] ?? ""] ?? [];
      const scene = spot({ id: "p1", name: words[0] ?? "无关场景", type: words[0] ?? "无关", area: "还剑湖", latitude: 21.0285, longitude: 105.853 });
      expect(momentDistanceLabel([scene], template.id, hanoi), `${template.title} 绑人却给出了距离`).toBe("");
    }
    const cafe = spot({ id: "c1", name: "Cafe Giang", type: "咖啡", area: "还剑湖", latitude: 21.0285, longitude: 105.853 });
    expect(momentDistanceLabel([cafe], "coffee", hanoi)).toMatch(/^\d+m$/);
  });

  it("绑定场景的模板必须有关键词表，否则会静默拿不到距离", () => {
    for (const template of MOMENT_TEMPLATES.filter((item) => item.binding === "scene")) {
      const actionId = MOMENT_ACTION_ID[template.id] ?? "";
      expect(actionId, `${template.title} 绑场景却没有 action id`).not.toBe("");
      expect(ACTION_SCENE_KEYWORDS[actionId], `${template.title} 绑场景却没有归属词`).toBeDefined();
    }
  });

  it("底行只有两种形状：时间+距离，或时间。永远没有「只有距离」", () => {
    for (const template of MOMENT_TEMPLATES) {
      // 有距离 ⇒ 时间+距离；时间那一格恒非空，所以顺序和内容都是确定的。
      expect(momentMetaLine("1.2km", template)).toBe(`1.2km · ${template.defaultDuration}`);
      // 没距离 ⇒ 只剩时间，而且**不是空串**（空串会让底行整格消失）。
      expect(momentMetaLine("", template)).toBe(template.defaultDuration);
      expect(momentMetaLine("", template)).not.toBe("");
    }
  });
});
