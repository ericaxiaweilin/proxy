import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DEMAND-SCENE-MAP-001（2026-10-07，用户：「你在咖啡 list 下面放一个地点什么意义」）：
// 有列表的模板，地点手填框 + 手动地图撤掉 —— 列表 / 地图里选中回填，配一行已选
// 反馈（× 清掉重选）。无列表模板（绑人 / 协助）照旧手填 + 手动地图。
//
// 这条钉守的是「有列表就不摆手填」：谁把输入框摆回列表下面，这里先红。
// 断言只落在精确写法上 —— 注释里也写着这些词，裸名会被自己的注释喂红（本仓有前科）。
describe("DEMAND-SCENE-MAP-001 有列表不用手填地点，选中给已选行", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );

  it("选中回填配已选行，× 清掉重选", () => {
    expect(wizard).toContain("已选：");
    expect(wizard).toContain("清除已选地点");
    expect(wizard).toContain("pickedRow");
  });

  it("手填地点 + 手动地图只留给无列表模板", () => {
    // 地点输入与手动地图包在 !sceneBinding 分支里 —— 有列表时不渲染。
    expect(wizard).toContain("{sceneBinding ? null : (");
    expect(wizard).toContain('testID="demand-place-map"');
  });
});
