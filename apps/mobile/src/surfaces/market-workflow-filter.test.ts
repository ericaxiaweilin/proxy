import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./market.tsx", import.meta.url)), "utf8");

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
    expect(source).toContain(">发布订单<");
    expect(source).toContain(">发布活动<");
    expect(source).toContain("await activities.publish({");
    expect(source).toContain('visible={publishMenuOpen}');
    expect(source).toContain('setTab("OPPORTUNITY")');
    expect(source).toContain('setTab("ACTIVITY")');
    expect(source).toContain('bottomNavVisible === false ? 28 : 116');
  });
});
