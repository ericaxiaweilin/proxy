import { describe, expect, it } from "vitest";
import { creatorRatingLabel, formatCreatorGrade, formatCreatorScore, formatFansCount, formatPriceRange, formatRatePercent, formatServiceVolume, labelCapability, labelInvitationPurpose, labelMarket, labelServiceType, labelSocial, labelVertical, visibleCapabilityTags } from "./creator-capability-labels";

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
  it("粉丝数必有：0 也照印（未披露），调用方不许判空隐藏", () => {
    expect(formatFansCount(24000)).toBe("2.4w");
    expect(formatFansCount(10000)).toBe("1w");
    expect(formatFansCount(950)).toBe("950");
    expect(formatFansCount(0)).toBe("0");
    expect(formatFansCount(undefined)).toBe("0");
  });

  it("评价分/等级只做展示映射：分档阈值 S85/A70/B55，无记录一律新人", () => {
    expect(formatCreatorGrade(92, true)).toBe("S");
    expect(formatCreatorGrade(85, true)).toBe("S");
    expect(formatCreatorGrade(70, true)).toBe("A");
    expect(formatCreatorGrade(55, true)).toBe("B");
    expect(formatCreatorGrade(54.9, true)).toBe("C");
    // 无成交记录不给先验分定级 —— 哪怕 Total 有数。
    expect(formatCreatorGrade(53, false)).toBe("新人");
    expect(formatCreatorGrade(95, false)).toBe("新人");
    expect(formatCreatorScore(92)).toBe("92");
    expect(formatCreatorScore(87.5)).toBe("87.5");
    expect(creatorRatingLabel({ total: 92, hasTrackRecord: true })).toBe("S · 92分");
    expect(creatorRatingLabel({ total: 53, hasTrackRecord: false })).toBe("新人 · 暂无评价");
    expect(creatorRatingLabel(undefined)).toBe("");
  });

  it("服务量只印真实成交单数，无记录印 0 单", () => {
    expect(formatServiceVolume(12)).toBe("服务 12 单");
    expect(formatServiceVolume(0)).toBe("服务 0 单");
    expect(formatServiceVolume(undefined)).toBe("服务 0 单");
  });

  it("比率只印正数百分比，无评价不印 0%", () => {
    expect(formatRatePercent(0.9)).toBe("90%");
    expect(formatRatePercent(0.955)).toBe("96%");
    expect(formatRatePercent(0)).toBe("");
    expect(formatRatePercent(undefined)).toBe("");
  });

  it("邀约出价印区间：一口价走报价口径，没填不编免费", () => {
    expect(formatPriceRange(800000, 1500000, "VND")).toBe("800K–1.5tr VND");
    expect(formatPriceRange(1200000, 1200000, "VND")).toBe("1.2tr VND");
    expect(formatPriceRange(0, 0, "VND")).toBe("出价待商议");
    expect(formatPriceRange(undefined, undefined, "VND")).toBe("出价待商议");
    expect(formatPriceRange(900, 900, "VND")).toBe("900 VND");
  });

  it("合作目的封闭集：三选一+其他，未知值不渲染", () => {
    expect(labelInvitationPurpose("SALES")).toBe("冲销量");
    expect(labelInvitationPurpose("UGC")).toBe("UGC产出");
    expect(labelInvitationPurpose("TRAFFIC")).toBe("拉人气");
    expect(labelInvitationPurpose("OTHER")).toBe("其他合作");
    expect(labelInvitationPurpose("陪聊")).toBe("");
    expect(labelInvitationPurpose(undefined)).toBe("");
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
