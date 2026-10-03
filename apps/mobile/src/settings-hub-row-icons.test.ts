import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SETTINGS-HUB-ROW-ICONS-001（2026-10-01）
//
// 用户连着两轮报「还是没有logo」：设置入口页（SETTINGS-HUB-001）的四行
// （账号与安全 / 手机号认证 KYC / 位置与隐私 / 语言）此前是裸 label + ›，
// 而原型 deepseek_html_20261001_726714.html 的每一行都有 .item-icon
// （24 栅格 / 描边 1.5 / 22px 全出血）。
//
// 根因是改错了仓库：第一轮把行图标加进了过期 checkout ~/work/kake，
// 运行中的 app 由 ~/proxy 的 Metro 供包 —— 那边四行从来就没有图标。
//
// 钉三件事：
//   1. 四行各自渲染一个 ProxyIcon（name=… 各恰好一次 —— 计数制，
//      删掉任何一行的图标都会红，和只检查「定义存在」的假绿区分开）；
//   2. 图标在 proxy-icon.tsx 的 switch 里有 case（联合类型里声明
//      `| "lock"` 而不实现 = 渲染 null，也是假绿）；
//   3. 反向：行结构不许退化回 emoji 当图标。
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const me = readFileSync(join(sourceRoot, "surfaces", "me.tsx"), "utf8");
const iconSource = readFileSync(join(sourceRoot, "components", "proxy-icon.tsx"), "utf8");

// 设置入口页的渲染块：从 appbehavior 分支起到下一个 sub-page 分支（SAFETY-NET-001）。
const hubStart = me.indexOf('subPage.route === "appbehavior"');
const hubEnd = me.indexOf("SAFETY-NET-001", hubStart);
const hub = hubStart >= 0 && hubEnd > hubStart ? me.slice(hubStart, hubEnd) : "";

describe("SETTINGS-HUB-ROW-ICONS-001: 设置入口页的行图标", () => {
  // 这一条原来数的是 `settingsHubRowMain` 出现的**次数**（先 4、后 5）。
  // 那是错的形态：它数的是一个**共享样式**，而设置页的行只会越加越多
  // （SETTINGS-HUB-ALL-NINE-001 把原型 9 行摆回来后，连「暂不可用」行也复用
  // 这个左组）。别人多加一行合法，钉却红了 —— 假红比不钉更糟。
  //
  // 现在钉的是**配对**：这四个图标各自紧挨着**它自己那一行的 label**，而且
  // 在左组里。加多少行都不影响它，但删掉任何一个图标、或者把图标和别的行
  // 的 label 拼在一起，立刻红。
  const rowWithIcon = (name: string, key: string): RegExp =>
    new RegExp(
      `<View style=\\{styles\\.settingsHubRowMain\\}>\\s*<ProxyIcon name="${name}" color=\\{color\\.ink\\} size=\\{22\\} />\\s*<Text selectable style=\\{styles\\.settingsHubRowLabel\\}>\\{t\\("${key}"\\)\\}</Text>`
    );

  it("SETTINGS-HUB-ROW-ICONS-001: 四个可打开的行各自「图标 + 自己那行的 label」配对", () => {
    expect(hub).not.toBe("");
    expect(me).toMatch(rowWithIcon("lock", "settingsRowAccountSecurity"));
    expect(me).toMatch(rowWithIcon("shield", "settingsRowKyc"));
    expect(me).toMatch(rowWithIcon("pin", "settingsRowLocationPrivacy"));
    expect(me).toMatch(rowWithIcon("globe", "language"));
    // 每个字形在整个文件里只出现在它自己那一行（出现两次 = 抄了一份到别处，
    // 那种「图标跟错行」的接线光看配对是看不出来的）。
    expect(me.split('name="lock"').length - 1).toBe(1);
    expect(me.split('name="shield"').length - 1).toBe(1);
    expect(me.split('name="pin"').length - 1).toBe(1);
    expect(me.split('name="globe"').length - 1).toBe(1);
  });

  it("SETTINGS-HUB-ROW-ICONS-001: 四个字形在 proxy-icon 的 switch 里有实现", () => {
    for (const name of ["lock", "shield", "globe"]) {
      expect(iconSource).toContain(`case "${name}":`);
    }
    // pin 是既有字形，但也要确认它仍在 switch 里（被删就渲染 null）。
    expect(iconSource).toContain('case "pin":');
  });

  it("SETTINGS-HUB-ROW-ICONS-001: 行图标不许退化回 emoji", () => {
    // 原型是描边 SVG；emoji（🔒🛡📍🌐等）字形随系统字体漂，与全仓图标体系冲突。
    expect(hub).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
