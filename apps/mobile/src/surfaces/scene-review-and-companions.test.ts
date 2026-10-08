import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SCENE-REVIEW-001 + SCENE-COMPANION-001: 场景名片重做——真实场景评分 +
// 有隐私边界的同行推荐。注释先剥掉再断言，只认代码。
const map = readFileSync(fileURLToPath(new URL("./reality-scene-map.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const mapCode = stripComments(map);

describe("SCENE-REVIEW-001 the rating line never fabricates a default", () => {
  it("only renders the rating line when ratingCount is greater than zero", () => {
    // 2026-09-28：统计卡重构成「每一格各自按真实数据决定画不画」之后，这条闸门
    // 从内联三元搬到了一个具名局部变量（`const ratingCount = … ?? 0` +
    // `if (ratingCount > 0)`）。语义没变 —— 仍然没有编造的默认分 —— 但原来那条
    // 字面量正则匹配不到了，钉就一直是红的（门禁在第一个失败处 exit 1，红着等于
    // 后面的钉全都不执行）。改成钉**两件事**：取值链仍然诚实回落 0，且渲染仍然
    // 以 `> 0` 为闸。两臂分开写，任一条被破坏都会红。
    expect(mapCode).toMatch(/const ratingCount = detail\?\.ratingCount \?\? selected\.ratingCount \?\? 0;/);
    expect(mapCode).toMatch(/if \(ratingCount > 0\)/);
  });

  it("gates the review entry on real checkin history, not a UI-only guess", () => {
    // BADGE-WALL-001 的 badgeHistoryIds 是服务端 ListMyCheckinHistory 的全量
    // 历史——跟提交时服务端的 SCENE_NOT_VISITED 校验读的是同一份事实。
    expect(mapCode).toContain("badgeHistoryIds?.includes(selected.id)");
    expect(mapCode).toContain("setReviewSheetOpen(true)");
  });

  it("submits through the real SubmitSceneReview command and surfaces the real rejection reason", () => {
    expect(mapCode).toContain('"SubmitSceneReview"');
    expect(mapCode).toContain("SCENE_NOT_VISITED");
    expect(mapCode).toContain("还没在这个场景打过卡，去过之后才能评价。");
  });

  it("echoes only the just-submitted value locally, never a fetched-then-guessed default", () => {
    expect(mapCode).toContain("setMyReviewStars(reviewStars)");
  });
});

describe("SCENE-COMPANION-001 companion suggestions never leak to anonymous or non-friend viewers", () => {
  it("fetches suggestions only when a real session exists", () => {
    expect(mapCode).toContain('"ListSceneCompanionSuggestions"');
    expect(mapCode).toMatch(/if \(!selectedId \|\| !session\?\.principal\) return;/);
  });

  it("renders the real companion rail only when there is a real hit, with an honest signal label", () => {
    expect(mapCode).toContain("companionSuggestions && companionSuggestions.length > 0");
    expect(mapCode).toContain("companionSignalLabel(person.signal)");
  });

  it("does not wire real suggestions into the DIRECT_INVITE selection chain (no shape to fake it with)", () => {
    // 真实同行推荐这轮只展示，不接 selectedHumanId —— 那条链认的是 detail.humans
    // 的形状。真实人渲染必须是普通 View，不是调用 setSelectedHumanId 的 Pressable。
    // 区域边界原来用的是 `detail.humans.length > 0`（下面那块占位 rail 的起点），
    // DEMO-CUT-001 把它摘了之后边界改钉匹配卡的下一节标题行 —— 钉的东西没变，
    // 只是不再依赖一段已经不存在的 markup。
    const companionBlock = mapCode.slice(
      mapCode.indexOf("companionSuggestions && companionSuggestions.length > 0"),
      mapCode.indexOf("styles.sectionTitleRow"),
    );
    expect(companionBlock.length).toBeGreaterThan(0);
    expect(companionBlock).not.toContain("setSelectedHumanId");
    expect(companionBlock).not.toContain("<Pressable");
  });

  it("renders nothing instead of a placeholder fallback when there is no real match", () => {
    // 原来这条钉的是「没有真实命中时退回诚实标注的 FIXTURE」，字面量是
    // `expect(mapCode).toContain("· 占位候选")` + `toContain("detail.humans.length > 0")`。
    // DEMO-CUT-001（2026-10-08）删的就是这个 fallback：这一块是选人的付费决策点，
    // 「诚实标注过的占位人」也还是一个不存在的人。现在没有命中就整块不画 ——
    // 而"不画"必须钉住，否则占位 rail 悄悄挂回来照样绿。
    expect(mapCode).not.toContain("detail.humans.length > 0");
    expect(mapCode).not.toContain("detail.humans.map");
    expect(mapCode).not.toContain('{human.source === "FIXTURE" ? " · 占位候选" : ""}');
    expect(mapCode).toMatch(
      /companionSuggestions && companionSuggestions\.length > 0 \?\s*\(\s*<>[\s\S]*?<\/>\s*\) : null\}/,
    );
    // 确认单里那一处还照旧明说这是占位供给（本轮没动，也不许悄悄长得像真人）。
    expect(mapCode).toContain('" · 占位候选，尚未接入真实供给"');
  });
});

describe("SCENE-PHOTO-WALL-001 the photo wall stays undifferentiated (no fabricated curation split)", () => {
  it("renders one 全部 group sourced from real scene-tagged posts, no category tabs", () => {
    expect(mapCode).toContain("scenePhotoWallTiles");
    expect(mapCode).toContain("listPostsAtScene");
    expect(mapCode).not.toContain("环境");
    expect(mapCode).not.toContain("用户精选");
    expect(mapCode).not.toContain("官方");
  });

  it("requires a real session, same as the existing scene-shop-directory pattern", () => {
    expect(mapCode).toContain('"SIGNED_OUT"');
    expect(mapCode).toContain("登录后才能看到这里的照片墙。");
  });
});
