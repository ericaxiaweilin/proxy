import { describe, it, expect } from "vitest";
import {
  parseListTwinInsightsPayload,
  parseTwinInsight,
  twinScoreBand,
  formatTwinStay,
} from "./twin-insight";

const ALEX = {
  targetId: "alex",
  displayName: "Alex",
  initial: "A",
  avatarUrl: "",
  signal: "hot",
  verdict: "worth",
  verdictLabel: "值得运营",
  summaryHint: "7 天访问 12 次 · 互动深",
  score: 82,
  signals: { views7d: 12, messages7d: 48, avgStaySec: 180, likes7d: 9 },
  advices: [
    { type: "good", text: "他主动看过你主页 12 次，其中 4 次停留超过 5 分钟，兴趣明确。" },
    { type: "info", text: "你们的对话以咖啡馆、办公为主，主题稳定。" },
  ],
  summaryText: "你们在 3 天内聊过 2 次。他刚搬到北宁，在找可以安静工作的地方。",
  timeline: [
    { text: "访问了你的主页", time: "2 小时前", gray: false },
    { text: "回复了你的咖啡馆主题消息", time: "昨天 21:30", gray: false },
  ],
};

const PAYLOAD = {
  twinId: "twin_01",
  insights: [ALEX],
  totalTargets: 6,
  thresholds: { operateAt: 60, observeAt: 40, configVersion: 3 },
};

describe("twin-insight contract (TWIN-INSIGHT-001)", () => {
  it("parses prototype-shaped payload", () => {
    const out = parseListTwinInsightsPayload(PAYLOAD);
    expect(out.insights).toHaveLength(1);
    expect(out.insights[0]!.targetId).toBe("alex");
    expect(out.thresholds.operateAt).toBe(60);
  });

  it("rejects missing insights array (fail-closed, [] vs missing are different)", () => {
    expect(() => parseListTwinInsightsPayload({ ...PAYLOAD, insights: undefined })).toThrow();
  });

  it("rejects out-of-range score", () => {
    expect(() => parseTwinInsight({ ...ALEX, score: 120 })).toThrow();
  });

  it("rejects HTML-carrying advice drift (server must send plain text)", () => {
    // 当前 schema 允许任意文本；这条钉住“原型 <strong> 不得原样上 wire”：
    // 含 < 的文本视为上游未清洗，客户端拒绝渲染。
    const dirty = { ...ALEX, advices: [{ type: "good", text: "看过 <strong>12 次</strong>" }] };
    const parsed = parseTwinInsight(dirty);
    expect(parsed.advices[0]!.text).toContain("<");
    // 若未来收紧为纯文本（refine / superRefine），此用例应改为 rejects。
    // 在此之前，client 渲染层必须用 <Text> 原样展示，不得 dangerouslySetInnerHTML。
  });

  it("score band follows server thresholds, not hardcoded 60/40", () => {
    expect(twinScoreBand(82, PAYLOAD.thresholds)).toBe("above");
    expect(twinScoreBand(58, PAYLOAD.thresholds)).toBe("near");
    expect(twinScoreBand(22, PAYLOAD.thresholds)).toBe("below");
  });

  it("formats stay seconds like the prototype", () => {
    expect(formatTwinStay(180)).toBe("3分");
    expect(formatTwinStay(45)).toBe("45秒");
    expect(formatTwinStay(30)).toBe("30秒");
  });
});
