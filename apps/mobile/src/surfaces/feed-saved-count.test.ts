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
  // FEED-ACTION-DEDUP-001（2026-09-25，用户：「帖文为什么有重复的...2个
  // 按钮，保持一个，并且移除书签logo和引用logo」）：书签按钮本身撤了——
  // 写入有（engagement.bookmarkPost），但"收藏"页的动态 tab 还没接读接口
  // （见 me-orders.tsx FAVORITES-REAL-001 注释），点了看不到任何效果。
  // 这条测试原本锁的是"收藏图标不显示假聚合数"，图标本身没了，改成锁
  // "bookmark 真的从帖子操作行消失了，没有半吊子重新长出来"。
  it("has no bookmark affordance on the post action row (feature retired, not half-built)", () => {
    expect(feedCode).not.toContain('name="bookmark"');
    expect(feedCode).not.toContain("bookmarked");
    expect(feedCode).not.toContain("isSaved");
    expect(feedCode).not.toContain("收藏 {isSaved ? 1 : 0}");
  });

  // FEED-ACTION-DEDUP-001：引用（打开编辑器预填这条帖子）跟分享都是"把这条
  // 帖子传出去"，功能重复，快捷方式也撤了——写新帖时 ComposerV2Screen 自己
  // 的"引用"面板还能选任意帖子引用，只是不再有从这条帖子直接跳转预填的
  // 入口，也就没有 composerQuoteId 这条状态要维护。
  it("has no quote-shortcut affordance on the post action row either", () => {
    expect(feedCode).not.toContain('name="remix"');
    expect(feedCode).not.toContain("openComposerFor");
    expect(feedCode).not.toContain("composerQuoteId");
  });

  it("keeps exactly one 'send this post elsewhere' action: share", () => {
    // 2026-09-26：分享那颗的**字形**换成了 replyShare（原型 Feather 那一组，跟
    // replyLike / replyBubble / replyRepost 同源、1.8 描边），shareUp 从此不再出现。
    // 换的是字形不是功能，所以这条钉的语义不变：**分享入口仍然只有一个**（引用
    // 那条 shortcut 已撤，不许再长回来）。转发（replyRepost）是另一个动作 ——
    // 它写的是自己的时间线，跟 ProfileTabs 动作行里那颗是同一颗，不是重复的分享。
    expect(feedCode).toContain('name="replyShare"');
    expect(feedCode.match(/name="replyShare"/g)).toHaveLength(1);
    expect(feedCode).not.toContain('name="shareUp"');
  });

  it("keeps the two media systems in their own lanes", () => {
    // #18 订正：这不是“两套重复系统”——feed 多图轨＋X 式视频自动播只能用
    // AdaptiveMediaCollection（ThreadsPostMedia 没有 autoplay/position，
    // 也只取前 4 张）；个人主页照片墙才用 ThreadsPostMedia 单行铺开。
    // 把 feed 迁到单行等于把审计自己夸过的自动播给砍了。谁再提“合并”，
    // 先回答 autoplay 和第 5 张以后怎么办。
    expect(feedCode).toContain("<AdaptiveMediaCollection");
    expect(feedCode).toContain("activeVideoKey");
  });
});

// FEED-ACTION-ROW-001（2026-09-26，用户「对齐原型 下面的logo」）：动态卡片底部
// 那排动作图标，原型是 **4 颗**（♡ / 💬 / ↻ / ⤴），app 里只有 3 颗 —— 少了转发。
// 而且原来那 3 颗是三种不同来源的字形（heart 是 CSS 拼的 view、chat 是方角气泡、
// shareUp 是自造上传箭头），粗细和几何各不一样，才是「不像原型」的根因。
// 现在 4 颗统一走 replyLike / replyBubble / replyRepost / replyShare（Feather 那组，
// 1.8 描边）—— 跟 ProfileTabs 动作行、回复行同源。
// ⚠️ 反向臂照旧写在正向臂**前面**：反过来写的话，把 replyRepost 删掉时先开火的是
// 正向臂，反向臂永远走不到，等于没验过的钉。
describe("FEED-ACTION-ROW-001 the post action row matches the prototype's four icons", () => {
  const row = (() => {
    const start = feedCode.indexOf("<View style={styles.postActions}>");
    return start < 0 ? "" : feedCode.slice(start, feedCode.indexOf("</View>", start));
  })();

  it("renders four actions, not three (repost was missing)", () => {
    expect(row, "动作行块没找到 —— 结构变了就改这里，别删钉").not.toBe("");
    expect(row.match(/<Pressable /g) ?? []).toHaveLength(4);
  });

  it("uses the prototype's glyph family for all four, never the mismatched legacy ones", () => {
    // 反向臂先判
    expect(row).not.toContain('name="heart"');
    expect(row).not.toContain('name="chat"');
    expect(row).not.toContain('name="shareUp"');
    // 正向臂：4 颗同源
    expect(row).toMatch(/name="replyLike" size=\{18\}/);
    expect(row).toMatch(/name="replyBubble" size=\{18\}/);
    expect(row).toMatch(/name="replyRepost" size=\{18\}/);
    expect(row).toMatch(/name="replyShare" size=\{18\}/);
  });

  it("keeps the liked state visible: replyLike receives filled, and the glyph honours it", () => {
    // filled 传了还不够 —— replyLike 的 case 必须真的用 filled ? filledCommon : common。
    // 写死 {...common} 的话 filled 被静默吞掉，点赞后只剩变色、不变实心。
    expect(row).toMatch(/filled=\{isLiked\} name="replyLike"/);
    const icon = readFileSync(fileURLToPath(new URL("../components/proxy-icon.tsx", import.meta.url)), "utf8");
    const iconCode = stripComments(icon);
    // 走 [\s\S]*? 而不是 \s*\n\s*：源文件 case 块里有 6 行注释，剥注释后会留下空
    // 行 + 空白行，原来的 \s*\n\s* 在 vitest 跑全套时被贪婪匹配打回（实测单独跑
    // 该文件 7/7 绿、跑全套会假红）。新写法断言「case 块体内**包含**这个三元
    // 表达式」—— 比「紧跟其后」更稳，注入验证仍能抓到回归。
    expect(iconCode).toMatch(/case "replyLike":[\s\S]*?\(filled \? filledCommon : common\)/);
  });
});
