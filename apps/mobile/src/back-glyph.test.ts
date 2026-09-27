import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// BACK-GLYPH-001（2026-09-26）
//
// 用户：「把所有页面的返回 < 这个logo统一颜色 大小 形状 我看了 很多页面的返回不统一
// 红的 黑的 大小...」
//
// 统一之前：94 处返回控件散在 38 个文件里，各自手写一个**文本字符**当箭头 ——
// fontSize 11/12/13/14/16/20/22/24/25/26/28 十一种，颜色九种（magenta / violet /
// #151515 / #11110f / lotus.ink / #DCE6F7 …），字符三种（`‹` / `<` / `←`）。
//
// 根因不是"有人偷懒"，是**字形选错了**：`‹`(U+2039) 是单左引号、`<` 是小于号，
// 都不是箭头。它们的可见形状/粗细/垂直基线**随 fontSize 和 fontWeight 漂**，所以
// 每页只能各自试一个字号"让它看起来像箭头"—— 十一种尺寸就是这么来的。原型本身也
// 不统一（Proxy_R15_15 / R15_18 两份稿里各有 6 个不同的返回 class），照着抄只会
// 把不一致抄进来。
//
// 现在：字形是 SVG 描边路径（proxy-icon 的 backArrow），尺寸只有 foundation.backGlyph
// 一个来源，颜色只有两个 tone。这个文件钉住这四件事，**并钉住字符字形不许回来**。
//
// 剥注释是必须的：下面的注释里复述了这些字符，不剥的话把代码删掉测试照样绿。
const sourceRoot = dirname(fileURLToPath(import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/.test(entry)
        ? [path]
        : [];
  });
}

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const read = (relative: string): string => readFileSync(join(sourceRoot, relative), "utf8");

const theme = read("theme.tsx");
const foundation = read("components/proxy-foundation.tsx");
const icon = read("components/proxy-icon.tsx");
const i18n = read("i18n.ts");

// 「长得像返回箭头」的字符。`<` 不在里面 —— 它是 JSX 的尖括号，全仓库都是，
// 单独钉没有意义；`<` 版的返回由下面 other-profile 的钉守。
const BACK_GLYPH_CHARS = /[‹←↩↤◀≪❮⟵]/;

// 白名单：**不是返回控件**、但确实用了这些字符的地方。
//
// 断言写的是「实际集合 **恰好等于** 白名单」——两个方向都 fail-closed：
//   ① 新增一处手写返回字形 ⇒ 不在白名单里 ⇒ 红；
//   ② 删掉了旧用法却忘了删白名单 ⇒ 白名单条目"过时" ⇒ 红（见最后一个 it）。
// 这样每条理由都必须保持真实，白名单不会烂成一张免死金牌。
const NON_BACK_ALLOWLIST: Readonly<Record<string, string>> = {
  "components/privacy-settings.tsx":
    "「‹ 收起明细 / 查看明细 ›」是**展开收起开关**，不是返回：它成对出现，收起/展开是一个动作的两态",
  "components/security-settings.tsx":
    "「‹ 收起 / 展开全部 N 条 ›」同上，展开收起开关；跟返回不是一个语义",
  "composer-body.ts":
    "「↩ 引用 某某：…」是**消息正文里的引用前缀**，是这个字符串本身的一部分，不是控件",
  "surfaces/conversation.tsx":
    "「↩」是回复菜单里「回复」那一项右边的提示符，不是返回",
};

