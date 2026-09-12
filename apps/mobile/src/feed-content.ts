import type { FeedPost } from "@proxy/contracts";
import type { MarketOpportunity } from "./market-fixtures";

export function isOpportunityPost(post: FeedPost): boolean {
  return post.authorType === "AGENT" || post.contextRefs.some((ref) =>
    ref.contextType === "OPPORTUNITY" || ref.contextType === "DEMAND" || ref.contextType === "AVAILABILITY"
  );
}

export function opportunityAsPost(opportunity: MarketOpportunity, index: number, now: number): FeedPost {
  return {
    postId: `market_opportunity:${opportunity.id}`,
    authorType: opportunity.ownerType === "BUSINESS" ? "MERCHANT" : "USER",
    authorId: `market_owner:${opportunity.owner}`,
    // FEED-OWN-001: 服务端个人机会 Owner 恒为写死的 "你"；viewer 相对标签
    // 绝不带进合成帖——读端按 author id 判定归属、无名按中性兜底展示。
    ...(opportunity.owner && opportunity.owner !== "你" ? { authorDisplayName: opportunity.owner } : {}),
    body: `${opportunity.title}\n${opportunity.date} ${opportunity.time} · ${opportunity.location} · ${opportunity.price}`,
    mediaRefs: [],
    visibility: "PUBLIC",
    cityScope: opportunity.location.includes("河内")
      ? "hn"
      : opportunity.location.includes("远程")
        ? ""
        : opportunity.location.includes("北宁")
          ? "hanoi"
          : "",
    status: "PUBLISHED",
    contextRefs: [
      { contextType: "OPPORTUNITY", contextId: opportunity.title, relationType: opportunity.id },
      { contextType: "DEMAND", contextId: opportunity.theme }
    ],
    createdAt: new Date(now - index * 60_000).toISOString()
  };
}

export function mergeFeedContent(posts: FeedPost[], opportunities: MarketOpportunity[], now: number): FeedPost[] {
  const marketPosts = opportunities.map((item, index) => opportunityAsPost(item, index, now));
  return [...posts, ...marketPosts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
