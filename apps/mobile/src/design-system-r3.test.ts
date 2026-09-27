import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/.test(entry)
        ? [path]
        : [];
  });
}

// R15.67: R2 参考设计允许的装饰元素白名单 (头像字符 / 链接装饰行 / 数字加粗 / status bar 模拟).
// 装饰 (avatar 字符, dot, 数字加粗) 不是 UI text, 11pt+ 强校验只针对真文字.
const R2_DECORATION_WHITELIST: ReadonlyArray<string> = [
  "personalAvaLetter",    // 头像 1-2 字符装饰
  "personalFaceText",     // 关注者头像堆叠装饰
  "personalLinkText",     // 链接装饰行 (handle 名也是装饰)
  // BACK-GLYPH-001（2026-09-26）：原条目 "personalTopbarIcon"（顶栏返回箭头 21pt 装饰）
  // 已删 —— 那个样式本身是给 `‹` 那份 Text 用的，字形换成 ProxyBackGlyph 之后它就没了。
  // 条目删掉前实测过：违规集合与删前**完全一致**（22 条，全在 my-benefits），
  // 所以它不是「靠子串蹭豁免」的条目（它同时是 personalTopbarIconBtn 的子串）。
  "personalMetaDot",      // 装饰 dot (无 fontSize, 占位)
  "personalFace",         // 头像背景 (无 font)
  "personalAvaAdd",       // 头像 + 浮层 (无 font)
  "personalStatValue",    // 浏览数数字加粗 (装饰 数字)
  "personalFollowersValue", // 关注数数字加粗 (装饰数字)
  // R15.96: scene map entry eyebrow ("SCENE MAP · 河内") — 8pt 装饰，跟 personalAvaLetter 同类
  "sceneMapEyebrow",
  // R15.76: R1 AI Identity System PRD — 头像下 AI 徽章 (frontstage 透明度义务).
  //   9pt "AI" 字符跟 personalAvaLetter 同类装饰.
  "aiAuthorBadgeText",
  // R37 market redesign (Proxy_Market_R37_4_Exact_Approved_Order_Logos.html):
  //   high-density opportunity card and type palette. The 6.5-10.5pt scale
  //   is matched to the approved visual (390px phone frame), not the
  //   R2 personal-profile readable-text scale. Same exclusion pattern
  //   as sceneMapEyebrow.
  "thumbInitial",
  "typeMetaLabel",
  "typeMetaTitle",
  "fitTagText",
  "oppTitle",
  "metaText",
  "why",
  "priceLabel",
  "priceValue",
  "priceNegotiable",
  "takeBtnText",
  "pillLabel",
  "pillLabelActive",
  "pillSub",
  // AI-TWIN-SHOWCASE-STRIP-001（2026-09-21）删过一轮 R1 静态 showcase；
  // AI-TWIN-SHOWCASE-STRIP-002（2026-09-22，用户对照原型复盘："这些都是
  // 后端的，并不是做到 app 里的"）删掉了 STRIP-001 留下的「我的分身」
  // 列表/创建表单/「数据模型」弹层/Human Confirm Gate 说明——原型
  // （小美 · AI 分身受众调度版）这屏只有图库/帖文编排/好友运营三段，
  // 没有分身管理或架构说明。对应的 ruleActionText/ruleReason/archSub/
  // archCode/persona*/coldCardSub/confirmBox* 白名单条目随样式一起删除，
  // 不留死条目。
  //
  // AI-TWIN-SHOWCASE-STRIP-002 裁剪的订正（2026-09-22）：
  //
  // 上面那轮按「样式删了就把白名单条目一起删」清掉 86 条 —— 其中 76 条确实是
  // 死条目（那些删除保留），但另有 5 处 10pt 装饰原本是「蹭」邻近死条目的豁免：
  // 条目一删就露出来，于是 3 个**本轮完全没碰过**的文件冒出 5 处假红
  // （business-home ×3 / feed / merchant-me-r21-replacement）。
  //
  // 这里不把死条目加回来（那会让白名单里重新出现「为什么它在这」的条目），
  // 改成**按样式自己的键名列** —— 豁免从此是明写的，也不怕这几个 style 块
  // 换顺序。逐条对应它豁免的那处 10pt：
  //   signalLabel           business-home.tsx 信号卡标签
  //   signalSub             business-home.tsx 信号卡副标签
  //   inlinePlanEyebrow     business-home.tsx 方案眉标（与 sceneMapEyebrow 同类）
  //   aiBadge               feed.tsx「AI 生成」徽标（与 aiAuthorBadgeText 同类）
  //   caption               merchant-me-r21-replacement.tsx —— 见下
  //
  // ⚠️ caption 是这 5 条里唯一存疑的：它只有 2 个文件定义成样式，但全仓有 13 个
  // 文件出现过这个子串（本套豁免是「按名字全局匹配 + 800 字符回看窗口」），
  // 而且它是个 lineHeight 15 的正文型 caption，不像纯装饰。这里先按「恢复 HEAD
  // 的绿」列上，但它应该由设计侧复核一次：要么提到 11pt，要么确认它就是装饰。
  "signalLabel",
  "signalSub",
  "inlinePlanEyebrow",
  "aiBadge",
  "caption",
  // SCENE-CATEGORY-BADGE-001 / SCENE-HOME-PROTOTYPE-001: scene-shop-directory
  // card cover badge and match-card eyebrow — same "short pill/eyebrow over
  // an image" decoration as sceneMapEyebrow/inlinePlanEyebrow, not body text.
  "coverBadgeText",
  "matchLabelText",
  // GROWTH-REAL-DATA-001: my-benefits.tsx tier/growth dashboard — short
  // badges, eyebrows and bold value pills, same categories as the R37
  // priceValue/pillLabel and sceneMapEyebrow entries above (not paragraphs
  // a user reads start-to-end).
  "heroBadge",
  "heroStatLabel",
  "todayKicker",
  "todayCount",
  "benefitLock",
  "benefitRowValue",
  "taskGroupLabel",
  "taskReward",
  "taskProgress",
  "taskDoneBadge",
  "tierCardBadge",
  "sectionTitleHint"
];

