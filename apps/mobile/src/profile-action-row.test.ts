import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// PROFILE-ACTION-MORE-001 / PROFILE-ACTION-COUNTS-001 —— 他人主页「还没有对齐原型」
// （2026-09-25 用户报了两次）。三个缺口：
//   1. 行动行只有「关注 / 消息」两个控件，原型是**三个**（第三个是圆形「···」）；
//   2. 帖子动作行是文字「♡ 喜欢 / 💬 回复 / ↗ 分享」，原型是**图标 + 计数**
//      （`♡ 12  💬 3  ↻  ⤴`，见 docs/design/references/
//      Proxy_Profile_Threads_Standalone_R2.html 的 function post()）；
//   3. 第 2 颗「评论」**从来没画出来过**（用户第二次报：「少了评论logo功能」）——
//      它挂在一个 `onReplyPost` 上，而那个 prop 全仓没有任何调用方传过，
//      所以那一颗的闸门恒为 false。
// 这三处以前**没有任何断言会红** —— 「少一个按钮」「用文字不用图标」「prop 没人传」
// 都不会让谁失败，所以它们一直漂着没人发现。这个文件就是给它们上钉。
//
// 为什么单独一个文件，而不是塞进 design-system-r3.test.ts（其他主页钉都在那儿）：
// 那个文件里有一处别人正在修的 11pt 违规（surfaces/my-benefits.tsx），整文件是红的。
// 把新钉塞进去等于让它一起红 —— 门禁在第一个失败处就 exit 1，我的钉永远不会被走到，
// 日志里 grep 不到，反而容易被误读成「没跑 = 没问题」。

