import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// FEED-SAVED-COUNT-001: 收藏数显示的是查看者自己的 0/1，不是真实聚合数。
// 服务端根本没算这个聚合（engagement 只有 FOLLOW_COUNTS），计数管线建成
// 之前，诚实的修法是只显示状态（收藏/已收藏）不显示数字 —— 和点赞/回复
//（真值＋0 兜底）不一样，那个 0/1 是拿“我收没收藏”冒充“多少人收藏”。
// 注释先剥掉再断言，只认代码。
const feed = readFileSync(fileURLToPath(new URL("./feed.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const feedCode = stripComments(feed);

describe("FEED-SAVED-COUNT-001 saved count never invents an aggregate", () => {
  it("shows only the viewer state, not a fabricated number", () => {
    expect(feedCode).toContain('{isSaved ? "已收藏" : "收藏"}');
    expect(feedCode).not.toContain("收藏 {isSaved ? 1 : 0}");
  });

  it("keeps the two media systems in their own lanes", () => {
    // #18 订正：这不是“两套重复系统”——feed 多图轨＋X 式视频自动播只能用
    // AdaptiveMediaCollection（ThreadsPostMedia 没有 autoplay/position，
    // 也只取前 4 张）；个人主页照片墙才用 ThreadsPostMedia 网格。
    // 把 feed 迁到网格等于把审计自己夸过的自动播给砍了。谁再提“合并”，
    // 先回答 autoplay 和第 5 张以后怎么办。
    expect(feedCode).toContain("<AdaptiveMediaCollection");
    expect(feedCode).toContain("activeVideoKey");
  });
});
