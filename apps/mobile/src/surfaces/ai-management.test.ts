import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// AI-MANAGE-002：AI 管理页全量按原型 deepseek_html_20260923_83b40b 落地 ——
// 暂停 / Token / 三个设置 sheet 都接真服务端。钉住：数从服务端来（不编
// 120K/200K 上限）、动态卡不虚报「运行中」、厂商是偏好 ID 不是直绑 provider。
const surfaceSource = readFileSync(fileURLToPath(new URL("./ai-management.tsx", import.meta.url)), "utf8");
const clientSource = readFileSync(fileURLToPath(new URL("../ai-engine-client.ts", import.meta.url)), "utf8");
const meSource = readFileSync(fileURLToPath(new URL("./me.tsx", import.meta.url)), "utf8");
const surfaceCode = surfaceSource
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");
const clientCode = clientSource
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");

describe("AI management entry (AI-MANAGE-001/002)", () => {
  it("is listed under the account section", () => {
    expect(meSource).toContain('label: "AI 管理"');
    expect(meSource).toContain('route: "aimanage"');
  });

  it("uses its own row icon, not the AI分身 one", () => {
    expect(meSource).toContain('{ icon: "sparkle", label: "AI 管理"');
  });

  it("opens a real surface wired to the session store", () => {
    expect(meSource).toContain("<AIManagementSurface");
    expect(meSource).toContain('subPage.route === "aimanage"');
    expect(meSource).toContain("secureSessionStore={nativeSecureSessionStore}");
  });
});

describe("AI management server-backed controls (AI-MANAGE-002)", () => {
  it("reads and writes settings through the command client", () => {
    expect(clientCode).toContain("GetAiEngineSettings");
    expect(clientCode).toContain("UpdateAiEngineSettings");
    expect(surfaceCode).toContain("engineClient.read()");
    expect(surfaceCode).toContain("engineClient.write(");
  });

  it("has a real pause control that flips server paused", () => {
    expect(surfaceCode).toContain("togglePause");
    expect(surfaceCode).toContain('accessibilityLabel={paused ? "继续" : "暂停"}');
    expect(surfaceCode).toContain("paused: !settings.paused");
  });

  it("shows token usage from the server month, not a fake quota cap", () => {
    expect(surfaceCode).toContain("本月 Token");
    expect(surfaceCode).toContain("formatTokens(tokenTotal)");
    // 不编 120K/200K 上限 —— 服务端只回本月累计，没有 limit 字段。
    expect(surfaceCode).not.toContain("120K");
    expect(surfaceCode).not.toContain("200K");
    expect(surfaceCode).not.toContain("/ 200");
  });

  it("opens three settings sheets matching the prototype", () => {
    expect(surfaceCode).toContain("对话管理");
    expect(surfaceCode).toContain("图片管理");
    expect(surfaceCode).toContain("动态管理");
    expect(surfaceCode).toContain("AiChatSheet");
    expect(surfaceCode).toContain("AiImageSheet");
    expect(surfaceCode).toContain("AiPostSheet");
    expect(surfaceCode).toContain("AI Engine v2.4 · 平台托管");
  });

  it("keeps vendor choice as preference ids, not direct provider binds", () => {
    expect(clientCode).toContain("imageVendorPref");
    expect(clientCode).toContain("imageModelPref");
    // 客户端不出现具体 provider SDK/baseURL 绑定字样。
    expect(surfaceCode).not.toContain("baseUrl");
    expect(surfaceCode).not.toContain("api.openai.com");
    expect(surfaceCode).not.toContain("generativelanguage");
  });

  it("does not fake a running auto-post worker", () => {
    expect(surfaceCode).toContain("自动发帖任务尚未上线");
    expect(surfaceCode).toContain("postPermissionBadge");
    // postPermission=auto 的 badge 说「全自动」，不说「运行中」。
    expect(surfaceCode).toContain('return "全自动"');
  });

  it("keeps management cards navigating to real content surfaces", () => {
    expect(surfaceCode).toContain("onOpenImageManage");
    expect(surfaceCode).toContain("onOpenPostManage");
    expect(surfaceCode).toContain("管理已生成图片");
    expect(surfaceCode).toContain("管理已发动态");
  });

  it("uses the prototype logo mark", () => {
    expect(surfaceCode).toContain("<Circle");
    expect(surfaceCode).toContain("<Line");
  });
});
