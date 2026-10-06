import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DEMAND-CTA-LABEL-001: 2026-10-06 用户「选择代替 下一步xxxx 要做 因为你喜欢说废话
// 没必要 大家知道选择」。
//
// 发布需求向导的步进按钮原来写「下一步 · 选人 / 服务 / 价格」和「下一步 · 规格」——
// 后缀在替用户复述他刚做完的动作，而下面那一屏本来就会说（选人页的「选人 · 可选」、
// 规格页的字段标题）。「上一步 / 选择」这组词自己就把方向说完了。
//
// 这条钉守的是**别把后缀加回来**，不是死抠「选择」这两个字 —— 用户以后想换个短词，
// 这里不该红。所以只断言两件事：① 主按钮文本里不出现「下一步」；② 步进按钮确实
// 用了那个短词，而且至少两处（选 Moment / 选人）。
//
// 反面断言**不能**裸查「下一步 · 」：向导里那段 2026-10-06 的注释就写着旧文案，
// 会被自己的注释喂红（本仓有前科）。只查真正渲染出来的文本节点。
describe("DEMAND-CTA-LABEL-001 步进按钮不复述下一步做什么", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );
  // 渲染出来的主按钮文本：`primaryBtnText}>…</Text>` 这一种形态。注释里的散文不匹配，
  // 所以下面那两个「不出现」的断言不会打到自己的注释上。
  const labels = [...wizard.matchAll(/primaryBtnText\}>([^<]*)<\/Text>/g)].map((match) => match[1]!);

  it("主按钮文本里没有「下一步」", () => {
    // 期望四个：选择 / 选择 / 发布到市场 / 查看市场。数量对不上说明正则没匹配到，
    // 那样这条钉会静默退化成空断言。
    expect(labels.length).toBeGreaterThanOrEqual(4);
    for (const label of labels) {
      expect(label, `主按钮「${label}」又在复述下一步做什么`).not.toContain("下一步");
    }
  });

  it("步进按钮用的是短词，而且选 Moment 与选人两步都有", () => {
    // 「发布到市场 / 查看市场」是终点动作，不算步进；步进只有这两处。
    // 用「至少两处」而不是「恰好两处」：以后加一步也只是再加一个短词按钮，不该红。
    expect(labels.filter((label) => label === "选择").length).toBeGreaterThanOrEqual(2);
  });
});
