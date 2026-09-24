import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ANALYTICS-ME-001 —— 「我的」分析弹层浏览/互动两行曾写死 "—"，从没接过数据源。
// 浏览 = 近 30 天主页访问（ListProfileViewStats 传 sinceDays: 30，全量口径
// 留给 friend-crm 不动）；互动 = 近 30 天收到的赞 + 评论（服务端聚合，
// 自赞/自评排除，客户端不做 N+1）。拉失败是未知画 —，不画 0。
describe("ANALYTICS-ME-001 profile analytics sheet is wired", () => {
  const me = readFileSync(new URL("./surfaces/me.tsx", import.meta.url), "utf8");
  const engagementClient = readFileSync(new URL("./engagement-client.ts", import.meta.url), "utf8");
  const localnetClient = readFileSync(new URL("./localnet-client.ts", import.meta.url), "utf8");

  it("the sheet loads views + received engagements when opened", () => {
    expect(me).toContain("listProfileViewStats(30)");
    expect(me).toContain("getReceivedEngagementStats()");
    expect(me).toContain("if (!insightsSheetOpen || !engagement) return;");
  });

  it("the sheet renders dash() on unknown, never a fabricated 0", () => {
    expect(me).toContain("{dash(profileAnalytics.opens)}");
    expect(me).toContain("{dash(profileAnalytics.interactions)}");
    expect(me).toContain("setProfileAnalytics({ opens: undefined, interactions: undefined })");
  });

  it("received engagement comes from a server aggregate, not per-post fan-out", () => {
    expect(engagementClient).toContain('"GetReceivedEngagementStats"');
    expect(engagementClient).toContain("ReceivedEngagementStatsSchema.parse(raw.stats)");
    expect(me).not.toMatch(/getPostEngagement\(post\.postId\)/);
  });

  it("profile view stats accept an optional window without changing the default", () => {
    expect(localnetClient).toContain("listProfileViewStats(sinceDays?: number)");
    expect(localnetClient).toContain("sinceDays } : {})");
  });
});
