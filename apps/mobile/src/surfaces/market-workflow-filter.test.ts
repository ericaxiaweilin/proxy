import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./market.tsx", import.meta.url)), "utf8");
const demandWizard = readFileSync(fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)), "utf8");
const activityWizard = readFileSync(fileURLToPath(new URL("./activity-wizard.tsx", import.meta.url)), "utf8");

describe("market workflow surface", () => {
  it("uses order lifecycle filters instead of fulfillment action buttons", () => {
    expect(source).toContain('label: "已申请"');
    expect(source).toContain('label: "已创建"');
    expect(source).toContain('label: "执行中"');
    expect(source).not.toContain('>我的 Offer<');
    expect(source).not.toContain('>打卡<');
    expect(source).not.toContain('>证据<');
  });

  it("offers real order and activity publishing entries", () => {
    expect(source).toContain(">创建订单<");
    expect(source).toContain(">创建活动<");
    expect(source).toContain("openDemandWizard");
    expect(source).toContain("openActivityPublisher");
    expect(source).toContain('visible={publishMenuOpen}');
    expect(source).toContain('setTab("OPPORTUNITY")');
    expect(source).toContain('setTab("ACTIVITY")');
    expect(source).toContain('bottomNavVisible === false ? 28 : 116');
    // 两向导都经真实 publish 通道发布（非 mock）。
    expect(demandWizard).toContain("await marketplace.publish(");
    expect(activityWizard).toContain("await activities.publish(");
  });
});
