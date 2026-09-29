import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SCENE-HUMANS-001: 场景详情“一起玩的人”只露圆头像 + 名字 + 可约状态。
// 之前是方形信息块：role / fit% / fitReason 全摊在这一屏，而详情都在个人主页。
// 圆头像和首页同款（CircularAvatarImage，真圆裁剪）；点按仍是“选中邀约对象”
// （DIRECT_INVITE 靠它找人），只动展示不动链。注释先剥掉再断言，只认代码。
const map = readFileSync(fileURLToPath(new URL("./surfaces/reality-scene-map.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const mapCode = stripComments(map);

describe("SCENE-HUMANS-001 scene people show a round avatar, name and order availability", () => {
  it("renders the homepage-style round avatar with name and availability", () => {
    expect(mapCode).toContain("<CircularAvatarImage");
    expect(mapCode).toContain("human.availability");
    expect(mapCode).toContain("{human.name}");
  });

  it("drops the square info block without touching the data", () => {
    // role / fit% 不再渲染 —— 类型里的 role / sceneFit 字段还在（邀约卡片要用名，
    // 服务端照常下发），删的是展示行。注意 OPEN_TASK 发包里的 "Scene fit / UGC"
    // 技能标签是另一回事，不许碰。
    expect(mapCode).not.toContain("{human.role}");
    expect(mapCode).not.toContain("Scene fit {human.sceneFit}");
    expect(mapCode).toContain('"Scene fit / UGC"');
  });

  it("keeps tap-to-select for the invite chain", () => {
    // 点按＝选中邀约对象：DIRECT_INVITE 找不到人会报“请先选择要邀请的真人”。
    // 改成跳个人主页就断了这条链，所以选中态（紫环＋✓ 已选择）必须留。
    // SCENE-HUMANS-003 起点按是 toggle（选中→取消），表达式以 toggle 为准。
    expect(mapCode).toContain("setSelectedHumanId((prev) => (prev === human.id ? undefined : human.id))");
    expect(mapCode).toContain("✓ 已选择");
    expect(mapCode).toContain("humanRingSelected");
  });
});

describe("SCENE-HUMANS-002 people are bare round heads, no white card", () => {
  it("drops the card wrapper and enlarges the circle", () => {
    // 白卡片（humanCard）整个拿掉：纯圆头 64＋名字＋可约状态居中。
    // 卡片回来就等于把方形块又套回来了。
    expect(mapCode).not.toContain("styles.humanCard");
    expect(mapCode).toContain("size={64}");
    expect(mapCode).toContain("styles.humanPlain");
  });
});
describe("SCENE-HUMANS-003 tapping the selected person deselects", () => {
  it("toggles selection instead of sticking on the first tap", () => {
    // 操作逻辑 bug：点一下选中，再点同一个没有任何反应 —— 选错人只能去选
    // 别人顶掉，取消不掉。同一头像点两次 = 选中→取消。
    expect(mapCode).toContain("setSelectedHumanId((prev) => (prev === human.id ? undefined : human.id))");
    // 没选中时邀约照样拦（"请先选择要邀请的真人"），不断链。
    expect(mapCode).toContain("请先选择要邀请的真人");
  });
});

describe("SCENE-HUMANS-004 people rail renders exactly once", () => {
  it("mounts a single humans map in the detail rail", () => {
    // 渲染 bug：humanRail 里同一行 detail.humans.map 并排出现两次 ——
    // 点进场景主页，每个人（头像/名字/可约态）都出现两遍，还各带各的选中态。
    // 数代码里 map 的挂载点：有且仅有一个，多一个少一个都是错。
    const mounts = mapCode.split("detail.humans.map").length - 1;
    expect(mounts).toBe(1);
  });
});

// SCENE-HUMANS-EMPTY-001: 选人是付费决策点 —— 没有人时必须说出"没有人"。
// 以前 detail.humans 为空时这一块只剩标题和一个空横滑，读起来像"还在加载"，
// 而用户此刻正准备付钱。
describe("SCENE-HUMANS-EMPTY-001 an empty people list says so", () => {
  it("branches on the list instead of rendering an empty rail", () => {
    expect(mapCode).toContain("detail.humans.length > 0 ?");
    expect(mapCode).toContain("styles.humanEmpty");
  });

  it("does not promise that waiting will produce someone", () => {
    // 空态只留一句话（2026-09-28 清废话）：点名没人，不做任何"等等就会有"的承诺。
    const empty = mapCode.slice(mapCode.indexOf("styles.humanEmpty"));
    expect(empty).toContain("还没有挂出可约时间的人");
    expect(empty).not.toContain("再等等就会有人");
  });
});
