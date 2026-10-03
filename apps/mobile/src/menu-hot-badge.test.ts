import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// MENU-HOT-001（2026-10-02，用户给原型「给商家菜单 某些打hot标」）：
//
// HOT 是商家亲手标的，不是从销量算的 —— 订单只记到店不记单品，全仓没有
// "某道菜卖多少"的数据。用店级销量给单品颁 HOT 等于编造归因。
// 徽样式照抄原型 hot-badge-v2（火焰 + HOT 白字，红橙渐变 pill）。
describe("MENU-HOT-001 HOT 徽按原型显示", () => {
  const badge = readFileSync(fileURLToPath(new URL("./components/hot-badge.tsx", import.meta.url)), "utf8");

  it("渐变红橙 + 火焰 + HOT，同原型", () => {
    expect(badge).toContain('from="#FF3B30"');
    expect(badge).toContain('to="#FF9500"');
    expect(badge).toContain('name="flame"');
    expect(badge).toContain(">HOT<");
    expect(badge).toContain("testID=\"hot-badge\"");
  });

  it("火焰图标路径照抄原型（viewBox 同源，不重描）", () => {
    const icon = readFileSync(fileURLToPath(new URL("./components/proxy-icon.tsx", import.meta.url)), "utf8");
    expect(icon).toContain('"flame"');
    expect(icon).toContain("M8.5 14.5A2.5 2.5");
  });

  it("没标的不画徽，有标的才画（三处一致）", () => {
    const cases: Array<[string, string]> = [
      ["./surfaces/business-home.tsx", "{m.isHot ? <HotBadge /> : null}"],
      ["./surfaces/my-stores-hub.tsx", "{m.isHot ? <HotBadge /> : null}"],
      ["./surfaces/merchant-storefront.tsx", "{p.isHot ? <HotBadge /> : null}"],
    ];
    for (const [f, want] of cases) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
      expect(src, f).toContain(want);
    }
  });
});

describe("MENU-HOT-001 打标/摘标走显式命令", () => {
  const ui = readFileSync(
    fileURLToPath(new URL("./surfaces/merchant-storefront.tsx", import.meta.url)),
    "utf8"
  );

  it("列表行一键打标，只改标记", () => {
    expect(ui).toContain("setProductHot(product.id, storeId, !product.isHot)");
    expect(ui).toContain("摘HOT");
  });

  it("编辑表单有开关，新建默认不标", () => {
    expect(ui).toContain("setEditingProductHot");
    // 新建不传 isHot（默认 false），编辑才带。
    expect(ui).toContain("标为 HOT");
  });
});

// STORE-EDIT-V2-001 round 2（用户给公告模板 HTML + "周1-7默认时间"）：
// 5 条双语模板点选填入；新店默认 07:00-22:00 全开，有行按行解析。
describe("STORE-EDIT-V2-001 公告模板与默认时间", () => {
  const src = readFileSync(fileURLToPath(new URL("./surfaces/merchant-storefront.tsx", import.meta.url)), "utf8");

  it("5 条模板原文在，点选填入并 100 封顶", () => {
    for (const t of ["今日休息", "调整营业", "备货售罄", "限时优惠", "新品上市"]) {
      expect(src, t).toContain(t);
    }
    expect(src).toContain("Nghỉ hôm nay");
    expect(src).toContain("setEditingAnnouncement(text.slice(0, 100))");
    // 手改取消选中态。
    expect(src).toContain("setAnnounceTpl(undefined)");
  });

  it("解析出来一天都没开就给默认（保存没动过走原文，不丢数据）", () => {
    expect(src).toContain("parsed.some((d) => d.enabled) ? parsed : defaultHoursDays()");
  });

  it("新店默认 07:00-22:00 全开，有行按行解析", () => {
    expect(src).toContain('open: "07:00", close: "22:00", enabled: true');
    expect(src).toContain("current ? parseHoursDays");
  });
});
