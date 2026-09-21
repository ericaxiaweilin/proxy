import { describe, it, expect } from "vitest";
import { parseListTwinInsightsPayload, twinScoreBand } from "@proxy/contracts";
import { DEMO_PAYLOAD, DEMO_INSIGHTS } from "./twin-insight-demo";

describe("TwinInsight demo data (TWIN-INSIGHT-001)", () => {
  it("demo payload passes the wire contract (backend-shaped)", () => {
    const out = parseListTwinInsightsPayload(DEMO_PAYLOAD);
    expect(out.insights).toHaveLength(6);
    expect(out.totalTargets).toBe(6);
  });

  it("demo texts are plain text (no prototype <strong> HTML on the wire)", () => {
    for (const insight of DEMO_INSIGHTS) {
      for (const advice of insight.advices) {
        expect(advice.text).not.toContain("<");
      }
      expect(insight.summaryText).not.toContain("<");
      for (const item of insight.timeline) {
        expect(item.text).not.toContain("<");
      }
    }
  });

  it("demo covers all verdict bands used by the prototype", () => {
    const verdicts = new Set(DEMO_INSIGHTS.map((entry) => entry.verdict));
    expect(verdicts).toEqual(new Set(["worth", "watch", "skip", "new"]));
  });

  it("demo scores land in the band their verdict claims", () => {
    for (const insight of DEMO_INSIGHTS) {
      const band = twinScoreBand(insight.score, DEMO_PAYLOAD.thresholds);
      if (insight.verdict === "worth") expect(band).toBe("above");
      if (insight.verdict === "skip") expect(band).toBe("below");
    }
  });
});
