import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 商家首页的输入框对齐用户侧：同一个 HomeSearchDock（默认搜索，左侧 AI 标识进会话），不再是旧的 HomeChatBox。
describe("business home search dock", () => {
  const src = readFileSync(new URL("./business-home.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../shell/app-shell.tsx", import.meta.url), "utf8");
  it("uses the same dock as the requester home", () => {
    expect(src).toContain("<HomeSearchDock");
    expect(src).not.toContain("<HomeChatBox");
  });
  it("plain text searches people, photos go to the AI, the AI mark opens the conversation", () => {
    expect(src).toContain("profileClient.searchProfiles(q)");
    expect(src).toMatch(/if \(attachment && onChat\) onChat\(text, undefined, attachment\);\s*else void runSearch\(text\);/);
    expect(src).toContain("onOpenConversation={() =>");
  });
  it("the shell hands the business home the profile client and the AI conversation opener", () => {
    const biz = shell.slice(shell.indexOf("<BusinessHome"), shell.indexOf("<BusinessHome") + 1400);
    expect(biz).toContain("onOpenAssistantConversation={openProxyAIConversation}");
    expect(biz).toContain("profileClient={profile}");
  });
});
