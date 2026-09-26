import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SEC-CATEGORY-ICONS-001（2026-09-26，用户：「模拟器的 推荐 关注还没有 logo 原型我给你了」）：
//
// 原型 deepseek_html_20260926_9d241a.html 的 02「推荐 / 关注 / 动态 / 探索 / 分类」把
// 「推荐」「关注」定义成了**有形状**的分类图标（推荐 = 五角星，关注 = 人 + 右上信号点）。
// ⚠️ 但同一份原型的 03「分段 / Tabs / 胶囊」里，推荐/关注 tab 本身是**纯文字** ——
//    所以这两个字形一直没有出处可抄，feed 顶部那行 tab 就一直空着。
//    这两个字形是**跨节**搬过来的（02 的定义 → 03 的位置），这个文件钉住这件事。
//
// 为什么是源码级 tripwire：vitest 这边没有 RN 渲染器，画不出 SVG。
// 所以钉「用的是哪条路径 / 挂在哪一处」，而不是钉「看起来对不对」——
// 看起来对不对只能靠真机截图（原型 02 那节的栅格与描边已按 CSS 核对，见下面的注释）。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");

// 剥注释再断言：本仓的注释会解释「这条路径从原型哪一节抄的」，被抄的路径原文
// 也可能出现在注释里。不剥的话，把实现删掉、注释留着，断言照样绿。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const icon = stripComments(read("./components/proxy-icon.tsx"));
const feed = stripComments(read("./surfaces/feed.tsx"));