describe("BACK-GLYPH-001 全 App 的返回字形只有一处出处", () => {
  it("尺寸只有 foundation.backGlyph 一个来源", () => {
    // token 在，且是个数。
    expect(theme).toMatch(/backGlyph:\s*\d+/);
    // 字形组件读 token，不自己写字面量 —— 否则「唯一来源」就是句空话。
    expect(foundation).toContain("size={foundation.backGlyph}");
  });

  it("字形是 proxy-icon 的 backArrow，取景贴着箭头本身", () => {
    expect(icon).toMatch(/case\s*"backArrow":/);
    // 紧 box：24 格的 chevronLeft 里箭头只占 x 9→15，两侧各 37.5% 是空白，
    // 直接拿来贴左边缘会让 38 个表头一起往右缩 ~7pt。
    expect(icon).toContain('viewBox="7.4 4.4 9.2 15.2"');
    // 和 chevronLeft 是**同一条路径**（形状同源，只差取景）。
    expect(icon).toContain('d="M15 18l-6-6 6-6"');
  });

  it("ProxyBackGlyph 只有两个 tone，且没有 size / color 逃生口", () => {
    expect(foundation).toContain('export type BackTone = "ink" | "onDark";');
    const from = foundation.indexOf("export function ProxyBackGlyph");
    expect(from).toBeGreaterThan(-1);
    const sig = foundation.slice(from, foundation.indexOf("):", from));
    // 签名里出现 size / color ⇒ 每页又能各调各的，统一就白做了。
    expect(sig).not.toMatch(/\bsize\b/);
    expect(sig).not.toMatch(/\bcolor\b/);
  });

  it("只有 proxy-foundation 能画 backArrow（页面不许绕过原语）", () => {
    const offenders = sourceFiles(sourceRoot)
      .filter((path) => !path.endsWith("components/proxy-foundation.tsx"))
      // 测试文件自己会复述这个字形名（本文件就复述了），不参与。
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) => stripComments(readFileSync(path, "utf8")).includes('name="backArrow"'))
      .map((path) => path.slice(sourceRoot.length + 1));
    expect(offenders).toEqual([]);
  });

  it("ProxyIconButton 里的返回字形必须是 ink（那颗圆钮自己是白底）", () => {
    // BACK-GLYPH-001 我在这里踩过一次，模拟器上一眼就看见：badminton 详情页的
    // 顶栏是 absolute、浮在 detailCover（color.ink = #17131F）上面，我据此把返回
    // 字形改成了 tone="onDark" —— 结果那颗钮是 ProxyIconButton，它自己带
    //   iconButton: { backgroundColor: foundation.surface }  (= color.white, 40pt 圆)
    // 字形画在**白圆**上，不是画在封面上 ⇒ 白字压白圆，又一个看不见。
    //
    // 规则：判断字形颜色看**按钮自己的底色**，不是页面的底色。
    // ProxyIconButton 恒为白圆 ⇒ 它里面的返回字形恒为 ink。这一条把它钉死。
    const offenders: string[] = [];
    for (const path of sourceFiles(sourceRoot)) {
      const relative = path.slice(sourceRoot.length + 1);
      if (/\.test\.tsx?$/.test(relative)) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      for (const block of code.matchAll(/<ProxyIconButton\b[\s\S]*?<\/ProxyIconButton>/g)) {
        if (block[0].includes('tone="onDark"')) offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("i18n 的返回文案不带字形（6 种语言都不带）", () => {
    const values = [...i18n.matchAll(/backShort:\s*"([^"]*)"/g)].map((match) => match[1] ?? "");
    // 6 种语言（zh/vi/en/lo/ko/ja）。数量对不上说明有语言漏改或键被删。
    expect(values).toHaveLength(6);
    // 原型 I18N 原文写的是 "‹ 返回" —— 那个 `‹` 必须去掉，否则字形组件会画出两个箭头。
    expect(values.filter((value) => BACK_GLYPH_CHARS.test(value))).toEqual([]);
  });

  it("代码里不再有手写的返回字符字形（注释除外）", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(sourceRoot)) {
      const relative = path.slice(sourceRoot.length + 1);
      // 测试文件自己会复述这些字符，不参与。
      if (/\.test\.tsx?$/.test(relative)) continue;
      if (relative in NON_BACK_ALLOWLIST) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      for (const [index, line] of code.split("\n").entries()) {
        if (BACK_GLYPH_CHARS.test(line)) {
          offenders.push(`${relative}:${index + 1}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("白名单里没有过时条目（每条理由都还成立）", () => {
    const stale: string[] = [];
    for (const relative of Object.keys(NON_BACK_ALLOWLIST)) {
      const code = stripComments(read(relative));
      if (!BACK_GLYPH_CHARS.test(code)) stale.push(relative);
    }
    // 一个条目过时 = 那条理由已经不成立，留着它下次会掩护真正的返回字形。
    expect(stale).toEqual([]);
  });
});
