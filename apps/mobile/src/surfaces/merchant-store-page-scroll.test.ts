import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./merchant-me-r21-replacement.tsx", import.meta.url), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

// STORE-HUB-SCROLL-001（2026-10-02，用户「还是显示不完整 不能下滑动」）：
//
// 「线上店铺」这一支（BUSINESS 上下文里的店 hub / 店详情）原来是这个文件里
// **唯一**没套 ScrollView 的页面分支：其余 12 个分支都是
// `<View style={styles.root}><ScrollView contentContainerStyle={styles.content}>`。
// MyStoresHub 自己是纯 View（列表/详情/资产三个态都不带滚动容器 —— 滚动归宿主），
// 所以直接渲染 = 整页没有滚动容器：内容一超过一屏就被屏幕底边裁掉，划不动，
// 而底部那条悬浮 Tab Bar（占 735–818pt）又压住最后一段内容。
// 在模拟器上的实测：修前同一页、同一个上滑手势，元素坐标一格没动；修后滚掉 683pt，
// 最后一个动作「复制地址」完整露在 dock 上方。
describe("STORE-HUB-SCROLL-001", () => {
  const storeBranch = (): string => {
    const start = code.indexOf('if (page === "store")');
    expect(start).toBeGreaterThan(-1);
    return code.slice(start, code.indexOf('if (page === "sales")'));
  };

  it("gives the store hub a scroll container like every other page in this file", () => {
    const branch = storeBranch();
    expect(branch).toContain("<ScrollView contentContainerStyle={styles.content}>");
    // 钉的是「包住了」而不是「出现过」：ScrollView 必须在 MyStoresHub 之前打开。
    expect(branch.indexOf("<ScrollView")).toBeLessThan(branch.indexOf("<MyStoresHub"));
    expect(branch.lastIndexOf("</ScrollView>")).toBeGreaterThan(branch.indexOf("<MyStoresHub"));
  });

  it("does not hand the hub a second nested scroll container of its own", () => {
    // hub 的滚动归宿主：它自己再开一个纵向 ScrollView 就会在 iOS 上抢走手势，
    // 宿主滚不动、它自己也滚不动（内容高度 = 自身高度）。
    const hub = readFileSync(new URL("./my-stores-hub.tsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/[^\n]*/g, "$1");
    expect(hub).not.toMatch(/<ScrollView(?![^>]*horizontal)[^>]*style=\{s\./);
  });

  it("keeps the shared content padding clear of the floating tab bar", () => {
    // styles.content 的 paddingBottom 就是 dock 让位量（悬浮 Tab Bar 到屏幕底
    // 还有 117pt）。谁把它调回几十，这一支会重新变成「到底也看不见最后一个按钮」。
    expect(code).toMatch(/content: \{[^}]*paddingBottom: (1[0-9][0-9]|[2-9][0-9]{2,})[^}]*\}/);
  });
});
