import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { merchantAvatarUri } from "./business-client";

// STORE-LOGO-001（2026-10-02，用户「商家侧的头像为什么不能更换」）
//
// 现场：editingLogoPath 这个 state 存在（初始化、读旧值、随表单提交），但**没有任何
// 输入框、选择器、上传按钮连到它** —— 商家在界面上根本换不了，只能干看。
// 修法：营业资料编辑里加"更换店徽"，走媒体管线上传，存 `assets/<id>`。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");

describe("STORE-LOGO-001 商家能换店徽", () => {
  const ui = read("./surfaces/merchant-storefront.tsx");

  it("编辑表单里有店徽选择器（预览 + 上传），不是只有 state", () => {
    expect(ui).toContain("pickLogoPhoto");
    expect(ui).toContain("setEditingLogoPath(`assets/${uploaded.mediaAssetId}`)");
    // 存资产引用，不是 URL。
    expect(ui).not.toMatch(/setEditingLogoPath\(`https?:/);
    // 空着也能保存 —— 店徽是可选的。
    expect(ui).toContain("+ 上传店徽");
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
