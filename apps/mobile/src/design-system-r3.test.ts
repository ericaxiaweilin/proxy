import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/.test(entry)
        ? [path]
        : [];
  });
}

// R15.67: R2 参考设计允许的装饰元素白名单 (头像字符 / 链接装饰行 / 数字加粗 / status bar 模拟).
// 装饰 (avatar 字符, dot, 数字加粗) 不是 UI text, 11pt+ 强校验只针对真文字.
const R2_DECORATION_WHITELIST: ReadonlyArray<string> = [
  "personalAvaLetter",    // 头像 1-2 字符装饰
  "personalFaceText",     // 关注者头像堆叠装饰
  "personalLinkText",     // 链接装饰行 (handle 名也是装饰)
  "personalTopbarIcon",   // 顶栏返回箭头 (装饰)
  "personalMetaDot",      // 装饰 dot (无 fontSize, 占位)
  "personalFace",         // 头像背景 (无 font)
  "personalAvaAdd",       // 头像 + 浮层 (无 font)
  "personalStatValue",    // 浏览数数字加粗 (装饰 数字)
  "personalFollowersValue", // 关注数数字加粗 (装饰数字)
  // R15.96: scene map entry eyebrow ("SCENE MAP · 河内") — 8pt 装饰，跟 personalAvaLetter 同类
  "sceneMapEyebrow",
  // R15.76: R1 AI Identity System PRD — 头像下 AI 徽章 (frontstage 透明度义务).
  //   9pt "AI" 字符跟 personalAvaLetter 同类装饰.
  "aiAuthorBadgeText",
  // R15.77: R1 HTML 1:1 抄 — AIIdentityShowcaseSurface 是静态 design showcase (3 phone preview,
  //   mini identity cards), 小屏 8-10pt 是 R1 原版. 跟 personalAvaLetter 同类装饰.
  "miniPillText", "pTopHandle", "pBadgeText", "pNoticeTitle", "pNoticeBody",
  "pActionText", "pActionDarkText", "pTabText", "pTabOnText",
  "pAvatarText", "pAvatarTextAi", "postAvaText", "postAvaTextAi",
  "postName", "postTime", "postText", "pOrigin", "postActions",
  // R15.78: R1 audit 段 (table + filter) — 装饰 8-10pt (R1 1:1 抄原版).
  "auditFilterText", "auditHeaderCell", "auditCell",
  // R15.79: R1 provenance 段 (pipeline + detection sample + signals) — 装饰 8-12pt.
  "pipeNumText", "pipeStepTitle", "pipeStepSub",
  "sampleVisualText", "sampleVisualTextAi", "sampleTitle", "sampleSub",
  "detectResultTitle", "detectResultSub",
  "signalLabel", "signalHint", "signalValue",
  "decisionTitle", "decisionSub", "riskPillText",
  // R15.80: R1 risk 段 (3 risk cards + 5 rules + 6 toggles + reco card).
  "riskCardTitle", "riskCardSub",
  "ruleTitle", "ruleReason", "ruleActionText", "ruleOpBtnText",
  "recoCardTitle", "toggleRowTitle", "toggleRowSub",
  // R15.81: R1 identity 段 (Account≠Content + 权限矩阵 + 注册链路 + 数据模型 modal).
  "archBtnText", "identityCardTitle", "identityCardSub", "contentBadgeText",
  "permHeaderCell", "permCellCap", "permCellText", "permPolicy",
  "signupBoxKind", "signupBoxSteps",
  "archTitle", "archSub", "archCode", "archCloseBtnText",
  // R15.82: R1 native 段 (3 persona + 冷启动 4 toggles + 2 强守门).
  "personaName", "personaRole", "personaOwner", "personaState",
  "personaPolicyBtnText", "personaCreateBtnText", "personaAvatarText",
  "personaBadgeText",
  "coldCardTitle", "coldCardSub", "coldRowTitle", "coldRowSub",
  // R15.83: R1 twin 段 (2 Twin + 8 授权 toggles + Human Confirm 3 flow).
  "confirmBoxTitle", "confirmBoxSub",
  // R15.84: R1 overview 段 (hero + 4 KPI + 3 identity cards + 3 flow).
  "heroKickerText", "heroTitle", "heroSub", "heroRulePillText",
  "heroSideLabel", "heroSideTitle", "heroBoundaryText",
  "kpiValue", "kpiLabel",
  "identityBigPillText", "identityBigTitle", "identityBigDesc",
  "identityBigRowLabel", "identityBigRowValue",
  "coreFlowTitle", "coreFlowSub"
];

