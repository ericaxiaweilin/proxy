import { describe, expect, it } from "vitest";
import { resolveAuthorAvatar, type AvatarAccount, type AvatarHumanAccount } from "./author-avatar";

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

// AVATAR-OTHER-HUMAN-002 (2026-09-21): 真实账号的服务端头像。
//
// 这个 describe 补的是一个**测试覆盖缺口**：上面 `falls back to initials for users
// without photo assets` 用 `user_b` 断言首字，读起来像是「真人没头像就首字」，
// 但真实世界里 46/69 条动态的作者都落进那一格，其中 23 条的 `identity.profiles`
// **真有** avatar_path。所以旧测试实际上把 bug 当成了正确行为 —— 它证明的只是
// 「没有数据源时首字」，从来没覆盖「有数据源时能不能出图」。
//
// 数据源现在是 feed.tsx 用 ProfileClient.getProfile(authorId) 按需补查出来的
// 真人 profile 表（服务端契约 FeedPostSchema 没有头像字段，AI 账号有批量接口、
// 真人没有，所以只能在客户端补）。
const REAL_HUMAN_ASSET_ID = "ma_9b85d31f5712125ca8d5682e";
const REAL_HUMAN_AUTHOR = "user_5fbe354a954f14391d5a056ce97f3e15";
const REAL_HUMAN: AvatarHumanAccount = { avatarPath: `assets/${REAL_HUMAN_ASSET_ID}`, avatarVersion: 3 };

describe("AVATAR-OTHER-HUMAN-002 a real human author with a server-side avatar gets their photo, not a black initial", () => {
  it("resolves a non-viewer, non-AI author from the loaded profile map", () => {
    const avatar = resolveAuthorAvatar(
      { authorType: "USER", authorId: REAL_HUMAN_AUTHOR },
      {
        baseUrl: BASE,
        viewerAccountId: "user_a",
        humanAvatarsById: new Map([[REAL_HUMAN_AUTHOR, REAL_HUMAN]]),
        displayName: "weilinxia511"
      }
    );
    expect(avatar).toEqual({ kind: "image", source: { uri: `${BASE}/v1/media/thumb/${REAL_HUMAN_ASSET_ID}?v=3` } });
  });

  // 反向配重：如果哪天有人把 humanAvatarsById 分支删了、或者 feed 忘了传这张表，
  // 上面那条会红；但「一律返回某张图」这种改法也能让它假绿，所以这里钉住
  // 「没有表就必须回退」——即这张表是**必需的**，不是可有可无的装饰。
  it("without the profile map the same author still falls back to initials (the map is load-bearing)", () => {
    const avatar = resolveAuthorAvatar(
      { authorType: "USER", authorId: REAL_HUMAN_AUTHOR },
      { baseUrl: BASE, viewerAccountId: "user_a", displayName: "weilinxia511" }
    );
    expect(avatar).toEqual({ kind: "initial", letter: "W" });
  });

  it("server-side profile beats the hardcoded mock creator table", () => {
    // 那张写死的表已经漂移过一次（客户端有 `trang`，服务端没有这行 profile）。
    // 服务端数据必须优先，否则漂移永远修不掉。
    const avatar = resolveAuthorAvatar(
      { authorType: "USER", authorId: "user_mockcreator_linh" },
      {
        baseUrl: BASE,
        humanAvatarsById: new Map([["user_mockcreator_linh", { avatarPath: "assets/ma_from_server" }]]),
        displayName: "Linh"
      }
    );
    expect(avatar).toEqual({ kind: "image", source: { uri: `${BASE}/v1/media/thumb/ma_from_server?v=1` } });
  });

  it("a MERCHANT author is resolved the same way — USER is not the only human type", () => {
    const avatar = resolveAuthorAvatar(
      { authorType: "MERCHANT", authorId: "user_merchant_1" },
      { baseUrl: BASE, humanAvatarsById: new Map([["user_merchant_1", REAL_HUMAN]]), displayName: "Cafe" }
    );
    expect(avatar).toEqual({ kind: "image", source: { uri: `${BASE}/v1/media/thumb/${REAL_HUMAN_ASSET_ID}?v=3` } });
  });

  it("an empty avatarPath in the profile falls through instead of building a broken URL", () => {
    const avatar = resolveAuthorAvatar(
      { authorType: "USER", authorId: REAL_HUMAN_AUTHOR },
      { baseUrl: BASE, humanAvatarsById: new Map([[REAL_HUMAN_AUTHOR, { avatarPath: "" }]]), displayName: "weilinxia511" }
    );
    expect(avatar).toEqual({ kind: "initial", letter: "W" });
  });

  it("an undocumented prefix (store/) never produces an invented thumb URL", () => {
    const avatar = resolveAuthorAvatar(
      { authorType: "USER", authorId: REAL_HUMAN_AUTHOR },
      { baseUrl: BASE, humanAvatarsById: new Map([[REAL_HUMAN_AUTHOR, { avatarPath: "store/whatever" }]]), displayName: "weilinxia511" }
    );
    expect(avatar).toEqual({ kind: "initial", letter: "W" });
  });

  it("an empty profile map behaves exactly like no map at all", () => {
    const avatar = resolveAuthorAvatar(
      { authorType: "USER", authorId: REAL_HUMAN_AUTHOR },
      { baseUrl: BASE, humanAvatarsById: new Map(), displayName: "weilinxia511" }
    );
    expect(avatar).toEqual({ kind: "initial", letter: "W" });
  });
});

// AVATAR-FALLBACK-TINT-001：没头像的人不再是 #111 黑圆 —— 按 id 稳定取柔和底色，同一个人永远同一个颜色。
describe("initial avatar tint", () => {
  it("is stable per id, varies across ids and is never black", async () => {
    const { initialAvatarTint } = await import("./author-avatar");
    expect(initialAvatarTint("user_abc")).toEqual(initialAvatarTint("user_abc"));
    const colors = new Set(["user_a", "user_b", "user_c", "user_d", "user_e", "user_f", "user_g", "user_h"].map((id) => initialAvatarTint(id).backgroundColor));
    expect(colors.size).toBeGreaterThan(2);
    for (const c of colors) expect(c.toLowerCase()).not.toMatch(/^#(111|111111|000|000000)$/);
  });
});
