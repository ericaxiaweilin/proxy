import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { formatReferencePrice } from "./creator-pricing";

// CREATOR-LIST-CARD-001（2026-10-04，用户「给你替换 proxy 的商家侧-我的 creator list
// 展示形式 这次比较亮眼 之前太素了」）
//
// 商家侧「我的 → Creator 经营」的列表原来是一行三段文字的通讯录条目（原型
// proxy_creator_center_match_v3.html 的 .creator-row）。换成卡片之后有两件事必须钉住：
//
//   1. **报价只有一个格式化实现。** 横滑卡和经营列表读的是同一个
//      SupplierCandidate.referencePrice，各写一份就会出现「同一个人两个价」——
//      和 CREATOR-AVATAR-001 钉照片解析是同一个理由。
//
//   2. **卡片上不许出现这份数据里没有的数字。** 新原型卡上写着「⭐4.9 / 粉丝 2.4w /
//      均播 5.2w」，SupplierCandidate 里一个都没有。照抄上去就是上一轮那个 P0
//      （没有账户的人进「真人推荐」）的同一类问题：让编造的东西看起来像真实读数。
//      换上去的是服务端算的 eligibility 和真实的到店素材数。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");
// 必须先剥注释：本文件下面的反向断言要禁掉的那几个词，正上方这几行注释里就写着
// （仓里的老坑：注释里重复一个 token，钉就永远红或者永远绿）。
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const meRaw = read("./surfaces/merchant-me-r21-replacement.tsx");
const me = strip(meRaw);
const rail = strip(read("./surfaces/merchant-creator-recommendations.tsx"));
const pricing = strip(read("./creator-pricing.ts"));

// 只看列表那一支：整份文件里出现过某个字符串说明不了什么（文件别处还有详情页）。
const listStart = me.indexOf("visibleCreators.map((creator) =>");
const listEnd = me.indexOf('if (page === "', listStart);
const listBranch = me.slice(listStart, listEnd > 0 ? listEnd : undefined);

describe("CREATOR-LIST-CARD-001 报价只有一个格式化实现", () => {
  it("边界：没有报价 / 千位以下 / K / M 都不把数说高说低", () => {
    expect(formatReferencePrice(0, "VND")).toBe("报价待沟通");
    expect(formatReferencePrice(-1, "VND")).toBe("报价待沟通");
    // 900 不是「1K」—— 先判阈值再四舍五入，否则报价被说高。
    expect(formatReferencePrice(900, "VND")).toBe("900 VND");
    expect(formatReferencePrice(1_200, "VND")).toBe("1K VND");
    expect(formatReferencePrice(1_200_000, "VND")).toBe("1.2M VND");
    // 999_999 进位到 1000K；印 1.0M 更好读，但绝不许印「1000K」。
    expect(formatReferencePrice(999_999, "VND")).toBe("1.0M VND");
    // 币种跟着数据走，不写死 VND。
    expect(formatReferencePrice(1_200_000, "USD")).toBe("1.2M USD");
  });

  it("横滑卡和经营列表都走这一个实现，没有第二份", () => {
    expect(pricing).toContain("export function formatReferencePrice");
    // 两个面都从纯模块 import，谁都不许自己再写一份。
    for (const [label, source] of [["横滑卡", rail], ["经营列表", me]] as const) {
      expect(source, `${label} 没有共用报价格式化`).toMatch(
        /import \{[^}]*\bformatReferencePrice\b[^}]*\} from "\.\.\/creator-pricing";/
      );
      expect(source, `${label} 自己又实现了一份报价格式化`).not.toMatch(
        /function formatReferencePrice/
      );
    }
    // 只 import 不用等于没接：列表卡和横滑卡都必须真的调用它。
    expect(listBranch).toContain("formatReferencePrice(creator.referencePrice, creator.currency)");
    expect(rail).toContain("formatReferencePrice(creator.referencePrice, creator.currency)");
  });
});

