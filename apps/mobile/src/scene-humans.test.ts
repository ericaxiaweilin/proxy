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
    expect(mapCode).toContain("onPress={() => setSelectedHumanId(human.id)}");
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
