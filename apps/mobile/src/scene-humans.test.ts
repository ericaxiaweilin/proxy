import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SCENE-HUMANS-001..004 / SCENE-HUMANS-EMPTY-001 —— 2026-10-08 DEMO-CUT-001 之后
// 这一屏的真相变了：场景详情里**不再有** detail.humans 的 FIXTURE 候选人横滑。
// 以前真实同行推荐（companionSuggestions）为空时，这一块会退回那排标着
// "占位候选"的人，而这里正是选人的付费决策点 —— 用户挑到的是一个不存在的人。
// 现在只有真实命中才画，没有命中就整块不画。
//
// 下面的钉子一条都没删、也没放松成「包含什么都算」：每条都从「旧 markup 在不在」
// 改成「新现实对不对」，而且比原来更严 —— 旧 rail 的任何痕迹（数据源 map、
// 名字/可约原文的展示位、占位标签、点按选中态、空态那句话）回来了就是红。
const map = readFileSync(fileURLToPath(new URL("./surfaces/reality-scene-map.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const mapCode = stripComments(map);
// 「这一整块」的范围：深色匹配卡从 styles.matchCard 起，到下一节标题行为止。
// 钉区域而不是钉全文，是因为确认单里还留着另一处 selectedHuman 的展示（本轮没动）。
function matchCardBlock(): string {
  const start = mapCode.indexOf("styles.matchCard");
  const end = mapCode.indexOf("styles.sectionTitleRow", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return mapCode.slice(start, end);
}

describe("SCENE-HUMANS-001 the only people rail in the scene detail is the real companion rail", () => {
  it("renders round avatars from real recommendations", () => {
    expect(mapCode).toContain("<CircularAvatarImage");
    expect(mapCode).toContain("companionSuggestions.map");
    expect(mapCode).toContain("{person.name}");
  });

  it("no longer renders FIXTURE candidate rows at all", () => {
    // 这几样合起来就是那条演示横滑：数据源 map、可点的候选人、可约原文的展示位，
    // 以及每个占位人尾巴上的 " · 占位候选" 标签。
    expect(mapCode).not.toContain("detail.humans.map");
    expect(mapCode).not.toContain('<Pressable key={human.id}');
    expect(mapCode).not.toContain("human.availability");
    expect(mapCode).not.toContain('{human.source === "FIXTURE" ? " · 占位候选" : ""}');
    // 名字不反向钉：`human.name` 在邀约 payload 里还要用（CreateInvitation 的 who、
    // 以及那句 "邀请已发送给 …"），那是发包代码不是渲染。要钉的是「不再把它画成
    // 一个可选的人」—— 那行 JSX 的形状。
    expect(mapCode).not.toContain("styles.humanPlainNameOnDark>{human.name}");
  });

  it("keeps the square info block out without touching the data", () => {
    // role / fit% 不渲染是 SCENE-HUMANS-001 的原意，这一条在新现实下依然成立：
    // 类型里的 role / sceneFit 字段还在（邀约卡与 OPEN_TASK 技能标签要用），
    // 删的从来只是展示行。
    expect(mapCode).not.toContain("{human.role}");
    expect(mapCode).not.toContain("Scene fit {human.sceneFit}");
    expect(mapCode).toContain('"Scene fit / UGC"');
  });
});

describe("SCENE-HUMANS-002 people are bare round heads, no white card", () => {
  it("keeps the bare-head shape on the real rail and never re-wraps it in a card", () => {
    // 白卡片（humanCard）回来就等于把方形块又套回去了。
    expect(mapCode).not.toContain("styles.humanCard");
    expect(mapCode).toContain("styles.humanPlain");
    expect(mapCode).toContain("styles.humanRing");
    // 头像尺寸自 AVATAR-UNIFY-001 起是全 app 行头像同款 44 —— 这里钉**实际值**。
    // （原来钉的是 size={64}：AVATAR-UNIFY-001 把 64 改成 44 之后这条就已经红了，
    //  把它一起带进下面的 64 反向钉，是为了不许谁再悄悄放大回去。）
    expect(mapCode).toContain("size={44}");
    expect(mapCode).not.toContain("size={64}");
  });
});

describe("SCENE-HUMANS-003 the invite chain keeps its person without the placeholder rail", () => {
  it("auto-seeds the invite target from the server detail and keeps the guard", () => {
    // 旧的「点一下选中 / 再点取消」是那条 rail 上的交互，rail 没了它也没了。
    // DIRECT_INVITE 不能因此找不到人 —— 撑着这条链的是 detail 到手时把
    // humans[0] 设为邀约对象，所以钉它，而不是钉已经消失的点按表达式。
    expect(mapCode).toContain("setSelectedHumanId(value.humans[0]?.id)");
    expect(mapCode).not.toContain("setSelectedHumanId((prev) => (prev === human.id");
    // 没选中时邀约照样拦，不断链。
    expect(mapCode).toContain("请先选择要邀请的真人");
  });
});

describe("SCENE-HUMANS-004 the placeholder rail renders zero times", () => {
  it("mounts no humans map in the detail rail", () => {
    // 原来是「有且仅有一个挂载点」（曾经同一天 map 并排挂了两遍，每人出现两次）。
    // DEMO-CUT-001 之后正确数量是 0：多一个等于演示数据回来了。
    const mounts = mapCode.split("detail.humans.map").length - 1;
    expect(mounts).toBe(0);
  });
});

// SCENE-HUMANS-EMPTY-001: 选人是付费决策点 —— 这一块的空态现在由「什么都不画」
// 承担：没有真实同行推荐就没有人选 rail，也就没有拿 FIXTURE 顶上去的"有人"假象。
describe("SCENE-HUMANS-EMPTY-001 the people block stays empty of demo data when there are no real recommendations", () => {
  it("draws only the real rail inside the match card", () => {
    const block = matchCardBlock();
    expect(block).toContain("companionSuggestions.length > 0");
    expect(block).not.toContain("detail.humans");
    expect(block).not.toContain("humanEmptyOnDark");
    // 那一屏的空态组件整体不再被使用（样式定义留着，是给下一次真接上
    // 「可约时间」时用的；渲染它的那行 JSX 才是这条钉要拦的东西）。
    expect(mapCode).not.toContain("styles.humanEmptyOnDark");
  });

  it("does not promise that waiting will produce someone, and does not fake someone either", () => {
    // 原来这里钉的是那句空态文案（"还没有挂出可约时间的人"）。DEMO-CUT-001 之后
    // 没有真实命中就整块不画，那句话连同它描述的占位 rail 一起消失 —— 两条都不许回来：
    // 一句是"再等等就会有人"式的安抚承诺，另一句是给自己没接线找台阶。
    expect(mapCode).not.toContain("还没有挂出可约时间的人");
    expect(mapCode).not.toContain("再等等就会有人");
  });
});
