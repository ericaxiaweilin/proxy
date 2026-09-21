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

// 这一组钉的是**覆盖**，不是某个样式名。
//
// 2026-09-21 的第一次修复只把标注加在 AdaptiveMediaCollection 的**单图**分支里，
// 于是这些形状全都没标注：
//   - 多图帖 —— mediaCollectionMode() 判成 RAIL → AdaptiveMediaRail → SocialMediaFrame
//   - AI 视频 —— renderKindAwareStage 的 VIDEO 分支在算 aiLabel 之前就 return
//   - 个人主页 / 他人主页 —— 直接调 SinglePostImage / ThreadsPostMedia
// 都是同一件事：AI 做的媒体对用户可见，但没有标注。用户口径（2026-09-21）：
// 「ai做的 就标注」，且**公共空间（发帖文）是明确需要的那一处**。
// 所以钉的是「每种形状都有挂点」，而不是「某个分支里有某行代码」。
describe("LC-06 显示侧：每个「画媒体」的形状都挂上了标注", () => {
  const stripComments = (code: string): string =>
    code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const read = (rel: string): string =>
    stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

  it("判定口径只允许一条链：renderer → AIMediaBadge → aiMediaLabel", () => {
    const badge = read("./ai-media-badge.tsx");
    expect(badge).toContain('from "./ai-media-label"');
    // 挂载件自己不许再判一次来源 —— 那就是第二套口径，迟早跟 ai-media-label 漂移。
    expect(badge).not.toMatch(/AI_PERSONA|MODEL_API/);
    // 渲染分支不许碰 aiGenerationSource，只许挂 <AIMediaBadge/>。
    // （第一次修复就是在这里出的错：判定逻辑内联进了某一个分支。）
    for (const rel of ["./AdaptiveMediaCollection.tsx", "./SocialMediaFrame.tsx", "../components/threads-post-media.tsx"]) {
      expect(read(rel)).not.toMatch(/aiGenerationSource/);
    }
  });

  it("标注是覆盖层，不能吃掉「点开原图」的手势", () => {
    // pointerEvents="none" 必须跟标注同框，否则会把点开原图的手势吃掉 ——
    // 那是比不显示标注更糟的回归。
    expect(read("./ai-media-badge.tsx")).toMatch(/pointerEvents="none"/);
  });

  it("单图帖 + 单视频 + 多图帖里的视频：AdaptiveMediaCollection 三处挂点", () => {
    const code = read("./AdaptiveMediaCollection.tsx");
    // ① SinglePostImage 叶子（单图帖；个人主页也直接调它）
    // ② renderKindAwareStage 的 VIDEO 分支（它在图片分支**之前** return）
    // ③ AdaptiveMediaRail 的 VIDEO 卡（图片卡由 SocialMediaFrame 自己挂）
    expect((code.match(/<AIMediaBadge item=\{item\} \/>/g) ?? []).length).toBe(3);
  });

  it("多图帖的每张图（SocialMediaFrame）挂了标注", () => {
    expect(read("./SocialMediaFrame.tsx")).toContain("<AIMediaBadge item={item} />");
  });

  it("个人主页 / 他人主页的帖子图片区（ThreadsPostMedia）挂了标注", () => {
    expect(read("../components/threads-post-media.tsx")).toContain("<AIMediaBadge item={item} />");
  });
});
