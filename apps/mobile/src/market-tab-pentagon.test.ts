import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 市场 tab 的字形 —— 这个文件里驻着**两条**钉：
//
//   · MARKET-TAB-PENTAGON-001（2026-10-01，用户「把市场的logo换成这个」）
//     —— 用户给的五边形字形本身。2026-10-06 起底栏不再指它，但字形保留不删，
//        所以这条钉降级为「用户给的坐标原样还在」，不再声称市场用五边形。
//   · MARKET-TAB-GEM-OUTLINE-001（2026-10-06，用户「自己做个💎形轮廓logo 目前是菱形」）
//     —— 市场 tab 现在的字形，宝石轮廓 gemOutline。
//
// 文件名仍是 market-tab-pentagon.test.ts 是历史原因（2026-10-01 建），**不改名**：
// 门禁 check-regression-contracts.sh 按文件名取它，且本仓的 git 索引操作不在
// 自动化范围内（改名要动索引）。两条钉同处一文件，靠 describe 名区分。
//
// ⚠️ 这两条钉**必须同时覆盖两个渲染器**：
//   · JS 字形   apps/mobile/src/components/proxy-icon.tsx
//   · iOS 原生  apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBarView.swift
// Revision 341 只改了 JS 侧，而 iOS 底栏是原生 UITabBar（app-shell.tsx 的
// Platform.OS === "ios" 分支），JS dock 在 iOS 上根本不渲染 —— 于是「市场 logo 换了」
// 在设备上是假的，整整一轮白做。Revision 343 记录了这次事故。
// 所以 MARKET-TAB-GEM-OUTLINE-001 特意把 Swift 那份坐标一起钉进来。
//
// 两个渲染器都**画不出图**给 vitest 看，「看起来像不像宝石」只能靠真机截图
// （跟 proxy-icon.test.ts 头注释同一口径）。这里守的是接线与坐标。
const sourceRoot = dirname(fileURLToPath(import.meta.url));

// 剥注释再断言：注释里也抄了这些坐标（解释几何来源）。不剥的话，
// 把 case 改回去、注释留着，反向臂照样绿。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const icon = stripComments(readFileSync(join(sourceRoot, "components", "proxy-icon.tsx"), "utf8"));
const shell = stripComments(readFileSync(join(sourceRoot, "shell", "app-shell.tsx"), "utf8"));
const swift = stripComments(
  readFileSync(join(sourceRoot, "..", "modules", "proxy-native-tab-bar", "ios", "ProxyNativeTabBarView.swift"), "utf8")
);

// 用户给的 <polygon points="12 3 21 15 18 21 6 21 3 15"> 按本文件 diamond 的写法
// 搬成闭合 Path（M → 隐式 L → z）：顶点顺序与坐标一个不改。
const PENTAGON_D = 'd="M12 3 21 15 18 21 6 21 3 15z"';

// MARKET-TAB-GEM-OUTLINE-001 的几何（24 栅格，自画，取景约 16×16 —— 正方形，
// 跟 💎 emoji 的纵横比一致；早先一版 18×15 太扁，读起来像平底碗不像宝石）：
//   台面  (8.5,4.5) → (15.5,4.5)
//   右腰棱 → (20,10.5)   亭尖 → (12,20.5)   左腰棱 → (4,10.5)
//   腰棱线 (4,10.5) → (20,10.5)
const GEM_SILHOUETTE_D = 'd="M8.5 4.5H15.5L20 10.5 12 20.5 4 10.5z"';
const GEM_GIRDLE_D = 'd="M4 10.5H20"';

