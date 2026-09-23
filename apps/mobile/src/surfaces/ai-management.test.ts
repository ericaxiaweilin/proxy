import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("react-native", () => ({ StyleSheet: { create: <T,>(s: T) => s, absoluteFill: {} }, Animated: { Value: class {}, View: "View", timing: () => ({ start: () => undefined }) }, Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View" }));
vi.mock("react-native-svg", () => ({ Circle: "Circle", Defs: "Defs", Line: "Line", LinearGradient: "LinearGradient", Path: "Path", RadialGradient: "RadialGradient", Rect: "Rect", Stop: "Stop", Svg: "Svg", SvgXml: "SvgXml" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("../ai-engine-client", () => ({ AiEngineClient: class {} }));
vi.mock("../composer-body", () => ({ formatRelativeTime: () => "" }));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("../ai-persona-client", () => ({ AiPersonaClient: class {} }));
vi.mock("../media/asset-sources", () => ({ getAiScenePhoto: () => undefined }));

import { decodePromptHistory, encodePromptHistoryEntry, formatTokens, promptForScene } from "./ai-management";
import { AI_CAMERA_ICONS, AI_CAMERA_MOVES, AI_MANAGE_ICONS, AI_SCENE_ALIASES, AI_POSES, AI_POSE_ICONS, AI_SCENES } from "./ai-management-data";

// AI-MANAGE-003（2026-09-23，用户：「原型给了 干的一坨屎 logo 也不对 功能也不对」）：
// 整页按原型 deepseek_html_20260923_83b40b (1).html 重做。钉住：
//   - 「我的」入口用原型的节点牌标，不再是回落成「sp」的 sparkle 文字；
//   - 目录（场景 / 姿态 / 运镜 / 厂商）逐项来自原型，不是删减版；
//   - 所有选择真落服务端，点下去先变、失败再撤；
//   - Token 不画假上限；出图 / 自动发帖没接上就如实说，不画「运行中」。
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const stripComments = (source: string): string => source.split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
const surface = stripComments(read("./ai-management.tsx"));
const me = read("./me.tsx");
const meRow = read("./me-profile-components.tsx");

describe("AI management entry (AI-MANAGE-001/003)", () => {
  it("is listed under the account section and opens the real surface", () => {
    expect(me).toContain('{ icon: "ai-manage", label: "AI 管理"');
    expect(me).toContain('subPage.route === "aimanage"');
    expect(me).toContain("<AIManagementSurface");
    expect(me).toContain("secureSessionStore={nativeSecureSessionStore}");
  });

  it("draws the prototype logo mark in the 我的 row instead of a fallback glyph", () => {
    expect(me).not.toContain('icon: "sparkle", label: "AI 管理"');
    expect(meRow).toContain('row.icon === "ai-manage"');
    expect(meRow).toContain("<AILogo active size={40} />");
  });
});

describe("AI management surface (AI-MANAGE-003)", () => {
  it("keeps every catalogue entry from the prototype", () => {
    // AI-MANAGE-005：场景按用户样片扩到 12 个，每个都有打包的封面照片。
    expect(AI_SCENES.map((s) => s.id)).toEqual(["cafe", "fine_dining", "beach", "garden", "brunch", "rooftop_city", "dessert", "night_lounge", "old_street", "bookstore_cafe", "riverside_sunset", "resort_pool"]);
    const assets = read("../media/asset-sources.ts");
    for (const scene of AI_SCENES) {
      expect(assets).toContain(`case "${scene.id}":`);
      expect(assets).toContain(`assets/ai-scenes/${scene.id}.jpg`);
    }
    expect(AI_SCENE_ALIASES).toEqual({ restaurant: "fine_dining", izakaya: "night_lounge", night: "rooftop_city" });
    for (const scene of AI_SCENES) {
      expect(scene.elements.length).toBeGreaterThanOrEqual(6);
      expect(scene.prompt.length).toBeGreaterThan(40);
      expect(AI_POSES[scene.id]).toHaveLength(6);
      for (const pose of AI_POSES[scene.id]!) expect(AI_POSE_ICONS[pose.id]).toContain("<svg");
    }
    expect(AI_CAMERA_MOVES.map((c) => c.id)).toEqual(["static", "push", "pull", "pan", "track", "crane"]);
    for (const camera of AI_CAMERA_MOVES) expect(AI_CAMERA_ICONS[camera.id]).toContain("<svg");
  });

  it("loads vendors, prices, logos and the free quota from the server catalog, not from app code (AI-MANAGE-007)", () => {
    expect(surface).toContain("fetchAiCatalog(authClient)");
    expect(surface).toContain("sortCatalogVendors(catalog?.vendors ?? [], sort)");
    expect(surface).toContain("catalog.imageBilling.freeImagesPerMonth");
    const data = read("./ai-management-data.ts");
    // 价格 / 厂商 logo 不许再写死在 App 里
    expect(data).not.toMatch(/\$\d+(\.\d+)?-?[\d.]*\/张/);
    expect(data).not.toContain("GPT-Image");
    expect(surface).not.toMatch(/\$\d+(\.\d+)?-?[\d.]*\/张/);
  });

  it("uses the user's management icons, not emoji on gradient tiles (AI-MANAGE-004)", () => {
    // 用户给的 proxy_management_icons_svg：对话 #E9EEFF 气泡、图片 #E6F7EF 相框、动态 #FFF4E3 文稿+笔。
    expect(AI_MANAGE_ICONS.chat).toContain('fill="#E9EEFF"');
    expect(AI_MANAGE_ICONS.image).toContain('fill="#E6F7EF"');
    expect(AI_MANAGE_ICONS.post).toContain('fill="#FFF4E3"');
    expect(surface).toContain("<ManageCard iconXml={AI_MANAGE_ICONS.chat}");
    expect(surface).toContain("<ManageCard iconXml={AI_MANAGE_ICONS.image}");
    expect(surface).toContain("<ManageCard iconXml={AI_MANAGE_ICONS.post}");
    expect(surface).not.toContain('icon="🖼️"');
    expect(surface).toContain("<Image source={getAiScenePhoto(item.id) ?? null}");
  });

  it("animates the camera-move bars like the prototype (AI-MANAGE-006)", () => {
    // 原型 .camera-motion-bar：push / pull / pan / track / crane 循环动画，static 静止深色。
    for (const kind of ["push", "pull", "pan", "track", "crane"]) expect(surface).toMatch(new RegExp(`\\n  ${kind}: \\{ x: `));
    expect(surface).toContain("<MotionBar kind={item.id} selected={selected} />");
    expect(surface).toContain("Animated.loop(Animated.sequence([");
  });

  it("asks for likeness authorisation before AI may use the owner's photos (AI-MANAGE-009)", () => {
    // 形象授权 = 本人对自己 AI 分身的 VISUAL likeness consent；授权 / 撤回都要本人二次确认。
    expect(surface).toContain("<LikenessCard likeness={likeness} onGrant={askGrantLikeness} onRevoke={askRevokeLikeness} onRetry={loadLikeness} />");
    expect(surface).toContain('personaClient.grantConsent(personaId, viewerAccountId, "VISUAL")');
    expect(surface).toContain("personaClient.revokeConsent(personaId, viewerAccountId)");
    expect(surface).toContain('Alert.alert(\n      "授权 AI 使用你的形象"');
    expect(surface).toContain("不授权，模型读不到你的个人相册");
    expect(surface).toContain('name={likenessGranted ? "已授权使用你的形象" : "还没有授权形象"}');
  });

  it("saves every choice to the server optimistically and reverts on failure", () => {
    expect(surface).toContain("engineClient.write(next).catch(");
    expect(surface).toContain('showToast("没保存成功，已恢复")');
    expect(surface).toContain('patch({ paused: !paused }, paused ? "AI 已恢复" : "已暂停所有 AI 操作")');
  });

  it("does not draw a fake token quota", () => {
    expect(surface).not.toContain("200K");
    expect(surface).toContain("formatTokens(tokenTotal)");
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(1_234)).toBe("1.2K");
    expect(formatTokens(120_000)).toBe("120K");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });

  it("does not claim image generation or auto-posting is running when nothing runs them", () => {
    expect(surface).toContain('const imageBadge: Badge = { text: "未接出图", kind: "off" };');
    expect(surface).toContain('settings.postPermission === "auto" ? { text: "全自动", kind: "confirm" }');
    expect(surface).toContain("自动发帖任务尚未上线");
    expect(surface).toContain("出图任务还没接上这些设置");
  });

  it("stores prompt history per scene and restores the last saved prompt of a scene", () => {
    const entry = encodePromptHistoryEntry({ scene: "night", text: "夜景自定义", at: "2026-09-23T10:00:00.000Z" });
    const settings = { imageScene: "cafe", imagePrompt: "", imagePromptHistory: [entry, "旧纯文本"] };
    expect(decodePromptHistory(settings.imagePromptHistory)).toEqual([
      { scene: "night", text: "夜景自定义", at: "2026-09-23T10:00:00.000Z" },
      { scene: "", text: "旧纯文本", at: "" },
    ]);
    expect(promptForScene(settings, "night")).toBe("夜景自定义");
    expect(promptForScene(settings, "dessert")).toBe(AI_SCENES.find((s) => s.id === "dessert")!.prompt);
    expect(promptForScene({ ...settings, imagePrompt: "咖啡自定义" }, "cafe")).toBe("咖啡自定义");
  });
});
