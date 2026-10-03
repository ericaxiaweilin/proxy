import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DEFAULT_PRESET_ID, VOUCHER_PRESETS, defaultPresetForFamily, voucherPresetById } from "./voucher-presets";
import type { VoucherFamily } from "./voucher-client";

// VOUCHER-PRESET-001（2026-10-01，用户「商家的发卷 现在要输入一堆 改为预设好 默认
// 标准值。商家点击创建就可以」）
//
// 现场：CREATE 页的类型 / 面值 / 数量 / 有效期**本来就有默认值**，真正逼着商家动手的
// 只有「适用范围」—— 它初始是空串，而 issue() 硬要求 scope.trim()，于是商家点
// 「创建」只会看到一句「请填写权益价值、数量和适用范围」。一张标准咖啡券是商家最常
// 发的东西，却要先想清楚这张券在哪能用。
describe("VOUCHER-PRESET-001 商家点创建就能发券，不用先填一堆", () => {
  it("每个类型都有标准预设，不会出现「点了类型没东西可填」", () => {
    const families: VoucherFamily[] = ["COFFEE", "EXPERIENCE", "ACTIVITY"];
    for (const family of families) {
      const preset = defaultPresetForFamily(family);
      expect(preset.family, `${family} 没有对应预设`).toBe(family);
      expect(preset.displayValue).toBeGreaterThan(0);
      expect(preset.quantity).toBeGreaterThan(0);
    }
  });

  it("默认预设存在且合法 —— 打开页面就能直接发", () => {
    const preset = voucherPresetById(DEFAULT_PRESET_ID);
    expect(preset, "默认预设 id 指向了不存在的预设").toBeDefined();
    expect(preset!.scopeName.trim(), "适用范围不能为空，否则又回到填表").not.toBe("");
    expect(preset!.redeemTimeWindow.trim()).not.toBe("");
    expect(preset!.minimumSpend.trim()).not.toBe("");
    expect(preset!.perPersonLimit).toBeGreaterThan(0);
  });

  it("每条预设都自带一句人话说明，界面上原样显示", () => {
    // "预设"变成黑箱就等于把编造藏起来了：商家得看得见这张券到底是什么。
    for (const preset of VOUCHER_PRESETS) {
      expect(preset.hint.trim().length, `${preset.id} 缺说明`).toBeGreaterThan(0);
      expect(preset.hint).toContain(preset.scopeName);
    }
  });

  it("适用范围不编造城市名", () => {
    // 以前 issue() 里是 `scopeDetail: … || "河内"` —— 券面会印上一个商家从没填过的
    // 地名。现在预设只说"本店"，不含任何编造的地理信息。
    for (const preset of VOUCHER_PRESETS) {
      expect(preset.scopeName).toBe("本店");
    }
  });

  it("issue() 不再硬要求适用范围，留空回落到预设", () => {
    const src = readFileSync(fileURLToPath(new URL("./surfaces/voucher.tsx", import.meta.url)), "utf8");
    // 原来 `if (!displayValue || !issuedQuantity || !scope.trim())` —— 少打一个
    // 适用范围就整张券发不出去。
    expect(src).not.toMatch(/!scope\.trim\(\)/);
    expect(src).toContain("const scopeText = scope.trim() || preset.scopeName;");
    // 报错文案也要跟着改：还写着"请填写…适用范围"就是在叫一个已经不需要的字段。
    expect(src).toContain("请填写权益价值和数量。");
    expect(src).not.toContain("请填写权益价值、数量和适用范围。");
  });

  it("核销规则来自预设而不是藏在代码里", () => {
    const src = readFileSync(fileURLToPath(new URL("./surfaces/voucher.tsx", import.meta.url)), "utf8");
    // 原来 redeemTimeWindow / minimumSpend / perPersonLimit 是在 issue() 里写死的，
    // 界面上一个字都没有 —— 商家看到的券和他填出来的东西可能对不上。
    expect(src).not.toMatch(/redeemTimeWindow:\s*family === "COFFEE"/);
    expect(src).toContain("redeemTimeWindow: preset.redeemTimeWindow");
    expect(src).toContain("minimumSpend: preset.minimumSpend");
    expect(src).toContain("perPersonLimit: preset.perPersonLimit");
    // 而且必须在界面上显出来。
    expect(src).toContain("按标准预设的核销规则");
  });

  it("换类型会落到该类型的预设，不会留着上一套数值", () => {
    const src = readFileSync(fileURLToPath(new URL("./surfaces/voucher.tsx", import.meta.url)), "utf8");
    expect(src).toContain("function applyFamily(next: VoucherFamily)");
    expect(src).toContain("applyPreset(defaultPresetForFamily(next).id)");
    // 类型 chips 走 applyFamily，不是裸的 setFamily —— 后者只改类型、留下旧数值。
    expect(src).toContain("onPress={() => applyFamily(item)}");
  });
});