describe("CREATOR-LIST-CARD-001 列表卡只用真实字段", () => {
  it("标签来自 serviceType / languages，不是编出来的分类", () => {
    expect(listBranch).toContain("creator.serviceType");
    expect(listBranch).toContain("creator.languages.slice(0, 2)");
    // 语言多于两个折成 +N，不把真实值丢掉也不撑破卡片。
    expect(listBranch).toContain("creator.languages.length > 2");
  });

  it("MERCHANT-CREATOR-TAGS-001 标签行只放三类：垂类/范围/社媒", () => {
    // 能力标签位已让给垂类（verifiedCapabilities 数据照常解析，见 supply-client.test.ts）。
    expect(listBranch).toContain("creator.verticalTags");
    expect(listBranch).toContain("creator.availability?.marketId");
    expect(listBranch).toContain("creator.socials");
    expect(listBranch).not.toContain("visibleCapabilityTags(");
    // 稿子里的假分类（本地生活/探店达人/KTV/SPA/美食探店/夜生活）不许硬编码进列表分支。
    expect(listBranch).not.toMatch(/本地生活|探店达人|美食探店|夜生活/);
  });

  it("MERCHANT-CREATOR-TAGS-001 垂类只明示三类", () => {
    expect(listBranch).toContain("creator.verticalTags");
    expect(listBranch).toContain("labelVertical");
    // 实现里出现 KTV/SPA 字样即有人想明示，直接红。
    expect(listBranch).not.toMatch(/KTV|SPA/);
  });

  it("MERCHANT-CREATOR-TAGS-001 范围与社媒标签来自真实字段", () => {
    expect(listBranch).toContain("creator.availability?.marketId");
    expect(listBranch).toContain("creator.socials");
    // 粉丝数没有聚合来源：不许出现写死的粉丝数字。
    expect(listBranch).not.toMatch(/粉丝\s*\d|2\.4w|1\.8w|1\.2w/);
  });

  it("可邀请态来自服务端 eligibility，两种态都画", () => {
    expect(listBranch).toContain("creator.eligibility.eligible");
    expect(listBranch).toContain("✓ 可邀请");
    expect(listBranch).toContain("✗ 不符合资格");
    // 头像右下那颗点只在真能邀请时画 —— 不在线不许装在线。
    expect(listBranch).toMatch(
      /creator\.eligibility\.eligible \? <View pointerEvents="none" style=\{styles\.creatorOnlineDot\} \/> : null/
    );
  });

  it("到店素材数还是真实读数，没有被统计数字顶掉", () => {
    expect(listBranch).toContain("creator.photos.length");
  });

  it("不编原型卡上的评分 / 粉丝 / 均播", () => {
    // 这三个数 SupplierCandidate 里没有 —— 出现即有人在编。
    expect(me).not.toMatch(/粉丝|均播|⭐|评分/);
    expect(me).not.toMatch(/4\.9|2\.4w|5\.2w/);
  });

  it("卡片样式是原型的那一套（圆角卡 + 标签胶囊 + 报价列 + 柠檬主操作）", () => {
    for (const key of ["creatorTag:", "creatorStatRow:", "creatorAction:", "creatorPrice:", "creatorGo:"]) {
      expect(me).toContain(key);
    }
    expect(me).toMatch(/creatorRow:\s*\{[^}]*borderRadius:\s*20/);
    expect(me).toMatch(/creatorGo:\s*\{[^}]*backgroundColor:\s*color\.lime/);
  });
});

describe("CREATOR-LIST-CARD-001 详情页同一套语言", () => {
  const start = me.indexOf('page === "creatorDetail"');
  const next = me.indexOf('if (page === "', start + 10);
  const detail = me.slice(start, next > 0 ? next : undefined);

  it("详情有参考报价条，报价走同一个格式化实现", () => {
    expect(detail).toContain("creatorPriceBar");
    expect(detail).toContain("参考报价");
    expect(detail).toContain(
      "formatReferencePrice(selectedCreator.referencePrice, selectedCreator.currency)"
    );
  });

  it("已验证 / 未验证的能力芯片样子分得开，但判据仍是 verified", () => {
    expect(detail).toContain("capChipVerified");
    expect(detail).toContain("capTextVerified");
    expect(detail).toContain("c.verified");
    // 未验证的不许被打上已验证的样子。
    expect(detail).toMatch(/c\.verified && styles\.capChipVerified/);
  });
});
