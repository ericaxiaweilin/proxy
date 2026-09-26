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
    // 自己那份 disabled 键已删（ProxyButton 有统一的 0.4）
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

describe("BUTTON-UNIFY-003 又一批主按钮迁到 ProxyButton", () => {
  // 判定「这个样式键还剩什么」的公共小工具：切出键体，断言里面没有形状字段。
  const shapeKeys = (source: string, key: string): string => {
    const body = source.match(new RegExp(key + ":\\s*\\{[^}]*\\}"))?.[0] ?? "";
    expect(body, `${key} 样式键应该还在（它是布局覆盖）`).not.toBe("");
    return body;
  };

  it("native-app 的「继续」走 ProxyButton，写死的 height 38 与 11 圆角都交出去", () => {
    const source = read("native-app.tsx");
    expect(source).not.toMatch(/rememberedContinueText:\s*\{/);
    const body = shapeKeys(source, "rememberedContinue");
    // 形状字段一个都不许留：原来覆盖的是圆角 11（当时恰好 = radius.sm）与 height 38。
    // ⚠️ 2026-09-26 对齐后基准圆角是 14，所以「删掉 11」不再是等值替换，是真换了形状。
    // height 38 仍是死代码（ProxyButton 的 minHeight 48 会赢）。
    expect(body).not.toContain("backgroundColor");
    expect(body).not.toContain("borderRadius");
    expect(body).not.toContain("height");
    expect((source.match(/<ProxyButton/g) ?? []).length).toBe(1);
    expect(source).toContain('accessibilityLabel="继续上次的账号"');
  });

  it("twin-gallery-section 的「授权形象」走 ProxyButton", () => {
    const source = read("components/twin-gallery-section.tsx");
    expect(source).not.toMatch(/aiStateBtnText:\s*\{/);
    const body = shapeKeys(source, "aiStateBtn");
    expect(body).not.toContain("backgroundColor");
    expect(body).not.toContain("borderRadius");
    expect(body).not.toContain("padding");
    // alignSelf 是定位，必须留着 —— 去掉它会撑满一行
    expect(body).toContain('alignSelf: "flex-start"');
    expect(source).toContain("<ProxyButton");
  });

  it("qr-zoom-overlay 的主/次动作键走 ProxyButton 的 tone，四个形状键全删", () => {
    const source = read("components/qr-zoom-overlay.tsx");
    expect(source).not.toMatch(/btnPrimary:\s*\{/);
    expect(source).not.toMatch(/btnGhost:\s*\{/);
    expect(source).not.toMatch(/btnPrimaryText:\s*\{/);
    expect(source).not.toMatch(/btnGhostText:\s*\{/);
    const body = shapeKeys(source, "btn");
    expect(body).not.toContain("borderRadius");
    expect(body).not.toContain("paddingVertical");
    // flex: 1 是「两个键平分一行」，是布局，必须留着
    expect(body).toContain("flex: 1");
    expect((source.match(/<ProxyButton/g) ?? []).length).toBe(1);
    // 主/次映射不许写死成一种
    expect(source).toContain('tone={a.primary ? "primary" : "secondary"}');
    expect(source).toContain("accessibilityLabel={a.label}");
  });
});

describe("BUTTON-UNIFY-004 999 胶囊 CTA 收敛到 ProxyButton", () => {
  const shapeKeys = (source: string, key: string): string => {
    const body = source.match(new RegExp(key + ":\\s*\\{[^}]*\\}"))?.[0] ?? "";
    expect(body, `${key} 样式键应该还在（它是布局覆盖）`).not.toBe("");
    return body;
  };

  it("outcome 的「跑一次 Demo 链路」走 ProxyButton（禁用态不再自己写 0.6）", () => {
    const source = read("surfaces/outcome.tsx");
    expect(source).not.toMatch(/ctaText:\s*\{/);
    const body = shapeKeys(source, "cta");
    expect(body).not.toContain("backgroundColor");
    expect(body).not.toContain("borderRadius");
    expect(body).not.toContain("paddingVertical");
    // 整份文件不再有手写 Pressable（原来就这一个）
    expect(source).not.toContain("<Pressable");
    expect(source).toContain("<ProxyButton");
    // 禁用条件一字未改
    expect(source).toContain("disabled={busy}");
    expect(source).not.toContain("opacity: 0.6");
  });

  it("custom-feed 的「创建并固定到首页」走 ProxyButton", () => {
    const source = read("surfaces/custom-feed.tsx");
    expect(source).not.toMatch(/aiBtnText:\s*\{/);
    // 自己那份 disabled 键也删了（ProxyButton 有统一的 0.4）
    expect(source).not.toMatch(/^\s*disabled:\s*\{/m);
    const body = shapeKeys(source, "aiBtn");
    expect(body).not.toContain("backgroundColor");
    expect(body).not.toContain("borderRadius");
    expect(body).not.toContain("paddingVertical");
    expect(source).toContain("<ProxyButton");
    // 禁用条件一字未改
    expect(source).toContain("disabled={!draft.trim()}");
  });

  it("ExperienceSurfaceBanner 的 primary_action 走 ProxyButton", () => {
    const source = read("experience-runtime/ExperienceSurfaceBanner.tsx");
    expect(source).not.toMatch(/actionText:\s*\{/);
    const body = shapeKeys(source, "action");
    expect(body).not.toContain("backgroundColor");
    expect(body).not.toContain("borderRadius");
    expect(body).not.toContain("padding");
    // alignSelf 是定位，留着 —— 去掉会撑满 banner 整行
    expect(body).toContain('alignSelf: "flex-start"');
    expect(source).not.toContain("<Pressable");
    expect(source).toContain("<ProxyButton");
    // 标签回退值一字未改
    expect(source).toContain('String(node.props.label ?? "查看")');
  });
});

describe("BUTTON-UNIFY-005 两行保存键：形状收敛，版式保留", () => {
  const shapeKeys = (source: string, key: string): string => {
    const body = source.match(new RegExp(key + ":\\s*\\{[^}]*\\}"))?.[0] ?? "";
    expect(body, `${key} 样式键应该还在（它是布局覆盖）`).not.toBe("");
    return body;
  };

  it("location-picker-sheet 的保存键走 ProxyButton", () => {
    const source = read("components/location-picker-sheet.tsx");
    // ⚠️ 不能断言 not.toContain("#3A2F4A") / not.toContain("confirmPressed") ——
    // 我自己的注释里就复述了这两个词，断言会被注释喂饱（假守卫）。
    // 只钉样式键：那个形状键必须消失。
    expect(source).not.toMatch(/confirmPressed:\s*\{/);
    const body = shapeKeys(source, "confirm");
    expect(body).not.toContain("backgroundColor");
    expect(body).not.toContain("borderRadius");
    // 纵向内边距必须留着 —— 这是全 App 唯一的两行主按钮，去掉会压成 48pt 最小高
    expect(body).toContain("paddingVertical: 14");
    // 两行内容必须自己竖排：ProxyButton 的行方向是 row，不包一层就是左右并排
    expect(source).toContain("<View style={styles.confirmCopy}>");
    expect(source).toContain("<ProxyButton");
    // accessibilityLabel 与副标题文案一字未改
    expect(source).toContain("accessibilityLabel={`保存到 ${finalCommit.city} 的 ${finalCommit.area}`}");
    expect(source).toContain('{finalCommit.city || "所选区域"}');
  });
});

// BUTTON-UNIFY-006 —— 覆盖审计的追溯补齐（2026-09-26）。
//
// 上面五段守的都是「我这一批迁过的文件」。这一段不一样：`twin-insight-card.tsx`
// 不是迁出来的，它是 TWIN-INSIGHT-001（67ec205，9-21）诞生时就用了 ProxyButton ——
// 比我这几批早 5 天，所以从来没有人为它加过钉。
//
// 做覆盖审计时数出来：全仓 13 个含 `<ProxyButton` 调用点的文件里，只有它一条钉都没有
// （12/13）。也就是说它的两个动作键漂回手写 Pressable，不会有任何东西变红。
describe("BUTTON-UNIFY-006 twin-insight-card 的两个动作键（追溯补齐）", () => {
  it("先观察 / 开启单独运营 仍是 ProxyButton，tone 一主一次", () => {
    const source = read("components/twin-insight-card.tsx");
    // 两个调用点。⚠️ 不能只钉 `<ProxyButton` —— 把两个键换成同一个 tone
    // （主次消失、两个键长得一样）也照样满足「有 ProxyButton」。
    // 所以把 tone / disabled / handler 一起钉在那一行上。
    expect((source.match(/<ProxyButton/g) ?? []).length).toBe(2);
    expect(source).toContain('<ProxyButton tone="secondary" disabled={acting} onPress={onObserve}>');
    expect(source).toContain('<ProxyButton tone="primary" disabled={acting} onPress={onOperate}>');
    // 文案一字未改 —— ⚠️ 但不能只 toContain("开启单独运营")：twinScoreHint() 的返回文案里
    // 就有这四个字（「建议开启单独运营」），所以按钮上那行被删掉，断言照样绿（假守卫）。
    // 用「ProxyButton 开标签 → 文案 → 闭标签」的正则把文案绑回按钮本身。
    // 这条是注入实验抓出来的：删掉整个主键后 toContain 版本仍然满足。
    expect(source).toMatch(/<ProxyButton tone="secondary"[^>]*>\s*先观察\s*<\/ProxyButton>/);
    expect(source).toMatch(/<ProxyButton tone="primary"[^>]*>\s*开启单独运营\s*<\/ProxyButton>/);
  });

  it("动作行只留版式，禁用态交回 ProxyButton", () => {
    const source = read("components/twin-insight-card.tsx");
    // actions 是那一行的版式覆盖，必须还在（不在了说明整行被重写）
    const actions = source.match(/actions:\s*\{[^}]*\}/)?.[0] ?? "";
    expect(actions, "actions 样式键应该还在（它是版式行）").not.toBe("");
    expect(actions).not.toContain("backgroundColor");
    expect(actions).not.toContain("borderRadius");
    // 自己那份 disabled 键不许回来（ProxyButton 有统一的 0.4）
    expect(source).not.toMatch(/^\s*disabled:\s*\{/m);
  });

  // ⚠️ 这个文件里另外 3 个 Pressable 是**故意不迁**的，不是漏的。写在这里，
  // 免得下一个人拿着「统一按钮」的清单来把它们「补全」：
  //   · TwinTargetRail 的头像项 —— accessibilityRole="tab"，是 tab 不是按钮；
  //   · styles.summary 那张卡 —— 整卡可点（展开/收起），是卡片点击面，不是 CTA；
  //   · styles.refresh「重新总结」—— 11pt 紫色文字链，嵌在 summaryHead 的
  //     justifyContent:"space-between" 里；ProxyButton 的 minHeight 48 + paddingHorizontal 20
  //     会把它撑成一个 48pt 药丸、把那一行版式顶坏。要迁它是设计决定，不是机械统一。
});

// BUTTON-SHAPE-ALIGN-001 —— 基准形状本身也要钉（2026-09-26，用户看了 sec-buttons
// 原型之后说「对齐」）。
//
// 上面六段钉的都是**调用点**（某个页面有没有退回手写按钮）。这一段钉的是**原语自己**：
// 基准形状一旦被谁顺手改回 40 / radius 11 / 13pt，20+ 个已迁按钮会一起变，而上面每一段
// 都还是绿的 —— 因为调用点确实还在用 ProxyButton。所以形状必须有独立的钉。
//
// 值全部来自原型 sec-buttons 04「所有按钮共享同一套圆角、间距、字号、状态反馈」：
//   .btn { padding:0 20px; height:48px; border-radius:14px; font-size:14px;
//          font-weight:900; letter-spacing:-.2px }   .btn:disabled{opacity:.4}
//   .icon-btn { width:44px; height:44px; border-radius:14px }   :active{scale(.94)}
describe("BUTTON-SHAPE-ALIGN-001 基准形状对齐原型 sec-buttons 04", () => {
  const shapeKeys = (source: string, key: string): string => {
    const body = source.match(new RegExp(key + ":\\s*\\{[^}]*\\}"))?.[0] ?? "";
    expect(body, `${key} 样式键应该还在`).not.toBe("");
    return body;
  };

  it("ProxyButton 基准形状 = 原型的 48 / 圆角 14 / 0 20 / 14pt / 900", () => {
    const foundation = read("components/proxy-foundation.tsx");
    const button = shapeKeys(foundation, "button");
    expect(button).toContain("minHeight: foundation.control.lg"); // = 48
    expect(button).toMatch(/borderRadius: 14\b/);
    expect(button).toMatch(/borderWidth: 1\.5\b/);
    expect(button).toContain("paddingHorizontal: foundation.space.five"); // = 20
    const text = shapeKeys(foundation, "buttonText");
    expect(text).toMatch(/fontSize: 14\b/);
    expect(text).toContain('fontWeight: "900"');
    expect(text).toMatch(/letterSpacing: -0\.2\b/);
    // ⚠️ 这里用正则而不是 toContain("opacity: 0.4") —— 后者会被 "opacity: 0.42"
    // 喂饱（0.4 是 0.42 的前缀），退回 .42 也照样绿。本仓库踩过的同族假守卫。
    expect(shapeKeys(foundation, "disabled")).toMatch(/opacity: 0\.4\b/);
  });

  it("对齐前的 40 / radius 11 / 13pt 不许回来", () => {
    const foundation = read("components/proxy-foundation.tsx");
    const button = shapeKeys(foundation, "button");
    expect(button).not.toContain("minHeight: foundation.control.md");
    expect(button).not.toContain("borderRadius: foundation.radius.sm");
    expect(shapeKeys(foundation, "buttonText")).not.toContain("foundation.text.sm");
  });

  it("ProxyIconButton 是原型的 44×44 圆角方（不是 40×40 胶囊），且按压反馈接上了", () => {
    const foundation = read("components/proxy-foundation.tsx");
    const icon = shapeKeys(foundation, "iconButton");
    expect(icon).toMatch(/height: 44\b/);
    expect(icon).toMatch(/width: 44\b/);
    expect(icon).toMatch(/borderRadius: 14\b/);
    expect(icon).toMatch(/borderWidth: 1\.5\b/);
    // 反向臂：胶囊（radius.full）是本仓自己的形状，原型是圆角方，不许回来
    expect(icon).not.toContain("radius.full");
    // 原型图标钮有 :active{scale(.94)}；定义了还得**接上**（没接上 = 没接线）
    expect(foundation).toMatch(/iconButtonPressed: \{ transform: \[\{ scale: 0\.94 \}\] \}/);
    expect(foundation).toMatch(/pressed && styles\.iconButtonPressed/);
  });
});
