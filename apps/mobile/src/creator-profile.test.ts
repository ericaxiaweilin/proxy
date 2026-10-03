import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseAgentPassport } from "./supply-client";

// CREATOR-PROFILE-001（2026-10-02，用户「最佳匹配的creator 不能看个人主页
// 也看不到关联的社媒账户」）
//
// 详情页原来只有计数 + 占位行。passport（头像/简介/能力/档期）服务端明明发了，
// 移动端 `getAgentPassport` 却是个裸 cast，连 photos 都没进类型 —— 发了也白发。
describe("CREATOR-PROFILE-001 passport 解析留住照片", () => {
  it("照片字段缺了给 []，不断言服务端一定发", () => {
    const p = parseAgentPassport({ profile: { agentId: "a", name: "N" } });
    expect(p?.profile.photos).toEqual([]);
    expect(p?.profile.bio).toBe("");
  });

  it("发了就留住，不丢", () => {
    const p = parseAgentPassport({
      profile: { agentId: "a", name: "N", bio: "向导", photos: ["p1", 42, null], languages: ["ZH"], serviceAreas: ["hn"], status: "ACTIVE" },
      capabilities: [{ capability: "photo", declared: true, verified: true }, "junk", { capability: 7 }],
      availability: [{ id: "w1", startAt: "2026-10-03", endAt: "2026-10-04", marketId: "hn", status: "AVAILABLE" }, null],
    });
    expect(p?.profile.photos).toEqual(["p1"]);
    expect(p?.profile.bio).toBe("向导");
    expect(p?.capabilities).toEqual([{ capability: "photo", declared: true, verified: true }]);
    expect(p?.availability.length).toBe(1);
  });

  it("不是对象就返回 undefined，调用方据此抛（不静默 {}）", () => {
    expect(parseAgentPassport(null)).toBeUndefined();
    expect(parseAgentPassport(42)).toBeUndefined();
    expect(parseAgentPassport({ profile: { name: "缺id" } })).toBeUndefined();
  });
});

describe("CREATOR-PROFILE-001 详情页是系统性个人页", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./surfaces/merchant-me-r21-replacement.tsx", import.meta.url)),
    "utf8"
  );
  // 只取 creatorDetail 这一块（到下一页开始），不然文件尾别的页会污染断言。
  const start = src.indexOf('page === "creatorDetail"');
  const next = src.indexOf('if (page === "', start + 10);
  // 剥注释：修复说明里会复述被禁的词，那是解释不是代码（跟门禁里同一个坑）。
  const detail = src
    .slice(start, next > 0 ? next : undefined)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  // CREATOR-HOME-001 三分法：这页是 creator主页（经营），不是个人主页（帖文）。
  // 之前眉题写"个人主页"是错的，已改成 "Creator 主页 · 经营"。
  it("经营详情不叫个人主页", () => {
    expect(detail).toContain("Creator 主页 · 经营");
    expect(detail).not.toContain("个人主页 · 站内");
  });

  it("有头像（passport 优先，列表回落），有简介", () => {
    expect(detail).toContain("creatorHeroAvatar");
    expect(detail).toContain("creatorPassport?.profile.photos[0] ?? selectedCreator.photos[0]");
    expect(detail).toContain("creatorPassport?.profile.bio");
    // 简介空就不画那一行，不拿服务类型凑字数。
    expect(detail).toContain('!== ""');
  });

  it("能力只给已验证的打标，没验证的不冒充", () => {
    expect(detail).toContain("c.verified");
  });

  it("档期只显示没过的，不编随时可约", () => {
    expect(detail).toContain("upcoming");
    expect(detail).not.toContain("随时可约");
  });

  it("平台个人主页有明确入口按钮，不是整行可点碰运气", () => {
    expect(detail).toContain("socialGo");
    // 按钮写全平台名 + 外跳箭头，不和站内"个人主页"撞名。
    expect(detail).not.toContain("看主页 ›");
    expect(detail).toContain("主页 ↗");
    expect(detail).toContain("creator-social-go-");
    // 没链接的平台（如 Zalo）不画假按钮：按钮只在 url 存在时渲染。
    expect(detail).toContain("{url ? (");
  });

  it("加载中/读失败/空是三种文案，不混为一谈", () => {
    expect(detail).toContain("正在读取社媒信息");
    expect(detail).toContain("creator-social-failed-");
    expect(detail).toContain("尚未关联社媒账户");
  });

  it("有社媒就列出来（平台名+用户名，可点的跳 canonical 链接）", () => {
    expect(detail).toContain("socialProfileUrl(item.platform, item.handle)");
    expect(detail).toContain("socialPlatformLabel(item.platform)");
    // 空态还在 —— 没关联时显示那句，不画空列表。
    expect(detail).toContain("尚未关联社媒账户");
  });

  it("社媒如实空，不编 handles", () => {
    expect(detail).toContain("尚未关联社媒账户");
    expect(detail).toContain("creator-social-empty-");
    // 反向：详情里出现 tiktok/zalo/微信/IG 字样 = 有人在编账号。
    expect(detail).not.toMatch(/tiktok|zalo|微信|instagram|小红书/i);
  });

  it("passport 进详情才拉，列表不预拉", () => {
    expect(src).toContain("getAgentPassport(selectedCreator.agentId)");
    // 失败有文案，不是一片空白。
    expect(detail).toContain("creatorPassportFailed");
  });
});

