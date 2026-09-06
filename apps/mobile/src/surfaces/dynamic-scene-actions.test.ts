import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./reality-scene-map.tsx", import.meta.url)), "utf8");

describe("SCENE-ACTION-MATERIALIZATION-001", () => {
  it("keeps the three scene exits on independent domain commands", () => {
    expect(source).toContain('"CreateInvitation"');
    expect(source).toContain('"PublishMarketOpportunity"');
    expect(source).toContain('"PublishActivity"');
    expect(source).toContain("尚未生成订单");
    expect(source).toContain("等待候选申请");
    expect(source).toContain("已进入“我的活动”");
  });
});
