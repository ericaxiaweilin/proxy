import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// MERCHANT-AVATAR-001（2026-10-02，用户 P0「企业店铺的头像用了用户侧的头像」）
//
// 服务端 ListAccountsForUser 以前 LEFT JOIN identity.profiles，把店主**个人**头像
// 填进 Account.AvatarPath —— 企业/店铺身份卡上显示的是店主的脸。
// 店主的脸不是店的脸：店的视觉只能来自店自己的资产，都没有就显示店名首字。
describe("MERCHANT-AVATAR-001 店头像不用用户侧头像", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./surfaces/merchant-me-r21-replacement.tsx", import.meta.url)),
    "utf8"
  );

  it("企业身份卡不画 accounts.avatarPath", () => {
    // 反向钉：只要这串再出现，店主的脸就又回到了店卡上。
    expect(src).not.toContain("accounts?.[0]?.avatarPath");
    expect(src).not.toContain("merchantAvatarUri(");
  });

  it(" fallback 是店名首字，不是写死的字母也不是人脸", () => {
    expect(src).toContain('accounts?.[0]?.name.trim().slice(0, 1)');
    // 以前 fallback 是写死的 "B" —— 每家店都是同一个字母，等于没信息。
    expect(src).not.toMatch(/bizAvatarText\}>"B"</);
  });
});
