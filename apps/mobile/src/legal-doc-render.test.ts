import { describe, expect, it } from "vitest";
import { extractToc, parseLegalDoc } from "./legal-doc-parser";

// R15.x+ (P0 协议字体/排版 audit) — 解析器单测。
//
// 验证 parseLegalDoc 对真实 server txt 的解析结果:
//   1. "1. 关于 Proxy" 这种 "数字 + 点 + 空格" 应该是 heading
//   2. "- " 开头应该是 list
//   3. 普通行应该是 paragraph
//   4. 空行是 spacer
//   5. 章节标题后接 "- " 不是 heading (e.g. "3. 可能包括：\n- A; - B;")
//   6. TOC 只包含 heading

describe("parseLegalDoc (R15.x legal renderer)", () => {
  it("parses a typical section + paragraph + list", () => {
    const text = `1. 关于 Proxy

Proxy 是一项以通信为基础的数字服务。

Proxy 可能提供：

- 账号注册；
- 1:1 消息；
- 群聊。

具体功能因地区而异。`;
    const blocks = parseLegalDoc(text);
    expect(blocks.length).toBeGreaterThan(0);
    const heading = blocks.find((b) => b.type === "heading");
    expect(heading).toBeDefined();
    if (heading && heading.type === "heading") {
      expect(heading.number).toBe("1");
      expect(heading.title).toBe("关于 Proxy");
      expect(heading.anchor).toBe("s1");
    }
    const lists = blocks.filter((b) => b.type === "list");
    expect(lists.length).toBe(1);
    if (lists[0]?.type === "list") {
      expect(lists[0].items).toEqual(["账号注册；", "1:1 消息；", "群聊。"]);
    }
  });

  it("treats numbered label immediately followed by bullets as paragraph (not heading)", () => {
    // Real-world pattern: "1. 可能包括：" directly (no blank line) before
    // bullets is a list label, NOT a heading. The blank line is the
    // disambiguator — when present, "1. X" is a real heading.
    const text = `1. 可能包括：
- A；
- B；
- C。`;
    const blocks = parseLegalDoc(text);
    const headings = blocks.filter((b) => b.type === "heading");
    expect(headings.length).toBe(0);
    const first = blocks[0];
    expect(first?.type).toBe("paragraph");
    if (first?.type === "paragraph") {
      expect(first.text).toBe("1. 可能包括：");
    }
  });

  it("emits spacers for blank lines but not duplicates", () => {
    const text = "A\n\n\n\nB";
    const blocks = parseLegalDoc(text);
    const spacers = blocks.filter((b) => b.type === "spacer");
    expect(spacers.length).toBe(1);
  });

  it("extractToc returns only heading entries", () => {
    const text = `1. 第一章

- A；
- B。

2. 第二章

- C。`;
    const blocks = parseLegalDoc(text);
    const toc = extractToc(blocks);
    expect(toc).toEqual([
      { number: "1", title: "第一章", anchor: "s1" },
      { number: "2", title: "第二章", anchor: "s2" }
    ]);
  });

  it("anchors a list to the preceding heading", () => {
    const text = `1. X

- A；
- B。`;
    const blocks = parseLegalDoc(text);
    const list = blocks.find((b) => b.type === "list");
    expect(list?.type).toBe("list");
    if (list?.type === "list") {
      expect(list.anchor).toBe("s1");
    }
  });

  it("handles the real terms_v1.1.txt shape (first 3 sections)", () => {
    // Real shape from apps/api-go/internal/api/legal_docs/terms_v1.1.txt
    const text = `1. 关于 Proxy

Proxy 是一项以通信为基础的数字服务。

Proxy 可能提供包括但不限于：

- 账号注册和身份管理；
- 1:1 消息。

具体功能因地区而异。


2. 协议组成

本协议还包括：

- 《隐私政策》；
- 《社区规范》。

这些规则均构成本协议的一部分。


3. 使用资格

你必须具有相应的民事行为能力。`;
    const blocks = parseLegalDoc(text);
    const headings = blocks.filter((b) => b.type === "heading");
    expect(headings.length).toBe(3);
    if (headings[0]?.type === "heading") {
      expect(headings[0].number).toBe("1");
      expect(headings[0].title).toBe("关于 Proxy");
    }
    if (headings[1]?.type === "heading") {
      expect(headings[1].number).toBe("2");
      expect(headings[1].title).toBe("协议组成");
    }
    if (headings[2]?.type === "heading") {
      expect(headings[2].number).toBe("3");
      expect(headings[2].title).toBe("使用资格");
    }
    const lists = blocks.filter((b) => b.type === "list");
    expect(lists.length).toBe(2);
  });
});
