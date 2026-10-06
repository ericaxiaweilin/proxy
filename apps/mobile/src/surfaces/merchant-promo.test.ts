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

// MERCHANT-CREATOR-PROMO-002（2026-10-04，用户：「给所有 creator-商家开发一套专属优惠码系统，
// 对于 n 商家 n creator 开发专属唯一的优惠码……而不是简单的满 x 减 y」；原型
// docs/design/references/Proxy_Creator_Promo_20261004_bc214e.html）。PROMO-001 的「creator 一个
// 全局码 + 商家逐个绑优惠 + 自动档」界面已被这一页替换（服务端命令仍在，兼容老数据）。
describe("MERCHANT-CREATOR-PROMO-002 商家页照原型：一对一码 + 四个数 + 依据 / 调整", () => {
  it("整店四个数只读服务端统计，转化率没有分母时写 —", () => {
    expect(promo).toContain("supply.listMerchantCreatorPromos(");
    expect(promo).toContain('label="本店到店新客"');
    expect(promo).toContain('label="本店累计核销"');
    expect(promo).toContain('label="本店累计发券"');
    expect(promo).toContain('label="核销转化率"');
    expect(promo).toContain('conversionBp < 0 ? "—"');
    expect(promo).not.toMatch(/1,850|2,300|5,000|37%/);
  });
  it("每位达人一张卡：专属码、系统建议 / 手动调整标签、四个数、查看依据 / 调整折扣", () => {
    expect(promo).toContain("达人专属折扣");
    expect(promo).toContain("按新客数排序");
    expect(promo).toContain('"✋ 手动调整" : "🤖 系统建议"');
    expect(promo).toContain("promoQrValue(promo.code)");
    for (const label of ['label="新客"', 'label="核销"', 'label="发券"', 'label="消费"']) expect(promo).toContain(label);
    expect(promo).toContain("调整折扣");
  });
  // 用户 2026-10-04：「不要让商家一个个给 creator 生成，而是系统自动生成的，商家唯一操作就是选择
  // 下单或者调整系统自动的折扣值，对商家要简单，复杂留给后端」。
  it("码由系统自动发：页面不调发码命令、没有「生成专属码」；卡片操作只有选择下单 / 调整折扣", () => {
    expect(promo).toContain("supply.listMerchantCreatorPromos({ merchantId, marketId, merchantName })");
    expect(promo).not.toContain("supply.issueMerchantCreatorPromo(");
    expect(promo).not.toContain("生成专属码");
    expect(promo).toContain("选择下单");
    // 「查看依据」只读，挂在说明行上，不占操作位。
    expect(promo).toContain("依据 ›");
    expect(promo).not.toContain(">查看依据</Text>");
    // 品类读本店门店资料，页面上不让商家再选一遍（2026-10-04 用户：「本身我是商家登陆，就知道自己开的什么店」）。
    expect(promo).not.toContain("本店品类（");
    expect(promo).not.toMatch(/CATEGORIES\s*=/);
  });
  it("调整折扣：快捷模板 + 门槛 / 面额 / 文案 / 范围 / 有效期（含长期）/ 原因留痕，也能恢复系统建议", () => {
    expect(promo).toContain("PROMO_TEMPLATES.map(");
    expect(promo).toContain('{ days: 0, label: "长期有效" }');
    expect(promo).toContain("本店全部品类");
    expect(promo).toContain("调整原因（可选，记录留痕，方便团队回看）");
    expect(promo).toContain("applySuggestion: true");
    expect(promo).toContain('if (min > 0 && min < face) { setSheetError("门槛不能低于面额（满的要比减的多）"); return; }');
  });
  it("查看依据：按当前数据重算，没数据的维度照实灰掉，并列出调整记录", () => {
    expect(promo).toContain("supply.merchantCreatorPromoBasis(");
    expect(promo).toContain("muted={!b.available}");
    expect(promo).toContain("调整记录");
  });
  it("核销：扫顾客的券（系统判新客）或输码（店员勾新客），报错说人话", () => {
    expect(promo).toContain("parseCouponQr(data)");
    expect(promo).toContain("...(couponId ? { couponId } : {})");
    expect(promo).toContain("这张券已经核销过了（一张券只能用一次）");
    expect(promo).toContain("这是别家店的专属码 / 券，本店不能核销");
    expect(promo).toContain("这单没到门槛：满 ${formatWan(min)} VND 才能减");
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


describe("MERCHANT-CREATOR-PROMO-002 creator 看自己在各家店的码", () => {
  it("认领区下面列出各家店给她的专属码和战绩", () => {
    expect(section).toContain("supply.listMyMerchantPromos({ agentId })");
    expect(section).toContain("各家店给我的专属码");
    expect(section).toContain("st.newCustomers");
  });
});

describe("MERCHANT-CREATOR-PROMO-002 品类读门店资料；没核定就只如实说明", () => {
  it("不在专属码页选品类；没核定时说明清楚，且不给一个做不到的入口", () => {
    expect(promo).toContain("const storeCategory = storeInfo?.category ?? \"\";");
    expect(promo).toContain("本店品类还没由平台核定");
    // 2026-10-06 改：品类是**平台核定项、商家侧只读**（my-stores-hub.tsx 2026-10-04 的
    // 决定），店铺 hub 上既没有品类编辑器、未核定时连那一节都不画 —— 所以旧那个
    // 「跳去店铺页」的按钮是死路，连同 onOpenStore 这个 prop 一起撤掉了。
    // 反面断言查的是 merchant-promo.tsx 的源码，本文件自己的注释不会被喂红。
    expect(promo).not.toContain("onOpenStore");
    expect(promo).not.toContain("还没填品类");
  });
});