// 先切出目标片段再断言：「符号在文件里」≠「这条路径走到它」。
// feed.tsx 里 `size={16}` 的 ProxyIcon 有三处（搜索框 / 分段控件 / 这行 tab），
// 全文 toContain 分不出是哪一处 —— 把实现从 tab 行删掉、留在搜索框里，断言会照样绿。
const slice = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  expect(start, `找不到起始锚点：${from}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(to, start);
  expect(end, `找不到结束锚点：${to}`).toBeGreaterThan(start);
  return source.slice(start, end);
};

const TAB_ROW_FROM = "{TABS.map((entry) => {";
const SECTION_ROW_FROM = "{SECTIONS.map((entry) => {";

// 切出 proxy-icon 里某个 case 分支的实现体。窗口收到下一个 case / default 为止 ——
// 不收的话最后一个分支会一路吃到文件尾，别的分支里的 canvas32 也能让断言变绿（假守卫）。
const caseBody = (name: string): string => {
  const at = icon.indexOf(`case "${name}":`);
  expect(at, `没有 case "${name}" 分支 —— 图标名写错只会静默渲染空白`).toBeGreaterThanOrEqual(0);
  const ends = [icon.indexOf("case ", at + 1), icon.indexOf("default:", at + 1)].filter((i) => i > -1);
  return icon.slice(at, ends.length > 0 ? Math.min(...ends) : undefined);
};

describe("SEC-CATEGORY-ICONS-001 推荐 / 关注 挂上原型 02 的分类字形", () => {
  it("两个字形名进了 ProxyIconName，且各有自己的 case 分支", () => {
    // 只钉 `| "recommend"` 不够：它也可能只是被人加进了联合类型却没实现分支，
    // 于是 <ProxyIcon name="recommend"/> 渲染出 null（静默空白，不报错）。
    expect(icon, '"recommend" 没进 ProxyIconName').toMatch(/\|\s*"recommend"/);
    // 这一组以前钉的是「follow 是联合类型的最后一项」（`| "follow";`）。
    // SEC-CATEGORY-ICONS-002 分两批把同族字形接在后面（先 动态/探索，再
    // 全部/人关系/机会需求/活动团体），而「谁排最后」本来也不是不变量 ——
    // 改成逐个钉「进了联合类型」：以后再加同族字形只需往数组里加一个名字。
    for (const name of ["follow", "dynamicRing", "explore", "allGrid", "peoplePair", "clockDot", "hexGroup"]) {
      expect(icon, `"${name}" 没进 ProxyIconName`).toMatch(new RegExp(`\\|\\s*"${name}"`));
    }
    expect(icon, '没有 case "recommend" 分支').toContain('case "recommend":');
    expect(icon, '没有 case "follow" 分支').toContain('case "follow":');
  });

  it("推荐 = 原型那条 10 段折线五角星（不是拿 24 栅格的 star 顶替）", () => {
    const body = slice(icon, 'case "recommend":', 'case "follow":');
    // 原型 02 的路径原文，照抄：
    // <path d="M16 4L19.5 12L28 13L21.5 18.5L23.5 27L16 22.5L8.5 27L10.5 18.5L4 13L12.5 12Z"/>
    expect(body, "五角星的路径原文被改了").toContain('d="M16 4L19.5 12L28 13L21.5 18.5L23.5 27L16 22.5L8.5 27L10.5 18.5L4 13L12.5 12Z"');
    // 坐标最大到 28 ⇒ 必须画在 32 栅格上。已有的 `star` 是 24 栅格的圆角星，
    // 形状不同，不能顶替（顶替了就会是「看着有个星，但不是原型那颗」）。
    expect(body, "推荐字形没走 32 栅格").toContain("canvas32");
  });

  it("关注 = 人 + 右上信号点（少了那个点就退化成普通的 user）", () => {
    const body = slice(icon, 'case "follow":', "default:");
    expect(body, "人形轮廓的路径原文被改了").toContain('d="M6 27C6 22 10 19 16 19C22 19 26 22 26 27"');
    expect(body, "少了头部的圆").toMatch(/<Circle[^>]*cx="16"[^>]*cy="11"[^>]*r="5"/);
    // 信号点：实心、无描边。这是「关注」和已有 `user` 字形的唯一区别。
    expect(body, "右上角的信号点丢了（那就变成普通的 user 了）").toMatch(/<Circle[^>]*cx="25"[^>]*cy="8"[^>]*fill=\{color\}[^>]*r="2\.5"[^>]*stroke="none"/);
  });

  it("feed 的 推荐 / 关注 两个 tab 各自绑了字形，不再是纯文字", () => {
    // 钉整条字面量（id + icon + label 三件套一起），不是只钉 `icon: "recommend"`——
    // 后者在文件别处也可能出现，分不出是哪个 tab 绑的。
    expect(feed, "推荐 tab 没绑字形").toMatch(/\{\s*id:\s*"RECOMMENDED",\s*icon:\s*"recommend",\s*label:\s*"推荐"\s*\}/);
    expect(feed, "关注 tab 没绑字形").toMatch(/\{\s*id:\s*"FOLLOWING",\s*icon:\s*"follow",\s*label:\s*"关注"\s*\}/);
    // 反向臂：纯文字那版（只有 id + label）不许回来。
    expect(feed, "推荐 tab 又退回纯文字了").not.toMatch(/\{\s*id:\s*"RECOMMENDED",\s*label:\s*"推荐"\s*\}/);
    expect(feed, "关注 tab 又退回纯文字了").not.toMatch(/\{\s*id:\s*"FOLLOWING",\s*label:\s*"关注"\s*\}/);
  });

  it("tab 行真的把字形渲染出来了，且在标签前面（图标 + 文字）", () => {
    const block = slice(feed, TAB_ROW_FROM, "</View>");
    // 这里刻意不写死 16：尺寸是下一条测试的事（它钉的是两行相等）。
    // 写死会变成两颗钉钉同一件事，改尺寸时两条一起红，反而看不出是哪条在起作用。
    expect(block, "tab 行没有渲染字形").toMatch(/name=\{entry\.icon\} size=\{\d+\}/);
    // 字形必须排在标签**前面** —— 原型 02 的分类单元是「图标在上/在左，文字跟其后」，
    // 渲染到文字后面会变成「推荐 ⭐」。
    expect(block.indexOf("<ProxyIcon"), "字形不在标签前面").toBeLessThan(block.indexOf("styles.tabText"));
    // ICON-INK-001（2026-09-26，用户：「logo不能发灰 必须黑 对齐 threads 风格」）：
    // 这条钉原来是**反的** —— 它要求写 `color={active ? …}`，理由是「写死 ink 的话
    // 未选中那栏的图标会跟文字一样深，就只剩下面那条渐变下划线在提示在哪一栏」。
    // 产品明确要图标恒黑（截图实测：未选中的探索罗盘最深像素是 (124,117,133)，
    // 而 16px 下 32 栅格描边只有 0.95px，连 ink 的星形都被读成 (176,173,180)）。
    // 按新口径改钉：选中态由**文字颜色 + 渐变下划线**承担，不再靠图标变灰。
    // 钉整条 ProxyIcon 标签，不是只钉 `color={color.ink}`——后者在文件别处也有。
    expect(block, "tab 行字形颜色又跟着选中态走了（产品要求恒为 ink）").toMatch(
      /<ProxyIcon color=\{color\.ink\} name=\{entry\.icon\} size=\{\d+\}/
    );
    // 反向臂：不许退回「跟选中态走」那版。
    expect(block, "tab 行字形又退回跟选中态发灰了").not.toMatch(/<ProxyIcon color=\{active \?/);
  });

  it("两行图标同一套尺寸（tab 行 = 它上面的分段控件）", () => {
    // 同屏两行图标（动态/探索 与 推荐/关注）必须是同一个系统 ——
    // 这也是这次改动的口径（见 feed.tsx 里那句注释）。钉的是**两者相等**，
    // 不是「都等于 16」：将来一起改尺寸不该打红，只改一行才该打红。
    const sizeOf = (s: string): string => s.match(/name=\{entry\.icon\} size=\{(\d+)\}/)?.[1] ?? "";
    const tabRow = sizeOf(slice(feed, TAB_ROW_FROM, "</View>"));
    const sectionRow = sizeOf(slice(feed, SECTION_ROW_FROM, "</View>"));
    expect(tabRow, "tab 行取不到图标尺寸").not.toBe("");
    expect(sectionRow, "分段控件取不到图标尺寸").not.toBe("");
    expect(tabRow, "两行图标尺寸不一致了").toBe(sectionRow);
  });

  it("两行图标是同一套字形系统（栅格 + 描边），不只是同一个尺寸", () => {
    // 上面那条只钉了 size 相等。尺寸一样、但一行画在 24 栅格 / 描边 2.2、
    // 另一行画在 32 栅格 / 描边 1.9 的话，16pt 下渲染出来是 1.47px vs 0.95px
    // （差 1.55 倍）—— 同屏看就是「上面一行粗、下面一行细」。
    // 分段控件那行原来挂的是 target / cup，两个都是 24 栅格，就是这个毛病。
    // 所以这里钉**系统**：两行四个字形都必须走 canvas32（原型 02 那套 32 栅格 / 1.9）。
    //
    // ⚠️ 钉的必须是「这两行**实际指到**的字形」，不能写死四个名字。写死的话：
    //    那四个字形一直躺在文件里，把某一行改指到别的 24 栅格字形，这种钉照样绿
    //    （假守卫 —— 「字形是 32 栅格」≠「这一行用的是它」）。所以从行表里把名字读出来。
    const namesOf = (table: string): string[] =>
      [...table.matchAll(/icon:\s*"([a-zA-Z0-9]+)"/g)].map((m) => m[1] ?? "").filter((n) => n !== "");
    const rows = namesOf(slice(feed, "const SECTIONS", "];")).concat(
      namesOf(slice(feed, "const TABS", "];"))
    );
    // 非空校验：锚点漂了就会取到 0 个名字，下面的循环空转 = 假绿。
    expect(rows.length, "两行一个字都没取到（锚点漂了）").toBeGreaterThanOrEqual(4);
    for (const name of rows) {
      expect(caseBody(name), `${name} 没走 32 栅格 —— 和同屏那一行不是一套字形系统`).toContain("canvas32");
    }
    // 反向臂：分段控件那行不许指回 24 栅格的 target / cup。
    const sections = slice(feed, "const SECTIONS", "];");
    expect(sections, "动态 又指回 24 栅格的 target 了").not.toContain('icon: "target"');
    expect(sections, "探索 又指回 24 栅格的 cup 了").not.toContain('icon: "cup"');
    expect(sections, "探索 又指回咖啡杯字形了").not.toContain('icon: "cafeCup"');
    // ICON-INK-001：两行的**颜色口径**也得是同一套 —— 图标恒 ink，不跟选中态发灰。
    // 分段控件未选中那格原来是 color.muted（截图量到 (124,117,133)，确实是灰的）。
    const sectionRowBlock = slice(feed, SECTION_ROW_FROM, "</View>");
    expect(sectionRowBlock, "分段控件未选中的图标又发灰了（muted）").toContain(
      "color={active ? color.white : color.ink}"
    );
    expect(sectionRowBlock, "分段控件未选中的图标又退回 muted 了").not.toContain("color.muted");
  });

  it("分类胶囊那行也挂上原型 02 的字形（原型 06 的首页顶部三行都有图标）", () => {
    // 原型 06「真实场景组合」把首页顶部画成**三行**：分段控件（动态 / 探索）→
    // Tabs（推荐 / 关注）→ **分类胶囊**（全部 / 人关系 / 机会需求 / 活动团体），
    // 三行都带图标。FilterChipRail 本来就有 icon 槽（requester-home 传 assetIcon 在用），
    // feed 这边只传 { id, label } 把槽空着 —— 所以这一行一直是纯文字。
    const filters = slice(feed, "const FILTERS", "];");
    const wanted: ReadonlyArray<readonly [string, string]> = [
      ["allGrid", "全部"],
      ["peoplePair", "人 / 关系"],
      ["clockDot", "机会 / 需求"],
      ["hexGroup", "活动 / 团体"]
    ];
    for (const [name, label] of wanted) {
      expect(filters, `分类胶囊「${label}」没绑字形`).toContain(`icon: "${name}"`);
      // 同一套字形系统：也必须是 32 栅格（上面两行都是）。
      expect(caseBody(name), `${name} 没走 32 栅格`).toContain("canvas32");
    }
    // 只往表里加 icon、不透传给 FilterChipRail = 静默不渲染（icon 是可选字段，tsc 不报）。
    // 透传写成 `...(cond ? { icon } : {})` 而不是 `icon: f.icon`，是因为
    // exactOptionalPropertyTypes：f.icon 可能是 undefined，直接赋给 icon?: ProxyIconName
    // 过不了类型（TS2322）。这个写法跟 composer-publish / secure-session 一致。
    expect(feed, "FilterChipRail 没透传 icon").toContain("...(f.icon ? { icon: f.icon } : {})");
    // 反向臂：透传又退回不带 icon 的那版。
    expect(feed, "FilterChipRail 又只传 { id, label } 了").not.toContain("({ id: f.id, label: f.label })");
  });

  it("EXPLORE-RENAME-001：分段控件第二格是「探索」+ 罗盘指针（不再是「咖啡场景」+ 咖啡杯）", () => {
    // 产品 2026-09-26：「探索是代替咖啡场景 改名 目前没改」——
    // 这一格原叫「咖啡场景」（字形 = 咖啡杯），改名叫「探索」，字形换成
    // 原型 02 同一组里的**罗盘指针**。
    // ⚠️ 钉整条字面量（id + label + icon 三件套），不是只钉 label：
    //    只钉 label 的话「名字改了、字形还是咖啡杯」照样绿。
    expect(feed, "分段控件第二格没改名成「探索」").toMatch(
      /\{\s*id:\s*"CAFE",\s*label:\s*"探索",\s*icon:\s*"explore"\s*\}/
    );
    // 反向臂：旧名 / 旧字形不许回来。
    expect(feed, "分段控件又退回「咖啡场景」了").not.toContain('label: "咖啡场景"');
    expect(feed, "分段控件又指回咖啡杯字形了").not.toContain('icon: "cafeCup"');
    // 咖啡杯那个字形只有这一处调用点，换名后就是死字形 —— 一起删掉，别留。
    expect(icon, "咖啡杯字形没删干净（换名后它已经没有调用点了）").not.toContain('case "cafeCup"');
    // 罗盘指针 = 原型 02 的路径原文：
    // <circle cx="16" cy="16" r="11"/> + <path d="M21 11 L 18 18 L 11 21 L 14 14 Z"/>
    const body = caseBody("explore");
    expect(body, "罗盘指针的路径原文被改了").toContain('d="M21 11L18 18L11 21L14 14Z"');
    expect(body, "外圈那个圆丢了（只剩指针就成了一个菱形）").toMatch(
      /<Circle[^>]*cx="16"[^>]*cy="16"[^>]*r="11"/
    );
    // 和同屏那三行同一套字形系统：32 栅格 / 描边 1.9。
    expect(body, "探索字形没走 32 栅格").toContain("canvas32");
    // 改名要一路改到用户看得见的地方：分段控件下面那一层 —— CoffeeScenesHub 的
    // 「全部店铺」子视图 —— 的返回标签也写着这一格的名字，别只改分段控件、
    // 留下「探索 里写着 返回咖啡场景」这种半截接线。
    const coffee = stripComments(read("./surfaces/coffee-scenes.tsx"));
    expect(coffee, "探索 里面的返回标签没跟着改名").toContain("返回探索");
    expect(coffee, "探索 里面的返回标签又退回「返回咖啡场景」了").not.toContain("返回咖啡场景");
  });
});
