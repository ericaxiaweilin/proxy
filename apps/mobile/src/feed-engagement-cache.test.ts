import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ENGAGEMENT-CACHE-001（2026-09-26，用户报的 P0）：
//   「我看了帖文的评论 点赞…切换来回就不显示了 要重新刷新才显示」
//
// 根因（已核验，不是猜的）：切 tab 是 **remount** —— app-shell.tsx 里 FeedSurface
// 挂在一条 ternary 分支上（`key={feedSearchSeed ?? "feed"}`），不是常驻；remount
// 时组件状态全新。帖文有模块级缓存（cachedPosts），互动态**没有**：
//   liked（点赞态）/ postEngagement（点赞·评论·转发计数）/ postReplies（评论预览）
// 而唯一给它们注水的 hydrateEngagement 只活在 loadFeed 里，remount 又撞上
// `if (feedNetworkLoadedThisSession) return;` 那条早退（TAB-SWITCH-JANK-001 定的
// 「有缓存就同步渲染、不重注水」）—— 于是压根不调 loadFeed，也就永远不注水。
// 表现：帖文还在，心是空的、三个计数全 0、评论预览也空了，必须下拉刷新（重跑
// loadFeed）才回来。
//
// ⚠️ 为什么是源码级钉：这个仓**没有 React 渲染器**（没有 .test.tsx、没有
// @testing-library/react-native、没有 react-test-renderer），remount 这种时序行为
// 在 vitest 里复现不了。所以钉的是那条**接线**：三样状态是不是从模块级缓存起初值、
// 有没有把它们镜像回缓存。这是这个仓对渲染行为一贯的钉法（同 sec-category-icons.test.ts）。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");

// 剥注释再断言：本仓注释会把这些标识符原文抄一遍（下面就有），不剥的话
// 把实现删掉、注释留着，断言照样绿。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const feed = stripComments(read("./surfaces/feed.tsx"));

// 组件**外面**那一段（模块级缓存声明区）：`export function FeedSurface` 之前。
// 「缓存是模块级的」和「缓存是组件里的 ref」是两回事 —— 后者 remount 一样丢。
const moduleScope = (): string => {
  const at = feed.indexOf("export function FeedSurface");
  expect(at, "找不到 FeedSurface 的导出锚点（切片会变成空串 = 假绿）").toBeGreaterThan(0);
  return feed.slice(0, at);
};

const slice = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  expect(start, `找不到起始锚点：${from}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(to, start);
  expect(end, `找不到结束锚点：${to}`).toBeGreaterThan(start);
  return source.slice(start, end);
};

// [组件状态, 对应的模块级缓存, 旧初值] —— 三样缺一样，remount 就少一样东西。
const TRIPLE: ReadonlyArray<readonly [string, string, string]> = [
  ["liked", "cachedLikedPostIds", "new Set()"],
  ["postEngagement", "cachedPostEngagement", "{}"],
  ["postReplies", "cachedPostReplies", "{}"]
];

describe("ENGAGEMENT-CACHE-001 互动态要跟着帖文一起活过 remount", () => {
  it("三样缓存都声明在模块作用域（不是组件里的 state / ref）", () => {
    const scope = moduleScope();
    for (const [, cache] of TRIPLE) {
      // 必须 `let`：`const` 就改不了；而且必须在 FeedSurface 外面。
      expect(scope, `${cache} 不在模块作用域 —— 组件一卸载就跟着没了`).toMatch(
        new RegExp(`^let ${cache}:`, "m")
      );
    }
    // 非空校验：锚点漂了就会拿到空串，上面的 toMatch 全挂 —— 但报错会很难懂。
    expect(scope.length, "模块作用域切片是空的（锚点漂了）").toBeGreaterThan(1000);
  });

  it("三样 state 的初值都取缓存，不再从空集合起（这是这次 P0 的正面修法）", () => {
    for (const [state, cache] of TRIPLE) {
      // 钉整条初始化：`const [liked, setLiked] = useState<…>(cachedLikedPostIds)`。
      // 只钉「文件里出现过 cachedLikedPostIds」不够 —— 那可能只出现在注释或镜像 effect 里。
      expect(feed, `${state} 的初值没取 ${cache} —— remount 后它就是空的`).toMatch(
        new RegExp(`const \\[${state}, set[A-Za-z]+\\] = useState<[^;]*\\(${cache}\\)`)
      );
    }
  });

  it("反向臂：旧初值（空 Set / 空对象）不许回来", () => {
    for (const [state, , oldInit] of TRIPLE) {
      const escaped = oldInit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(feed, `${state} 又退回从空值起（remount 就会丢）`).not.toMatch(
        new RegExp(`const \\[${state}, set[A-Za-z]+\\] = useState<[^;]*\\(${escaped}\\)`)
      );
    }
  });

  it("三样状态都镜像回了模块级缓存（否则下一次 remount 还是空的）", () => {
    for (const [state, cache] of TRIPLE) {
      expect(feed, `没有把 ${state} 写回 ${cache} —— 缓存永远是空壳`).toMatch(
        new RegExp(`useEffect\\(\\(\\) => \\{ ${cache} = ${state}; \\}`)
      );
    }
  });

  it("注水路径仍然写这两样（有人把 hydrateEngagement 删空了也拦一下）", () => {
    const hydrate = slice(feed, "async function hydrateEngagement", "async function hydrateReplyPreviews");
    expect(hydrate, "注水不再写 postEngagement 了 —— 计数永远是 0").toContain("setPostEngagement(");
    expect(hydrate, "注水不再写 liked 了 —— 心永远是空的").toContain("setLiked(");
    // 非空校验：窗口没切对的话上面两条 toContain 会假绿。
    expect(hydrate.length, "注水函数切片太短（锚点漂了）").toBeGreaterThan(200);
  });
});