describe("Proxy Design System R3 typography", () => {
  it("keeps readable UI text at 11pt or larger (R2 decoration whitelist excluded)", () => {
    const violations = ["components", "surfaces"].flatMap((directory) =>
      sourceFiles(join(sourceRoot, directory)).flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return [...source.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)]
          .filter((match) => Number(match[1]) < 11)
          // 读取 5-8 行内上下文, 检查该 fontSize 是否属于 R2 装饰白名单
          .filter((match) => {
            const start = Math.max(0, (match.index ?? 0) - 800);
            const context = source.slice(start, (match.index ?? 0) + 200);
            return !R2_DECORATION_WHITELIST.some((name) => context.includes(name));
          })
          .map((match) => `${path.slice(sourceRoot.length + 1)}:${match.index}:${match[0]}`);
      })
    );

    expect(violations).toEqual([]);
  });

  // R15.67 → PERSONAL-PROFILE-PARITY-001 订正：commit 8404d51 把头部从
  // row 改回 column，理由是"原始设计头像在左名字在下"——实测参考稿
  // (proxy_personal_profile_architecture_v5_threads.html，本人视角) 头部
  // 是名字在左、头像在右的一行，8404d51 的假设是错的，是它自己才是
  // regression。这条断言按参考稿钉回 row + gap 16，场景足迹入口挪出这一行
  // （参考稿本来就没有这个功能，不该跟头像/名字抢位置）。
  it("keeps Threads R2 personal profile header layout", () => {
    const mePath = join(sourceRoot, "surfaces", "me.tsx");
    const stylesPath = join(sourceRoot, "surfaces", "me-styles.ts");
    const source = readFileSync(mePath, "utf8") + "\n" + readFileSync(stylesPath, "utf8");
    // personalHead: 1fr 86px 等价 = flexDirection row + gap + 86px ava wrap
    expect(source).toMatch(/personalHead:\s*\{[\s\S]*?flexDirection:\s*"row"[\s\S]*?gap:\s*16/);
    // ava 86px 区域
    expect(source).toMatch(/personalAvaWrap:\s*\{[\s\S]*?width:\s*82/);
    // ava + 浮层 (Threads R2 .add 32x32 浮在 -6 -2)
    expect(source).toMatch(/personalAvaAdd:\s*\{[\s\S]*?position:\s*"absolute"/);
    // STAT-ROW-TIGHT-001（2026-09-25，用户对照原型）：参考稿统计行是
    // `display:flex; gap:18px` —— 左对齐、两个数字挨着。不许再用 space-between
    // 把它们顶到屏幕左右两边（一行里隔几百像素，读起来像两个不相干的指标）。
    expect(source).toMatch(/personalStatRow:\s*\{[^}]*gap:\s*18/);
    expect(source.match(/personalStatRow:\s*\{[^}]*\}/)?.[0] ?? "").not.toContain("space-between");
  });

  // PROFILE-HEAD-PARITY-001（2026-09-23）：上面那条只钉了「我的 → 个人主页」。
  // 从「动态 → 点帖文头像 → 主页」进来的那一份（other-profile.tsx）当时还是
  // 头像在左、名字在右的老布局 —— 同一个 App 里两条路进到「一个人的主页」
  // 却长得不一样，而且**没有任何断言会红**，所以它一直没人发现。这里把同一条
  // 不变量钉到第二条路上：名字在左、头像在右的一行 + 82 圆头像（与 me-styles
  // personalAvaWrap 同值）+ 头部下面是「关注 / 粉丝」统计行。
  it("keeps the same Threads R2 header on the profile reached from the feed", () => {
    const otherPath = join(sourceRoot, "surfaces", "other-profile.tsx");
    const other = readFileSync(otherPath, "utf8");
    // 名字/头像同一行 + gap 16（= me-styles personalHead）
    expect(other).toMatch(/head:\s*\{[\s\S]*?flexDirection:\s*"row"[\s\S]*?gap:\s*16/);
    // 头像 82px（= me-styles personalAvaWrap）
    expect(other).toMatch(/avatarWrap:\s*\{[\s\S]*?width:\s*82/);
    // 名字块必须在头像之前 —— 顺序反了就是回到「头像在左」的老布局。
    // 两个标记串都只在 JSX 里出现（styles 表里是 headCopy:{ / avatarWrap:{）。
    const nameAt = other.indexOf("styles.headCopy");
    const avatarAt = other.indexOf("styles.avatarWrap");
    expect(nameAt, "styles.headCopy should be rendered").toBeGreaterThan(-1);
    expect(avatarAt, "styles.avatarWrap should be rendered").toBeGreaterThan(-1);
    expect(nameAt, "名字块要排在头像前面").toBeLessThan(avatarAt);
    // 参考稿头部下面是「关注 / 粉丝」两格
    expect(other).toContain("</Text> 关注</Text>");
    expect(other).toContain("</Text> 粉丝</Text>");
    // 计数没拉到画「—」，不回填 0（0 读起来是「没人关注他」）
    expect(other).toContain("function countLabel(value: number | undefined): string");
    // STAT-ROW-TIGHT-001：统计行也要挨着（与 me-styles personalStatRow 同形），
    // 两条路的间距规则必须一样，否则又变成「同一个 App 两个长相」。
    expect(other).toMatch(/statRow:\s*\{[^}]*gap:\s*18/);
    expect(other.match(/statRow:\s*\{[^}]*\}/)?.[0] ?? "").not.toContain("space-between");
  });

  // MAP-FOOTPRINT-LOGO-001：个人主页场景足迹入口用原型「场景足迹」logo，
  // 不再用通用 route 图标（形状见 proxy-icon.tsx footprint，几何照抄原型）。
  it("keeps the prototype footprint logo on the personal scene entry", () => {
    const mePath = join(sourceRoot, "surfaces", "me.tsx");
    const source = readFileSync(mePath, "utf8");
    const entry = source.match(/personalSceneEntry[\s\S]*?<Text selectable style=\{styles\.personalSceneChevron\}>/)?.[0] ?? "";
    expect(entry, "personalSceneEntry should exist").not.toBe("");
    expect(entry).toContain('name="footprint"');
    expect(entry).not.toContain('name="route"');
  });

  // PROFILE-TAB-LOGO-001（2026-09-25，用户「还有 logo 要对齐原型」）：个人主页的
  // tab 图标是原型 deepseek_html_20260925_4e54a0.html 那一套 —— 帖子 = 圆角方框 +
  // 十字分隔、回复 = 气泡、标签 = 同心圆、关于 = ⓘ。
  // 这条钉的是**形状的来源**：改之前 帖子/回复 都是 sparkle/spark（同一颗星画两遍），
  // 关于 是空心圆 ring —— 三个字形跟标签毫无关系，而且**没有任何断言会红**，
  // 所以一直漂着没人发现。
  it("keeps the profile tab glyphs on the prototype vocabulary", () => {
    const ptPath = join(sourceRoot, "surfaces", "ProfileTabs.tsx");
    const source = readFileSync(ptPath, "utf8");
    const table = source.match(/const PROFILE_TAB_ICON[\s\S]*?\n\};/)?.[0] ?? "";
    expect(table, "PROFILE_TAB_ICON 应该还在").not.toBe("");
    expect(table).toMatch(/POSTS:\s*"postsGrid"/);
    expect(table).toMatch(/REPLIES:\s*"replyBubble"/);
    expect(table).toMatch(/TAGGED:\s*"target"/);
    expect(table).toMatch(/ABOUT:\s*"infoCircle"/);
    // 语义错位的旧字形不许回来（`"spark"` 也会命中 `"sparkle"`，两向都守住）
    expect(table).not.toMatch(/POSTS:\s*"sparkle"/);
    expect(table).not.toMatch(/REPLIES:\s*"spark"/);
    expect(table).not.toMatch(/ABOUT:\s*"ring"/);
    // ⚠️ REPLIES 不许退回 chat：chat 是**方角**气泡，原型是**圆形**对话气泡。
    // 第一轮就是误用了 chat，用户第二轮当场指出「回复的 logo 还是不符合原型」。
    expect(table).not.toMatch(/REPLIES:\s*"chat"/);
  });

  // REPLY-ROW-FORMAT-001（2026-09-25，用户「回复的格式」对齐原型）：原型回复行 =
  // 左头像 + 右一列（名字/@handle → 「回复了 X 的帖子 · 时间」→ 正文）。
  // 守的是**这一行有作者块**，不是某个词 —— 没有头像/名字时一屏回复看不出是谁发的。
  it("keeps the reply row shaped like the prototype feed item", () => {
    const ptPath = join(sourceRoot, "surfaces", "ProfileTabs.tsx");
    const source = readFileSync(ptPath, "utf8");
    // replyCard 必须是「左头像 + 右一列」的横向结构（原型 .feed-item{display:flex}）
    expect(source).toMatch(/replyCard:\s*\{[^}]*flexDirection:\s*"row"/);
    expect(source).toMatch(/replyAvatar:\s*\{[^}]*width:\s*36/);
    expect(source).toMatch(/replyBody:\s*\{[^}]*flex:\s*1/);
    // 作者块三个字段都要渲染出来（头像 / 名字 / @handle）。
    // ⚠️ 别用裸 toContain("styles.replyAvatar") —— 它同样命中 styles.replyAvatarText，
    // 把头像整块删掉都不会红（反向验时抓到的假绿）。这里断言 JSX 形状。
    expect(source).toMatch(/<View style=\{styles\.replyAvatar\}>/);
    expect(source).toMatch(/style=\{styles\.replyName\}/);
    expect(source).toMatch(/style=\{styles\.replyHandle\}/);
    // handle 空串时不渲染 —— 一个光秃秃的 "@" 比没有更糟
    expect(source).toContain("const atHandle = props.handle.replace(/^@+/, \"\").trim();");
    // 上下文行（回复了谁 · 时间）和正文仍在，且排在作者块里面
    expect(source).toMatch(/styles\.replyHead\}>[\s\S]*?styles\.replyName[\s\S]*?styles\.replyHandle/);
    // 上下文行（回复了谁 · 时间）仍走 reply-target.ts 的共享分段器，且**名字段
    // 必须单独上墨色**（REPLY-TARGET-NAME-INK-001：原型是「回复了 Linh 的帖子」，
    // Linh 是黑的）。以前整句一个 <Text>（styles.replyTarget 只有 #94a3b8），
    // 名字跟着一起变灰 —— 用户 2026-09-25 报的正是这个。
    expect(source).toMatch(/styles\.replyMeta[\s\S]*?replyTargetParts\(/);
    expect(source).toMatch(/<Text selectable style=\{styles\.replyTargetName\}>\s*\{targetParts\.name\}\s*<\/Text>/);
    expect(source).toMatch(/replyTargetName:\s*\{[^}]*color:\s*"#0f172a"/);
    // 圆气泡字形真的存在（不是只改了映射表却没实现字形）
    const icon = readFileSync(join(sourceRoot, "components", "proxy-icon.tsx"), "utf8");
    expect(icon).toMatch(/case\s*"replyBubble":/);
    expect(icon).toContain('d="M21 11.5a8.38 8.38 0 0 1-.9 3.8');
  });

  // REPLY-ACTION-ICONS-001（2026-09-25，用户「这几个 logo 没有对齐设计的」）：
  // 原型回复行底部是 4 个 Feather svg（♡/💬/↻/⤴）。守的是**形状就位**：4 个
  // 字形、放在 replyActions 行里、最后一个 share 顶到行尾（marginLeft:auto）。
  // 不守 handler / 计数 —— ReplyEntry 没数据，按 PROFILE-REPLIES-VISIBLE-001
  // 不渲染假按钮、也不渲染假数字，等后端有接口再加 Pressable。
  it("keeps the reply row action glyphs on the prototype Feather vocabulary", () => {
    const ptPath = join(sourceRoot, "surfaces", "ProfileTabs.tsx");
    const source = readFileSync(ptPath, "utf8");
    const icon = readFileSync(join(sourceRoot, "components", "proxy-icon.tsx"), "utf8");
    // ProfileTabs 端：replyActions 行容器 + 4 个图标组件 + share 顶到行尾
    expect(source).toMatch(/replyActions:\s*\{[^}]*flexDirection:\s*"row"/);
    expect(source).toMatch(/<View style=\{styles\.replyActions\}>/);
    expect(source).toMatch(/name="replyLike"/);
    expect(source).toMatch(/name="replyBubble"\s+color=\{props\.color\.muted\}/);
    expect(source).toMatch(/name="replyRepost"/);
    expect(source).toMatch(/<View style=\{styles\.replyActionsSpacer\}/);
    expect(source).toMatch(/name="replyShare"/);
    // 三个新字形在 proxy-icon 里真存在（含 prototype 路径）
    expect(icon).toMatch(/case\s*"replyLike":/);
    expect(icon).toMatch(/case\s*"replyRepost":/);
    expect(icon).toMatch(/case\s*"replyShare":/);
    expect(icon).toContain('M20.84 4.61a5.5 5.5 0 0 0-7.78 0');
    expect(icon).toContain('M17 1l4 4-4 4');
    expect(icon).toContain('M16 6l-4-4-4 4');
  });

  // BACK-BTN-INK-001（2026-09-25，用户「< 返回 黑色字体」）：他人主页顶栏的
  // 返回按钮**应该是黑色不是粉色**：原型的顶栏返回就是 ink 色，brand pink
  // 只用在主操作（关注 / 已关注）。
  //
  // BACK-GLYPH-001（2026-09-26，用户「把所有页面的返回 < 这个logo统一颜色 大小 形状」）：
  // 这条钉原来还兼职守字形 —— 断言源码里写的是 `{"< 返回"}`（less-than），而不是
  // `‹ 返回`（curly left angle）。但那**不是统一字形，只是换了一个字符**：`<` 和 `‹`
  // 都是文本字符，形状/粗细/基线随 fontSize 漂，谁都能再换第三个（全 App 当时就是
  // 十一种尺寸、九种颜色、三种字符）。现在字形只有一处出处（ProxyBackGlyph 的
  // chevronLeft 描边路径），所以这条钉改守「用的是公共原语 + 源码里没有手写字符字形」。
  // 颜色那条原意不变：返回是 ink，不是 magenta —— 现在 tone 默认就是 ink，
  // magenta 连选项都不是（要显式写 tone="onDark" 才不是黑）。
  it("keeps the other-profile back button in ink, not brand magenta", () => {
    const opPath = join(sourceRoot, "surfaces", "other-profile.tsx");
    const source = readFileSync(opPath, "utf8");
    // 返回控件走公共原语，且**不显式指定 tone** ⇒ 落到默认 ink。
    expect(source).toContain('<ProxyBackGlyph label="返回" />');
    expect(source).not.toMatch(/<ProxyBackGlyph[^>]*tone=/);
    // 字形出处唯一：源码里不许再有手写的 `< 返回` / `‹ 返回`。
    expect(source).not.toContain('{"< 返回"}');
    expect(source).not.toContain("‹");
    // 也不许再留一份自己的返回文字样式（有 backText 就有第二个颜色出处）。
    expect(source).not.toMatch(/backText:\s*\{/);
  });

  // REPLY-ACTION-ICONS-001（配套）：消息按钮 `💬 消息` 改成 replyBubble svg +
  // 文字，与回复 tab 字形同源，emoji 退场。
  it("keeps the send-message button using the replyBubble glyph, not the emoji", () => {
    const ptPath = join(sourceRoot, "surfaces", "ProfileTabs.tsx");
    const source = readFileSync(ptPath, "utf8");
    // Pressable 里必须出现 replyBubble 图标组件 + 消息 文字（emoji 不许回来）
    expect(source).toMatch(/<ProxyIcon name="replyBubble"[^>]*\/>\s*<Text[^>]*>\s*消息\s*<\/Text>/);
    expect(source).not.toMatch(/>💬\s*消息</);
  });

  // R15.67: R2 actions 守门 (ProfileTabs) — 1px 边框 + 10 圆角 (R2 .actions button)
  it("keeps R2 action button styling on ProfileTabs", () => {
    const ptPath = join(sourceRoot, "surfaces", "ProfileTabs.tsx");
    const source = readFileSync(ptPath, "utf8");
    // actionBtn 必含 1px 边框 + 圆角 10
    expect(source).toMatch(/actionBtn:\s*\{[\s\S]*?borderWidth:\s*1[\s\S]*?borderRadius:\s*10/);
  });

  // R15.67: no-AI 守门 — 个人主页 (personalHub 段) 不应包含 老 R3 字眼
  // (proto / displayName / 已履约 / 可接单) — user 反馈 AI 味过重, 强守门.
  it("rejects R3 prototype design words in me.tsx personal hub", () => {
    const mePath = join(sourceRoot, "surfaces", "me.tsx");
    const source = readFileSync(mePath, "utf8");
    const personalHubMatch = source.match(/subPage\.route === "personalhub"[\s\S]*?(?=return contentWrapper)/);
    expect(personalHubMatch, "personalhub section should exist").toBeTruthy();
    if (personalHubMatch) {
      const section = personalHubMatch[0];
      expect(section, "禁止 prototype / protoBar / displayName R3 老字眼").not.toMatch(/prototype|protoBar|displayName/);
      expect(section, "禁止 已履约 / 可接单 R3 自创 meta").not.toMatch(/已履约|可接单/);
    }
  });
});

describe("DESIGN-CLEANUP-001 token discipline and shared primitives", () => {
  const readSrc = (rel: string): string => readFileSync(join(sourceRoot, rel), "utf8");

  it("exports ProxyLoading and ProxyEmptyState from the foundation", () => {
    const foundation = readSrc("components/proxy-foundation.tsx");
    expect(foundation).toContain("export function ProxyLoading");
    expect(foundation).toContain("export function ProxyEmptyState");
    // tone 必须显式传 —— 默认蒙混会把灰点染成品牌色。
    expect(foundation).toContain('tone: LoadingTone;');
    expect(foundation).toContain('"brand" | "onDark" | "onLight" | "violet" | "muted"');
  });

  it("keeps fully-migrated files free of hardcoded hex", () => {
    // 这 4 个文件已清零：再出现硬编码就是新欠账。其他文件仍有 B/C 档调色板，
    // 等设计拍板后再收，不在这里一刀切。
    for (const rel of [
      "components/registry.tsx",
      "components/TooltipOnLongPress.tsx",
      "surfaces/order-execution.tsx",
      "surfaces/outcome.tsx",
    ]) {
      const source = readSrc(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
      expect(source, `${rel} 又出现硬编码 hex`).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });

  it("keeps the dead order-type-logos assets deleted", () => {
    expect(statSync(join(sourceRoot, "assets", "order-type-logos"), { throwIfNoEntry: false })).toBeUndefined();
  });

  it("keeps superseded references out of the active baseline", () => {
    const baseline = JSON.parse(readFileSync(join(sourceRoot, "..", "..", "..", "docs", "design", "CURRENT_BASELINE.json"), "utf8")) as {
      screenReferences: Array<{ scope: string; status: string }>;
    };
    const zombies = baseline.screenReferences.filter((s) => s.status.startsWith("SUPERSEDED"));
    expect(zombies.map((s) => s.scope)).toEqual([]);
  });
});
