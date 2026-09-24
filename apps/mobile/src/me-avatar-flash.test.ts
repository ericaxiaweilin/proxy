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

  it("AVATAR-REMOTE-CACHE-001: remote avatars are cached for first-frame sync reads", () => {
    // 本机目录是空的（从没选过头像）= 每次必闪。远端拉到后落盘，下次首帧直出。
    expect(me).toContain("remote-avatar-${avatarScope(accountId)}.jpg");
    expect(me).toContain("File.downloadFileAsync(url, dest, { idempotent: true })");
    // 路径没变且文件还在就不重下；变了覆盖，不留过期副本。
    expect(me).toContain("existingRecord?.remoteAvatarPath === remote.avatarPath");
    // 回填前检查页面没走、用户没换头像 —— 不覆盖新选择。
    expect(me).toContain("if (cancelled || profileTouchedRef.current) return;");
  });
});
