import { describe, expect, it } from "vitest";
import { formatFansCount, labelCapability, labelMarket, labelServiceType, labelSocial, labelVertical, visibleCapabilityTags } from "./creator-capability-labels";

describe("creator-capability-labels (MERCHANT-CREATOR-TAGS-001)", () => {
  it("已知编码转中文", () => {
    expect(labelCapability("PHOTOGRAPHY")).toBe("摄影");
    expect(labelCapability("ZH")).toBe("中文");
    expect(labelCapability("GUIDE")).toBe("城市向导");
  });
  it("未知编码原样透出，不编造", () => {
    expect(labelCapability("DRIVING")).toBe("DRIVING");
  });
  it("取前 N 个并过滤空值", () => {
    expect(visibleCapabilityTags(["ZH", "", "VI", "PHOTOGRAPHY"], 2)).toEqual(["中文", "越南语"]);
    expect(visibleCapabilityTags(undefined as unknown as string[])).toEqual([]);
    expect(visibleCapabilityTags([], 2)).toEqual([]);
  });
  it("服务类型与城市转中文，未知原样透出", () => {
    expect(labelServiceType("CITY_COMPANION")).toBe("本地生活");
    expect(labelServiceType("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(labelMarket("hn")).toBe("河内");
    expect(labelMarket("hcm")).toBe("胡志明");
    expect(labelMarket("xx")).toBe("xx");
    expect(labelMarket(undefined)).toBe("");
  });
  it("社媒账号转标签，无 handle 不渲染", () => {
    expect(labelSocial("tiktok", "linh_hanoi")).toBe("🎵 @linh_hanoi");
    expect(labelSocial("zalo", "")).toBe("");
  });
  it("粉丝数自填格式化：万级缩写，无数不渲染", () => {
    expect(formatFansCount(24000)).toBe("2.4w");
    expect(formatFansCount(10000)).toBe("1w");
    expect(formatFansCount(950)).toBe("950");
    expect(formatFansCount(0)).toBe("");
    expect(formatFansCount(undefined)).toBe("");
  });
  it("垂类只明示三类，其余返回空", () => {
    expect(labelVertical("RESTAURANT")).toBe("餐饮");
    expect(labelVertical("CAFE")).toBe("餐饮");
    expect(labelVertical("TOUR")).toBe("旅游");
    expect(labelVertical("SPORT")).toBe("运动");
    expect(labelVertical("KTV")).toBe("");
    expect(labelVertical("SPA")).toBe("");
    expect(labelVertical("")).toBe("");
  });
});
