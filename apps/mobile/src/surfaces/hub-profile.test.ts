import { describe, it, expect } from "vitest";
import { resolveHubProfile, resolveHubSocials, INITIAL_SOCIAL_ACCOUNTS } from "./me-types";

// R18.x HUB-PROFILE-001: the me-hub top card (the
// profile card + identity card) used to render the
// hardcoded `persona.name` ("Huyen" / "Bonsaidon")
// + `persona.avatarText` ("H" / "B") no matter who
// was signed in, and a fake "已验证 · 准时 98%"
// verification stat. The profile editor wires
// profileStore + ProfileClient, but the hub never
// read those fields, so editing 主页 produced no
// visible effect on the hub card. resolveHubProfile
// is the single source of precedence used by both
// the profile card and the identity card.
describe("resolveHubProfile", () => {
  it("uses the live profile name when it is non-empty", () => {
    const hub = resolveHubProfile({
      personaName: "Huyen",
      personaAvatarText: "H",
      personaCity: "河内",
      profileName: "Mai",
      profileCity: "胡志明",
      profileHandle: "mai.sgn",
      hasAvatar: true,
    });
    expect(hub.displayName).toBe("Mai");
    expect(hub.initial).toBe("M");
    expect(hub.city).toBe("胡志明");
    expect(hub.handle).toBe("@mai.sgn");
    expect(hub.hasAvatar).toBe(true);
  });

  it("falls back to the persona name when the profile is still default", () => {
    const hub = resolveHubProfile({
      personaName: "Huyen",
      personaAvatarText: "H",
      personaCity: "河内",
      profileName: "",
      profileCity: "",
      profileHandle: "",
      hasAvatar: false,
    });
    expect(hub.displayName).toBe("Huyen");
    expect(hub.initial).toBe("H");
    expect(hub.city).toBe("河内");
    expect(hub.handle).toBe("");
  });

  it("keeps a leading @ on the handle if the user already typed it", () => {
    const hub = resolveHubProfile({
      personaName: "Bonsaidon",
      personaAvatarText: "B",
      personaCity: "河内",
      profileName: "Bonsai Don",
      profileHandle: "@bonsai.don",
      hasAvatar: false,
    });
    expect(hub.handle).toBe("@bonsai.don");
  });

  it("does not surface a fake verification stat — hub no longer hardcodes '已验证 · 准时 98%'", () => {
    // The old me.tsx used the literal "✓ 已验证 · 准时 98%"
    // text inside the hub card. resolveHubProfile does not
    // expose any verification stat at all, which forces the
    // card to render the real handle / city / avatar / name
    // instead of a fake reputation number.
    const hub = resolveHubProfile({
      personaName: "Huyen",
      personaAvatarText: "H",
      personaCity: "河内",
      profileName: "Mai",
      profileCity: "胡志明",
      profileHandle: "mai.sgn",
      hasAvatar: true,
    });
    // No verification field exists on HubProfile.
    expect("verified" in hub).toBe(false);
    expect("onTimePct" in hub).toBe(false);
    // The handle replaces the fake verify badge.
    expect(hub.handle).toBe("@mai.sgn");
  });

  it("defaults the city to the persona city when the profile has none yet", () => {
    const hub = resolveHubProfile({
      personaName: "Bonsaidon",
      personaAvatarText: "B",
      personaCity: "河内",
      profileName: "Bonsai Don",
      hasAvatar: false,
    });
    expect(hub.city).toBe("河内");
  });

  it("uppercases the initial and trims whitespace", () => {
    const hub = resolveHubProfile({
      personaName: "Huyen",
      personaAvatarText: "H",
      personaCity: "河内",
      profileName: "  lina  ",
      hasAvatar: false,
    });
    expect(hub.displayName).toBe("lina");
    expect(hub.initial).toBe("L");
  });
});

// R18.x HUB-SOCIAL-001: the me-hub top card used to
// render the hardcoded persona.profileCard.social
// (["TT","Z","IG","in"]) no matter what the user
// actually configured. resolveHubSocials projects
// socialAccounts (handle set + visibility public).
describe("resolveHubSocials", () => {
  it("returns isEmpty when every handle is blank", () => {
    const { visible, isEmpty } = resolveHubSocials(INITIAL_SOCIAL_ACCOUNTS);
    expect(isEmpty).toBe(true);
    expect(visible).toEqual([]);
  });

  it("hides accounts that are not set to public visibility", () => {
    const accounts = [
      { key: "tiktok", mark: "TT", dark: true, name: "TikTok", handle: "@mai.tt", url: "", visibility: "仅自己" as const },
      { key: "instagram", mark: "IG", name: "Instagram", handle: "@mai.ig", url: "", visibility: "公开展示" as const }
    ];
    const { visible, isEmpty } = resolveHubSocials(accounts);
    expect(isEmpty).toBe(false);
    expect(visible).toEqual([{ key: "instagram", mark: "IG", dark: false }]);
  });

  it("hides accounts whose handle is only whitespace", () => {
    const accounts = [
      { key: "tiktok", mark: "TT", dark: true, name: "TikTok", handle: "   ", url: "", visibility: "公开展示" as const }
    ];
    const { visible, isEmpty } = resolveHubSocials(accounts);
    expect(isEmpty).toBe(true);
    expect(visible).toEqual([]);
  });

  it("preserves the dark flag for TT / X style accounts", () => {
    const accounts = [
      { key: "tiktok", mark: "TT", dark: true, name: "TikTok", handle: "@mai.tt", url: "", visibility: "公开展示" as const },
      { key: "x", mark: "X", dark: true, name: "X", handle: "@mai.x", url: "", visibility: "公开展示" as const }
    ];
    const { visible } = resolveHubSocials(accounts);
    expect(visible).toEqual([
      { key: "tiktok", mark: "TT", dark: true },
      { key: "x", mark: "X", dark: true }
    ]);
  });
});