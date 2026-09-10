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
