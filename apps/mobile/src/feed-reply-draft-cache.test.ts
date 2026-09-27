import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// REPLY-DRAFT-CACHE-001（2026-09-26，用户「我看了 threads 没有取消发送 2 个
// 不想发送滑走就行了 存到草稿里了」）：这条钉守住「回复编辑器不再有『取消』按钮，
// 关闭走 swipe-down + closeReply，草稿按 postId 分桶存在模块级缓存里」整套接线。
//
// ⚠️ 本仓库没有 React 渲染器（无 .test.tsx、无 @testing-library/react-native、
// 无 react-test-renderer、无 vitest config），所以只能钉到源码级 —— 真正的
// 滑动手势行为需要在模拟器上确认。

const SRC_PATH = join(__dirname, "surfaces", "feed.tsx");
const feed = readFileSync(SRC_PATH, "utf8");

function stripComments(s: string): string {
  // 删块注释 / 行注释 / JSX 注释；保留字符串字面量。
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

/**
 * 从 src 里找到 `function NAME(` 第一次出现的位置，跳过参数列表（包括参数里的类型
 * 注解 `{...}`），找到函数体的 `{`，然后数平衡的花括号，截到匹配的 `}` 为止。
 * 返回包含签名 + 函数体的整段文本。找不到返回 ""。
 */
function extractFunctionBody(src: string, name: string): string {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) return "";
  let i = start + sig.length;
  // 我们刚越过 `function NAME(` —— 函数体的开括号还没消费，所以 parenDepth 从 1 起算。
  let parenDepth = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "(") parenDepth++;
    else if (c === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        i++;
        // 跳过返回类型，直到下一个 `{`（那就是函数体）
        while (i < src.length && src[i] !== "{") i++;
        if (i >= src.length) return "";
        let depth = 0;
        for (; i < src.length; i++) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
          }
        }
        return "";
      }
    }
    i++;
  }
  return "";
}

/** 从 anchorIndex（含）开始数花括号配对，截到 depth 归零的 `}` 为止。 */
function extractBalancedFrom(src: string, anchorIndex: number): string {
  if (anchorIndex < 0 || anchorIndex >= src.length) return "";
  let depth = 0;
  for (let i = anchorIndex; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(anchorIndex, i + 1);
    }
  }
  return "";
}

const cleaned = stripComments(feed);

describe("REPLY-DRAFT-CACHE-001：回复编辑器 = Threads 风格的 swipe-down + draft 缓存", () => {
  it("REPLY-DRAFT-CACHE-001 / 1：PanResponder 已从 react-native 导入", () => {
    expect(feed).toMatch(
      /import\s*\{[^}]*\bPanResponder\b[^}]*\}\s*from\s*["']react-native["']/
    );
  });

  it("REPLY-DRAFT-CACHE-001 / 2：cachedReplyDrafts 在模块作用域声明（不是 useState 也不是 useRef）", () => {
    expect(cleaned).toMatch(/^let cachedReplyDrafts:\s*Record<string,\s*string>\s*=\s*\{\}/m);
  });

  it("REPLY-DRAFT-CACHE-001 / 3：openReplies 从缓存取草稿，不许退回 setReplyDraft(\"\")", () => {
    const body = extractFunctionBody(cleaned, "openReplies");
    expect(body, "找不到 openReplies 函数体").not.toBe("");
    expect(body).toMatch(/setReplyDraft\(cachedReplyDrafts\[postId\]\s*\?\?\s*["']{2}\s*\)/);
    expect(body, "openReplies 又退回 setReplyDraft(\"\") 了（会覆盖缓存里的草稿）").not.toMatch(
      /setReplyDraft\(\s*["']{2}\s*\)/
    );
  });

  it("REPLY-DRAFT-CACHE-001 / 4：closeReply 函数存在；submitReply 成功路径用它丢掉已发草稿", () => {
    const body = extractFunctionBody(cleaned, "closeReply");
    expect(body, "closeReply 函数体找不到").not.toBe("");
    expect(body, "closeReply 没有保留非空草稿的分支").toMatch(/cachedReplyDrafts\[id\]\s*=\s*replyDraft/);
    expect(body, "closeReply 没有删除空草稿的分支").toMatch(/delete cachedReplyDrafts\[id\]/);
    expect(body).toMatch(/setReplyTargetId\(null\)/);
    expect(body).toMatch(/setReplyDraft\(\s*["']{2}\s*\)/);

    const submitBody = extractFunctionBody(cleaned, "submitReply");
    expect(submitBody, "submitReply 函数体找不到").not.toBe("");
    expect(submitBody, "submitReply 成功后没用 closeReply 丢掉草稿").toMatch(
      /closeReply\(\s*\{\s*keepDraft:\s*false\s*\}\s*\)/
    );
  });

  it("REPLY-DRAFT-CACHE-001 / 5：replyPanResponder 在 handle 上、垂直位移触发关闭", () => {
    expect(cleaned).toMatch(/useMemo\(\s*\(\)\s*=>\s*PanResponder\.create\(\{/);
    expect(cleaned).toMatch(/Math\.abs\(gestureState\.dy\)\s*>\s*8/);
    expect(cleaned).toMatch(/gestureState\.dy\s*>\s*80/);
    expect(cleaned).toMatch(/onPanResponderRelease[\s\S]{0,300}closeReply\(\)/);
    expect(cleaned).toMatch(/\{\.\.\.replyPanResponder\.panHandlers\}/);
  });

  it("REPLY-DRAFT-CACHE-001 / 6：回复编辑器里不再有「取消」按钮（不动 PostMenuModal 的取消按钮）", () => {
    // 锚到回复编辑器所在的 JSX 三元：`{replyTargetId === post.postId ? (...) : null}`，
    // 把真分支里那段截出来断言。这样不会误伤 PostMenuModal 的「取消」。
    const ternary = cleaned.match(
      /\{replyTargetId === post\.postId \?\s*\(([\s\S]*?)\)\s*:\s*null\}/
    );
    expect(ternary, "找不到回复编辑器的三元 JSX").toBeTruthy();
    if (!ternary) return;
    const inlineReplyBlock = ternary[1];
    expect(inlineReplyBlock, "回复编辑器的「取消回复」Pressable 又出现了").not.toMatch(
      /accessibilityLabel=\s*["']取消回复["']/
    );
    expect(inlineReplyBlock, "回复编辑器里还在渲染「取消」两个字").not.toMatch(/>\s*取消\s*</);
    // 反向：PostMenuModal 的「取消」按钮不能被一起误删
    expect(cleaned, "误伤：PostMenuModal 的取消按钮没了").toMatch(
      /postMenuStyles\.cancelText[^}]*\}\s*>\s*取消\s*</
    );
  });

  it("REPLY-DRAFT-CACHE-001 / 7：drag handle 样式 inlineReplyHandle + inlineReplyHandleBar 在 styles 里；旧 inlineReplyCancel 删干净", () => {
    expect(cleaned).toMatch(/inlineReplyHandle:\s*\{/);
    expect(cleaned).toMatch(/inlineReplyHandleBar:\s*\{/);
    expect(cleaned, "inlineReplyCancel/inlineReplyCancelText 已没人用，应删掉").not.toMatch(/inlineReplyCancel(Text)?:/);
  });
});