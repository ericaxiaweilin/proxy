import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// FEED-POST-CLEAN-001 —— 帖子卡底部不再有 CTA 按钮（用户：「不需要任何帖文不需要 保持清爽」）。
//
// 原先只有 AGENT 帖（城市同行）会渲染这两个按钮，所以此前「有的帖文有、有的没有」。
// 用户要求所有帖文都不显示 ⇒ 整块移除，连同它专用的 isCityCompanion 与 5 条样式。
//
// 钉两件事，缺一不可：
//  1) 负向：那两个按钮的字面量、以及它们专用样式名 / 标志位，都不得再出现。
//     断言前先剥注释 —— 否则解释「为什么不做」的注释会把负向断言喂红。
//  2) 正向：帖子卡的真实动作行必须还在。只写负向断言的话，把整张卡删掉也能通过。
const feed = readFileSync(fileURLToPath(new URL("./surfaces/feed.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const code = stripComments(feed);

describe("FEED-POST-CLEAN-001 no per-post CTA buttons", () => {
  it("the two CTA labels are gone from every post card", () => {
    expect(code).not.toContain("聊一下");
    expect(code).not.toContain("按这个想法找同行");
  });

  it("their dedicated styles and the AGENT-only flag are gone too (no dead code left)", () => {
    for (const dead of [
      "styles.postIntent",
      "styles.intentChat",
      "styles.intentChatText",
      "styles.intentNeed",
      "styles.intentNeedText",
      "isCityCompanion"
    ]) {
      expect(code).not.toContain(dead);
    }
  });

  it("the real post action row and body are still rendered", () => {
    expect(code).toContain("<Text selectable style={styles.postCopy}>{post.body}</Text>");
    expect(code).toContain("更多帖子操作");
    expect(code).toContain("styles.postAction");
    expect(code).toContain("查看其余");
  });
});
