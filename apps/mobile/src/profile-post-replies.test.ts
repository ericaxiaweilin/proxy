import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// PROFILE-REPLIES-VISIBLE-001 —— 个人主页帖子收到的赞数/评论列表以前根本不渲染：
// feed 里能看到的互动，在主页 PostCard 上只有动作按钮。调用方传 engagementClient
// 进来后 hydrate 计数、点开拉评论；作者名走 resolveReplyAuthorDisplayName，
// 无名不显示裸 id；没传 client 就是今天的样子。
describe("PROFILE-REPLIES-VISIBLE-001 profile posts show received engagement", () => {
  const tabs = readFileSync(new URL("./surfaces/ProfileTabs.tsx", import.meta.url), "utf8");
  const me = readFileSync(new URL("./surfaces/me.tsx", import.meta.url), "utf8");
  const other = readFileSync(new URL("./surfaces/other-profile.tsx", import.meta.url), "utf8");

  it("ProfileTabs hydrates per-post engagement and lazy-loads replies on expand", () => {
    expect(tabs).toContain("engagementClient?: EngagementClient | undefined;");
    expect(tabs).toContain("client.getPostEngagement(postId)");
    expect(tabs).toContain("client.listPostReplies(postId, 50)");
    expect(tabs).toContain("function togglePostReplies(postId: string): void {");
  });

  it("counts render only when loaded, never fabricated zeros", () => {
    expect(tabs).toContain("props.engagement.reactions > 0 || props.engagement.replies > 0");
    expect(tabs).toContain("💬 {props.engagement.replies} 条评论");
  });

  it("reply authors resolve to display names, never bare ids", () => {
    expect(tabs).toContain("resolveReplyAuthorDisplayName(reply, props.replyViewerId)");
    expect(tabs).toContain("replyViewerId={props.viewerAccountId}");
  });

  it("both profile callers thread the client through", () => {
    expect(me).toContain("engagementClient={engagement ?? undefined}");
    expect(other).toContain("engagementClient={engagement}");
  });
});
