import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseListTwinInsightsPayload,
  twinScoreBand,
  formatTwinStay,
  type TwinInsight,
} from "@proxy/contracts";

// TWIN-INSIGHT-002 —— 好友洞察已经接上真服务端，原先那份虚构兜底数据
// （6 个编造好友 + 编造分数/建议/对话摘要）已删除。
//
// 这批用例是**反向钉**：它们不测"功能在"，而是测"编数据这件事不再可能"。
// 之所以需要反向钉，是因为正向的"能渲染"在两种实现下都绿 —— 接真服务端绿，
// 接一份假数据也绿。只有钉住"假数据的入口不存在"才能让这个回归真的失败。

const sectionSource = readFileSync(
  fileURLToPath(new URL("./twin-insight-section.tsx", import.meta.url)),
  "utf8",
);

describe("TwinInsight no longer ships fabricated data (TWIN-INSIGHT-002)", () => {
  it("the demo module is gone", () => {
    const demoPath = fileURLToPath(new URL("./twin-insight-demo.ts", import.meta.url));
    expect(existsSync(demoPath)).toBe(false);
  });

  it("the section never imports a demo fallback", () => {
    // 只看 import 行，不看注释 —— 注释里提到"以前那份 demo 已删除"是有价值的
    // 历史记录，不该让这条钉误伤；真正要钉死的是**没有 import 进来**。
    const importLines = sectionSource
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n");
    expect(importLines).not.toContain("twin-insight-demo");
    expect(importLines).not.toContain("DEMO_");
    // 代码里也不许再出现这些标识符。
    expect(sectionSource).not.toContain("DEMO_PAYLOAD");
    expect(sectionSource).not.toContain("DEMO_INSIGHTS");
    expect(sectionSource).not.toContain("DEMO_THRESHOLDS");
  });

  it("the section no longer renders a 本机演示 badge", () => {
    // badge 是最危险的部分：它把"后端没接"包装成一个看起来已完成的功能。
    expect(sectionSource).not.toContain("本机演示");
    expect(sectionSource).not.toContain("demoBadge");
  });

  it("the section distinguishes empty from failed (no silent downgrade)", () => {
    // [] = 真没有（空态）；失败 = 错误态 + 重试。把失败显示成空态就是骗人。
    expect(sectionSource).toContain("ProxyEmptyState");
    expect(sectionSource).toContain("重试");
    // 失败必须落到 error 状态，不能落到 payload。
    expect(sectionSource).toContain("setError");
  });

  it("read path hits the real endpoint, not a local constant", () => {
    // 真正的读路径是 listInsights -> GET /v1/ai/twins/...（见 twin-insight-client.ts）
    expect(sectionSource).toContain("insightClient.listInsights");
  });
});

describe("TwinInsight wire contract tolerates real (empty) data", () => {
  // 真实服务端在"好友没有可观测行为"时会下发全 0。这种数据必须能过契约 ——
  // 否则空态会变成解析失败，用户看到的是"读不出来"而不是"还没有洞察"。
  const zeroSignal: TwinInsight = {
    targetId: "user_mockcreator_mai",
    displayName: "Mai",
    initial: "M",
    avatarUrl: "",
    signal: "cold",
    verdict: "skip",
    verdictLabel: "暂不推荐",
    summaryHint: "7 天无互动",
    score: 0,
    signals: { views7d: 0, messages7d: 0, avgStaySec: 0, likes7d: 0 },
    advices: [{ type: "warn", text: "过去 7 天没有任何互动记录。" }],
    summaryText: "过去 7 天没有互动记录。",
    timeline: [],
  };

  it("a zero-signal payload parses", () => {
    const out = parseListTwinInsightsPayload({
      twinId: "aip_1",
      insights: [zeroSignal],
      totalTargets: 1,
      thresholds: { operateAt: 60, observeAt: 30, configVersion: 1 },
    });
    expect(out.insights).toHaveLength(1);
    const first = out.insights[0];
    expect(first).toBeDefined();
    expect(first?.score).toBe(0);
    expect(first?.timeline).toEqual([]);
  });

  it("an empty insights array is a valid empty state", () => {
    const out = parseListTwinInsightsPayload({
      twinId: "aip_1",
      insights: [],
      totalTargets: 0,
      thresholds: { operateAt: 60, observeAt: 30, configVersion: 1 },
    });
    expect(out.insights).toEqual([]);
    expect(out.totalTargets).toBe(0);
  });

  it("a missing insights array fails closed (protocol anomaly, not empty)", () => {
    // 契约：空集合 = []，缺数组 = 协议异常。这两件事必须分开。
    expect(() =>
      parseListTwinInsightsPayload({
        twinId: "aip_1",
        totalTargets: 0,
        thresholds: { operateAt: 60, observeAt: 30, configVersion: 1 },
      }),
    ).toThrow();
  });

  it("band and stay formatting stay consistent with the server", () => {
    const thresholds = { operateAt: 60, observeAt: 30, configVersion: 1 };
    expect(twinScoreBand(0, thresholds)).toBe("below");
    expect(twinScoreBand(30, thresholds)).toBe("near");
    expect(twinScoreBand(60, thresholds)).toBe("above");
    expect(formatTwinStay(0)).toBe("0秒");
    expect(formatTwinStay(45)).toBe("45秒");
    expect(formatTwinStay(180)).toBe("3分");
  });
});