/**
 * 剥掉注释再断言。
 *
 * 「不许再出现 X」这类反向臂**必须**走这个函数：本仓库的注释习惯是解释**为什么不做 X**
 * （「这里原来有个 onReplyPost，全仓没人传」），于是被解释的那串字面量就躺在源码里，
 * 反向臂会被自己的说明文字喂饱 ⇒ 永远绿。design-system-r3.test.ts 已有同样的写法。
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
}
describe("PROFILE-ACTION-MORE-001 the profile action row has the prototype's third control", () => {
  const tabs = readFileSync(new URL("./surfaces/ProfileTabs.tsx", import.meta.url), "utf8");
  const icon = readFileSync(new URL("./components/proxy-icon.tsx", import.meta.url), "utf8");

  it("keeps a circular ellipsis button whose glyph is an icon, not a character", () => {
    // 圆形：38×38 + 圆角 19（= 半径，正圆），跟关注/消息两个按钮并排
    expect(tabs).toMatch(/actionMore:\s*\{[^}]*borderRadius:\s*19/);
    expect(tabs).toMatch(/actionMore:\s*\{[^}]*height:\s*38/);
    expect(tabs).toMatch(/actionMore:\s*\{[^}]*width:\s*38/);
    // 取「更多」按钮那一块。⚠️ 反向臂写在正向臂**前面**：反过来写的话，把图标换成
    // "···" 字符会先触发正向臂，「不是字符」那一臂就永远不会被求值 —— 一条从没红过
    // 的钉（这个教训是本轮在门禁脚本里真踩到的，见 check-regression-contracts.sh）。
    const button = tabs.match(/accessibilityLabel="更多"[\s\S]*?styles\.actionMore[\s\S]*?<\/Pressable>/)?.[0] ?? "";
    expect(button, "行动行的「···」按钮应该还在").not.toBe("");
    // 字形必须是 ProxyIcon，不许往 Text 里塞 "···"/"⋯" 字符 —— 字符的字重和基线
    // 跟着字号跑，这正是本仓库把 ♡/♥ 从字符换成图标的原因。
    expect(button).not.toContain("<Text");
    expect(button).not.toContain("···");
    expect(button).not.toContain("⋯");
    expect(button).toContain('name="ellipsis"');
    // 字形真存在（不是只改了调用处、proxy-icon 里却没有这条分支）。
    // ⚠️ ellipsis 在 proxy-icon 里走的是**提前 return 的 if 分支**，不是 switch 的
    // case —— 照着 heart 的写法去 grep `case "ellipsis"` 会假红。
    const glyph = icon.match(/if \(name === "ellipsis"\)[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(glyph, "proxy-icon 里的 ellipsis 字形应该还在").not.toBe("");
    // 反向臂在前：它必须是三个 View 画的点，不能退化成文字
    expect(glyph).not.toContain("<Text");
    // 三个点（少一个就是「··」—— 形状不对了）
    expect(glyph).toContain("[0, 1, 2].map");
  });

  it("opens a real Modal, not an absoluteFill scrim", () => {
    // ProfileTabs 是渲染在调用方的 ScrollView **里面**的 —— 普通绝对定位覆盖层会被
    // 滚出可视区 / 被裁掉。ReportSheet 之所以能用遮罩，是因为调用方把它放在
    // ScrollView 外面。
    expect(tabs).toMatch(/<Modal[^>]*visible=\{props\.open\}/);
  });

  it("offers only actions the app can actually perform", () => {
    // 只取函数体，**不含**上面的文档注释 —— 那段注释故意写着「没有『举报』」来解释
    // 为什么不做；连注释一起匹配的话，反向臂会被自己的说明文字喂饱（永远红）。
    const sheet = tabs.match(/function ProfileMoreSheet\(props: \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(sheet, "ProfileMoreSheet 应该还在").not.toBe("");
    // 反向臂在前。举报的唯一入口是页头那颗 —— 两套菜单各缺几项比一套更糟
    // （FEED-MENU-DEDUP-001 就是为这个把 feed 帖文里重复的「···」删掉的）。
    // 减少推荐没有**按账号**的服务端命令（只有按帖子的 RecordFeedPreference），
    // 编一条出来点下去只会安静地什么都不发生。
    expect(sheet).not.toContain("举报");
    expect(sheet).not.toContain("减少推荐");
    // 正向臂：剩下两项都是真的。
    // ⚠️ 钉的是**可见文案**（`>分享主页</Text>`），不是裸的「分享主页」—— 后者会被
    // 同一行的 accessibilityLabel="分享主页" 喂饱：把菜单项文字改成「分享」而
    // 无障碍标签没动，裸子串照样绿（反向注入验出来的假绿）。
    expect(sheet).toContain(">分享主页</Text>");
    expect(sheet).toContain("muteAuthor");
    // 没接 client（游客 / 没传 engagement）时「屏蔽作者」整条不画 ——
    // 一个点下去没反应的菜单项比没有更糟。
    expect(sheet).toMatch(/\{props\.client \? \(/);
    // 失败必须说出来：屏蔽是「以后不再看到这个人」的承诺，静默失败会让用户以为
    // 已经生效（而它同时是 feed 永久过滤，撤销入口会变得很难找）。
    expect(sheet).toContain("onMuteFailed(");
  });
});

describe("PROFILE-ACTION-COUNTS-001 the profile post action row matches the prototype", () => {
  const tabs = readFileSync(new URL("./surfaces/ProfileTabs.tsx", import.meta.url), "utf8");

  it("uses the feed's icon vocabulary with real counts", () => {
    const row = tabs.match(/styles\.postActions\}>[\s\S]*?styles\.postActionsSpacer[\s\S]*?<\/View>/)?.[0] ?? "";
    expect(row, "动作行应该还在").not.toBe("");
    // 反向臂在前：文字按钮不许回来（`♡ 喜欢` / `💬 回复` / `↗ 分享`）
    expect(row).not.toContain("喜欢</Text>");
    expect(row).not.toContain("回复</Text>");
    expect(row).not.toContain("分享</Text>");
    expect(tabs).not.toContain("postActionText");
    // 正向臂：四个字形，且跟 feed 同一套词汇 —— 同一个「喜欢」在动态流和主页
    // 不能长成两个样子（feed 已经改成图标了，见 FEED-ACTION-ROW-001）。
    // 整行 4 颗都是 Feather 1.8（replyLike / replyBubble / replyRepost / replyShare），
    // 之前 ♡ 用的是 ProxyIcon 的 `heart`（CSS 拼的 View），几何和描边粗细都跟同排
    // 另外 3 颗不一样，是「不像原型」的根因。baseline: B326 → B327。
    expect(row).toMatch(/name="replyLike" size=\{18\}/);
    // 反向臂在前：第 2 颗**不许**退回方角 chat 气泡。原型的 I.reply 是**圆**气泡
    // （`M20 11.5a7.5 7.5 0 1 1-3.2-6.1A7.5 7.5 0 0 1 20 11.5Z` + 尾巴），
    // proxy-icon.tsx 里 chat 是方角（`M5 6h14v9H9l-4 3z`）—— 两个字形不是一回事。
    // 同一个错在 PROFILE-TAB-LOGO-001 已经犯过一次（回复 tab 指到 chat，用户当场
    // 指出「回复的 logo 还是不符合原型」）；回复行第 2 颗也是 replyBubble
    // （REPLY-ACTION-ICONS-001），两处必须同源。
    // 走 withoutComments：上面那条注释自己就写着 "chat" 这个字面量，不剥注释等于
    // 让反向臂被自己的说明喂饱。
    expect(withoutComments(row)).not.toMatch(/name="chat"/);
    // 正向臂：第 2 颗 = replyBubble（圆气泡）+ 评论数。以前这一臂只保证**行里
    // 写着**一个字形、不保证它真出现 —— 实测（2026-09-25，模拟器
    // Proxy iPhone 15 QA）主页帖子行**看不到** 💬，因为它挂在一个没人传的 prop
    // 上（用户第二次报的正是这个）。现在它走 onToggleReplies，「它是真入口而不是
    // 死图标」由下面那个 describe 专门钉。
    expect(row).toMatch(/name="replyBubble" size=\{18\}/);
    expect(row).toMatch(/name="replyRepost" size=\{18\}/);
    expect(row).toMatch(/name="replyShare" size=\{18\}/);
    // 已喜欢 = filled + magenta（跟 feed 的 isLiked 分支同形）
    // replyLike 的 case 真的会读 filled（跟 bookmark 同形），不会像换字形前那样被吞
    expect(row).toMatch(/filled=\{liked\} name="replyLike"/);
    expect(row).toMatch(/liked \? props\.color\.magenta : props\.color\.ink/);
    // 计数只在 engagement 拉到后才画 —— 没拉到就只画图标，不回填 0
    // （真·0 会照常显示 0）。沿用这个文件自己的 PROFILE-REPLIES-VISIBLE-001 口径。
    expect(row).toMatch(/props\.engagement \?[\s\S]*?props\.engagement\.reactions/);
    expect(row).toContain("props.engagement.replies");
    expect(row).toContain("props.engagement.reposts");
    // 分享顶到行尾（原型 .pa 第 4 个按钮带 margin-left:auto）
    expect(tabs).toMatch(/postActionsSpacer:\s*\{[^}]*flex:\s*1/);
  });

  it("never draws an expand-comments control with nothing to expand", () => {
    // 闸门以前是 `reactions > 0 || replies > 0` —— 赞很多但一条评论都没有的帖子
    // 会画出一个「💬 0 条评论 ﹀」，点开是空列表：一个**假控件**（看着能展开，
    // 展开什么都没有）。那行开关已经整行删掉（见下面那个 describe），所以这里
    // 只留一条反向臂守住它别回来。
    expect(tabs).not.toContain("props.engagement.reactions > 0 || props.engagement.replies > 0");
  });
});

describe("PROFILE-ACTION-COUNTS-001 the comment button is a real affordance", () => {
  const tabs = readFileSync(new URL("./surfaces/ProfileTabs.tsx", import.meta.url), "utf8");
  const code = withoutComments(tabs);

  it("wires the second action to the comment list, not to a prop nobody passes", () => {
    // 反向臂在前。`onReplyPost` / `props.onReply` 是「💬 从来没画出来」的根因：
    // 一个没人传的 prop 把一颗按钮的闸门焊死在 false 上，而且**不会让任何断言变红**
    // —— 用户对照原型一眼就看出来了，机器看了几个月没看出来。
    // ⚠️ 必须剥注释：源码里正躺着解释它为什么被删的注释。
    expect(code).not.toContain("onReplyPost");
    expect(code).not.toContain("props.onReply");
    // 正向臂：第 2 颗走 onToggleReplies（展开/收起评论列表），标签跟着状态变。
    expect(tabs).toContain('accessibilityLabel={props.repliesExpanded ? "收起评论" : "查看评论"}');
    expect(tabs).toContain("onPress={props.onToggleReplies}");
    // 计数：拉到才画，不回填 0（真·0 照常显示 0）。
    expect(tabs).toContain("{props.engagement ? <Text selectable style={styles.postActionCount}>{props.engagement.replies}</Text> : null}");
  });

  it("has exactly one comment affordance", () => {
    // 原来动作行下面还有一行独立的「💬 N 条评论 ﹀」开关。动作行第 2 颗现在**就是**
    // 这个开关（原型也把评论数画在动作行里），留着那行 = 同屏两个评论入口、隔 8px
    // 说同一个数字。`︿` / `﹀` 是那一行独有的字符，拿它当反向臂
    // （同一件事在 profile-post-replies.test.ts 里另有一条文案臂，两处互相独立）。
    expect(code).not.toContain('{props.repliesExpanded ? "︿" : "﹀"}');
  });

  it("never expands into a silent nothing", () => {
    // 展开成功但一条评论都没有时必须有句话，否则点完 💬 屏幕上什么都不变，
    // 看起来像按钮坏了。而且只在**确实拉到过**之后才敢说 —— 不能把「还没读到」
    // 说成「没有」（这是这个文件一贯的口径：失败 / 未加载 ≠ 空）。
    expect(tabs).toContain("<Text selectable style={styles.postReplyEmpty}>还没有评论</Text>");
    expect(tabs).toMatch(/props\.replies === undefined \? null : \(\s*<Text selectable style=\{styles\.postReplyEmpty\}>/);
  });

  it("hides the comment button when there is no comment channel", () => {
    // 没接 engagementClient（游客 / 没传 engagement）就没有评论通道 ⇒ 两个调用点
    // 都不传 handler，PostCard 那颗 💬 整颗不画 —— 不摆一颗按不动的按钮。
    expect(tabs).toMatch(/onToggleReplies=\{props\.engagementClient \? \(\) => togglePostReplies\(post\.postId\) : undefined\}/);
    expect(tabs).toContain("onToggleReplies={props.engagementClient ? () => { const pinned = props.pinnedPost;");
  });
});
