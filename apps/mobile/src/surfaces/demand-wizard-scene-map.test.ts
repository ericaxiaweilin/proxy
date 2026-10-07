import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DEMAND-SCENE-MAP-001（2026-10-07，用户：「你在咖啡 list 下面放一个地点什么意义」）：
// 有列表的模板，地点手填框 + 手动地图撤掉 —— 列表 / 地图里选中回填，配一行已选
// 反馈（× 清掉重选）。无列表模板（绑人 / 协助）照旧手填 + 手动地图。
//
// 这条钉守的是「有列表就不摆手填」：谁把输入框摆回列表下面，这里先红。
// 断言只落在精确写法上 —— 注释里也写着这些词，裸名会被自己的注释喂红（本仓有前科）。
describe("DEMAND-SCENE-MAP-001 有列表不用手填地点，选中给已选反馈", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );

  it("选中回填，清除入口在段头（不再单占一行重复名字）", () => {
    // DEMAND-NOISE-TRIM-001（2026-10-07，用户：「功能可以 就是废话有点多」）：
    // 「已选：XXX · 清除」整行撤了 —— 选中的卡自己变色（PICKED-COLOR-001），
    // 「清除」搬进第 1 段段头 hint 槽。清除能力本身必须在（否则选错就换不掉）。
    expect(wizard).toContain("清除已选地点");
    // 断言收精确到 JSX 写法（`已选：{...}`）—— 注释里也写着「已选：XXX」，
    // 裸字符串会被自己的注释喂红（本仓有前科）。
    expect(wizard).not.toContain("已选：{");
    // 同样收精确到引用写法：注释里留着「pickedRow」这几个字（记录删了哪四条样式），
    // 裸名字会把注释一起算进去。
    expect(wizard).not.toContain("styles.pickedRow");
  });

  it("清除动作用 close 字形，不摆文字", () => {
    // DEMAND-NOISE-TRIM-002（2026-10-07，用户：「可以用X号代替啊 能用logo尽量别用
    // 文字」）：取消选择是通用语义 —— 有现成字形就用字形（ProxyIcon 的 close，
    // 跟各处关闭按钮同一个 ×），文案退到 accessibilityLabel 供读屏。
    expect(wizard).toContain('name="close"');
    // 反向：段头 hint 里不许再把「清除」两个字摆出来。收精确到 JSX 写法（`>清除<`）——
    // 上面注释里也写着「清除」两个字（用「」包着），裸串会被自己的注释喂红。
    expect(wizard).not.toContain(">清除<");
  });

  it("手填地点 + 手动地图只留给无列表模板", () => {
    // 地点输入与手动地图包在 !sceneBinding 分支里 —— 有列表时不渲染。
    expect(wizard).toContain("{sceneBinding ? null : (");
    expect(wizard).toContain('testID="demand-place-map"');
  });
});
