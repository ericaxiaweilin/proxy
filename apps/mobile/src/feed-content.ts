import type { FeedPost } from "@proxy/contracts";
import { opportunityWhenLabel, type MarketOpportunity } from "./market-fixtures";
import { ENTITY_REF_RELATION } from "./activity-ref";

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
    // MARKET-WHEN-LABEL-001: 合成帖文正文也走同一个「什么时候」串 —— 以前这里
    // 手拼 `${date} ${time}`，需求向导发的机会会印成
    // 「今晚 19:00 今晚 19:00 · 2 小时 · 1:1」。
    body: `${opportunity.title}\n${opportunityWhenLabel(opportunity)} · ${opportunity.location} · ${opportunity.price}`,
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
      // ACTIVITY-REF-001 同一条规矩：contextId 放 **id**，relationType 放关系动词。
      //
      // 这里以前是反的 —— 标题塞进 contextId、id 塞进 relationType。于是这条 ref
      // 两件事都做不到：按 id 定位机会（id 在语义不对的字段里，没人会去读），
      // 以及在 chip 行当标签（它印的是标题，但读端把它当 ref id 用）。
      //
      // ⚠️ 本文件在生产里是**死代码**：只有 isOpportunityPost 被 feed.tsx 引用，
      // opportunityAsPost / mergeFeedContent 只有 feed-content.test.ts 在调。
      // 所以这次改动没有可见效果。真接线时别只把它接上 —— 需要配一张机会卡片，
      // 否则这条 ref 会变成「有引用、没东西可渲染」（跟活动卡片同样的位置）。
      { contextType: "OPPORTUNITY", contextId: opportunity.id, relationType: ENTITY_REF_RELATION },
      { contextType: "DEMAND", contextId: opportunity.theme }
    ],
    createdAt: new Date(now - index * 60_000).toISOString()
  };
}

export function mergeFeedContent(posts: FeedPost[], opportunities: MarketOpportunity[], now: number): FeedPost[] {
  const marketPosts = opportunities.map((item, index) => opportunityAsPost(item, index, now));
  return [...posts, ...marketPosts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
