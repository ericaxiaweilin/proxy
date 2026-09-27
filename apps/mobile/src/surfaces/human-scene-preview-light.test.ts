import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// HOME-HUMAN-PROFILE-LIGHT-001（用户："真人推荐-点击头像进入 真人主页 页面
// 背景黑的 改下 正常白色的"）。这一屏（requester-home.tsx 的
// humanScenePreview 全屏 Modal）原来是硬编码深色主题（#162030 底 + 半透明
// 白覆盖层 + 白字/浅蓝字），跟 App 其余页面的白底不一致。
const source = readFileSync(fileURLToPath(new URL("./requester-home.tsx", import.meta.url)), "utf8");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const code = stripComments(source);

describe("HOME-HUMAN-PROFILE-LIGHT-001 真人主页预览走正常白底", () => {
  it("page/header background is the app's normal offWhite, not the old dark navy", () => {
    expect(code).toContain("humanScenePage: { backgroundColor: color.offWhite");
    expect(code).toContain("humanSceneHeader: { alignItems: \"center\", backgroundColor: color.offWhite");
    expect(code).not.toContain("#162030");
  });

  it("no leftover translucent-white-on-dark overlays (rgba(255,255,255,...)) for non-photo surfaces", () => {
    // 只扫这一屏自己的样式表（humanScenePage 到 humanSceneAddDoneText 之间），
    // 不误扫文件里其它页面本来就合法的深色浮层用法。两张贴真实照片的卡片
    // （当前 Scene / 可以一起去的地方）的深色遮罩是给盖在照片上的文字读性
    // 用的，跟页面主题无关，允许保留——它们的 shade 样式紧跟在这段之后。
    const start = code.indexOf("humanScenePage: { backgroundColor: color.offWhite");
    const end = code.indexOf("humanSceneAddDoneText: { color: color.ink }");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = code.slice(start, end);
    // 只钉"背景覆盖层"用法——两张真实照片卡片的 borderColor 仍合法用浅色
    // rgba(255,255,255,0.2)（边框在照片上不分深浅底），不属于本条钉的范围。
    expect(block).not.toMatch(/backgroundColor:\s*"rgba\(255,255,255,0\.\d+\)"/);
  });

  it("back glyph uses the ink tone for a light header, not onDark", () => {
    expect(code).toContain('<ProxyBackGlyph label={t("backShort")} tone="ink" />');
  });

  it("fact-row icons use a readable-on-light color, not the old #DCE6F7 light-blue-on-dark", () => {
    expect(code).not.toContain('color="#DCE6F7"');
    const factsBlock = code.slice(code.indexOf("humanSceneFacts}>"), code.indexOf("</View>\n              {publicHistoryOpen"));
    expect((factsBlock.match(/color=\{color\.muted\}/g) ?? []).length).toBe(3);
  });

  it("the avatar-initials fallback has a filled background so it stays readable on white", () => {
    expect(code).toContain("humanSceneAvatarRing: { alignItems: \"center\", backgroundColor: color.proxyPurpleSoft");
    expect(code).toContain("humanSceneInitials: { color: color.violet");
  });

  it("the already-added button state has its own readable text color instead of white-on-near-white", () => {
    expect(code).toContain("humanSceneAddDoneText: { color: color.ink }");
    expect(code).toContain("styles.humanSceneAddDoneText]");
  });

  it("dead pre-existing styles (0 usages before this fix) were removed, not carried forward mis-colored", () => {
    for (const dead of ["humanSceneClose:", "humanSceneCloseText:", "humanSceneAdd:", "humanSceneAddText:", "humanSceneActions:", "humanSceneAction:", "humanSceneActionText:"]) {
      expect(code).not.toContain(dead);
    }
  });

  it("photo-backed cards (real scene images) keep their dark scrim for text legibility — not part of this fix", () => {
    expect(code).toContain("humanSceneLinkShade: { backgroundColor: \"rgba(8,13,24,0.48)\"");
    expect(code).toContain("humanSceneSceneShade: { backgroundColor: \"rgba(8,13,24,0.35)\"");
  });
});
