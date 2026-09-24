import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SELECTABLE-TEXT-001 —— 全页面内容长按可复制（用户：「现在我先复制给你都不行」）。
//
// 规则：react-native 的 <Text> 默认加 selectable；但长按手势优先的地方不动 ——
// 会话气泡（长按出管理菜单，复制走菜单里的「复制」项）、TooltipOnLongPress
// 包裹的工具栏按钮（长按出 tooltip）。这组断言钉住代表页面 + 两个例外，
// 防止将来有人把 selectable 删掉或把例外凿穿。
function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("SELECTABLE-TEXT-001 page content is manually copyable", () => {
  it("feed post body, profile bio and insight texts are selectable", () => {
    const feed = read("./surfaces/feed.tsx");
    expect(feed).toContain("<Text selectable style={styles.postCopy}>{post.body}</Text>");
    const me = read("./surfaces/me.tsx");
    expect(me).toContain("<Text selectable numberOfLines={2} style={styles.personalIntroText}>");
    const card = read("./components/twin-insight-card.tsx");
    expect(card).toContain("<Text selectable style={styles.summaryText}>{insight.summaryText}</Text>");
  });

  it("conversation bubbles keep the long-press menu (no selectable inside)", () => {
    const convo = read("./surfaces/conversation.tsx");
    // 气泡正文必须保持普通 Text —— selectable 会吞掉长按菜单手势。
    expect(convo).toContain("<Text style={styles.bubbleText}>{message.body}</Text>");
    expect(convo).not.toMatch(/<Text selectable style=\{styles\.bubbleText\}>/);
  });

  it("conversation long-press menu offers copy via clipboard", () => {
    const convo = read("./surfaces/conversation.tsx");
    expect(convo).toContain('import * as Clipboard from "expo-clipboard"');
    expect(convo).toContain('accessibilityLabel="复制这条消息"');
    expect(convo).toContain("Clipboard.setStringAsync(target.body)");
  });

  it("toolbar buttons wrapped by TooltipOnLongPress stay non-selectable", () => {
    const composer = read("./surfaces/ComposerV2Screen.tsx");
    expect(composer).toContain("<Text style={[styles.quotePrimaryText, quoteId ? styles.quotePrimaryTextActive : null]}>引用</Text>");
    expect(composer).toContain("<Text style={styles.gifToolText}>GIF</Text>");
    expect(composer).not.toContain("<Text selectable style={styles.gifToolText}>");
  });
});
