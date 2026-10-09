import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ME-NO-DESC-FILLER-001（2026-10-09）：「我的」这一片的灰色副文案（`desc` / 解释性灰字）整体删除。
//
// 用户原话：「我看了 还有很多解释废话没有删除 比如我的权益 钱包与结算...」
// 上一轮删的是**分组副标题**（`hint`）；这一轮是每个菜单行/磁贴下面那行 `desc`
// —— 它讲的是「这一项里有什么 / 为什么这样设计」（「等级、成长值、成长任务与可领取的
// 活动权益」「钱包是'我的'内页，只展示 Proxy 真正经手或需要记录的资金状态」），
// 用户点进去自然就看得到。子页头部的副标题（`me-sub-pages.ts`）是同一种东西，一起删。
//
// 随后按用户「不只这个功能 其它的解释废话移除」把同一种灰字扫到**其余渲染层**：
//   · `subPageSub`（专属子页头部的副标题）、`customSectionHint`（分区标题下的小字）、
//     `enterpriseQuickDesc`（卡片里那串「里面有什么」的清单）—— 元素删掉后样式也变死，一并删；
//   · 两处 `QrCard desc`、两处 `SocialRow desc`（后者在商家资料卡上，与菜单行同类）。
// 同时清掉**内部词泄漏**：`已接 supply` / `Source Assets` / `系统只生成 Draft，业务真源…`
// —— 这不是「废话」而是把实现词汇印给了用户。
//
// ⚠️ **留下的不是漏删**，是三类**不许当废话删**的东西：
//   ① 状态诚实标记：`功能预览 · 实时数据待接入`（那一项的后端还没有，删了就等于假装做完了）；
//   ② 口径诚实声明：`…口径未接入前不编数`（`placeholder-honest-actions.test.ts` 钉着它）；
//   ③ 身份行（`PersonaConfig.desc`，渲染在身份卡上）：`河内 · 个人身份` 这类是**数据**。
// 同理**保留**的还有（都不是「这一项里有什么」）：状态/数量（`可编辑` / `已开放` / `N 项`）、
// 规则说明（`按日例外优先于每周规律…`）、当前值（`当前：…`）、以及空态前提
// （`先设置你的个人主页名，才能生成二维码。` —— 那是「为什么这里是空的」，删了页面就只剩一个标题）。
//
// 所以下面的断言是**白名单相等**而不是「一个都没有」—— 任何**新**的解释性 desc 都会红，
// 想加就得先改这份白名单（= 明确知道自己在加一句用户可见的解释）。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const meCode = stripComments(readFileSync(here("./me.tsx"), "utf8"));
const subPagesCode = stripComments(readFileSync(here("./me-sub-pages.ts"), "utf8"));
const meTypesCode = stripComments(readFileSync(here("./me-types.ts"), "utf8"));
const componentsCode = stripComments(readFileSync(here("./me-profile-components.tsx"), "utf8"));
const stylesCode = stripComments(readFileSync(here("./me-styles.ts"), "utf8"));

// 只数**字符串字面量**的 desc（`desc: row.desc` 这类透传不算）。
const descLiterals = (source: string): string[] =>
  [...source.matchAll(/desc:\s*"([^"]*)"/g)].map((m) => m[1]!);

const ME_ALLOWED = [
  "功能预览 · 实时数据待接入", // ① 状态诚实标记
  "河内 · 个人身份", // ③ 身份行
  "Business Principal · 当前你有经营权限" // ③ 身份行
];
const SUBPAGE_ALLOWED = [
  "收入口径未接入前不编造数字。", // ② 口径诚实声明
  "口径未接入前不编数。", // ②
  "归因口径未接入前不编数。" // ②
];

