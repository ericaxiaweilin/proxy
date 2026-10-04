import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// HOME-FORYOU-SLOT-AVAIL-001 / 修冲突的源码钉已随 FOR-YOU-DERIVE-001 删除：
// 「哪一组能下单」现在由 for-you-derivation.ts 判定，行为测试在 for-you-derivation.test.ts。

// HOME-FORYOU-CTA-DOCK-001（2026-10-01，模拟器 idb 实测，用户连报两次「点击选择没响应」的第一层真因）：
// 格高 172 时「选择」CTA 落在 y 735..779，而玻璃 dock 的可点区域是 y 735..818 ——
// CTA 整颗被 dock 盖住，点它实际点到 dock（实测一次点击被带去了动态 tab）。
// 静态检查（tsc / vitest / Babel）**全都发现不了**，只有真机/模拟器点一下才知道。
//
// 修法：两行格子各收 22pt（172→150）+ CTA 上边距 10→6，实测 CTA 回到 y 658..702，
// 与 dock 之间留出 33pt。这条钉钉住**导致越界的那个数字**，谁要改格高就会撞上它，
// 然后必须按注释在模拟器上重测（idb ui describe-all 量 CTA 与 Tab Bar 的 frame），
// 不许靠目测。
describe("HOME-FORYOU-CTA-DOCK-001 For You CTA 不许落到玻璃 dock 底下", () => {
  const source = readFileSync(fileURLToPath(new URL("./surfaces/requester-home.tsx", import.meta.url)), "utf8");

  it("格高必须保持 CTA 在 dock 上沿之上（2026-10-01 实测 150 可行）", () => {
    expect(source).toMatch(/gridTile: \{ borderRadius: 18, height: (\d+),/);
    const height = Number(source.match(/gridTile: \{ borderRadius: 18, height: (\d+),/)?.[1]);
    // 经验上限：两行格 + 提示行 + CTA(≈44pt) 的总高必须落在 dock(顶 y≈735) 之上。
    // 172 实测越界 37pt；150 实测留 33pt 余量。要放宽这条，先在模拟器上量，
    // 并把量到的数字写回注释 —— 不许只改数字不改注释。
    expect(height).toBeLessThanOrEqual(150);
  });

  it("CTA 的上边距不许再放大（dock 余量就是从这里让出来的）", () => {
    expect(source).toMatch(/gridCta: \{[^\n]*marginTop: (\d+),/);
    expect(Number(source.match(/gridCta: \{[^\n]*marginTop: (\d+),/)?.[1])).toBeLessThanOrEqual(6);
  });
});
