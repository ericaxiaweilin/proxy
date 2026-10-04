import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// MERCHANT-CREATOR-PROMO-001：专属营销码两端入口 —— 商家 promo 页 + creator 认领区。
// 钉住：调的都是真命令（认领/绑定/报码/统计），战绩数字只许从统计里来，
// 码和金额不许写死，creator 认领区必须挂在本人视角（myAgentId）。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const promo = strip(read("./merchant-promo.tsx"));
const me = strip(read("./me.tsx"));
const section = strip(read("../components/promo-code-section.tsx"));

describe("MERCHANT-CREATOR-PROMO-001 商家 promo 页调真命令", () => {
  it("绑定/报码/统计走 supply client，不编数", () => {
    expect(promo).toContain("supply.bindPromoBenefit(");
    expect(promo).toContain("supply.quotePromoCode(");
    expect(promo).toContain("supply.merchantPromoStats(");
    expect(promo).toContain("supply.listMerchantBenefits(");
    // 战绩头只许读 stats，不许出现写死的单数/金额。
    expect(promo).toContain("stats?.quotes");
    expect(promo).toContain("stats?.firstVisits");
    expect(promo).not.toMatch(/带来 \d+ 单|新客 \d+ 人/);
  });
  it("报码必须经过服务端返回的优惠 terms，不自己算折扣", () => {
    expect(promo).toContain("result.faceValueVnd");
    expect(promo).toContain("result.scopeName");
  });
});

describe("MERCHANT-CREATOR-PROMO-001 creator 认领区挂本人视角", () => {
  it("me.tsx 挂 PromoCodeSection，agentId 取 myAgentId", () => {
    expect(me).toContain("<PromoCodeSection");
    expect(me).toContain("agentId={myAgentId}");
    expect(section).toContain("ProxyQrCode");
    expect(section).toContain("promoQrValue(");
  });
  it("认领区调认领/查码/查统计，码展示用 testID 钉住", () => {
    expect(section).toContain("supply.claimPromoCode(");
    expect(section).toContain("supply.listMyPromoCodes(");
    expect(section).toContain("supply.myPromoStats(");
    expect(section).toContain('testID="creator-promo-code"');
    // 战绩只许读 stats，不许出现写死的单数。
    expect(section).toContain("stats?.quotes");
    expect(section).not.toMatch(/带来 \d+ 单/);
  });
});

describe("MERCHANT-CREATOR-PROMO-001 自动档 + 扫码 + 选人", () => {
  it("自动档调真命令，扫码只填框不直接落", () => {
    expect(promo).toContain("supply.setAutoPromoBenefit(");
    expect(promo).toContain("CameraView");
    expect(promo).toContain("parsePromoQr(");
    // 扫到只填框（setQuoteCode），减多少钱还是点报码才落 —— 两步确认。
    expect(promo).toContain("setQuoteCode(code)");
    expect(promo).toContain("onBarcodeScanned");
  });
  it("绑定选人即选码，列表标出来源", () => {
    expect(promo).toContain("creators.map((creator)");
    expect(promo).toContain("setBindCode(creator.promoCode)");
    expect(promo).toContain("AUTO");
    expect(promo).toContain("setAutoPromoBenefit");
  });
});
