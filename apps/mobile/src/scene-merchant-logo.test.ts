import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// MERCHANT-LOGO-001: 商家详情页必须有商家 logo，现在没有。
// 现状：场景链只有 venue 大图；logo 只活在商家自己的管理面
//（store_lines.logo_asset_path），且场景↔店铺没有关联键。
// 本轮：详情 payload 带 logoUrl（omitempty，没有就没有），详情页标题旁挂
// 小圆标；没有回字母块（和线上店铺管理面同款），不编占位图。
// logo 文件本身要商户给 —— 全仓现在没有任何一家上传过，空着比编诚实。
// 注释先剥掉再断言，只认代码。
const map = readFileSync(fileURLToPath(new URL("./surfaces/reality-scene-map.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const mapCode = stripComments(map);

describe("MERCHANT-LOGO-001 scene detail shows the merchant logo", () => {
  it("renders the logo next to the venue name with a letter fallback", () => {
    expect(mapCode).toContain("detail?.logoUrl");
    expect(mapCode).toContain("styles.venueLogo");
    expect(mapCode).toContain("商家标志");
    // 回退：字母块，和线上店铺管理面同一语言。
    expect(mapCode).toContain("styles.venueLogoText");
    // 守卫：logoUrl 可选 —— 缺失是合法状态，不是脏数据。
    expect(mapCode).toContain("(item.logoUrl === undefined || typeof item.logoUrl === \"string\")");
  });
});
