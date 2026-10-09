import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// NO-PAGE-GLOSS-FILLER-001（2026-10-09）：「解释性废话」清扫扫出「我的」之后的第一批。
//
// 用户原话：「把解释性的废话全部删除 不只这个功能 其它的解释废话移除」。前三轮
// （Revision 355/356/357 + `ME-NO-DESC-FILLER-001`）清的是「我的」那一片；这一轮按同一判据
// 扫其余页面，又找出**同一种形状**：**标题下面那行灰色解释**。
//
// 判据（与本仓既有的三分类一致）：那行字讲的是「**这一页/这个面板里有什么 / 它在干什么**」，
// 而标题已经把这件事说完了 ⇒ 删；它讲的是「**这个选项是什么 / 选了会怎样**」⇒ 留。
//
// 本轮删掉的七条：
//   · `AIIdentityShowcaseSurface.tsx` —— 页头「AI分身中心」下那行「图库 · 帖文编排 · 好友运营」
//     （就是「里面有什么」的清单，和上一轮删的 `enterpriseQuickDesc` 同类）。
//   · `ai-management.tsx` —— 三个 Sheet 的 `subtitle`：「AI 怎么替你聊天」/「场景 · 姿态 · 模型 ·
//     提示词」/「AI 替你发什么」。Sheet 标题（「对话管理」/「图片管理」/「动态管理」）已经把
//     这件事说完，且「场景 · 姿态 · 模型 · 提示词」就是**下面那排 tab 的名字**，等于把目录抄了一遍。
//     删掉后 `Sheet` 的 `subtitle` 参数、渲染行、`sheetSub` 样式全成死代码，一并删。
//   · `feed.tsx` —— 三个面板标题下的操作废话：「选一项作用于这篇帖子」（标题「更多操作」已经说了）、
//     「选一个最贴近的」（标题「举报原因」已经说了）、
//     「选一位聊过天的联系人，直接发一条私信」（标题「分享给」+ 下面就是联系人列表）。
//     删掉后 `postMenuStyles.subtitle` 成死样式，一并删。
//
// ⚠️ **刻意保留**（不是漏删，是判定为**功能**）：
//   · `ai-management.tsx` 自己的 `styles.subtitle` / `subtitleText` —— 那是 AI 分身**状态行**
//     （「AI 正在替你工作」/「AI 已暂停」/「读取中…」），是状态诚实标记，跟 Sheet 的 `subtitle`
//     只是**重名**，不是一回事（下面第 4 条专门反证它没被连坐删掉）。
//   · `feed.tsx` 的 `postMenuStyles.rowHint`（「不摘这条，以后少推类似的」「不再看 Ta 的任何内容」）
//     —— 这几个动作**名字相近、后果不同**，hint 承担的是**区分**，删了用户就分不清
//     「不感兴趣 / 减少这类内容 / 少看这个人 / 屏蔽作者」（下面第 6 条反证它们还在）。
//   · `ai-management.tsx` 的选项 `desc`（`RHYTHMS` / `CHAT_PERMISSIONS` / `POST_PACES`）与
//     `AI_SCENES[].desc`、`AI_CAMERA_MOVES[].desc` —— 同属「这个选项是什么」，不是「里面有什么」。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const showcase = stripComments(readFileSync(here("./AIIdentityShowcaseSurface.tsx"), "utf8"));
const aiManagement = stripComments(readFileSync(here("./ai-management.tsx"), "utf8"));
const feed = stripComments(readFileSync(here("./feed.tsx"), "utf8"));

