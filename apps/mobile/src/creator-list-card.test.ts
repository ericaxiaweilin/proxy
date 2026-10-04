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
  it("边界：没有报价 / 千位以下 / K / tr 都不把数说高说低", () => {
    expect(formatReferencePrice(0, "VND")).toBe("报价待沟通");
    expect(formatReferencePrice(-1, "VND")).toBe("报价待沟通");
    // 900 不是「1K」—— 先判阈值再四舍五入，否则报价被说高。
    expect(formatReferencePrice(900, "VND")).toBe("900 VND");
    expect(formatReferencePrice(1_200, "VND")).toBe("1K VND");
    // 越南盾百万位印 tr（triệu），不印 M。
    expect(formatReferencePrice(1_200_000, "VND")).toBe("1.2tr VND");
    // 999_999 进位到 1000K；印 1.0tr 更好读，但绝不许印「1000K」。
    expect(formatReferencePrice(999_999, "VND")).toBe("1.0tr VND");
    // 币种跟着数据走，不写死 VND；非 VND 暂时印 M（汇率兑换以后再做）。
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
  it("标签来自垂类 / 语言 / 地址，不是编出来的分类", () => {
    expect(listBranch).toContain("creator.verticalTags");
    expect(listBranch).toContain("creator.languages.slice(0, 2)");
    expect(listBranch).toContain("creator.availability?.marketId");
    // 语言多于两个折成 +N，不把真实值丢掉也不撑破卡片。
    expect(listBranch).toContain("creator.languages.length > 2");
  });

  it("MERCHANT-CREATOR-TAGS-001 标签行只放三类：垂类/语言/地址", () => {
    // 能力标签位已让给垂类（verifiedCapabilities 数据照常解析，见 supply-client.test.ts）。
    expect(listBranch).toContain("creator.verticalTags");
    expect(listBranch).toContain("creator.availability?.marketId");
    expect(listBranch).toContain("creator.languages");
    expect(listBranch).not.toContain("visibleCapabilityTags(");
    // 服务类型和社媒账号不占标签位：前者和查询条件重复，后者贴在名字后面。
    expect(listBranch).not.toContain("labelServiceType(");
    expect(listBranch).not.toContain("labelSocial(");
    // 稿子里的假分类（本地生活/探店达人/KTV/SPA/美食探店/夜生活）不许硬编码进列表分支。
    expect(listBranch).not.toMatch(/本地生活|探店达人|美食探店|夜生活/);
  });

  it("MERCHANT-CREATOR-TAGS-001 垂类只明示三类", () => {
    expect(listBranch).toContain("creator.verticalTags");
    expect(listBranch).toContain("labelVertical");
    // 实现里出现 KTV/SPA 字样即有人想明示，直接红。
    expect(listBranch).not.toMatch(/KTV|SPA/);
  });

  it("MERCHANT-CREATOR-TAGS-001 handle 贴名字后面，不占标签位", () => {
    // Thao @thao_hanoi 挨在一起：handle 来自已关联账号（socials[0]），
    // 没有关联账号就只印名字，不编。
    expect(listBranch).toContain("creator.socials");
    expect(listBranch).toMatch(/@\{.*handle/);
    expect(listBranch).toContain("creatorHandle");
    // 粉丝数没有聚合来源：不许出现写死的粉丝数字。
    expect(listBranch).toContain("formatFansCount(");
    expect(listBranch).not.toMatch(/粉丝\s*\d|2\.4w|1\.8w|1\.2w/);
  });

  it("MERCHANT-CREATOR-TAGS-001 「可邀请」标签已下掉，换成真实评价分", () => {
    // 列表本来就只含 Eligible 的，再贴 ✓可邀请是同义反复；而且“可邀请”
    // 没有公开判定标准 —— 下掉，换服务端 matching.Score 的 Total。
    expect(listBranch).not.toContain("✓ 可邀请");
    expect(listBranch).not.toContain("✗ 不符合资格");
    expect(listBranch).not.toContain("creatorOnlineDot");
    // 评价分胶囊只许走 creatorRatingLabel（服务端 Total），这一支里必须出现。
    expect(listBranch).toContain("creatorRatingLabel(creator.rating)");
  });

  it("服务量是真实成交单数，不编；头像本身就是到店照片，不重复印数", () => {
    // 服务量走 rating.completedOrders（Postgres 真实订单数），只许走
    // formatServiceVolume 格式化；卡上不再印「到店 X 媒体」。
    expect(listBranch).toContain("formatServiceVolume(creator.rating?.completedOrders)");
    expect(listBranch).not.toContain("到店");
  });

  it("不编原型卡上的均播；评分只许走服务端 Total，粉丝只许走自填格式化", () => {
    // 均播依然没有任何来源 —— 出现即有人在编。
    expect(me).not.toMatch(/均播|⭐/);
    expect(me).not.toMatch(/4\.9|5\.2w/);
    // 评分现在有真来源（QuerySuppliers.rating ← matching.Score），但只许走
    // creatorRatingLabel 这一条路：等级/分数的具体字样（S/新人/87.5分这类）
    // 只能活在纯模块里，surface 里出现字面量就是有人在手写分数。
    expect(me).toContain("creatorRatingLabel(");
    expect(me).not.toMatch(/["']S ·|["']A ·|["']B ·|["']C ·|新人 · 暂无评价|分["']/);
    // 粉丝数现在是创作者自填（formatFansCount 统一格式化），但写死的
    // 具体数字（2.4w 这类字面量）依然不许出现 —— 数只能来自数据。
    expect(me).not.toMatch(/粉丝\s*[0-9]/);
    expect(me).not.toMatch(/["']2\.4w["']/);
    expect(me).toContain("formatFansCount(");
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

  it("MERCHANT-CREATOR-TAGS-001 详情头和列表卡同一套语言，明细只印真实发生", () => {
    // 头：名字+@handle 挨在一起，标签行 大类/语言/地址，stats 粉丝/服务量/评价。
    expect(detail).toContain("creatorHandle");
    expect(detail).toContain("selectedCreator.verticalTags");
    expect(detail).toContain("selectedCreator.languages");
    expect(detail).toContain("selectedCreator.availability?.marketId");
    expect(detail).toContain("formatServiceVolume(selectedCreator.rating?.completedOrders)");
    expect(detail).toContain("creatorRatingLabel(selectedCreator.rating)");
    // 服务类型和社媒胶囊不许回流到详情头。
    expect(detail).not.toContain("labelServiceType(");
    expect(detail).not.toContain("labelSocial(");
    // 评价明细：好评率/履约率只许走 formatRatePercent（无评价不印 0%），
    // 新人如实说没记录；社媒行粉丝数和列表对表，不许出现手写数字。
    expect(detail).toContain("formatRatePercent(");
    expect(detail).toContain("fanCountFor(");
    expect(detail).not.toContain("✓ 可邀请");
    expect(detail).not.toContain("✗ 不符合资格");
  });

  it("MERCHANT-CREATOR-INVITE-001 详情有邀请合作入口，走真命令不画假按钮", () => {
    // 发/查/撤/还价四个真命令在组件顶部（effect + handler），按钮/表单/状态行
    // 在详情分支里 —— 分开断言，别把 handler 搬进详情分支凑数。
    expect(me).toContain("supply.inviteCreator(");
    expect(me).toContain("supply.listSentInvitations(");
    expect(me).toContain("supply.cancelInvitation(");
    expect(me).toContain('supply.respondInvitation({');
    // 时间不用手填：day/slot chips 走现成的 direct-invite-schedule（组件顶部）；
    // 默认明天（有可约档期就切过去），不留空等用户现想。
    expect(me).toContain("dayOptions(");
    expect(me).toContain("combineDayAndTime(");
    expect(detail).toContain("邀请合作");
    expect(detail).toContain("creator-invite-open-");
    expect(detail).toContain("creator-invite-pending-");
    expect(detail).toContain("creator-invite-countered-");
    expect(detail).toContain("creator-invite-accepted-");
    // 出价是区间 + 目的必选 + 可谈开关，还价往返都在详情里。
    expect(detail).toContain("formatPriceRange(");
    expect(detail).toContain("labelInvitationPurpose(");
    expect(detail).toContain("再议");
    // 合作时间进表单，展示走 formatInviteDateTime；
    // 金额单独成行放大（invitePrice），不缩在灰字里。
    expect(detail).toContain("formatInviteDateTime(");
    expect(detail).toContain("InviteSchedulePicker");
    expect(detail).toContain("styles.invitePrice");
    // 详情页不摆 SimpleRows 那四行（最近到店空占位 + 三个重复入口）。
    expect(detail).not.toContain("最近到店");
    expect(detail).not.toContain("当前权益");
  });
});
