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
    // PROFILE-ACTION-COUNTS-001 收尾（2026-09-25，用户「少了评论logo功能」）之后，
    // 评论数只有**一个**落点：动作行第 2 颗 —— 原型 `function post(p)` 就是
    // `<button>${I.reply}<span>${p.replies}</span></button>`（图标 + 评论数）。
    // 闸门必须「拉到才画」（`props.engagement ? … : null`），不回填 0；真·0 照常显示 0。
    // 以前动作行下面那行独立的「💬 N 条评论 ﹀」开关整行删掉了：动作行第 2 颗现在
    // **就是**这个开关（它同时是评论入口），留着那行等于同屏两个评论入口、
    // 隔 8px 说同一个数字。
    expect(tabs).toContain("{props.engagement ? <Text selectable style={styles.postActionCount}>{props.engagement.replies}</Text> : null}");
    expect(tabs).not.toContain("条评论 {props.repliesExpanded");
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
