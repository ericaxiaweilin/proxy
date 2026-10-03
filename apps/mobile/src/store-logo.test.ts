import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { merchantAvatarUri } from "./business-client";

// STORE-LOGO-001（2026-10-02，用户「商家侧的头像为什么不能更换」）
//
// 现场：editingLogoPath 这个 state 存在（初始化、读旧值、随表单提交），但**没有任何
// 输入框、选择器、上传按钮连到它** —— 商家在界面上根本换不了，只能干看。
//
// 2026-10-03 二次现场：上传入口统一到「照片与内容」页时，详情表单里那个店徽选择器
// 被删掉，能力跟着一起没了 —— logoAssetPath 只剩原样回存。所以这里钉的是**能力**
// （相册行上能设店徽、存资产引用），不是某一个控件名。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");

describe("STORE-LOGO-001 店铺照片入口只在相册页", () => {
  const ui = read("./surfaces/merchant-storefront.tsx");

  it("经营资料页只有预览，没有重复上传入口", () => {
    expect(ui).not.toContain("+ 上传店铺照片");
    expect(ui).not.toContain("+ 上传店徽");
    expect(ui).not.toContain("pickLogoPhoto");
    // 预览取相册封面，logo 只做回落，上传统一去相册页。
    expect(ui).toContain("照片与内容」页统一上传");
  });

  it("换店徽的入口在相册行上，存资产引用", () => {
    // 上传入口统一到相册页之后，「换店徽」这个能力一度跟着上传入口一起被删掉了：
    // logoAssetPath 只剩原样回存，新店永远拿不到店徽、老店也换不掉。现在相册每行
    // 照片上有「设为店徽」，存 assets/<mediaAssetId>（与 merchantAvatarUri 同口径）。
    expect(ui).toContain("async function setStoreLogoFromPhoto");
    expect(ui).toContain("setStoreLogoFromPhoto(s.id, p)");
    expect(ui).toContain('accessibilityLabel="设为店徽"');
    expect(ui).toContain("assets/${photo.mediaAssetId}");
    expect(ui).toContain("当前店徽");
  });

  it("整行覆盖的 upsert 一律走合并口径，改一个字段不冲掉其余", () => {
    // upsertStoreLines 是整行覆盖：只传改动的那几个字段，等于把没传的清空。
    // 详情表单保存曾经就是这么把设施（wifi/smoking/acTempC/…）和对接人姓名冲掉的。
    const upserts = ui.split("client.upsertStoreLines(").length - 1;
    const merged = ui.split("linesPayload(storeId,").length - 1;
    expect(upserts).toBeGreaterThan(0);
    expect(merged).toBe(upserts);
    // 合并口径本身得把整行字段都带上 —— 少一个，那个字段照样会被冲成空。
    for (const field of [
      "logoAssetPath", "description", "hoursJson", "contactPhone", "contactEmail",
      "contactName", "wifi", "smoking", "acTempC", "power", "quiet", "seating",
      "announcement", "socials",
    ]) {
      expect(ui).toContain(`${field}: c?.${field} ??`);
    }
  });

  it("上传走媒体管线，和菜品照片同一套", () => {
    expect(ui).toContain("storefrontMedia.uploadImage");
  });
});

describe("STORE-LOGO-001 店徽显示优先级 logo → 照片 → 首字", () => {
  it("merchantAvatarUri 认 assets/ 前缀（和服务端校验口径一致）", () => {
    expect(merchantAvatarUri("assets/ma_1", "http://x")).toBe("http://x/v1/media/thumb/ma_1");
    expect(merchantAvatarUri("", "http://x")).toBeUndefined();
    expect(merchantAvatarUri(undefined, "http://x")).toBeUndefined();
    // 裸 id 不认 —— 必须带 assets/ 前缀，这正是服务端 isValidAssetPath 卡的那一关。
    expect(merchantAvatarUri("ma_1", "http://x")).toBeUndefined();
  });

  it("hub 店详情画 logo，没有才首字", () => {
    const hub = read("./surfaces/my-stores-hub.tsx");
    expect(hub).toContain("merchantAvatarUri(row.lines?.logoAssetPath");
    expect(hub).toContain("s.heroLogo");
  });

  it("商家主页身份卡优先级 logo → 菜品图 → 首字", () => {
    const home = read("./surfaces/business-home.tsx");
    expect(home).toContain("merchantAvatarUri(storeLogoPath");
    // 菜品图还在（回落），但不再是第一顺位。
    expect(home).toContain("logoUri ?? dishUri");
  });
});
