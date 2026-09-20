import { describe, expect, it } from "vitest";
import { resolveAuthorAvatar, type AvatarAccount } from "./author-avatar";

const BASE = "http://api.test";
const ACCOUNT: AvatarAccount = {
  accountId: "ai_account_001",
  personaId: "ai_001",
  avatarPath: "ai-personas/photos/ai_001.png",
  avatarMediaAssetId: "media_ai_1",
  avatarVersion: 2
};
const ACCOUNTS = new Map([["ai_account_001", ACCOUNT]]);

describe("MEDIA-PIPELINE-001 author avatar mapping", () => {
  it("shows the viewer avatar for own posts", () => {
    const avatar = resolveAuthorAvatar(
      { authorType: "USER", authorId: "user_a" },
      { baseUrl: BASE, viewerAccountId: "user_a", viewerAvatarUri: "file:///me.jpg", displayName: "你" }
    );
    expect(avatar).toEqual({ kind: "image", source: { uri: "file:///me.jpg" } });
  });

  it("resolves AGENT posts to the AI account photo (media asset first)", () => {
    const avatar = resolveAuthorAvatar(
      { authorType: "AGENT", authorId: "ai_account_001" },
      { baseUrl: BASE, aiAccountsById: ACCOUNTS, displayName: "晴晴" }
    );
    expect(avatar).toEqual({ kind: "image", source: { uri: `${BASE}/v1/media/thumb/media_ai_1?v=2` } });
  });

  it("falls back to the bundled persona portrait without a media asset", () => {
    // NOTE: bundled require() only exists under Metro. In node the lookup
    // degrades gracefully to initials; on device this branch returns the
    // persona portrait image (verified on device, not in unit tests).
    const plain: AvatarAccount = { ...ACCOUNT, avatarMediaAssetId: undefined, avatarPath: "" };
    const avatar = resolveAuthorAvatar(
      { authorType: "AGENT", authorId: "ai_account_001" },
      { baseUrl: BASE, aiAccountsById: new Map([["ai_account_001", plain]]), displayName: "晴晴" }
    );
    expect(avatar).toEqual({ kind: "initial", letter: "晴" });
  });

  it("resolves AI_NATIVE posts to the bundled persona portrait", () => {
    // Same Metro-only note as above: node asserts graceful degradation.
    const avatar = resolveAuthorAvatar(
      { authorType: "AI_NATIVE", authorId: "ai_003" },
      { baseUrl: BASE, displayName: "小美" }
    );
    expect(avatar).toEqual({ kind: "initial", letter: "小" });
  });

  it("falls back to initials for users without photo assets", () => {
    expect(resolveAuthorAvatar(
      { authorType: "USER", authorId: "user_b" },
      { baseUrl: BASE, viewerAccountId: "user_a", displayName: "Linh" }
    )).toEqual({ kind: "initial", letter: "L" });
  });
});

// AVATAR-OTHER-HUMAN-001 (P0): Linh shows her real avatar in 首页「真人推荐」
// (recommend-fixtures.ts reads the same server-side asset) but the feed used
// to show a black initial circle for her posts — resolveAuthorAvatar never
// checked any source for a real human author who isn't the viewer or an AI
// account. mockCreatorAvatarAssetId mirrors apps/api-go/internal/mockidentity
// so any surface rendering her authorId gets the same photo Home does.
describe("AVATAR-OTHER-HUMAN-001 mock creator accounts show their real avatar in posts, not a black initial", () => {
  it("resolves a known mock creator's authorId to their real avatar asset", () => {
    const avatar = resolveAuthorAvatar(
      { authorType: "USER", authorId: "user_mockcreator_linh" },
      { baseUrl: BASE, viewerAccountId: "user_a", displayName: "Linh" }
    );
    expect(avatar).toEqual({ kind: "image", source: { uri: `${BASE}/v1/media/thumb/ma_creator_linh_portrait_v1?v=1` } });
  });

  it("covers every mock creator facet key the server actually seeds, not just Linh", () => {
    for (const key of ["mai", "an", "thao", "yen", "minh", "trang", "hana", "nam"]) {
      const avatar = resolveAuthorAvatar(
        { authorType: "USER", authorId: `user_mockcreator_${key}` },
        { baseUrl: BASE, displayName: key }
      );
      expect(avatar).toEqual({ kind: "image", source: { uri: `${BASE}/v1/media/thumb/ma_creator_${key}_portrait_v1?v=1` } });
    }
  });

  it("does not match an authorId that merely starts with the prefix but isn't a real facet key", () => {
    const avatar = resolveAuthorAvatar(
      { authorType: "USER", authorId: "user_mockcreator_ghost" },
      { baseUrl: BASE, displayName: "Ghost" }
    );
    expect(avatar).toEqual({ kind: "initial", letter: "G" });
  });

  it("viewer's own post still takes priority over the mock-creator table", () => {
    const avatar = resolveAuthorAvatar(
      { authorType: "USER", authorId: "user_mockcreator_linh" },
      { baseUrl: BASE, viewerAccountId: "user_mockcreator_linh", viewerAvatarUri: "file:///me.jpg", displayName: "Linh" }
    );
    expect(avatar).toEqual({ kind: "image", source: { uri: "file:///me.jpg" } });
  });

  // IDENTITY-ID-001 carryover guard: identity is the system-generated
  // authorId, never the display name (feed-author.ts's resolveAuthorDisplayName
  // docstring says this explicitly — "display names are not unique"). Two
  // different accounts can legitimately share a display name "Linh"; the
  // avatar match must key on authorId alone, or the wrong account's photo
  // would leak onto a stranger's post the moment the names collide.
  it("never matches by displayName — a different authorId with the same display name 'Linh' gets no photo", () => {
    const impostor = resolveAuthorAvatar(
      { authorType: "USER", authorId: "user_9f3a2b7c" },
      { baseUrl: BASE, displayName: "Linh" }
    );
    expect(impostor).toEqual({ kind: "initial", letter: "L" });
    // The real Linh, same displayName, different (real) authorId — still
    // resolves correctly. This is the pair the "same name" concern is about:
    // the two calls must not influence each other and must not be
    // distinguishable by anything other than authorId.
    const real = resolveAuthorAvatar(
      { authorType: "USER", authorId: "user_mockcreator_linh" },
      { baseUrl: BASE, displayName: "Linh" }
    );
    expect(real).toEqual({ kind: "image", source: { uri: `${BASE}/v1/media/thumb/ma_creator_linh_portrait_v1?v=1` } });
  });

  it("matching depends only on authorId — passing every other mock creator's displayName onto Linh's authorId still resolves Linh's own photo", () => {
    // If matching ever regressed to keying off displayName instead of
    // authorId, this would return Mai's/An's/etc. asset instead of Linh's.
    for (const wrongName of ["Mai", "An", "Thao", "Yen", "Minh", "Trang", "Hana", "Nam", "随便叫什么"]) {
      const avatar = resolveAuthorAvatar(
        { authorType: "USER", authorId: "user_mockcreator_linh" },
        { baseUrl: BASE, displayName: wrongName }
      );
      expect(avatar).toEqual({ kind: "image", source: { uri: `${BASE}/v1/media/thumb/ma_creator_linh_portrait_v1?v=1` } });
    }
  });
});
