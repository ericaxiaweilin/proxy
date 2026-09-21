import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aiMediaLabel } from "./ai-media-label";

// LC-06 显示侧（2026-09-21 产品决定「AI 做的就标注，法规要求要满足」）。
// 上半段钉判定口径，下半段钉「feed 渲染点真的用上了它」—— 只测纯函数的话，
// 把 import 删掉照样全绿，标注就又不显示了。
describe("LC-06 显示侧：AI 生成媒体标注的判定口径", () => {
  it("AI_PERSONA / MODEL_API 标「AI 生成」", () => {
    expect(aiMediaLabel("AI_PERSONA")).toBe("AI 生成");
    expect(aiMediaLabel("MODEL_API")).toBe("AI 生成");
  });

  it("USER_UPLOADED 不标 —— 手机直传没有 AI 参与，标了是假话", () => {
    expect(aiMediaLabel("USER_UPLOADED")).toBeUndefined();
  });

  it("字段缺省不标（老服务端 / 非 feed 来源）", () => {
    expect(aiMediaLabel(undefined)).toBeUndefined();
  });

  it("UNKNOWN 不标，且它由服务端闸门保证不可达", () => {
    // 这条断言的不是「UNKNOWN 安全」，而是「UNKNOWN 到不了客户端」：
    // internal/media/service.go 的 MarkMediaReady 对 UNKNOWN 报
    // AI_LABEL_MISSING 直接拒发，所以 READY 资产不可能是 UNKNOWN。
    // 那道闸门若被放宽，这条测试仍然会绿 —— 但那时它就是错的了。
    expect(aiMediaLabel("UNKNOWN")).toBeUndefined();
  });
});

describe("LC-06 显示侧：feed 渲染点真的挂上了标注", () => {
  const source = readFileSync(fileURLToPath(new URL("./AdaptiveMediaCollection.tsx", import.meta.url)), "utf8");
  const stripComments = (code: string): string =>
    code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const code = stripComments(source);

  it("import 了 aiMediaLabel", () => {
    expect(code).toContain('from "./ai-media-label"');
  });

  it("图片分支渲染 aiMediaBadge，且不拦截点击", () => {
    expect(code).toContain("styles.aiMediaBadge");
    // 标注是覆盖层：pointerEvents="none" 必须跟它同框，否则会把「点开原图」
    // 的手势吃掉 —— 那是比不显示标注更糟的回归。
    expect(code).toMatch(/pointerEvents="none"[\s\S]{0,80}aiMediaBadge/);
  });
});
