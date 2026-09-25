import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CONFIDENCE_TIER_TEXT,
  RELATION_ORDER,
  confidenceTier,
  formatNextShowAt,
  groupObjectsByRelation,
  kindLabel,
  objectSuggestionHint,
  pickDailySuggestion
} from "./facet-home-model";
import type { FacetObject } from "@proxy/contracts";

// FACET 首屏读模型（2026-09-25，对齐 deepseek_html_20260925_cb1dd9.html）。
//
// 这个文件钉两类东西：
//   ① 纯逻辑的正确性（选谁 / 分组 / 时间显示）；
//   ② **不许照抄原型里没有数据源的部分** —— 原型的「准备了 N 张素材」「建议文案」
//      「AI 生成」标签「确认发布」「PDPL 同意闸 / 隐私看板（AES-256、越南境内服务器、
//      60 日公安部备案、DPO 邮箱）」在本仓库都没有对应事实。照抄 = 假承诺。
//      同类事故的钉子：STATIC-COUNT-001（内容库写死条数）、
//      FACET-HERO-FABRICATED-001（hero 写死常量）、MARKET-FAKE-JUDGMENT-001（编造匹配度）。

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const surface = readFileSync(here("./FacetHomeSurface.tsx"), "utf8");

// 跟仓库其它钉一样的理由：先剥注释再 grep，否则解释「为什么不照抄」的注释里
// 写着同一个词，把代码删掉测试照样绿。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const surfaceCode = stripComments(surface);

function obj(over: Partial<FacetObject> & { id: string }): FacetObject {
  return {
    displayName: over.id,
    relation: "BUILDING_TRUST",
    goal: "加强熟悉感与信任",
    currentState: "已展示 16 条",
    pillLabel: "重点关系",
    gap: { summary: "保持真实日常节奏", nextShowAt: "2026-09-25T13:00:00Z" },
    avatarUrl: "",
    recommendedKind: "personal/real-life",
    reasoningConfidence: 70,
    sideSpaceGap: "",
    sideSpaceKind: "",
    sideSpacePosts: [],
    sideSpaceFulfilled: false,
    ...over
  };
}

const NOW = new Date(2026, 8, 25, 10, 0, 0); // 2026-09-25 10:00 本地时间
const localIso = (y: number, mo: number, d: number, h: number, mi: number): string =>
  new Date(y, mo, d, h, mi).toISOString();

// 模拟「契约将来允许 recommendedKind 为空」的那一天。当前 contracts 里它是必填
// 枚举（恒非空），但同一仓库的 sideSpaceKind 就是 `...or(z.literal(""))`，
// 所以空值分支值得先钉住。
const NO_KIND = "" as unknown as FacetObject["recommendedKind"];

describe("formatNextShowAt", () => {
  // server 发的是 RFC3339（reasoning.go: r.now().Add(2h).UTC().Format(time.RFC3339)），
  // 屏上直接印就是 "2026-09-25T13:00:00Z"。这里必须转成人话。
  it("把同一天说成「今天 HH:mm」", () => {
    expect(formatNextShowAt(localIso(2026, 8, 25, 20, 0), NOW)).toBe("今天 20:00");
  });
  it("把第二天说成「明天 HH:mm」", () => {
    expect(formatNextShowAt(localIso(2026, 8, 26, 9, 5), NOW)).toBe("明天 09:05");
  });
  it("把前一天说成「昨天 HH:mm」", () => {
    expect(formatNextShowAt(localIso(2026, 8, 24, 8, 0), NOW)).toBe("昨天 08:00");
  });
  it("一周内说成「N 天后 HH:mm」", () => {
    expect(formatNextShowAt(localIso(2026, 8, 28, 12, 0), NOW)).toBe("3 天后 12:00");
  });
  it("更远就退回 MM-DD HH:mm", () => {
    expect(formatNextShowAt(localIso(2026, 9, 20, 7, 30), NOW)).toBe("10-20 07:30");
  });
  it("解析不了就原样返回，不把屏变空", () => {
    expect(formatNextShowAt("今晚 20:00", NOW)).toBe("今晚 20:00");
    expect(formatNextShowAt("", NOW)).toBe("");
  });
});