// CREATOR-SOCIAL-001：socialProfileUrl 只拼 canonical，不拼用户给的 URL。
describe("CREATOR-SOCIAL-001 社媒链接不编造", () => {
  it("四个平台拼对 canonical，zalo 没公开页就不拼", async () => {
    const m = await import("./supply-client");
    expect(m.socialProfileUrl("tiktok", "linh_hn")).toBe("https://www.tiktok.com/@linh_hn");
    expect(m.socialProfileUrl("instagram", "linh.hn")).toBe("https://www.instagram.com/linh.hn");
    expect(m.socialProfileUrl("facebook", "linhhn")).toBe("https://www.facebook.com/linhhn");
    expect(m.socialProfileUrl("zalo", "0912345678")).toBeUndefined();
    // 未知平台不拼 —— 拼出来就是编链接。
    expect(m.socialProfileUrl("wechat", "x")).toBeUndefined();
    expect(m.socialPlatformLabel("wechat")).toBe("wechat");
  });
});

// CREATOR-PROFILE-001（ round 2）：头像规矩 —— 圆圈不是方块、可点进主页。
describe("CREATOR-PROFILE-001 头像圆圈可点", () => {
  const me = readFileSync(fileURLToPath(new URL("./surfaces/merchant-me-r21-replacement.tsx", import.meta.url)), "utf8");

  it("四个 Creator 头像全是圆（999），没有方块R角", () => {
    for (const key of ["creatorAvatar:", "creatorAvatarMissing:", "creatorHeroAvatar:", "creatorHeroAvatarMissing:"]) {
      const i = me.indexOf(key);
      expect(i, key).toBeGreaterThanOrEqual(0);
      const snippet = me.slice(i, i + 160);
      expect(snippet).toContain("borderRadius: 999");
      expect(snippet).not.toMatch(/borderRadius: 1[0-9](,| )/);
    }
  });

  it("头像独立可点进帖文主页（无条件，不赌 userId）", () => {
    expect(me).toContain("creator-avatar-entry-");
    // userId 有就精确命中，没有靠名字回填 —— 两种都有帖子看，不再分叉弹框。
    expect(me).toContain("onOpenCreatorProfile(");
    expect(me).toContain("creator.userAccountId || creator.agentId");
  });

  it("详情大头像也可点进帖文主页（和列表头像同一条）", () => {
    expect(me).toContain("creator-hero-entry-");
    expect(me).toContain("selectedCreator.userAccountId || selectedCreator.agentId");
  });

  it("正文进经营详情（和头像是两个入口）", () => {
    expect(me).toContain("creator-home-entry-");
    expect(me).toContain('setSelectedCreator(creator); setPage("creatorDetail")');
  });
});
