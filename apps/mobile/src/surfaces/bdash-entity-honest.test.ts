import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// BDASH-SHOP-002（2026-10-09）：企业 / 店铺资料页的「企业主体」表不许再编数据。
//
// 背景：BDASH-SHOP-001 修过这一页的 **hero** —— 那里原来写死「Bonsaidon」+
// 「海鲜自助 · 河内 · 主体已验证」，代码注释自己写着 "The verified stat is fabricated"。
// 但**同一页下面那张「企业主体」表被漏掉了**，四行全是写死的：
//   主体名称 = Bonsaidon · 海鲜自助 / 经营城市 = 河内 / 经营节点 = 3 个 /
//   身份验证 = 已认证 · Proxy 商家身份
// 而且这块**无条件渲染** —— 没有店铺的用户也会看到一家不存在的店，还带着「已认证」。
// 这是产品红线（「没有数据」必须看起来和「有数据」不一样），不是文案问题。
//
// 现在只留**真有来源**的一行（主体名称 = `useMerchantIdentity` 的 ACTIVE 账号名，和 hero
// 同一个 `liveShopName`），没有主体就整块不画。后端 `MerchantAccount` 只有 `{ id, name }`，
// 所以「经营城市 / 经营节点 / 身份验证」是**没有字段**，删掉而不是填 `—`
// —— 三行 `—` 是噪声，不是信息。
//
// ⚠️ 本文件钉的是**这一页**。`BUSINESS_ME` persona fixture 里那句 `name: "Bonsaidon"`
// （以及 `contextLineLabel: "当前使用 · Bonsaidon"` / `avatarText: "B"`）是**同类问题的另一半**，
// 但换掉它要选新的用户可见文案（用户的真名？「尚未创建店铺」？），属产品决定 ⇒ **没有动**，
// 已在 changelog 记为待办。这里**不**断言它存在与否，免得把一个待修的缺陷冻进门禁。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
// 与同目录其他钉同样的理由：先剥注释，否则解释这段历史的注释里写着同一批字面量，
// 把代码删掉测试照样绿。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const meCode = stripComments(readFileSync(here("./me.tsx"), "utf8"));

describe("BDASH-SHOP-002 企业主体表不再编造主体数据", () => {
  it("四条写死的值一条都不剩", () => {
    // 用**不带引号**的字面量：原来那四条是 `["经营城市", "河内"]` 这种数组元素，
    // 但钉的是「这几个标签不许再出现在这一页」，而不是某一种写法 —— 换个形状加回来
    // 也得红。注释已剥，所以上面那段解释历史的注释不会把这条骗绿。
    for (const fabricated of [
      "Bonsaidon · 海鲜自助",
      "已认证 · Proxy 商家身份",
      "经营城市",
      "经营节点",
      "身份验证"
    ]) {
      expect(meCode, `企业主体表又出现了写死的「${fabricated}」`).not.toContain(fabricated);
    }
  });

  it("整块挂在 liveShopName 上 —— 没有店铺就不画", () => {
    expect(meCode).toContain("{liveShopName ? (");
    expect(meCode).toContain("<Text selectable style={styles.subRowValue}>{liveShopName}</Text>");
    // 反证：不是「整块连同 subSection 一起消失」才过的 —— 这套样式别处还在用。
    expect(meCode).toContain("styles.subSectionTitle");
  });

  it("店铺头像首字母从真实名字取，不再是写死的 B", () => {
    expect(meCode).not.toContain("storeAvatarText}>B<");
    expect(meCode).toContain("{(liveShopName ?? persona.name).slice(0, 1).toUpperCase()}");
  });

  it("数据源仍是 useMerchantIdentity（不是又接回某个 fixture）", () => {
    expect(meCode).toContain("const liveShopName = merchantIdentity.accounts[0]?.name;");
  });
});
