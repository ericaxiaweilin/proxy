import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// POST-THREAD-001（2026-09-28）：三轮修正，见 feed.tsx 里同名注释的完整历史。
//
// 第一轮（用户「没那么简单 x threads 点击评论 会单独跳全部评论页 我们照着学
// 吧」）：点「评论」以前是就地内联展开一个可以 swipe-down / 点非输入框收起的
// 输入框（REPLY-INLINE-001 / REPLY-DRAFT-CACHE-001 / REPLY-DRAFT-CACHE-002）。
// 改成了跳转一个带返回箭头的独立整屏页面——错的。
//
// 第二轮（用户「没做对 做的一踏糊涂」+ 原型 proxy_comment_keyboard_v2.html）：
// 整屏页面改成了从底部弹起的抽屉（Modal + 遮罩，同 PostMenuModal 写法），但
// 又手多加了"整帖内容 + 全部评论"塞进抽屉——还是错的，原型的抽屉只有"拖动
// 把手 + 输入框"。
//
// 第三轮（用户「点击评论 弹出整个帖文和输入框 输入重复...没有数字按键 直接
// 输入框」，追问后确认用系统真键盘，不照抄原型的自绘 26 键假键盘，也不画
// 图片/表情/GIF 三个没有真能力支撑的工具图标）：删掉抽屉里的整帖回顾 + 评论
// 列表，只留拖动把手 + 输入药丸 + 发送键，高度跟内容走（不再是给假键盘留位
// 置的固定 60vh），键盘交给系统。
//
// ⚠️ 本仓库没有 React 渲染器（无 .test.tsx、无 @testing-library/react-native、
// 无 react-test-renderer、无 vitest config），所以只能钉到源码级 —— 真正的
// 键盘避让 / 弹起动画需要在模拟器上确认。

const SRC_PATH = join(__dirname, "surfaces", "feed.tsx");
const feed = readFileSync(SRC_PATH, "utf8");

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

/**
 * 从 src 里找到 `function NAME(` 第一次出现的位置，跳过参数列表（包括参数里的类型
 * 注解 `{...}`），找到函数体的 `{`，然后数平衡的花括号，截到匹配的 `}` 为止。
 * 返回包含签名 + 函数体的整段文本。找不到返回 ""。
 */
function extractFunctionBody(src: string, name: string): string {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) return "";
  let i = start + sig.length;
  let parenDepth = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "(") parenDepth++;
    else if (c === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        i++;
        while (i < src.length && src[i] !== "{") i++;
        if (i >= src.length) return "";
        let depth = 0;
        for (; i < src.length; i++) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
          }
        }
        return "";
      }
    }
    i++;
  }
  return "";
}

/** 截取 [startMarker 第一次出现, endMarker 在其后第一次出现) 之间的原文，找不到返回 ""。 */
function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start === -1) return "";
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (end === -1) return "";
  return src.slice(start, end);
}

const cleaned = stripComments(feed);
// 评论抽屉那段 JSX：从它的开始标记截到下一个姊妹 Modal（PostMenuModal）为止。
const threadSheet = sliceBetween(cleaned, "<Modal animationType=\"slide\" onRequestClose={closeThread}", "<PostMenuModal");

