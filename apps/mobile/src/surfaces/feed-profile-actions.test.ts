import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const feed = readFileSync(new URL("./feed.tsx", import.meta.url), "utf8");

describe("SELF-FOLLOW-001 本人帖子的头像菜单不提供「关注」", () => {
  // 移动端没有 testing-library / react-test-renderer，组件不能真渲染，所以这里钉源码结构。
  // 后端已经拒绝自关注（CANNOT_FOLLOW_SELF）；这一层的作用是别让用户看到一个必然失败的操作。

  it("gates the 关注 row on isOwnAuthorId(profileActions.userId, viewerAccountId)", () => {
    expect(feed).toContain("!isOwnAuthorId(profileActions.userId, viewerAccountId)");
  });

  it("guards toggleProfileFollow too, before it can send anything", () => {
    const fnAt = feed.indexOf("async function toggleProfileFollow(");
    const guardAt = feed.indexOf("isOwnAuthorId(profileActions.userId, viewerAccountId)", fnAt);
    const busyAt = feed.indexOf("setProfileFollowBusy(true)", fnAt);
    expect(fnAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    expect(busyAt).toBeGreaterThan(-1);
    // 门必须排在真正开始请求之前，否则「隐藏按钮」只是表面功夫。
    expect(guardAt).toBeLessThan(busyAt);
  });

  it("still lets you reach your own profile — 访问个人主页 stays ungated", () => {
    // 这正是 PROFILE-FROM-ANY-TAB-001 修的那条路：自己帖子点头像 → 访问个人主页
    // 必须仍然可用。别把「不显示关注」误做成「不显示菜单」。
    // 注意锚点要用真正的 JSX 文本：文件里有三处注释也提到「访问个人主页」
    // （写入方说明 / 头像 onPress 说明），用 indexOf 会命中注释而不是那一行。
    const menuAt = feed.indexOf(">访问个人主页</Text>");
    expect(menuAt).toBeGreaterThan(-1);
    const rowAt = feed.lastIndexOf("<GlassView", menuAt);
    expect(rowAt).toBeGreaterThan(-1);
    // 承载「访问个人主页」的那一行没有被 isOwnAuthorId 条件包住。
    expect(feed.slice(rowAt, menuAt)).not.toContain("isOwnAuthorId");
  });
});
