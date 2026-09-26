// BUTTON-UNIFY-001（2026-09-26，用户「推进新的按钮组件统一更新」）。
//
// 背景：`ProxyButton` / `ProxyIconButton` 早就在 proxy-foundation 里，但全 App 只有
// 2 处调用 —— 其余页面各写各的 Pressable。实测同一类「确认键」在 4 个文件里是
// 4 种形状：
//
//   文件                      底色          圆角  字号  字重  禁用态
//   components/location-picker-sheet   ink    14    14    800   —
//   components/store-address-sheet     ink    14    14    800   0.45
//   components/registry                ink    12    11    800   0.4
//   components/privacy-settings        ink    12    14    600   0.5
//
// 还有一处危险色写的是 #c0392b（不是 foundation.danger），以及一处用 color.magenta
// 当主色。同一屏上两种圆角、两种字重，就是"没统一"看得见的样子。
//
// 这个文件守的是**已经迁完的那几个文件不许漂回去**（跟 back-glyph.test.ts 同一套路）。
// 不追求一次覆盖全部 36 处手写按钮 —— 迁移是一批一批做的，这里只钉住做完的部分，
// 每迁一批就加一段。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(join(sourceRoot, relative), "utf8");

describe("BUTTON-UNIFY-001 主按钮只有 ProxyButton 一个出处", () => {
  it("ProxyButton 支持 accessibilityLabel —— 否则迁移会静默丢掉按钮的读屏标签", () => {
    const foundation = read("components/proxy-foundation.tsx");
    // ⚠️ 不能只断言「整份文件里有 accessibilityLabel={accessibilityLabel}」——
    // 兄弟组件 ProxyIconButton 一直就有**一模一样**的那一行，把 ProxyButton 那行删掉
    // 断言照样绿（同名假守卫）。所以先把 ProxyButton 的函数体切出来，只在这一段里断言：
    // 参数声明 + 透传，两处都要在（只加声明不传等于没加）。
    const start = foundation.indexOf("export function ProxyButton(");
    const end = foundation.indexOf("export function ProxyIconButton(");
    expect(start, "ProxyButton 应该还在 proxy-foundation 里").toBeGreaterThan(-1);
    expect(end, "ProxyIconButton 应该还在 ProxyButton 之后").toBeGreaterThan(start);
    const proxyButton = foundation.slice(start, end);
    expect(proxyButton).toMatch(/accessibilityLabel\?: string;/);
    expect(proxyButton).toMatch(/accessibilityLabel=\{accessibilityLabel\}/);
  });

  it("privacy-settings 的按钮全部走 ProxyButton，危险色不再写死", () => {
    const source = read("components/privacy-settings.tsx");
    // 整份文件不再有手写 Pressable —— 6 个按钮（主/次/危险/开关/重试）全迁完。
    expect(source).not.toContain("<Pressable");
    // 四个形状键不许回来
    expect(source).not.toMatch(/cta:\s*\{/);
    expect(source).not.toMatch(/ctaDisabled:\s*\{/);
    expect(source).not.toMatch(/ctaText:\s*\{/);
    expect(source).not.toMatch(/ctaDanger:\s*\{/);
    expect(source).not.toMatch(/ctaDangerText:\s*\{/);
    expect(source).not.toMatch(/ctaSecondaryText:\s*\{/);
    // ⚠️ 不能断言 not.toContain("#c0392b") —— errorCard 的边框还用着这个色，
    // 那是错误卡片不是按钮。只钉按钮那处：ctaDanger 键必须消失（上面那条）。
    // 调用点数：迁完是 6 个（导出副本 / 保存副本 / 展开明细 / 撤回删除 / 重试 / 提交删除）
    expect((source.match(/<ProxyButton/g) ?? []).length).toBeGreaterThanOrEqual(6);
    // 次按钮的 tone 必须显式写出来，不许靠默认蒙混（默认是 primary，白底按钮会变黑底）
    expect(source).toMatch(/tone="secondary"/);
    expect(source).toMatch(/tone="danger"/);
  });

  it("store-address-sheet 的确认键走 ProxyButton", () => {
    const source = read("components/store-address-sheet.tsx");
    expect(source).toContain("<ProxyButton");
    // 形状键不许回来（只留布局）
    expect(source).not.toMatch(/confirm:\s*\{/);
    expect(source).not.toMatch(/confirmDisabled:\s*\{/);
    expect(source).not.toMatch(/confirmText:\s*\{/);
    // 迁移不等于丢标签：原来的 accessibilityLabel 必须还在
    expect(source).toContain('accessibilityLabel={coord ? "用这个落点" : "先在地图上落点"}');
    // 禁用语义也要留着（ProxyButton 用它驱动 disabled 态）
    expect(source).toContain("disabled={!coord}");
  });

  it("registry 的确认键走 ProxyButton", () => {
    const source = read("components/registry.tsx");
    expect(source).toContain("<ProxyButton");
    expect(source).not.toMatch(/confirmButtonText:\s*\{/);
    // confirmButton 只留布局：不许再有底色 / 圆角
    const confirmStyle = source.match(/confirmButton:\s*\{[^}]*\}/)?.[0] ?? "";
    expect(confirmStyle, "confirmButton 样式键应该还在（它是布局覆盖）").not.toBe("");
    expect(confirmStyle).not.toContain("backgroundColor");
    expect(confirmStyle).not.toContain("borderRadius");
    // 自己那份 disabled 键已删（ProxyButton 有统一的 0.42）
    expect(source).not.toMatch(/^\s*disabled:\s*\{/m);
  });
});

describe("BUTTON-UNIFY-002 按压反馈按原型收成 .97，chip 也走 ProxyButton", () => {
  it("ProxyButton 有原型的按压反馈 scale(.97)，而不是各页面自己那份", () => {
    const foundation = read("components/proxy-foundation.tsx");
    // ⚠️ 同样先切出 ProxyButton 的函数体：ProxyIconButton 没有按压反馈，
    // 若只断言「整份文件里有 buttonPressed」，把 ProxyButton 那条拆掉也不会红。
    const start = foundation.indexOf("export function ProxyButton(");
    const end = foundation.indexOf("export function ProxyIconButton(");
    expect(start, "ProxyButton 应该还在").toBeGreaterThan(-1);
    expect(end, "ProxyIconButton 应该还在 ProxyButton 之后").toBeGreaterThan(start);
    const proxyButton = foundation.slice(start, end);
    // 两头都要在：接线（pressed && …）+ 样式值（scale .97 = 原型那一个值）
    expect(proxyButton).toMatch(/pressed && styles\.buttonPressed/);
    expect(foundation).toMatch(/buttonPressed: \{ transform: \[\{ scale: 0\.97 \}\] \}/);
  });

  it("home-search-dock 的两个 action chip 走 ProxyButton", () => {
    const source = read("components/home-search-dock.tsx");
    // 形状键不许回来（只留布局）
    expect(source).not.toMatch(/actionChipText:\s*\{/);
    const chipStyle = source.match(/actionChip:\s*\{[^}]*\}/)?.[0] ?? "";
    expect(chipStyle, "actionChip 样式键应该还在（它是布局覆盖）").not.toBe("");
    expect(chipStyle).not.toContain("backgroundColor");
    expect(chipStyle).not.toContain("borderRadius");
    expect(chipStyle).not.toContain("paddingVertical");
    // 两个调用点，且各自的 accessibilityLabel 一字未改
    expect((source.match(/<ProxyButton/g) ?? []).length).toBe(2);
    expect(source).toContain('accessibilityLabel="整组换一套候选"');
    expect(source).toContain("accessibilityLabel={`更换${SLOT_LABEL[intentSlot]}候选`}");
  });
});