describe("ME-NO-DESC-FILLER-001 菜单副文案里不再有解释性废话", () => {
  it("me.tsx 的 desc 字面量只剩状态/身份两类白名单", () => {
    expect([...new Set(descLiterals(meCode))].sort()).toEqual([...ME_ALLOWED].sort());
  });

  it("me-sub-pages.ts 的 desc 字面量只剩三条口径诚实声明", () => {
    expect([...new Set(descLiterals(subPagesCode))].sort()).toEqual([...SUBPAGE_ALLOWED].sort());
  });

  it("类型允许 desc 缺席（不然删掉就编译不过，钉就成了摆设）", () => {
    expect(meTypesCode).toContain("desc?: string");
    expect(subPagesCode).toContain("desc?: string");
    // QrCard / SocialRow 的 desc 也必须是可选的 —— 否则删掉调用方那一行编译不过。
    expect(componentsCode.match(/desc\?: string;/g) ?? []).toHaveLength(2);
  });

  it("渲染点都做了 guard —— 没 desc 就不画那行，而不是画一行空的", () => {
    expect(meCode).toContain("{subPage.desc ? <Text selectable style={styles.detailSub}>{subPage.desc}</Text> : null}");
    expect(meCode).toContain("{tile.desc ? <Text selectable style={styles.tileDesc}>{tile.desc}</Text> : null}");
    expect(componentsCode).toContain("{row.desc ? <Text selectable style={styles.serviceDesc}>{row.desc}</Text> : null}");
    expect(componentsCode).toContain("{desc ? <Text selectable style={styles.qrCardDesc}>{desc}</Text> : null}");
    expect(componentsCode).toContain("{desc ? <Text selectable style={styles.socialRowDesc}>{desc}</Text> : null}");
    // 反证：上面几条不是因为渲染点整个消失了才过的。
    expect(componentsCode).toContain("styles.serviceLabel");
    expect(componentsCode).toContain("styles.qrCardTitle");
    expect(componentsCode).toContain("styles.socialRowLabel");
  });

  it("没有任何 JSX `desc=` / `desc={` 传参留在这一片（要么删了，要么走 guard）", () => {
    // 这两种形状是「把一句解释塞进子组件」的唯一入口。留着就说明还有没清干净的一层。
    for (const [name, code] of [["me.tsx", meCode], ["me-profile-components.tsx", componentsCode]] as const) {
      expect(code, `${name} 还有 desc="…" 传参`).not.toContain('desc="');
      expect(code, `${name} 还有 desc={…} 传参`).not.toContain("desc={");
    }
  });

  it("专属子页的 subPageSub 与分区标题下的 customSectionHint 连同死样式一起消失", () => {
    // 元素层
    expect(meCode).not.toContain("styles.subPageSub");
    expect(meCode).not.toContain("styles.customSectionHint");
    expect(meCode).not.toContain("styles.enterpriseQuickDesc");
    // 样式层（注释已剥，所以 me-styles.ts 里那条「为什么删掉」的注释不会把这条骗绿）
    expect(stylesCode).not.toContain("subPageSub:");
    expect(stylesCode).not.toContain("customSectionHint:");
    expect(stylesCode).not.toContain("enterpriseQuickDesc:");
    // 反证：同一个 style 表还在、同族的还活着（不是整个文件被清空了）。
    expect(stylesCode).toContain("customSectionTitle:");
    expect(stylesCode).toContain("subPageTitle:");
    // 刻意保留：qrRealHint 的空态前提还在（删了「我的二维码」页就只剩一个标题）。
    expect(meCode).toContain("先设置你的个人主页名，才能生成二维码。");
  });

  it("两段「扫码会怎样」的长解释删除（二维码卡与我的二维码页各一段）", () => {
    expect(meCode).not.toContain("可用于桌牌、海报和 Creator 分享");
    expect(meCode).not.toContain("TikTok / Zalo 是否展示，继续遵循你的可见范围");
    // 刻意保留：availabilitySub 那条**规则说明**还在（它讲的是优先级，不是「里面有什么」）。
    expect(componentsCode).toContain("按日例外优先于每周规律；两者都不覆盖时该日不可约。");
  });

  it("内部词不再印给用户（supply / Source Assets / Draft / 业务真源）", () => {
    for (const jargon of ["已接 supply", "Source Assets", "业务真源", "系统只生成 Draft"]) {
      expect(meCode, `内部词「${jargon}」又漏到用户可见文案里了`).not.toContain(jargon);
    }
    // 反证：那两处状态/数量还在，只是换成了用户能读的说法。
    expect(meCode).toContain('{abilities.length} 项{passportError ? " · 同步失败" : ""}');
    expect(meCode).toContain("{enterpriseAssets.length} 份");
    expect(meCode).toContain("系统只生成草稿，最终要由你确认。");
  });
});
