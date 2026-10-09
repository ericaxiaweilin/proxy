import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// NO-PAGE-GLOSS-FILLER-002（2026-10-09）：「解释性废话」清扫第二批（承接 358）。
//
// 同一判据（标题正下方那行灰字讲「这一页/这个面板里有什么」而标题已说完 ⇒ 删），扫到四个
// 还没碰过的页面，又清出 5 条。这一批里有两类：
//   · **泄漏的内部说明** —— 比「废话」更严重，是把内部设计/路线图印给了用户：
//     `app-shell.tsx` 的 `P0: 把意图变成可邀请的 Scene — 预算进场景而非买人`
//     （`P0:` 是排期标记、「预算进场景而非买人」是内部设计原则）；
//     `facet/FacetHomeSurface.tsx` 的 `FACET 当前为每个对象独立判断展示方向`（把内部代号 FACET 印出来）。
//   · **原地复述** —— `market.tsx` 的「接单前需要先通过 KYC 认证。」紧跟在标题「先完成KYC认证」下面；
//     `friend-crm.tsx` 的「通过二维码、邀请、通讯录、社媒或 Proxy 搜索找到你认识的人。」把下面那
//     5 个添加方式抄了一遍；同页「关系状态、互动与下一步动作」是页头把下面内容列了一遍。
//     删完 `styles.sub` / `sectionNote` / `composerSub` / `publishMenuHint` 全成死样式，一并删。
//
// ⚠️ **刻意保留**（不是漏删）：
//   · `friend-crm.tsx` 的 `styles.sectionNote`（「5 种方式」/「N 人 · 本机演示」/「最近 3 条」）
//     —— 是**计数/状态**，不是解释；下面第 5 条专门反证它还在。
//   · `facet` 的运营阈值面板（`opsSliderHint` 那组）—— 那是**运营/调试面板**，`label` 本身就是
//     `priority` / `confidence` / `CollaborationIntent` 这些内部名，hint 是它唯一的说明 ⇒ 留。
//   · `location-list-picker` 的 `entry.hint`（`${n} 个匹配` / `${n} 个区域`）—— 是**计数**。
//   · `business-home.tsx` 的 `sectionHint` 那一层 —— 359 当时判断「哪些算产品词得产品定」
//     ⇒ 本轮不动。**360 已做完**（证据：原型里没有这几句、`Scene Package` 被本文件注释自称
//     placeholder、`HOT / COOL` 的 COOL 从未实现）。留下的 `Scene Supply` / `OPERATING PLAN`
//     是**命名**不是解释 ⇒ 仍然不动。判据与钉子见 `no-page-gloss-filler-003.test.ts`。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const facet = stripComments(readFileSync(here("../facet/FacetHomeSurface.tsx"), "utf8"));
const shell = stripComments(readFileSync(here("../shell/app-shell.tsx"), "utf8"));
const market = stripComments(readFileSync(here("./market.tsx"), "utf8"));
const friendCrm = stripComments(readFileSync(here("./friend-crm.tsx"), "utf8"));

// **不带引号**地钉（带引号 / 模板串 / 放进数组都挡得住）；另有一份 `deConcat` 视图 ——
// `not.toContain` 是纯子串判定，`"P0: " + "把意图变成可邀请的 Scene"` 这种拼接**不抹就漏**
// （003 的反向注入实测到过）。残余上限：刻意打散成字符数组仍挡不住。
const deConcat = (s: string): string => s.replace(/["'`]\s*\+\s*["'`]/g, "");

const GLOSSES: ReadonlyArray<readonly [string, string, string]> = [
  ["facet/FacetHomeSurface.tsx", facet, "FACET 当前为每个对象独立判断展示方向"],
  ["shell/app-shell.tsx", shell, "P0: 把意图变成可邀请的 Scene — 预算进场景而非买人"],
  ["market.tsx", market, "接单前需要先通过 KYC 认证。"],
  ["friend-crm.tsx", friendCrm, "通过二维码、邀请、通讯录、社媒或 Proxy 搜索找到你认识的人。"],
  // ⚠️ 这句在 friend-crm.tsx 的**注释**里还被当作原型引文复述（`// 参考原型“好友关系 关系状态、…”`），
  // 所以必须用剥注释后的源码断言 —— 否则这条钉会被自己的引文喂红。
  ["friend-crm.tsx", friendCrm, "关系状态、互动与下一步动作"]
];

describe("NO-PAGE-GLOSS-FILLER-002 第二批页面级解释灰字 / 泄漏的内部说明已清", () => {
  it("五条字面量一条不剩（剥注释 + 抹掉拼接黏合处）", () => {
    for (const [file, code, gloss] of GLOSSES) {
      expect(code, `${file} 里「${gloss}」又回来了`).not.toContain(gloss);
      expect(deConcat(code), `${file} 里「${gloss}」被拼接着加回来了`).not.toContain(gloss);
    }
  });

  it("facet 首页：那条泄漏内部代号 FACET 的说明连同死样式一起消失", () => {
    expect(facet).not.toContain("styles.sectionNote");
    expect(facet).not.toContain("sectionNote:");
    // 反证：对象区还在，删的不是整块。
    expect(facet).toContain("styles.sectionTitle");
    expect(facet).toContain("styles.objectsList");
  });

  it("Scene Composer：泄漏排期与设计原则的那行连同死样式一起消失", () => {
    expect(shell).not.toContain("composerSub");
    // 反证：composer 本身还在（标题 + 字段）。
    expect(shell).toContain("styles.composerTitle");
    expect(shell).toContain("styles.composerField");
  });

  it("market 的 KYC 弹层：复述标题的那行连同死样式一起消失", () => {
    expect(market).not.toContain("publishMenuHint");
    // 反证：弹层还在 —— 标题与动作按钮都还在（删的只是标题下那句复述）。
    expect(market).toContain("styles.publishMenuTitle");
    expect(market).toContain("去KYC认证");
  });

  it("反证：friend-crm 的 sectionNote 是**计数**不是解释，必须还在", () => {
    expect(friendCrm).toContain("styles.sectionNote");
    expect(friendCrm).toContain("5 种方式");
    expect(friendCrm).toContain("最近 3 条");
    // 页头副标题的样式确实删了（元素与样式两层都不许留）。
    expect(friendCrm).not.toContain("sub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 4 }");
    // 反证：同页标题还在。
    expect(friendCrm).toContain("styles.title");
  });
});
