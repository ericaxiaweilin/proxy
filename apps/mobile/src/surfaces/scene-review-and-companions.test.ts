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
    expect(mapCode).toMatch(/\(detail\?\.ratingCount\s*\?\?\s*selected\.ratingCount\s*\?\?\s*0\)\s*>\s*0/);
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
    // 真实同行推荐这轮只展示，不接 selectedHumanId——那条链认的是
    // detail.humans 的 FIXTURE 形状。真实人渲染必须是普通 View，不是
    // Pressable 调用 setSelectedHumanId。
    const companionBlock = mapCode.slice(
      mapCode.indexOf("companionSuggestions && companionSuggestions.length > 0"),
      mapCode.indexOf("detail.humans.length > 0"),
    );
    expect(companionBlock).not.toContain("setSelectedHumanId");
  });

  it("keeps the honestly-labeled FIXTURE as the fallback when there is no real match", () => {
    expect(mapCode).toContain("· 占位候选");
    expect(mapCode).toContain("detail.humans.length > 0");
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