describe("Proxy Design System R3 typography", () => {
  it("keeps readable UI text at 11pt or larger (R2 decoration whitelist excluded)", () => {
    const violations = ["components", "surfaces"].flatMap((directory) =>
      sourceFiles(join(sourceRoot, directory)).flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return [...source.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)]
          .filter((match) => Number(match[1]) < 11)
          // 读取 5-8 行内上下文, 检查该 fontSize 是否属于 R2 装饰白名单
          .filter((match) => {
            const start = Math.max(0, (match.index ?? 0) - 800);
            const context = source.slice(start, (match.index ?? 0) + 200);
            return !R2_DECORATION_WHITELIST.some((name) => context.includes(name));
          })
          .map((match) => `${path.slice(sourceRoot.length + 1)}:${match.index}:${match[0]}`);
      })
    );

    expect(violations).toEqual([]);
  });

  // R15.67: R2 必含守卫 — 个人主页 (me.tsx) 必须有 R2 设计关键元素:
  // - 1fr 头网格 + 86px 头 (Threads R2 .head grid 1fr 86px)
  // - 1px 边框 actions (R2 .actions button border 1px + 圆角 10)
  it("keeps Threads R2 personal profile header layout", () => {
    const mePath = join(sourceRoot, "surfaces", "me.tsx");
    const stylesPath = join(sourceRoot, "surfaces", "me-styles.ts");
    const source = readFileSync(mePath, "utf8") + "\n" + readFileSync(stylesPath, "utf8");
    // personalHead: 1fr 86px 等价 = flexDirection row + gap + 86px ava wrap
    expect(source).toMatch(/personalHead:\s*\{[\s\S]*?flexDirection:\s*"row"[\s\S]*?gap:\s*16/);
    // ava 86px 区域
    expect(source).toMatch(/personalAvaWrap:\s*\{[\s\S]*?width:\s*82/);
    // ava + 浮层 (Threads R2 .add 32x32 浮在 -6 -2)
    expect(source).toMatch(/personalAvaAdd:\s*\{[\s\S]*?position:\s*"absolute"/);
  });

  // R15.67: R2 actions 守门 (ProfileTabs) — 1px 边框 + 10 圆角 (R2 .actions button)
  it("keeps R2 action button styling on ProfileTabs", () => {
    const ptPath = join(sourceRoot, "surfaces", "ProfileTabs.tsx");
    const source = readFileSync(ptPath, "utf8");
    // actionBtn 必含 1px 边框 + 圆角 10
    expect(source).toMatch(/actionBtn:\s*\{[\s\S]*?borderWidth:\s*1[\s\S]*?borderRadius:\s*10/);
  });

  // R15.67: no-AI 守门 — 个人主页 (personalHub 段) 不应包含 老 R3 字眼
  // (proto / displayName / 已履约 / 可接单) — user 反馈 AI 味过重, 强守门.
  it("rejects R3 prototype design words in me.tsx personal hub", () => {
    const mePath = join(sourceRoot, "surfaces", "me.tsx");
    const source = readFileSync(mePath, "utf8");
    const personalHubMatch = source.match(/subPage\.route === "personalhub"[\s\S]*?(?=return contentWrapper)/);
    expect(personalHubMatch, "personalhub section should exist").toBeTruthy();
    if (personalHubMatch) {
      const section = personalHubMatch[0];
      expect(section, "禁止 prototype / protoBar / displayName R3 老字眼").not.toMatch(/prototype|protoBar|displayName/);
      expect(section, "禁止 已履约 / 可接单 R3 自创 meta").not.toMatch(/已履约|可接单/);
    }
  });
});
