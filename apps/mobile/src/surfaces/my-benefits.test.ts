import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rawSource = readFileSync(fileURLToPath(new URL("./my-benefits.tsx", import.meta.url)), "utf8");
// Strip line comments before asserting "must not contain a fabricated
// number" — the doc comment at the top of the file explicitly *names*
// the mockup's fake numbers to explain why they were dropped, which
// would otherwise false-positive a naive substring check.
const source = rawSource.replace(/\/\/.*$/gm, "");

describe("GROWTH-REAL-DATA-001: 我的权益 dashboard has no fabricated numbers", () => {
  it("does not hardcode the mockup's example stats anywhere outside a comment", () => {
    expect(source).not.toContain("1250");
    expect(source).not.toContain("4.9");
    expect(source).not.toMatch(/\b2000\b/);
  });

  it("does not render trend arrows (no previous-period data exists to compare against)", () => {
    expect(source).not.toMatch(/trend|↑|Trend/);
  });

  it("reads real data from GrowthClient.getMySummary, not a local mock", () => {
    expect(source).toContain("growthClient.getMySummary()");
  });
});

describe("GROWTH-REAL-DATA-001: the real campaign list stays reachable, just folded in", () => {
  it("still imports and renders the real BenefitHubSurface (campaign claim flow untouched)", () => {
    expect(source).toContain('import { BenefitHubSurface } from "./benefit-hub"');
    expect(source).toContain("<BenefitHubSurface onBack={() => setShowCampaigns(false)} />");
  });

  it("counts campaigns from the real client rather than showing a static number", () => {
    expect(source).toContain('benefitClient.listCampaigns({ status: "ACTIVE" })');
  });
});

describe("GROWTH-REAL-DATA-001: tasks with no single action never render a button", () => {
  it("gates the task action button on both !done and a real actionTarget", () => {
    expect(source).toContain("const showAction = !task.done && !!task.actionTarget;");
  });

  it("does not use the mockup's toast-only fake 'go complete' handler", () => {
    expect(source).not.toMatch(/toast\(/);
  });
});

describe("GROWTH-REAL-DATA-001: hero identity comes from the real viewer, not a placeholder name", () => {
  it("takes displayName/avatar as props instead of hardcoding a persona", () => {
    expect(source).toContain("viewerDisplayName?: string | undefined;");
    expect(source).toContain("viewerAvatarUri?: string | undefined;");
    expect(source).not.toContain('"美"');
    expect(source).not.toContain('"黄金会员"');
  });
});