describe("confidenceTier / CONFIDENCE_TIER_TEXT", () => {
  it("按 80 / 60 分档，且每档都有人话", () => {
    expect(confidenceTier(90)).toBe("HIGH");
    expect(confidenceTier(80)).toBe("HIGH");
    expect(confidenceTier(79)).toBe("MID");
    expect(confidenceTier(60)).toBe("MID");
    expect(confidenceTier(59)).toBe("LOW");
    expect(confidenceTier(0)).toBe("LOW");
    for (const tier of ["HIGH", "MID", "LOW"] as const) {
      expect(CONFIDENCE_TIER_TEXT[tier].length).toBeGreaterThan(0);
    }
  });
});

describe("pickDailySuggestion", () => {
  it("没有对象 → undefined（首屏整块不渲染，而不是编一条）", () => {
    expect(pickDailySuggestion([], NOW)).toBeUndefined();
  });

  it("取置信度最高的那个", () => {
    const picked = pickDailySuggestion(
      [
        obj({ id: "low", reasoningConfidence: 30 }),
        obj({ id: "high", reasoningConfidence: 88 }),
        obj({ id: "mid", reasoningConfidence: 65 })
      ],
      NOW
    );
    expect(picked?.object.id).toBe("high");
  });

  it("同分取 nextShowAt 更早的", () => {
    const picked = pickDailySuggestion(
      [
        obj({ id: "late", reasoningConfidence: 80, gap: { summary: "a", nextShowAt: localIso(2026, 8, 27, 9, 0) } }),
        obj({ id: "soon", reasoningConfidence: 80, gap: { summary: "b", nextShowAt: localIso(2026, 8, 25, 20, 0) } })
      ],
      NOW
    );
    expect(picked?.object.id).toBe("soon");
  });

  it("跳过 recommendedKind 为空的对象（契约一旦允许 \"\"，那不是建议）", () => {
    const picked = pickDailySuggestion(
      [
        obj({ id: "empty", recommendedKind: NO_KIND, reasoningConfidence: 99 }),
        obj({ id: "real", recommendedKind: "photo", reasoningConfidence: 40 })
      ],
      NOW
    );
    expect(picked?.object.id).toBe("real");
  });

  it("全部没有方向 → undefined", () => {
    expect(
      pickDailySuggestion([obj({ id: "x", recommendedKind: NO_KIND })], NOW)
    ).toBeUndefined();
  });

  // 关键：卡上每个字都必须是 server 的原值，不许本地加工成更漂亮的说法。
  it("rationale / confidence / kind 都是 server 原值，不做美化", () => {
    const source = obj({
      id: "ken",
      displayName: "小帅 Ken",
      recommendedKind: "personal/honest",
      reasoningConfidence: 82,
      gap: { summary: "对方在观望，需要一条「真实软肋」破冰", nextShowAt: localIso(2026, 8, 25, 12, 0) }
    });
    const picked = pickDailySuggestion([source], NOW);
    expect(picked?.rationale).toBe(source.gap.summary);
    expect(picked?.confidence).toBe(82);
    expect(picked?.kind).toBe("personal/honest");
    expect(picked?.kindText).toBe(kindLabel("personal/honest"));
    expect(picked?.nextShowText).toBe("今天 12:00");
    expect(picked?.tier).toBe("HIGH");
  });

  it("不改动传进来的数组（纯读模型）", () => {
    const list = [obj({ id: "a", reasoningConfidence: 10 }), obj({ id: "b", reasoningConfidence: 90 })];
    const snapshot = JSON.stringify(list);
    pickDailySuggestion(list, NOW);
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});

describe("groupObjectsByRelation", () => {
  it("按 重点关系 → 朋友 → 合作 的固定顺序输出，空组不出现", () => {
    const groups = groupObjectsByRelation([
      obj({ id: "spa", relation: "CREATOR_COLLAB" }),
      obj({ id: "ken", relation: "BUILDING_TRUST" })
    ]);
    expect(groups.map((g) => g.relation)).toEqual(["BUILDING_TRUST", "CREATOR_COLLAB"]);
    expect(groups.map((g) => g.label)).toEqual(["重点关系", "合作"]);
  });

  it("计数等于组内对象数，且不丢对象", () => {
    const list = [
      obj({ id: "k1" }),
      obj({ id: "k2" }),
      obj({ id: "l1", relation: "SHARED_INTEREST" }),
      obj({ id: "s1", relation: "CREATOR_COLLAB" })
    ];
    const groups = groupObjectsByRelation(list);
    expect(groups.map((g) => g.objects.length)).toEqual([2, 1, 1]);
    expect(groups.flatMap((g) => g.objects).map((o) => o.id)).toEqual(["k1", "k2", "l1", "s1"]);
  });

  it("空输入 → 空数组", () => {
    expect(groupObjectsByRelation([])).toEqual([]);
  });

  it("RELATION_ORDER 覆盖 contracts 里全部三种关系", () => {
    expect([...RELATION_ORDER]).toEqual(["BUILDING_TRUST", "SHARED_INTEREST", "CREATOR_COLLAB"]);
  });
});

describe("objectSuggestionHint", () => {
  it("有方向 → 一行「AI 建议 · <方向>」", () => {
    expect(objectSuggestionHint(obj({ id: "ken", recommendedKind: "city/travel" }))).toBe("AI 建议 · 城市 · 旅行");
  });
  it("没方向 → undefined", () => {
    expect(objectSuggestionHint(obj({ id: "x", recommendedKind: NO_KIND }))).toBeUndefined();
  });
  it("不带数字徽章（每个对象最多一条建议，数字是噪音）", () => {
    expect(objectSuggestionHint(obj({ id: "ken" }))).not.toMatch(/\d/);
  });
});

describe("FacetHomeSurface 的诚实边界", () => {
  it("logo 没被换掉（用户明确要求 logo 不要改）", () => {
    // 这里刻意不把整条资产语句抄成字符串：scripts/check-media-pipeline.mjs 的 R1
    // 会把任何**新增**的打包资产引用判成「绕过 media/ 资产层」，连测试里的字符串
    // 常量都算（存量行按 HEAD 逐行比对放行，新文件没有豁免）。
    expect(surfaceCode).toContain("const OTTER_LOGO =");
    expect(surfaceCode).toContain("assets/otter-logo.png");
    expect(surfaceCode).toContain("source={OTTER_LOGO}");
  });

  it("没有搬原型里没有数据源的东西", () => {
    // 「给 X 准备了 N 张素材」「建议文案」「AI 生成」标签、「确认发布」、发布成功
    for (const needle of ["准备了", "建议文案", "AI 生成", "确认发布", "发布成功", "存草稿"]) {
      expect(surfaceCode).not.toContain(needle);
    }
  });

  it("没有搬原型的 PDPL 法律断言（这些不是 UI 文案，是承诺）", () => {
    for (const needle of ["PDPL", "AES-256", "dpo@", "公安部", "跨境传输", "隐私看板", "同意记录", "数据控制者"]) {
      expect(surfaceCode).not.toContain(needle);
    }
  });

  it("nextShowAt 一律经 formatNextShowAt，不再把 ISO 直接印到屏上", () => {
    expect(surfaceCode).toContain("formatNextShowAt(obj.gap.nextShowAt)");
    expect(surfaceCode).toContain("formatNextShowAt(previewObject.gap.nextShowAt)");
    expect(surfaceCode).not.toContain("value={obj.gap.nextShowAt}");
    expect(surfaceCode).not.toContain("{previewObject.gap.nextShowAt}");
  });

  it("关系文案 / 方向文案只有一份（在 model 里），屏内不再复制枚举表", () => {
    expect(surfaceCode).not.toContain("KIND_LABEL");
    expect(surfaceCode).toContain("const RELATION_PILL = RELATION_LABEL;");
  });

  it("STATIC-COUNT-001 要求的两条诚实占位还在（内容库不许报写死的草稿/备选条数）", () => {
    expect(surfaceCode).toContain("— · 本地上传待后续版本");
    expect(surfaceCode).toContain("— · 审核队列待后续版本");
  });

  it("首屏 AI 建议卡在 payload 没到时不渲染（不编一条出来）", () => {
    expect(surfaceCode).toContain("{dailySuggestion ? (");
    expect(surfaceCode).toContain("payload ? pickDailySuggestion(payload.objects) : undefined");
  });
});
