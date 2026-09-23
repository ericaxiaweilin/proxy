import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// AI-MANAGE-001：我的 → 账户 → AI 管理落地原型 deepseek_html_20260923_83b40b。
//
// 只画真数：分身状态走 listMine 真查，照片/视频/动态走 profilePosts +
// profileMedia 现算。原型里没有后端的三件（Token 用量、暂停按钮、
// 对话/出图/动态三个设置 sheet）不做 —— 这批用例钉住"没偷偷做假"：
const surfaceSource = readFileSync(fileURLToPath(new URL("./ai-management.tsx", import.meta.url)), "utf8");
const meSource = readFileSync(fileURLToPath(new URL("./me.tsx", import.meta.url)), "utf8");
// 只查代码行，不查注释 —— 注释里写"暂停按钮不做"是有价值的决策记录，
// 真正要钉的是没有实现出来（参考 twin-insight-section.test.ts 同款处理）。
const surfaceCode = surfaceSource
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");

describe("AI management entry (AI-MANAGE-001)", () => {
  it("is listed under the account section", () => {
    expect(meSource).toContain('label: "AI 管理"');
    expect(meSource).toContain('route: "aimanage"');
  });

  it("opens a real surface, not a stub", () => {
    expect(meSource).toContain("<AIManagementSurface");
    expect(meSource).toContain('subPage.route === "aimanage"');
  });
});

describe("AI management shows only real numbers (AI-MANAGE-001)", () => {
  it("has no token/quota statics", () => {
    expect(surfaceCode).not.toContain("120K");
    expect(surfaceCode).not.toContain("200K");
    expect(surfaceCode).not.toContain("Token");
  });

  it("has no pause switch (pausing AI is a server capability)", () => {
    expect(surfaceCode).not.toContain("togglePause");
    expect(surfaceCode).not.toContain("pauseBtn");
    expect(surfaceCode).not.toContain("暂停");
  });

  it("has no model-vendor sheets (clients must not bind providers directly)", () => {
    expect(surfaceCode).not.toContain("vendor");
    expect(surfaceCode).not.toContain("model");
  });

  it("reads twin state from listMine, not a hardcoded badge", () => {
    expect(surfaceCode).toContain("listMine");
    expect(surfaceCode).not.toContain("每次确认");
    expect(surfaceCode).not.toContain("运行中");
  });

  it("management cards navigate to real surfaces", () => {
    expect(surfaceCode).toContain("onOpenImageManage");
    expect(surfaceCode).toContain("onOpenPostManage");
  });

  it("uses the prototype logo mark", () => {
    expect(surfaceCode).toContain("<Circle");
    expect(surfaceCode).toContain("<Line");
  });
});