describe("POST-THREAD-001：评论抽屉只有拖动把手+输入框（对齐原型），不重复帖文/评论列表，不是整屏页面", () => {
  it("/ 1：评论按钮走 openThread，openReplies 这个旧名字已经不存在了", () => {
    expect(cleaned).toMatch(/onPress=\{\(\) => openThread\(post\.postId\)\}/);
    expect(cleaned, "openReplies 应该已经被 openThread 取代").not.toMatch(/openReplies/);
  });

  it("/ 2：草稿缓存形状不变——模块作用域声明，带 savedAt 时间戳；10 分钟 TTL 常量还在", () => {
    expect(cleaned).toMatch(
      /^let cachedReplyDrafts:\s*Record<string,\s*\{\s*text:\s*string;\s*savedAt:\s*number\s*\}>\s*=\s*\{\}/m
    );
    expect(cleaned).toMatch(/const REPLY_DRAFT_TTL_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
  });

  it("/ 3：openThread 只负责打开抽屉 + 回填/过期判断草稿——不再拉全部评论（抽屉不展示旧评论）", () => {
    const body = extractFunctionBody(cleaned, "openThread");
    expect(body, "找不到 openThread 函数体").not.toBe("");
    expect(body, "openThread 不该再拉评论列表——抽屉只负责写新评论").not.toMatch(/listPostReplies/);
    expect(body, "没有判断缓存是否还在 TTL 内").toMatch(/Date\.now\(\)\s*-\s*cached\.savedAt\s*<\s*REPLY_DRAFT_TTL_MS/);
    expect(body, "过期草稿没有被删除").toMatch(/delete cachedReplyDrafts\[postId\]/);
    expect(body, "打开抽屉没有 setThreadPostId").toMatch(/setThreadPostId\(postId\)/);
  });

  it("/ 4：persistReplyDraft 带时间戳写入、空草稿删除", () => {
    const persistBody = extractFunctionBody(cleaned, "persistReplyDraft");
    expect(persistBody, "persistReplyDraft 函数体找不到").not.toBe("");
    expect(persistBody, "没有带 savedAt 时间戳写入").toMatch(/savedAt:\s*Date\.now\(\)/);
    expect(persistBody, "没有删除空草稿的分支").toMatch(/delete cachedReplyDrafts\[postId\]/);
  });

  it("/ 5：closeThread（点遮罩关闭抽屉）用 persistReplyDraft 保留非空草稿，不再需要 keepDraft 选项", () => {
    const body = extractFunctionBody(cleaned, "closeThread");
    expect(body, "closeThread 函数体找不到").not.toBe("");
    expect(body, "closeThread 没有用 persistReplyDraft 保留非空草稿").toMatch(/persistReplyDraft\(id,\s*replyDraft\)/);
    expect(body, "closeThread 不该再有 keepDraft 这个选项了——发送成功不再靠它清草稿").not.toMatch(/keepDraft/);
    expect(body).toMatch(/setThreadPostId\(null\)/);
    expect(body).toMatch(/setReplyDraft\(\s*["']{2}\s*\)/);
  });

  it("/ 6：submitReply 发完留在抽屉里（不再退出），仍然刷新评论计数/预览给背后的动态列表用", () => {
    const body = extractFunctionBody(cleaned, "submitReply");
    expect(body, "submitReply 函数体找不到").not.toBe("");
    expect(body, "submitReply 应该用 threadPostId 而不是旧的 replyTargetId").toMatch(/if \(!threadPostId/);
    expect(body, "发送后应该刷新一次评论（更新动态列表里的评论数/预览），按服务端上限 50 拉").toMatch(
      /listPostReplies\(postId,\s*50\)/
    );
    expect(body, "发送成功后不该再调 closeThread —— 应该留在抽屉里").not.toMatch(/closeThread/);
    expect(body, "发送成功后不该清 threadPostId —— 应该留在抽屉里").not.toMatch(/setThreadPostId\(null\)/);
    expect(body, "已经发出去的草稿要删掉，不再当草稿保留").toMatch(/delete cachedReplyDrafts\[postId\]/);
  });

  it("/ 7：旧的内联收起机制（swipe-down PanResponder / 失焦收起）已经整段删除", () => {
    expect(cleaned, "PanResponder 不该再被 react-native 导入了 —— 抽屉靠点遮罩关闭，不需要 swipe 手势").not.toMatch(
      /import\s*\{[^}]*\bPanResponder\b[^}]*\}\s*from\s*["']react-native["']/
    );
    expect(cleaned, "replyPanResponder 应该已经删掉").not.toMatch(/replyPanResponder/);
    expect(cleaned, "handleReplyInputBlur 应该已经删掉——抽屉的关闭只有点遮罩这一条路").not.toMatch(
      /handleReplyInputBlur/
    );
    expect(cleaned, "旧的内联输入框样式（inlineReply*）应该已经删掉").not.toMatch(/inlineReply(Handle|Input|Actions|Send)?:/);
    expect(cleaned, "旧的整屏页面头部样式（threadHeader/threadBack）应该已经删掉——抽屉没有返回箭头/标题栏").not.toMatch(
      /threadHeader:|threadBack:/
    );
  });

  it("/ 7b：autoFocus 单打一次不可靠——Modal 打开后延迟兜底手动 focus 一次", () => {
    expect(cleaned, "没有 threadInputRef 这个 ref").toMatch(/const threadInputRef = useRef<TextInput>\(null\)/);
    expect(cleaned, "没有延迟兜底调用 threadInputRef.current?.focus()").toMatch(
      /setTimeout\(\(\) => threadInputRef\.current\?\.focus\(\), 350\)/
    );
    expect(threadSheet, "TextInput 没有接上 threadInputRef").toMatch(/ref=\{threadInputRef\}/);
  });

  it("/ 8：renderPostCard 没有被塞进抽屉——评论抽屉不重复回顾帖文/评论列表", () => {
    expect(threadSheet, "找不到评论抽屉这段 <Modal>...</Modal> 的渲染代码").not.toBe("");
    expect(threadSheet, "抽屉不该再调用 renderPostCard 回顾整条帖子——跟背后的动态列表重复").not.toMatch(
      /renderPostCard\(/
    );
    expect(threadSheet, "抽屉不该再渲染评论列表——原型的抽屉只有输入框").not.toMatch(/[Rr]eplies\.map\(|\(reply\) =>/);
    expect(threadSheet, "抽屉不该再有固定 60vh 高度——高度应该跟着内容（拖动把手+输入框）走").not.toMatch(
      /windowHeight/
    );
  });

  it("/ 9：评论抽屉是 Modal + 遮罩，不是整屏页面——点遮罩关闭，点抽屉内部不关闭；键盘用系统真键盘", () => {
    expect(threadSheet, "Modal 应该是 transparent + slide，跟 PostMenuModal/SharePostSheet 同一套写法").toMatch(
      /transparent visible=\{threadPost !== undefined\}/
    );
    expect(threadSheet, "遮罩没有接上 closeThread").toMatch(/onPress=\{closeThread\}[^}]*style=\{styles\.threadBackdrop\}/);
    expect(threadSheet, "抽屉内部的 Pressable 没有 stopPropagation——点抽屉内部会被误关闭").toMatch(
      /onPress=\{\(event\) => event\.stopPropagation\(\)\}/
    );
    expect(threadSheet, "输入框没有 autoFocus——应该聚焦就弹系统键盘").toMatch(/autoFocus/);
    expect(threadSheet, "不该给 TextInput 设 keyboardType——应该用默认的系统键盘").not.toMatch(/keyboardType/);
    expect(threadSheet, "抽屉里不该有返回按钮——关闭只靠点遮罩").not.toMatch(/accessibilityLabel="返回"/);
    expect(threadSheet, "抽屉顶部应该有一个拖动把手（纯视觉，跟原型一致，不需要接手势）").toMatch(
      /threadDragHandle/
    );
  });

  it("/ 10：发送键是图标不是文字，忙态用 loading", () => {
    expect(threadSheet, "发送键不是 ProxyIcon arrowUp 图标").toMatch(/name="arrowUp"/);
    expect(threadSheet, "发送中没有用 ProxyLoading，还在显示文字").toMatch(/ProxyLoading/);
    expect(threadSheet, "抽屉的发送按钮不该再显示「发送」/「发送中…」这种纯文字").not.toMatch(
      />\s*发送(中…)?\s*</
    );
  });

  it("/ 10b：输入药丸右侧有原型的图片/表情/GIF 三个图标；表情是真能用的，图片进相册，GIF 点了如实说明", () => {
    const pill = sliceBetween(threadSheet, "styles.threadComposerPill", "styles.threadComposerSend");
    expect(pill, "找不到输入药丸").not.toBe("");
    const tools = ["composerImage", "composerSmile", "composerGif"].map((name) => pill.indexOf(`name="${name}"`));
    expect(tools.every((index) => index >= 0), "药丸里缺了图片/表情/GIF 某个图标").toBe(true);
    expect(tools, "三个图标要按原型顺序：图片 → 表情 → GIF").toEqual([...tools].sort((a, b) => a - b));
    expect(pill.indexOf("<TextInput"), "图标要在输入框右边（原型 .right-tools）").toBeLessThan(tools[0]!);
    // 表情是真的：弹出快捷表情行，点了插进草稿。
    expect(pill).toMatch(/setThreadEmojiOpen\(\(open\) => !open\)/);
    expect(threadSheet).toMatch(/THREAD_QUICK_EMOJI\.map/);
    expect(threadSheet).toMatch(/setReplyDraft\(\(draft\) => draft \+ emoji\)/);
    // REPLY-IMAGE-001：图片按钮进相册（不再弹纯文字提示），GIF  still 如实提示。
    expect(pill).toMatch(/openReplyAlbum/);
    expect(pill.match(/setThreadNotice\(THREAD_TEXT_ONLY_NOTICE\)/g)?.length, "只剩 GIF 按钮给出提示").toBe(1);
    expect(cleaned).toMatch(/const THREAD_TEXT_ONLY_NOTICE = "评论暂时只能发文字/);
  });

  it("/ 10c：评论图片全链路——相册多选、上传后带媒体引用发送、行内缩略图可点开大图", () => {
    // 相册：只收 IMAGE，多选上限与契约 max(6) 同口径。
    expect(cleaned).toMatch(/MediaType\.IMAGE/);
    expect(cleaned).toMatch(/REPLY_IMAGE_MAX = 6/);
    // 发送：逐张 uploadImage，mediaAssetId 按序进 replyToPost。
    expect(cleaned).toMatch(/mediaClient\.uploadImage/);
    // 相册浮层必须铺全屏：KAV 撑满 + 内容沉底（否则浮层被压成一条缝）。
    expect(cleaned).toMatch(/threadAvoid/);
    // 开相册先收键盘（键盘是系统窗口，不收会盖住相册浮层）。
    expect(cleaned).toMatch(/threadInputRef\.current\?\.blur\(\)/);
    expect(cleaned).toMatch(/engagement\.replyToPost\(postId, body, refs\)/);
    // 行渲染 + 大图查看。
    expect(cleaned).toMatch(/reply\.media/);
    expect(cleaned).toMatch(/openReplyViewer/);
    expect(cleaned).toMatch(/<ImageViewing/);
  });

  it("/ 11：评论抽屉里一直没有「取消」按钮（不动 PostMenuModal 自己的取消按钮）", () => {
    expect(threadSheet, "抽屉里出现了「取消」按钮").not.toMatch(/>\s*取消\s*</);
    // 反向：PostMenuModal 的「取消」按钮不能被一起误删
    expect(cleaned, "误伤：PostMenuModal 的取消按钮没了").toMatch(
      /postMenuStyles\.cancelText[^}]*\}\s*>\s*取消\s*</
    );
  });
});
