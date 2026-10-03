import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// MARKET-TAB-PENTAGON-001（2026-10-01，用户：「把市场的logo换成这个」）
//
// 用户给的是一枚五边形：
//   <svg viewBox="0 0 24 24"><polygon points="12 3 21 15 18 21 6 21 3 15"></polygon></svg>
// 底栏 MARKET 这一格原来用通用菱形 diamond。
//
// 为什么**新增 pentagon 而不是改 diamond**：
//   diamond 画的是 `M12 4 20 12 12 20 4 12z` —— 四个顶点 (12,4)(20,12)(12,20)(4,12)，
//   边长全 11.31，是正方形转 45°。它被当「通用菱形符号」复用着：
//     · 底栏 MARKET（本次要换的就是这一格）
//     · 我的订单（surfaces/me.tsx）
//     · feed 分类兜底（surfaces/feed.tsx）
//     · 城市选项（components/location-options.ts）
//     · 首页聊天框 ORDER 机会（components/home-chat-box.tsx）
//   而且它的路径被 WALLET-GEM-ICON-001（proxy-icon.test.ts:95-98）钉死。
//   改 diamond 的字形会把这 5 处一起换掉，并撞掉那条钉 —— 所以只新开一个字形。
//
// 这条钉守的是**接线**：字形在、顶点坐标一字不改、且只有 MARKET 指向它。
// 「看起来像不像用户给的那个五边形」只能靠真机截图，vitest 画不出来
// （跟 proxy-icon.test.ts 头注释同一口径）。
const sourceRoot = dirname(fileURLToPath(import.meta.url));

// 剥注释再断言：注释里也抄了用户那行 SVG（解释坐标来源）。不剥的话，
// 把 case 改回去、注释留着，反向臂照样绿。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const icon = stripComments(readFileSync(join(sourceRoot, "components", "proxy-icon.tsx"), "utf8"));
const shell = stripComments(readFileSync(join(sourceRoot, "shell", "app-shell.tsx"), "utf8"));

// 用户给的 <polygon points="12 3 21 15 18 21 6 21 3 15"> 按本文件 diamond 的写法
// 搬成闭合 Path（M → 隐式 L → z）：顶点顺序与坐标一个不改。
const PENTAGON_D = 'd="M12 3 21 15 18 21 6 21 3 15z"';

describe("MARKET-TAB-PENTAGON-001: 市场 tab 的字形是用户给的五边形", () => {
  it("pentagon 在 MasterModuleIcon 的 switch 里有实现（不是只声明联合类型）", () => {
    // 反向臂在前：`if (name === "pentagon")` **不可达** —— ProxyIcon 先调
    // MasterModuleIcon，命中 switch 里的同名 case 就提前 return 了
    // （跟 chevronRight / heart 同一类坑，见 proxy-icon.test.ts:48-70）。
    expect(icon, "pentagon 又写成不可达的 if 分支了").not.toContain('if (name === "pentagon")');
    expect(icon, "pentagon 字形不见了 —— 市场 tab 会渲染 null").toContain('case "pentagon":');
    // 联合类型里声明 `| "pentagon"` 但不实现也是渲染 null 的假绿，两边都要在。
    expect(icon).toContain('| "pentagon"');
    expect(icon).toContain(PENTAGON_D);
  });

  it("顶点坐标照抄用户给的 polygon，一个不改", () => {
    // 用户原文 points="12 3 21 15 18 21 6 21 3 15" ⇒ 五个顶点
    // (12,3) (21,15) (18,21) (6,21) (3,15)。
    // 别顺手「修」成 r=9 的正五边形 —— 那会跟用户给的图不一致。
    expect(icon).toContain(PENTAGON_D);
    // 描边跟 common 走（fill:none + strokeWidth 2.2），跟其余 4 颗 tab 同一套线宽；
    // 只有它实心会像另一个控件。
    const branch = icon.slice(icon.indexOf('case "pentagon":'));
    const body = branch.slice(0, branch.indexOf("case ", 1));
    expect(body).toContain("{...common}");
  });

  it("底栏 MARKET 指向 pentagon，且不再和 diamond 配对", () => {
    expect(shell).toContain('{ id: "MARKET", icon: "pentagon", label: t("tabMarket") }');
    expect(shell, "市场这一格又指回 diamond 了").not.toContain('{ id: "MARKET", icon: "diamond"');
    // 五边形只出现在 MARKET 这一格（抄到别处 = 图标跟错行，光看配对看不出来）。
    expect(shell.split('icon: "pentagon"').length - 1).toBe(1);
  });

  it("diamond 本身没被动 —— 它还被另外 4 处复用着", () => {
    expect(icon).toContain('case "diamond":');
    expect(icon).toContain('d="M12 4 20 12 12 20 4 12z"');
    // 那 4 个消费者仍在用 diamond —— 正因为它们还在用，diamond 才不能被改形状。
    const me = stripComments(readFileSync(join(sourceRoot, "surfaces", "me.tsx"), "utf8"));
    const feed = stripComments(readFileSync(join(sourceRoot, "surfaces", "feed.tsx"), "utf8"));
    const loc = stripComments(readFileSync(join(sourceRoot, "components", "location-options.ts"), "utf8"));
    const chat = stripComments(readFileSync(join(sourceRoot, "components", "home-chat-box.tsx"), "utf8"));
    expect(me, "我的订单的图标被换掉了").toContain('icon: "diamond"');
    expect(feed, "feed 分类兜底被换掉了").toContain('return "diamond";');
    expect(loc, "城市选项被换掉了").toContain('icon: "diamond"');
    expect(chat, "首页聊天框的机会图标被换掉了").toContain('icon: "diamond"');
  });
});
