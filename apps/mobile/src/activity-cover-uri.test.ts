import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { activityCoverUri, mediaThumbUrl } from "./media-thumb-url";

// ACTIVITY-COVER-001（2026-10-01，用户「做活动 商家活动吧 活动图片资产」）
//
// 这个拼法（`{base}/v1/media/thumb/{mediaAssetId}`）在本仓本来已经有三份：场景照片墙
// （scene-shop-directory）、门店相册（merchant-storefront）、以及别处的真人头像
// （requester-home）。收成一处是因为媒体路由改一次要改三个地方，而漏掉的那个只会
// 表现为"某个面图不出来了"—— 很难往回找。
describe("ACTIVITY-COVER-001 媒体 thumb URL 只有一处拼法", () => {
  it("拼出来的就是媒体路由那条", () => {
    expect(mediaThumbUrl("ma_1", "http://127.0.0.1:4100")).toBe("http://127.0.0.1:4100/v1/media/thumb/ma_1");
    // 结尾斜杠不能拼出 //v1
    expect(mediaThumbUrl("ma_1", "http://127.0.0.1:4100/")).toBe("http://127.0.0.1:4100/v1/media/thumb/ma_1");
  });

  it("空 id / 空 baseUrl 一律 undefined，调用方据此走如实占位", () => {
    expect(mediaThumbUrl("", "http://x")).toBeUndefined();
    expect(mediaThumbUrl("   ", "http://x")).toBeUndefined();
    expect(mediaThumbUrl(undefined, "http://x")).toBeUndefined();
    expect(mediaThumbUrl("ma_1", "")).toBeUndefined();
    expect(mediaThumbUrl("ma_1", undefined)).toBeUndefined();
  });

  it("id 做 URL 编码，含分隔符的 id 拼不出别的路径", () => {
    // 服务端会拒掉这种 id，但客户端这层也不该给它拼出路径穿越的机会。
    expect(mediaThumbUrl("a/b", "http://x")).toBe("http://x/v1/media/thumb/a%2Fb");
    expect(mediaThumbUrl("a b", "http://x")).toBe("http://x/v1/media/thumb/a%20b");
  });
});

describe("ACTIVITY-COVER-001 活动封面优先用媒体资产", () => {
  it("有资产就用资产拼 thumb URL", () => {
    expect(activityCoverUri({ coverMediaAssetId: "ma_cover" }, "http://x")).toBe("http://x/v1/media/thumb/ma_cover");
  });

  it("资产优先于 R17.x 遗留的 coverImageUrl", () => {
    // 两个都存在时以资产为准：coverImageUrl 至今没有任何写入者，它是死字段，
    // 拿它当优先来源等于让死字段压过真正有生产者的那个。
    expect(activityCoverUri({ coverMediaAssetId: "ma_cover", coverImageUrl: "https://legacy/x.jpg" }, "http://x"))
      .toBe("http://x/v1/media/thumb/ma_cover");
  });

  it("只有遗留 URL 时仍能用（不破坏既有 wire 形状）", () => {
    expect(activityCoverUri({ coverImageUrl: "https://legacy/x.jpg" }, "http://x")).toBe("https://legacy/x.jpg");
  });

  it("两者都没有 → undefined，不拿场景图冒充这张活动的封面", () => {
    expect(activityCoverUri({}, "http://x")).toBeUndefined();
    expect(activityCoverUri({ coverImageUrl: "  " }, "http://x")).toBeUndefined();
  });
});

// 封面光"能用"不够：商家活动列表的 ActivityItem 那个 Pick 里**根本没有封面字段**，
// 所以商家侧永远画不出图（不是没传，是没读）。票券侧那条由 Go 测试盯
// （cover_asset_test.go）—— Go 行为该由 Go 测试看，不该从移动端读 .go 源码。
describe("ACTIVITY-COVER-001 商家侧读得到封面", () => {
  const merchant = readFileSync(fileURLToPath(new URL("./surfaces/merchant-me-r21-replacement.tsx", import.meta.url)), "utf8");

  it("商家活动列表的类型带上封面字段，并真的画出来", () => {
    expect(merchant).toMatch(/type ActivityItem = Pick<[\s\S]*?"coverMediaAssetId"/);
    expect(merchant).toContain("activityCoverUri(a, localApiBaseUrl)");
    expect(merchant).toContain("styles.activityCover");
    // 没有图时是如实占位，不拿场景图冒充。
    expect(merchant).toContain("activityCoverEmpty");
  });
});
