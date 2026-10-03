import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CREATOR-RAIL-HOME-001（2026-10-02，用户「点击creator头像 不能弹出入口」）
//
// 商家主页横滑卡（Creator 推荐）点人脸/卡片，以前直接 onOpenAll —— 进 Market
// 机会大盘。点的是 Linh 的脸，落到的是市场，跟这个人一点关系没有。
// 现在：卡片点人进个人主页弹窗（头像圆圈 + 简介 + 社媒平台入口），
// "查看全部 ›" 才进 Market（那是看全部，不是看人）。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("CREATOR-RAIL-HOME-001 横滑卡点人进主页，不进大盘", () => {
  const rail = strip(read("./surfaces/merchant-creator-recommendations.tsx"));

  it("卡片 onPress 走个人主页入口，有回落", () => {
    expect(rail).toContain("onOpenCreator");
    expect(rail).toContain("rail-creator-home-");
    // 没接 onOpenCreator 的别处复用不断：回落 onOpenAll。
    expect(rail).toContain("if (onOpenCreator) onOpenCreator(creator); else onOpenAll();");
  });

  it("查看全部仍然进 Market（那是看全部，不是看人）", () => {
    expect(rail).toContain("查看全部");
    expect(rail).toContain("onPress={onOpenAll}");
  });
});

// CREATOR-HOME-001（2026-10-02，用户「不能进入proxy账户的个人公共主页」）：
// 平台早有公开主页（OtherProfileSurface）。有 userAccountId 就进真主页，
// 没有才退回弹窗 —— 弹窗是未关联账号的兜底，不是正门。
describe("CREATOR-RAIL-HOME-001 主页弹窗有头像圆圈和平台入口", () => {
  const home = strip(read("./surfaces/business-home.tsx"));

  it("永远进帖文主页，不分叉弹框（userId 有就精确，没有靠名字回填）", () => {
    const home = strip(read("./surfaces/business-home.tsx"));
    expect(home).toContain("onOpenCreatorProfile(c.userAccountId || c.agentId, c.name, photoUri)");
    // 弹窗已删：卡片点人只有一条路，不再"没号弹框有号跳页"。
    expect(home).not.toContain("setRailCreator");
    expect(home).not.toContain("railModal");
  });
});
