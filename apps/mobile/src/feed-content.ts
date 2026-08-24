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
    authorDisplayName: opportunity.owner,
    body: `${opportunity.title}\n${opportunity.date} ${opportunity.time} · ${opportunity.location} · ${opportunity.price}`,
    mediaRefs: [],
    visibility: "PUBLIC",
    cityScope: opportunity.location.includes("河内") ? "hn" : "vn",
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
