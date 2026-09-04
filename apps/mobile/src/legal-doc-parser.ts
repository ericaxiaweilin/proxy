// R15.x+ (P0 协议字体/排版 audit) — legal doc 纯解析器。
//
// 行业共识: 法务文档应当用 serif 字体 + 较大字号 + 行距 1.6-1.75 +
// 标题层级 + 段间距 + 列表样式。越南合规: Decree 13/2023/ND-CP + PDP
// 91/2025/QH15 没有强制 ToS 字体，但 Vietnam E-Commerce Law 2025
// 草案 + GDPR Art. 12 都要求"concise, easily accessible, easy to
// understand"。
//
// 数据源: server 端仍然返回纯 txt
// (apps/api-go/internal/api/legal/legal_docs/terms_v1.1.txt)，
// 不引 markdown — 因为 txt 已经是法务写好的"半结构化"格式 (数字标题
// / 列表 / 段间距), 客户端只需要按行解析即可。markdown 反而要求 server
// 端再写一次, 增加法务 workflow 成本。
//
// 行级结构 (从 1.1 + 1.1.1 节中观察到的):
//   ^[0-9]+\. [^\n]+$     -> H2 (章节标题, e.g. "1. 关于 Proxy")
//   ^- [^\n]+$           -> bullet (列表项, e.g. "- 账号注册")
//   ^$                   -> 段间距 (空行)
//   其他                  -> 段落
//
// 数字 heading 跟普通数字列表 ("1. 账号 ...") 的区别: 法务文档的
// 章节标题后必跟空行 + 段落, 列表项后接下一项 (无空行)。解析器按
// 上下文判断: "数字行后第 1 个非空行如果是段落" → heading。

export type LegalBlockHeading = { type: "heading"; number: string; title: string; anchor: string };
export type LegalBlockList = { type: "list"; items: string[]; anchor?: string };
export type LegalBlockParagraph = { type: "paragraph"; text: string };
export type LegalBlockSpacer = { type: "spacer" };
export type LegalBlock = LegalBlockHeading | LegalBlockList | LegalBlockParagraph | LegalBlockSpacer;

const HEADING_RE = /^([0-9]+)\.\s+(.+)$/;
const BULLET_RE = /^-\s+(.+)$/;
const SUBSECTION_HEADING_RE = /^([0-9]+)\.([0-9]+)\s+(.+)$/;

/**
 * 解析 server 端返回的 txt 到结构化 block 数组。
 *
 * Pure function — vitest 单测覆盖。
 */
export function parseLegalDoc(text: string): readonly LegalBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: LegalBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      // Skip consecutive empty lines but emit one spacer for visual breathing room
      if (blocks.length > 0 && blocks[blocks.length - 1]?.type !== "spacer") {
        blocks.push({ type: "spacer" });
      }
      i += 1;
      continue;
    }

    // H2 like "1. 关于 Proxy" — only when next line is NOT a bullet
    // (i.e. heading is followed by blank line + paragraph, not by a
    // list directly). A "1. X\n- A" with no blank line means "1. X" is
    // a list label, not a heading.
    const headingMatch = HEADING_RE.exec(trimmed);
    if (headingMatch && !SUBSECTION_HEADING_RE.test(trimmed)) {
      const number = headingMatch[1] ?? "";
      const title = (headingMatch[2] ?? "").trim();
      const nextLine = i + 1 < lines.length ? (lines[i + 1] ?? "").trim() : "";
      if (BULLET_RE.test(nextLine)) {
        // treat as list label: emit as paragraph (no special styling)
        blocks.push({ type: "paragraph", text: trimmed });
        i += 1;
        continue;
      }
      blocks.push({ type: "heading", number, title, anchor: `s${number}` });
      i += 1;
      continue;
    }

    // Bullet list
    if (BULLET_RE.test(trimmed)) {
      const items: string[] = [];
      const prevHeading = [...blocks].reverse().find((b) => b.type === "heading");
      while (i < lines.length && BULLET_RE.test((lines[i] ?? "").trim())) {
        const m = BULLET_RE.exec((lines[i] ?? "").trim());
        if (m) items.push((m[1] ?? "").trim());
        i += 1;
      }
      const listBlock: LegalBlockList = prevHeading?.type === "heading"
        ? { type: "list", items, anchor: prevHeading.anchor }
        : { type: "list", items };
      blocks.push(listBlock);
      continue;
    }

    // Default: paragraph
    blocks.push({ type: "paragraph", text: trimmed });
    i += 1;
  }
  // Trim trailing spacers
  while (blocks.length > 0 && blocks[blocks.length - 1]?.type === "spacer") blocks.pop();
  return blocks;
}

/** Extract headings for TOC */
export function extractToc(blocks: readonly LegalBlock[]): ReadonlyArray<{ number: string; title: string; anchor: string }> {
  return blocks
    .filter((b): b is LegalBlockHeading => b.type === "heading")
    .map((b) => ({ number: b.number, title: b.title, anchor: b.anchor }));
}
