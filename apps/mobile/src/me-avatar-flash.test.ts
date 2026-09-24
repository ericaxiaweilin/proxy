import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// AVATAR-FLASH-002 —— 我的头像先显示默认、再切换成自定义。
// 根因：viewerAccountId 是异步恢复的，首帧为 undefined；hydration 在账号就绪
// 瞬间无条件 setProfileAvatarUri(undefined)，清空后再等异步回填 —— 中间那一帧
// 就是默认头像。修法：重置时先同步读本机副本，读到直接上，读不到才走后续 hydration。
describe("AVATAR-FLASH-002 profile avatar never blanks on account ready", () => {
  const me = readFileSync(new URL("./surfaces/me.tsx", import.meta.url), "utf8");

  it("hydration reset replays the synchronous local lookup instead of blanking", () => {
    expect(me).toContain("setProfileAvatarUri(initialProfileAvatarUri(viewerAccountId))");
  });

  it("the local lookup stays account-scoped (no cross-account flash)", () => {
    expect(me).toContain("avatar-${avatarScope(accountId)}-");
  });
});