describe("MARKET-TAB-PENTAGON-001: 用户给的五边形字形仍在，坐标未改", () => {
  it("pentagon 在 MasterModuleIcon 的 switch 里有实现（不是只声明联合类型）", () => {
    // 反向臂在前：`if (name === "pentagon")` **不可达** —— ProxyIcon 先调
    // MasterModuleIcon，命中 switch 里的同名 case 就提前 return 了
    // （跟 chevronRight / heart 同一类坑，见 proxy-icon.test.ts:48-70）。
    expect(icon, "pentagon 又写成不可达的 if 分支了").not.toContain('if (name === "pentagon")');
    expect(icon, "pentagon 字形不见了 —— 留着是为了能一行改回去").toContain('case "pentagon":');
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
});

describe("MARKET-TAB-GEM-OUTLINE-001: 市场 tab 的字形是宝石轮廓", () => {
  it("gemOutline 在 switch 里有实现，且两个渲染器都在（iOS 不是只改 JS）", () => {
    expect(icon, "gemOutline 又写成不可达的 if 分支了").not.toContain('if (name === "gemOutline")');
    expect(icon, "gemOutline 字形不见了 —— 市场 tab 会渲染 null").toContain('case "gemOutline":');
    expect(icon).toContain('| "gemOutline"');
    // iOS 原生那份。这条臂是本次新增的重点：Revision 341 只改 JS，iOS 上白改一轮。
    expect(swift, "iOS 原生底栏的字形没跟着改 —— 设备上仍是旧的").toContain("case 1:");
  });

  it("JS 那份：轮廓 + 腰棱线，坐标一字不改，且是描边不是实心", () => {
    expect(icon).toContain(GEM_SILHOUETTE_D);
    // 腰棱线是「这是宝石、不是风筝」的那一笔：只画轮廓不画它，读起来仍是个菱形。
    expect(icon, "腰棱线被删了 —— 那就退回成一个菱形了").toContain(GEM_GIRDLE_D);
    const branch = icon.slice(icon.indexOf('case "gemOutline":'));
    const body = branch.slice(0, branch.indexOf("case ", 1));
    // 两条子路径都走 common（fill:none + strokeWidth 2.2）。
    // 只数 {...common}：底栏五颗里只有它实心会像另一个控件。
    expect((body.match(/\{\.\.\.common\}/g) ?? []).length).toBe(2);
    expect(body, "gemOutline 被写成实心了").not.toContain("filledCommon");
  });

  it("iOS 那份：case 1 的坐标与 JS 逐字相同，旧的 diamond 顶点已消失", () => {
    const after = swift.slice(swift.indexOf("case 1:"));
    const body = after.slice(0, after.indexOf("case 2:", 1));
    // 顺序即路径顺序：台面左 → 台面右 → 右腰棱 → 亭尖 → 左腰棱，再一条腰棱线。
    const expected = [
      "CGPoint(x: 8.5, y: 4.5)",
      "CGPoint(x: 15.5, y: 4.5)",
      "CGPoint(x: 20, y: 10.5)",
      "CGPoint(x: 12, y: 20.5)",
      "CGPoint(x: 4, y: 10.5)"
    ];
    let cursor = -1;
    for (const point of expected) {
      const at = body.indexOf(point, cursor + 1);
      expect(at, `iOS case 1 里缺 ${point}（或顺序不对）—— 与 JS 字形漂移了`).toBeGreaterThan(cursor);
      cursor = at;
    }
    // 腰棱线：左腰棱再连回右腰棱（与 JS 的第二条 Path 同一笔）。
    expect(body.slice(cursor), "iOS 少画了腰棱线").toContain("CGPoint(x: 20, y: 10.5)");
    // 旧 diamond 的两个侧顶点必须没了，否则是「改了一半」。
    expect(body, "iOS 的 case 1 还是 diamond").not.toContain("CGPoint(x: 20, y: 12)");
    expect(body, "iOS 的 case 1 还是 diamond").not.toContain("CGPoint(x: 4, y: 12)");
  });

  it("底栏 MARKET 指向 gemOutline，且不再和 diamond / pentagon 配对", () => {
    expect(shell).toContain('{ id: "MARKET", icon: "gemOutline", label: t("tabMarket") }');
    expect(shell, "市场这一格又指回 diamond 了").not.toContain('{ id: "MARKET", icon: "diamond"');
    expect(shell, "市场这一格又指回 pentagon 了").not.toContain('{ id: "MARKET", icon: "pentagon"');
    // 宝石轮廓只出现在 MARKET 这一格（抄到别处 = 图标跟错行，光看配对看不出来）。
    expect(shell.split('icon: "gemOutline"').length - 1).toBe(1);
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
