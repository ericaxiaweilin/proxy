import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DEMAND-WIZARD-COPY-001: 发布需求向导里**用户看得见的文案**。两件事，都是用户当轮直接
// 定的，不是我自己挑的：
//
// ① 步进按钮不复述下一步做什么 —— 2026-10-06 用户「选择代替 下一步xxxx 要做 因为你喜欢
//    说废话 没必要 大家知道选择」。原来写「下一步 · 选人 / 服务 / 价格」「下一步 · 规格」，
//    后缀在替用户复述他刚做完的动作，而下面那一屏本来就会说（选人页的「选人 · 可选」、
//    规格页的字段标题）。「上一步 / 选择」这组词自己就把方向说完了。
//
// ② 搜索框示例不指向已撤掉的模板 —— 2026-10-06 用户「唱歌不要搞 😂」把 KTV 那条模板整条
//    撤了，但搜索框的 placeholder 还写着「例如：4个人，周六晚上唱歌」。照它输进去，
//    搜出来是空的：那是在拿一个不存在的能力当范例。
//
// 这条钉守的是**「别把撤掉的东西、和废话，写回用户看得见的地方」**，不是死抠具体措辞 ——
// 用户以后想换个短词、换个示例，这里不该红。
//
// ⚠️ 反面断言**不能**裸查「下一步」「唱歌」：向导里那段 2026-10-06 的注释就写着旧文案，
// 会被自己的注释喂红（本仓有前科）。所以两条都只查**真正渲染出来的**值 ——
// `primaryBtnText}>…</Text>` 的文本节点、`placeholder="…"` 的属性值。
describe("DEMAND-WIZARD-COPY-001 发布需求页的用户可见文案", () => {
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

  it("搜索框示例不拿已撤掉的模板当范例", () => {
    const placeholders = [...wizard.matchAll(/placeholder="([^"]*)"/g)].map((match) => match[1]!);
    // 只数**字符串字面量**占位：搜索框的「例如：…」和备注的「补充说明（随订单展示）」。
    // 场地输入那个是 `placeholder={template?.venue}`（表达式，取模板自带的场地名），
    // 不是字面量，也写不进一个已撤掉的能力名 —— 所以它不该被这条正则收进来。
    // （价格输入原本还有一个 `placeholder={template?.defaultPrice}`，2026-10-07 接上
    // 系统定价后那个输入框整条删了，这里只剩场地这一个表达式占位。）
    expect(placeholders.length).toBeGreaterThanOrEqual(2);
    for (const placeholder of placeholders) {
      // 唱歌 = 2026-10-06 撤掉的 KTV 模板；KTV 顺带一起禁（同一条能力）。
      expect(placeholder, `占位文案「${placeholder}」在拿已撤掉的能力当范例`).not.toMatch(/唱歌|KTV/);
    }
  });
});
