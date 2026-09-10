import { describe, expect, it } from "vitest";
import type { FeedPost } from "@proxy/contracts";
import type { MarketOpportunity } from "./market-fixtures";
import { isOpportunityPost, mergeFeedContent, opportunityAsPost } from "./feed-content";

const basePost: FeedPost = {
  postId: "post_1",
  authorType: "USER",
  authorId: "user_1",
  body: "普通动态",
  mediaRefs: [],
  status: "PUBLISHED",
  contextRefs: [],
  createdAt: "2026-08-24T00:00:00.000Z"
};

const opportunity: MarketOpportunity = {
  id: "opp_1", title: "活动摄影", shortTitle: "摄影", theme: "摄影", date: "周六", time: "15:00", location: "河内 · 西湖",
  price: "1,500,000₫", moneyFlow: "EARN", priceLabel: "完成后你可获得",
  owner: "Bonsaidon", ownerType: "BUSINESS", match: "91%", responses: 2, posted: "刚刚", skills: "摄影",
  verified: true, lens: ["NEARBY"], travel: 20, signal: "新发布", signalClass: "hot", countdown: "3天"
};

describe("unified feed content", () => {
  it("includes market opportunities in ALL and recognizes them in opportunity filter", () => {
    const merged = mergeFeedContent([basePost], [opportunity], Date.parse("2026-08-24T01:00:00.000Z"));
    expect(merged.map((post) => post.postId)).toContain("market_opportunity:opp_1");
    expect(merged.filter(isOpportunityPost).map((post) => post.postId)).toEqual(["market_opportunity:opp_1"]);
  });

  it("FEED-OWN-001: 服务端写死的个人 Owner 你不进合成帖（读端中性兜底）", () => {
    const personal = opportunityAsPost(
      { ...opportunity, id: "opp_2", owner: "你", ownerType: "PERSON" },
      0,
      Date.parse("2026-08-24T01:00:00.000Z")
    );
    expect(personal.authorDisplayName).toBeUndefined();
    const business = opportunityAsPost(opportunity, 0, Date.parse("2026-08-24T01:00:00.000Z"));
    expect(business.authorDisplayName).toBe("Bonsaidon");
  });
});