// 七条被删掉的页面级解释灰字。**不带引号**地钉（带引号 / 模板串 / 放进数组都挡得住）；
// 另有一份 `deConcat` 视图 —— `not.toContain` 是纯子串判定，`"图库 · " + "帖文编排"` 这种拼接
// **不抹就漏**（003 的反向注入实测到过）。残余上限：刻意打散成字符数组仍挡不住。
const deConcat = (s: string): string => s.replace(/["'`]\s*\+\s*["'`]/g, "");

const PAGE_GLOSSES: ReadonlyArray<readonly [string, string]> = [
  ["AIIdentityShowcaseSurface.tsx", "图库 · 帖文编排 · 好友运营"],
  ["ai-management.tsx", "AI 怎么替你聊天"],
  ["ai-management.tsx", "场景 · 姿态 · 模型 · 提示词"],
  ["ai-management.tsx", "AI 替你发什么"],
  ["feed.tsx", "选一项作用于这篇帖子"],
  ["feed.tsx", "选一个最贴近的"],
  ["feed.tsx", "选一位聊过天的联系人，直接发一条私信"]
];

describe("NO-PAGE-GLOSS-FILLER-001 页面级解释灰字已清出「我的」之外的页面", () => {
  it("七条页面级解释灰字一条不剩（剥注释 + 抹掉拼接黏合处）", () => {
    const sources: Record<string, string> = {
      "AIIdentityShowcaseSurface.tsx": showcase,
      "ai-management.tsx": aiManagement,
      "feed.tsx": feed
    };
    for (const [file, gloss] of PAGE_GLOSSES) {
      const code = sources[file];
      // 键写错 ⇒ 这条钉会变成对 undefined 断言（空转）。炸出来，别静默绿。
      if (code === undefined) throw new Error(`sources 里没有 ${file}`);
      expect(code, `${file} 里「${gloss}」又回来了`).not.toContain(gloss);
      expect(deConcat(code), `${file} 里「${gloss}」被拼接着加回来了`).not.toContain(gloss);
    }
  });

  it("AI 分身中心页：副标题元素与它的死样式一起消失", () => {
    // 这个文件里 subtitle 只承担那一行解释，所以可以整体断言 —— 元素与样式都不许再有。
    expect(showcase).not.toContain("subtitle");
    // 反证：页头还在，删的不是整页（标题与它的样式都还在）。
    expect(showcase).toContain("AI分身中心");
    expect(showcase).toContain("styles.title");
  });

  it("AI 管理的三个 Sheet 不再接 subtitle 参数（元素 / 样式 / 三个调用点）", () => {
    expect(aiManagement).not.toContain("sheetSub");
    expect(aiManagement).not.toContain("subtitle: string");
    // 反证：三个 sheet 标题本身还在 —— 删的是标题下面那行，不是标题。
    expect(aiManagement).toContain("styles.sheetTitle");
    expect(aiManagement).toContain('title="对话管理"');
    expect(aiManagement).toContain('title="图片管理"');
    expect(aiManagement).toContain('title="动态管理"');
  });

  it("反证：AI 管理的**状态行** subtitle 没被连坐删掉（只是与 Sheet 的 subtitle 重名）", () => {
    expect(aiManagement).toContain("styles.subtitleText");
    expect(aiManagement).toContain("AI 正在替你工作");
    expect(aiManagement).toContain("AI 已暂停");
    // 状态行是三态：加载失败优先、暂停次之、否则工作中 —— 顺序不能被改坏。
    expect(aiManagement).toContain('{!ready ? (loadError ?? "读取中…") : paused ? "AI 已暂停" : "AI 正在替你工作"}');
  });

  it("feed 的三个面板：标题还在，标题下那行操作废话与死样式消失", () => {
    expect(feed).not.toContain("postMenuStyles.subtitle");
    // 死样式本身也不许留（不是只把调用点删了）。
    expect(feed).not.toContain('subtitle: { color: color.muted, fontSize: 12, lineHeight: 18, marginBottom: 12 }');
    // 反证：三个标题还在（「更多操作」/「举报原因」/「分享给」）。
    expect(feed).toContain("postMenuStyles.title");
    expect(feed).toContain(">更多操作<");
    expect(feed).toContain(">举报原因<");
    expect(feed).toContain(">分享给<");
  });

  it("反证：feed 行内的 rowHint 保留 —— 它区分四个名字相近的动作，不是「里面有什么」", () => {
    expect(feed).toContain("不摘这条，以后少推类似的");
    expect(feed).toContain("不摘这条，以后少推这个作者");
    expect(feed).toContain("不再看 Ta 的任何内容");
    expect(feed).toContain("postMenuStyles.rowHint");
  });
});
