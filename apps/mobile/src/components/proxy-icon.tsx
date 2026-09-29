import { type StyleProp, StyleSheet, Text, type ViewStyle, View } from "react-native";
// Rect 是 SEC-CATEGORY-ICONS-002 的「全部（四宫格）」要用的：原型 02 那格画的是
// 四个 <rect x y width height rx>，用 Rect 才能把原型的坐标原样搬过来，不用手抄圆弧。
import Svg, { Circle, Path, Rect, Text as SvgText } from "react-native-svg";

// Android 的符号回退字体会把 ◎ / ◇ / ○ 等字形压得很小；这里使用固定画布，
// 让图标的可见面积和原型保持一致，不再依赖字体的 glyph metrics。
export type ProxyIconName =
  | "target"
  | "diamond"
  | "circle"
  | "ring"
  | "meRing"
  | "crosshair"
  | "home"
  | "check"
  | "sparkle"
  | "spark"
  | "arrowUpRight"
  | "arrowUp"
  | "chevronLeft"
  | "chevronRight"
  | "backArrow"
  | "close"
  | "plus"
  | "clock"
  | "star"
  | "coin"
  | "cup"
  | "ticket"
  | "wallet"
  | "settings"
  | "storefront"
  | "storeLines"
  | "profileRing"
  | "heart"
  | "route"
  | "pin"
  | "user"
  | "mail"
  | "chat"
  | "camera"
  | "microphone"
  | "image"
  | "infoCircle"
  | "qrGrid"
  | "postsGrid"
  | "replyBubble"
  | "replyLike"
  | "replyRepost"
  | "replyShare"
  | "composerImage"
  | "composerSmile"
  | "composerGif"
  | "ellipsis"
  | "search"
  | "chart"
  | "remix"
  | "editProfile"
  | "shareUp"
  | "aiPersona"
  | "bookmark"
  | "group"
  | "scan"
  | "mapFold"
  | "footprint"
  // FEED-MENU-ICONS-001：帖子「更多操作」菜单的 5 个行图标。此前是 emoji
  // （👎/🔉/🙈/🚫/⚠️），emoji 的字形/字重/基线全跟着系统字体走 ——
  // Android 与 iOS 画出来不是一套，字号一改还会变形（和 REPLY-ACTION-ICONS-001
  // 放弃 ♡/💬 字符的理由一样）。按原型 deepseek_html_20260926_fe2c4b.html
  // 「方案 B · 在菜单里的效果」那一节的 5 条描边路径原样移植。
  | "thumbDown"
  | "listMinus"
  | "personMinus"
  | "banCircle"
  | "alertTriangle"
  // SEC-CATEGORY-ICONS-001：原型 deepseek_html_20260926_9d241a.html 的 02
  // 「推荐 / 关注 / 动态 / 探索 / 分类」把「推荐」「关注」也定义成了有形状的图标
  // （推荐 = 五角星，关注 = 人 + 信号点）。同一套 32 栅格 / 描边 1.9。
  | "recommend"
  | "follow"
  // SEC-CATEGORY-ICONS-002（2026-09-26）：同一份原型 02 节里，「动态」「探索」
  // 也是**有形状**的分类字形（动态 = 同心圆 + 实心圆心，探索 = 罗盘指针）。
  // 而且它们和推荐 / 关注**画在同一屏**：分段控件那行（动态 / 探索）就在
  // tab 那行（推荐 / 关注）上面。这两行以前一个走 24 栅格 / 描边 2.2、一个走
  // 32 栅格 / 描边 1.9 —— 尺寸都写 16，渲染出来却是 1.47px vs 0.95px（差 1.55 倍），
  // 同屏看就是「上面一行粗、下面一行细」。所以按原型 02 把这两个字形补成 32 栅格，
  // 把分段控件那行一起拉进同一套系统。
  // ⚠️ **不动** target / cup 本身 —— 它们各有一堆别的调用点（target 在 me / ProfileTabs /
  //    FacetHomeSurface / 底栏等 15+ 处当通用标记用），改几何会牵连到别处。
  | "dynamicRing"
  // EXPLORE-RENAME-001：分段控件第二格的产品名从「咖啡场景」改成「探索」，字形换成
  // 原型 02 同一组里的**罗盘指针**。咖啡杯那个字形（上一条 commit 刚加的 `cafeCup`）
  // 只有这一处调用点 ⇒ 直接换名，不留死字形。
  // ⚠️ 原型 9d241a.html 的 02 节同时画了「探索」「咖啡场景」两个字形，但 06「真实场景
  //    组合」和首页预览里的第二格都还写着「咖啡场景」—— 原型那边还没跟着改名。
  | "explore"
  // 同一条原型 06「真实场景组合」里的**分类胶囊**那行（全部 / 人关系 / 机会需求 / 活动团体）。
  // 那行以前是纯文字 —— FilterChipRail 本来就有 icon 槽，feed 只是没传。
  // 这四个字形同样来自 02 节（全部 = 四宫格，人/关系 = 双人形，机会/需求 = 时钟 + 实心圆心，
  // 活动/团体 = 六边形双框），同一套 32 栅格 / 描边 1.9。
  | "allGrid"
  | "peoplePair"
  | "clockDot"
  | "hexGroup";

const symbolMap: Partial<Record<string, ProxyIconName>> = {
  "home": "home",
  "diamond": "diamond",
  "target": "target",
  "chat": "chat",
  "me-ring": "meRing",
  "ring": "ring",
  "cup": "cup",
  "profile-ring": "profileRing",
  "arrow-up-right": "arrowUpRight",
  "route": "route",
  "plus": "plus",
  "clock": "clock",
  "star": "star",
  "coin": "coin",
  "gear": "settings",
  "ticket": "ticket",
  "store-lines": "storeLines",
  "spark": "spark",
  "aiPersona": "aiPersona",
  "○": "ring",
  "◉": "target",
  "◎": "target",
  "◇": "diamond",
  "◈": "diamond",
  "⌖": "crosshair",
  "⌂": "home",
  "✓": "check",
  "✦": "spark",
  "↗": "arrowUpRight",
  "＋": "plus",
  "+": "plus",
  "◷": "clock",
  "₫": "coin",
  "⚙": "settings",
  "▣": "storeLines",
  "▤": "storeLines",
  "◫": "storeLines",
  "♙": "user",
  "✉": "chat",
  "券": "ticket",
  "P": "profileRing"
};

function MasterModuleIcon({ name, size, color, filled }: { name: ProxyIconName; size: number; color: string; filled?: boolean | undefined }): React.JSX.Element | null {
  const common = { fill: "none", stroke: color, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 2.2 };
  const filledCommon = { fill: color, stroke: color, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.4 };
  const canvas = (children: React.ReactNode): React.JSX.Element => (
    <Svg height={size} viewBox="0 0 24 24" width={size}>{children}</Svg>
  );
  // 原型 48 栅格的 logo（deepseek_html_20260923_5c4a22.html：折叠地图 /
  // 场景足迹）原样移植 —— 路径数据不动，只把 currentColor 换成 color prop，
  // 折叠地图右上角的状态圆点保持苹果绿 #34C759 不跟主题走。
  const canvas48 = (children: React.ReactNode): React.JSX.Element => (
    <Svg height={size} viewBox="0 0 48 48" width={size}>{children}</Svg>
  );
  // FEED-MENU-ICONS-001：原型 deepseek_html_20260926_fe2c4b.html 的菜单图标画在
  // **32 栅格**上、描边 1.9（不是 common 的 2.2，也不是 24 栅格）—— 跟 canvas48
  // 同一个理由：路径数据原样移植，不改坐标去凑现有网格，免得手抄缩放算错。
  // 描边按原型 1.9；渲染 26pt 时实际 = 1.9 × 26/32 ≈ 1.54px，比 tab 字形细一档，
  // 跟原型 .menu-icon svg{width:26px;height:26px;stroke-width:1.9} 一致。
  const common32 = { fill: "none", stroke: color, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.9 };
  const canvas32 = (children: React.ReactNode): React.JSX.Element => (
    <Svg height={size} viewBox="0 0 32 32" width={size}>{children}</Svg>
  );
  // BACK-GLYPH-001：返回箭头专用的**紧 box**。和 chevronLeft 是同一条路径，
  // 区别只在取景 —— chevronLeft 的 24 格 box 里箭头只占 x 9→15，两侧各 37.5% 是空白。
  // 返回控件是贴着表头左边缘排的，用带空白的 box 会整体往右缩 ~7pt（38 个表头的左对齐
  // 会一起漂），所以这里把 viewBox 收到箭头自己身上：
  //   描边后实际占 x 7.9→16.1、y 4.9→19.1（strokeWidth 2.2 的一半 = 1.1 外扩），
  //   再各留 0.5 余量免得圆头被裁 ⇒ 从 (7.4, 4.4) 起，宽 9.2、高 15.2。
  // 这个 box 以 x=12 对称（正好是箭头的中心），所以裸字形贴左边缘、塞进圆里也居中。
  // 注意 size 这里是**高**：宽按 9.2/15.2 算。
  const canvasBack = (children: React.ReactNode): React.JSX.Element => (
    <Svg height={size} viewBox="7.4 4.4 9.2 15.2" width={(size * 9.2) / 15.2}>{children}</Svg>
  );

  switch (name) {
    // FEED-ACTION-ICONS-001: 帖文操作行以前是纯文字（"回复 3"/"引用"/"分享"），
    // 喜欢那颗心也只是 ♥/♡ 两个字符往 Text 里塞——不是真图标，字号一改字重
    // 就跟着变形。喜欢/收藏都要支持已点亮的实心态，跟点赞按钮切换的语义对上。
    case "heart":
      return canvas(<Path {...(filled ? filledCommon : common)} d="M12 20.2c-.3 0-.6-.1-.8-.3C7.7 17.1 4 13.8 4 9.9 4 7 6.2 4.8 9 4.8c1.3 0 2.5.6 3.3 1.6.8-1 2-1.6 3.3-1.6 2.8 0 5 2.2 5 5.1 0 3.9-3.7 7.2-7.2 10-.2.2-.5.3-.8.3z"/>);
    case "bookmark":
      return canvas(<Path {...(filled ? filledCommon : common)} d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4.3L5.5 20V5a1 1 0 0 1 1-1z"/>);
    // GROUP-CREATE-001: 消息模块顶栏「建群」入口——两个人形叠一起，
    // 跟 aiPersona/profileRing 的单人形状拉开区分。
    case "group":
      return canvas(<><Circle {...common} cx="9" cy="8.3" r="3"/><Path {...common} d="M3.8 19c1-2.7 3-4.2 5.2-4.2s4.2 1.5 5.2 4.2"/><Path {...common} d="M14.5 5.3c1.4.3 2.4 1.5 2.4 3s-1 2.7-2.4 3"/><Path {...common} d="M16.3 14.9c2 .5 3.4 1.9 4 4"/></>);
    // MSG-SCAN-ICON-001: 之前用 qrGrid（QR 码本身的静态图标）顶替"扫一扫"这个
    // 动作按钮的图标，跟原型（取景框四角+扫描线）不是一个东西，看起来是错的。
    // qrGrid 留给"这是一个 QR 码"的场景（qr-zoom-overlay 的展示徽标），
    // "去扫码"这个动作统一换成这个取景框图标，抠图路径照抄原型 SVG。
    case "scan":
      return canvas(<><Path {...common} d="M3 8V5a2 2 0 0 1 2-2h3"/><Path {...common} d="M16 3h3a2 2 0 0 1 2 2v3"/><Path {...common} d="M21 16v3a2 2 0 0 1-2 2h-3"/><Path {...common} d="M8 21H5a2 2 0 0 1-2-2v-3"/><Path {...common} d="M3 12h18"/></>);
    case "home":
      return canvas(<><Path {...common} d="M4 10.5 12 4l8 6.5"/><Path {...common} d="M6.5 10v9h11v-9"/></>);
    case "diamond":
      return canvas(<Path {...common} d="M12 4 20 12 12 20 4 12z"/>);
    case "target":
      return canvas(<><Circle {...common} cx="12" cy="12" r="7"/><Circle {...common} cx="12" cy="12" r="3"/></>);
    // PROFILE-TAB-LOGO-001（2026-09-25，原型 deepseek_html_20260925_4e54a0.html）：
    // 原型个人主页 tab 栏的「帖子」字形 = 圆角方框 + 十字分隔。几何照抄原型 24 栅格
    // （rect x4 y4 w16 h16 rx3 + M4 10h16 + M10 4v16），只有描边跟 common 走。
    // 不拿 qrGrid 顶替 —— 那个字形是「这是一个 QR 码」的语义（MSG-SCAN-ICON-001）。
    case "postsGrid":
      return canvas(<><Path {...common} d="M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/><Path {...common} d="M4 10h16M10 4v16"/></>);
    // PROFILE-TAB-LOGO-001（2026-09-25 补）：前一天先把「回复」指到了现成的 chat，
    // 但 chat 是**方角气泡**（圆角矩形 + 尾巴），原型的回复字形是**圆形对话气泡**
    // （左下角带尾巴的 message-circle）—— 用户第二轮明确指出「回复的 logo 还是不
    // 符合原型」。几何照抄原型 24 栅格，不复用 chat：chat 还被 symbolMap 的 ✉ 和
    // 消息类入口用着，改它的几何会连带改到别处。
    case "replyBubble":
      return canvas(<Path {...common} d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>);
    // REPLY-ACTION-ICONS-001（2026-09-25，用户「这几个 logo 没有对齐设计的」）：
    // 原型回复行底部的 4 个操作图标（♡/💬/↻/⤴）走的是 Feather 那套标准路径，跟
    // 现有 heart（CSS 拼的 view）/ shareUp（自造上传箭头）几何不一样——所以单独
    // 加 replyLike / replyRepost / replyShare 三个名字，**不改**现有的 heart /
    // shareUp：前者用在 feed 卡片和场景卡的「♡ 已收藏」状态（实心是填充画法），
    // 后者用在帖子分享按钮（自带底框的「上传到云」语义），改了会牵连到别处。
    // 描边用 1.8（原型 .feed-action svg{stroke-width:1.8}），不走 common 的 2.2 —
    // — 这一组动作图标本来就比 tab 字形细一档。
    case "replyLike":
      // ⚠️ filled 不能省：feed 卡片和个人主页空态都会传 filled，而 replyLike 是这一组里
      // **唯一**有「已选中」态的（♡→♥）。写死 {...common} 的话 filled 被静默吞掉，
      // 点赞后就只剩变色、不再变实心 —— 状态反馈少一半。跟 bookmark 同形：
      // filled ? filledCommon : common。描边恒定 1.8（跟同组 replyBubble 等一致），
      // 所以 strokeWidth 写在展开**后面**，不让 filledCommon 的 1.4 把它拉细。
      return canvas(<Path {...(filled ? filledCommon : common)} strokeWidth={1.8} d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>);
    case "replyRepost":
      return canvas(<><Path {...common} strokeWidth={1.8} d="M17 1l4 4-4 4"/><Path {...common} strokeWidth={1.8} d="M3 11V9a4 4 0 0 1 4-4h14"/><Path {...common} strokeWidth={1.8} d="M7 23l-4-4 4-4"/><Path {...common} strokeWidth={1.8} d="M21 13v2a4 4 0 0 1-4 4H3"/></>);
    case "replyShare":
      return canvas(<><Path {...common} strokeWidth={1.8} d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><Path {...common} strokeWidth={1.8} d="M16 6l-4-4-4 4"/><Path {...common} strokeWidth={1.8} d="M12 2v14"/></>);
    // POST-THREAD-001：评论抽屉输入药丸右侧的三个工具图标，路径照抄原型
    // proxy_comment_keyboard_v2.html 的 .right-tools（24 栅格、描边 1.6）。
    // 不复用 image —— 那个名字画的是相机（跟 camera 同一套 View 拼法）。
    case "composerImage":
      return canvas(<><Rect {...common} strokeWidth={1.6} x="3" y="3" width="18" height="18" rx="2" ry="2"/><Circle {...common} strokeWidth={1.6} cx="8.5" cy="8.5" r="1.5"/><Path {...common} strokeWidth={1.6} d="M21 15l-5-5L5 21"/></>);
    case "composerSmile":
      return canvas(<><Circle {...common} strokeWidth={1.6} cx="12" cy="12" r="10"/><Path {...common} strokeWidth={1.6} d="M8 14s1.5 2 4 2 4-2 4-2"/><Path {...common} strokeWidth={1.6} d="M9 9h.01M15 9h.01"/></>);
    case "composerGif":
      return canvas(<><Rect {...common} strokeWidth={1.6} x="2" y="4" width="20" height="16" rx="2" ry="2"/><SvgText fill={color} fontSize="8" fontWeight="bold" stroke="none" textAnchor="middle" x="12" y="15">GIF</SvgText></>);
    case "chat":
      return canvas(<Path {...common} d="M5 6h14v9H9l-4 3z"/>);
    case "meRing":
      return canvas(<><Circle {...common} cx="12" cy="8" r="3.4"/><Path {...common} d="M6.2 19c1.2-3.5 3.7-5.3 5.8-5.3s4.6 1.8 5.8 5.3"/><Circle {...common} cx="12" cy="12" r="9"/></>);
    case "ring":
    case "circle":
      return canvas(<Circle {...common} cx="12" cy="12" r="7"/>);
    case "cup":
      return canvas(<><Path {...common} d="M6 9h10v5a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4z"/><Path {...common} d="M16 10h2a2.5 2.5 0 0 1 0 5h-2"/><Path {...common} d="M8 5c0 1-1 1.4-1 2M12 5c0 1-1 1.4-1 2M16 5c0 1-1 1.4-1 2"/></>);
    case "profileRing":
      return canvas(<><Circle {...common} cx="12" cy="12" r="8"/><Circle {...common} cx="12" cy="9" r="2.6"/><Path {...common} d="M7.7 17c1-2.8 2.9-4.2 4.3-4.2s3.3 1.4 4.3 4.2"/></>);
    case "arrowUpRight":
      return canvas(<><Path {...common} d="M7 17 17 7"/><Path {...common} d="M10 7h7v7"/></>);
    case "route":
      return canvas(<><Circle {...common} cx="5" cy="17" r="1.5"/><Circle {...common} cx="18" cy="8" r="1.5"/><Path {...common} d="M6.5 16c2.3-5.6 4.6-7.5 7.2-7.5 1.2 0 2.1.3 2.8.6"/></>);
    // MAP-FOOTPRINT-LOGO-001（2026-09-23，用户原型 deepseek_html_20260923_5c4a22.html）：
    // 市场头部地图切换按钮用「折叠地图」，个人主页场景足迹入口用「场景足迹」。
    // 路径照抄原型 48 栅格（描边 4.5），线条跟 color 走，绿点恒 #34C759。
    case "mapFold":
      return canvas48(<>
        <Path d="M14 18 L22 12 L30 18 L36 15 L36 32 L28 38 L20 32 L14 35 Z" fill="none" stroke={color} strokeWidth={4.5} strokeLinejoin="round"/>
        <Path d="M22 12 V 32" fill="none" stroke={color} strokeWidth={4.5} strokeLinecap="round"/>
        <Path d="M30 18 V 38" fill="none" stroke={color} strokeWidth={4.5} strokeLinecap="round"/>
        <Circle cx="37" cy="11" r="5.5" fill="#34C759"/>
      </>);
    case "footprint":
      return canvas48(<>
        <Circle cx="24" cy="24" r="17" fill="none" stroke={color} strokeWidth={4.5} strokeLinecap="round"/>
        <Path d="M11 26C16 19 24 33 37 22" fill="none" stroke={color} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round"/>
        <Circle cx="11" cy="26" r="4.5" fill={color}/>
        <Circle cx="37" cy="22" r="4.5" fill={color}/>
      </>);
    case "pin":
      return canvas(<><Path {...common} d="M12 21s-6.5-5.8-6.5-10.5A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.5C18.5 15.2 12 21 12 21z"/><Circle {...common} cx="12" cy="10.3" r="2.3"/></>);
    case "remix":
      return canvas(<><Path {...common} d="M5 7h3.2c2.2 0 3.4 1.2 4.5 3.2l1.1 2C14.9 14.2 16 17 19 17"/><Path {...common} d="m16 14 3 3-3 3"/><Path {...common} d="M5 17h3.2c1.8 0 2.9-.8 3.8-2.3l2-3.4C15.1 9.4 16.2 7 19 7"/><Path {...common} d="m16 4 3 3-3 3"/></>);
    // PERSONAL-PROFILE-PARITY-001: "search" 早就在类型里声明了，但从没在这个
    // switch 里实现过——个人主页的"搜索"按钮传的是 name="search"，落进
    // default 分支渲染 null，按钮位置上什么都看不见。补一个真正的放大镜。
    case "search":
      return canvas(<><Circle {...common} cx="11" cy="11" r="6.5"/><Path {...common} d="m20 20-4.3-4.3"/></>);
    // "分析"按钮之前用的是 name="ring"（一个空心圆），跟"数据分析"没有任何
    // 视觉关联。补一个简单的柱状图，跟本页其它按钮一样走矢量图标而不是
    // 随手抓一个几何图形顶替。
    case "chart":
      return canvas(<><Path {...common} d="M5 20V10"/><Path {...common} d="M12 20V4"/><Path {...common} d="M19 20v-7"/></>);
    // PERSONAL-PROFILE-PARITY-001: "crosshair" 跟 search 一样，声明了类型
    // 但从没实现过——全仓 4 处用它（个人主页/位置选择器/场景地图定位/
    // me-profile-components），全都是"按当前位置定位"的语义，一个都没
    // 真正显示过图标。补一个标准的 GPS 定位符号（圆环+十字准星）。
    case "crosshair":
      return canvas(<><Circle {...common} cx="12" cy="12" r="7"/><Path {...common} d="M12 2v3M12 19v3M2 12h3M19 12h3"/></>);
    case "plus":
      return canvas(<Path {...common} d="M12 5v14M5 12h14"/>);
    case "clock":
      return canvas(<><Circle {...common} cx="12" cy="12" r="7"/><Path {...common} d="M12 8v4l3 2"/></>);
    case "star":
      // SCENE-HOME-PROTOTYPE-001（2026-09-28）：原型的评分星是**实心金**星
      // （`.stat-star{fill:var(--gold);stroke:none}`），场景卡以前拿文本字符
      // "★" 顶替 —— 跟 BACK-GLYPH-001 同一类错。要能画实心就得读 filled，
      // 写死 {...common} 的话 filled 被静默吞掉（和 replyLike / bookmark 一样的坑）。
      return canvas(<Path {...(filled ? filledCommon : common)} d="M12 4l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.2l5-.7z"/>);
    case "coin":
      return canvas(<><Circle {...common} cx="12" cy="12" r="7"/><Path {...common} d="M9.5 9.5h5M9.5 14.5h5M12 7.5v9"/></>);
    case "settings":
      return canvas(<><Circle {...common} cx="12" cy="12" r="3"/><Path {...common} d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4"/></>);
    case "ticket":
      return canvas(<><Path {...common} d="M5 8h14v3a2 2 0 0 0 0 4v3H5v-3a2 2 0 0 0 0-4z"/><Path {...common} d="M12 8v10"/></>);
    case "storeLines":
      return canvas(<Path {...common} d="M6 7h12M7 10h10M7 13h10M7 16h10"/>);
    case "spark":
    case "sparkle":
      return canvas(<Path {...common} d="M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7z"/>);
    case "camera":
    case "image":
      return canvas(<><Path {...common} d="M7 7.5h2l1.2-2h3.6l1.2 2h2A2.5 2.5 0 0 1 19.5 10v6A2.5 2.5 0 0 1 17 18.5H7A2.5 2.5 0 0 1 4.5 16v-6A2.5 2.5 0 0 1 7 7.5z"/><Circle {...common} cx="12" cy="13" r="3.1"/><Path {...common} d="M16.6 10.2h.01"/></>);
    case "microphone":
      return canvas(<><Path {...common} d="M12 4a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3z"/><Path {...common} d="M6.5 11.5v.5a5.5 5.5 0 0 0 11 0v-.5"/><Path {...common} d="M12 17.5V20"/><Path {...common} d="M9.5 20h5"/></>);
    case "arrowUp":
      return canvas(<><Path {...common} d="M12 19V5"/><Path {...common} d="M7.5 9.5 12 5l4.5 4.5"/></>);
    // ME-SHEET-ICONS-001: 主页设置弹窗的三个按钮（编辑个人资料/分享主页/
    // AI分身中心）以前是纯文字，跟同一个 sheet 里其它纯文字按钮长一样，
    // 三个入口通到完全不同的地方（编辑表单/系统分享面板/AI 分身模块）却没
    // 有任何视觉区分。补三个专属图标，形状按提供的参考稿描摹。
    case "editProfile":
      return canvas(<><Circle {...common} cx="10" cy="8" r="3.2"/><Path {...common} d="M4.8 18.4c1.1-2.8 3.3-4.4 5.9-4.4 1.1 0 2.1.3 3 .8"/><Path {...common} d="M16.2 13.4l4.1-4.1a1.6 1.6 0 0 0-2.3-2.3l-4.1 4.1-.6 2.9 2.9-.6z"/></>);
    case "shareUp":
      return canvas(<><Path {...common} d="M12 3v12"/><Path {...common} d="M8.2 6.8 12 3l3.8 3.8"/><Path {...common} d="M5 12v6.8A2.2 2.2 0 0 0 7.2 21h9.6a2.2 2.2 0 0 0 2.2-2.2V12"/></>);
    case "aiPersona":
      return canvas(<><Circle {...common} cx="10" cy="8.5" r="3.2"/><Path {...common} d="M4.6 19.4c1.1-3 3.4-4.8 6.2-4.8 1.5 0 2.9.5 4 1.3"/><Path {...common} d="M18 4.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1z"/></>);
    // SPORT-BADMINTON-HEADER-002（2026-09-25，用户：「返回 logo 没做好」）：
    // chevronLeft 以前走的是下面那条「两根旋转方条」的分支（和 close 共用）。
    // 两根条长 0.62·size，却只错开 23% 高度 —— 45° 下要 ~44% 才能首尾相接，
    // 于是两条在顶点交叉、左上角戳出一根刺（真机截图放大就是个叉）。
    // ⚠️ 这个字形在此之前**全仓库只有羽毛球那个功能在用**（别处都用 <Text>‹</Text>），
    //    所以坏了很久没人看见 —— 新增字形一定要在真机上看一眼，别只跑测试。
    // 改成原型那条描边路径：原型 .back-btn svg 是 viewBox 0 0 24 24、
    // width/height 14px、stroke-width 2.5、round cap/join，path 就是 M15 18l-6-6 6-6。
    // 线重也对得上：common 的 2.2 在 size=16 时渲染成 2.2*(16/24)=1.47px，
    // 原型的 2.5*(14/24)=1.46px。
    case "chevronLeft":
      return canvas(<Path {...common} d="M15 18l-6-6 6-6"/>);
    // SCENE-HOME-PROTOTYPE-001（2026-09-28）：右向 chevron。原型
    // deepseek_html_20260927_7fc18d 里「列表卡尾部」和「意图卡尾部」都是一颗右尖括号，
    // 但**原型自己写的是文本字符** `<span class="intent-arrow">›</span>`，两份实现
    // 照抄了 ⇒ 字符不是字形（BACK-GLYPH-001 同款）：形状和垂直基线随 fontSize 漂，
    // 粗细也跟 chevronLeft 对不上。补一颗真字形 —— 和 chevronLeft 同一条路径的镜像。
    case "chevronRight":
      return canvas(<Path {...common} d="M9 18l6-6-6-6"/>);
    // BACK-GLYPH-001：全 App 的返回字形。同一条路径，但取景贴着箭头（见 canvasBack）。
    // 返回控件一律走这个，不要再写 `<Text>‹</Text>` —— `‹` 是引号不是箭头。
    case "backArrow":
      return canvasBack(<Path {...common} d="M15 18l-6-6 6-6"/>);
    // FEED-MENU-ICONS-001：帖子「更多操作」菜单 5 个行图标。全部按原型
    // deepseek_html_20260926_fe2c4b.html「方案 B · 在菜单里的效果」原样移植
    // （32 栅格 / 描边 1.9 / 圆头圆角），只把 currentColor 换成 color。
    case "thumbDown": // 不感兴趣
      return canvas32(<><Path {...common32} d="M11 14L11 26L7 26L7 14Z"/><Path {...common32} d="M11 14L16 6.5C16.5 5.5 17.5 5.5 18 6C18.5 6.5 18.5 7.5 18 8.5L17 13L24 13C25.5 13 26.5 14.5 26 16L24 24C23.5 25.5 22.5 26 21 26L11 26"/></>);
    case "listMinus": // 减少这类内容
      return canvas32(<Path {...common32} d="M5 10L17 10M5 16L17 16M5 22L17 22M21 16L29 16"/>);
    case "personMinus": // 少看这个人
      return canvas32(<><Circle {...common32} cx="12" cy="10.5" r="4.5"/><Path {...common32} d="M4.5 25.5C4.5 20 8 17.5 12 17.5C15 17.5 17 18.5 18.5 20.5"/><Path {...common32} d="M22 25L29 25"/></>);
    case "banCircle": // 屏蔽作者
      return canvas32(<><Circle {...common32} cx="16" cy="16" r="11"/><Path {...common32} d="M9.5 9.5L22.5 22.5"/></>);
    case "alertTriangle": // 举报
      return canvas32(<><Path {...common32} d="M16 5L28 26L4 26Z"/><Path {...common32} d="M16 13L16 19"/><Circle cx="16" cy="22.5" fill={color} r="1.2" stroke="none"/></>);
    // SEC-CATEGORY-ICONS-001（2026-09-26，用户：「模拟器的 推荐 关注还没有 logo 原型我给你了」）：
    // 原型 02 那节把「推荐」「关注」也定义成了有形状的分类图标，但同一份原型的
    // 03「分段 / Tabs / 胶囊」里这两个 tab 是**纯文字** —— 所以这两个字形一直没有出处可抄，
    // feed 顶部那行 tab 就一直空着。这里是跨节搬：02 的定义 → 03 的位置。
    // 栅格与描边按原型 02 的 .icon-frame svg（stroke-width:1.9 + round；坐标最大到 28
    // ⇒ 32 栅格），路径数据原样移植，只把 currentColor 换成 color。
    // ⚠️ 不要拿已有的 `star` 顶替「推荐」—— 那是 24 栅格的圆角星，和原型这条 10 段折线的
    // 尖角星不是同一个形状（同理别用 `user` 顶替「关注」，原型多一个右上信号点）。
    case "recommend": // 推荐（五角星）
      return canvas32(<Path {...common32} d="M16 4L19.5 12L28 13L21.5 18.5L23.5 27L16 22.5L8.5 27L10.5 18.5L4 13L12.5 12Z"/>);
    case "follow": // 关注（人 + 信号点）
      return canvas32(<><Circle {...common32} cx="16" cy="11" r="5"/><Path {...common32} d="M6 27C6 22 10 19 16 19C22 19 26 22 26 27"/><Circle cx="25" cy="8" fill={color} r="2.5" stroke="none"/></>);
    // SEC-CATEGORY-ICONS-002：原型 02 节同一组里的「动态」「探索」，路径原文照抄
    // （32 栅格 / 描边 1.9，只把 currentColor 换成 color）。
    // ⚠️ 「动态」别拿 24 栅格的 `target` 顶替：target 是 r7 外圈 + r3 **描边**内圈，
    //    原型这个是 r11 外圈 + r3 **实心**圆心 —— 外径和重心都不一样，而且描边
    //    比同屏那行粗 1.55 倍（见文件头 SEC-CATEGORY-ICONS-002 的说明）。
    case "dynamicRing": // 动态（同心圆 · 实心圆心）
      return canvas32(<><Circle {...common32} cx="16" cy="16" r="11"/><Circle cx="16" cy="16" fill={color} r="3" stroke="none"/></>);
    case "explore": // 探索（罗盘指针）
      return canvas32(<><Circle {...common32} cx="16" cy="16" r="11"/><Path {...common32} d="M21 11L18 18L11 21L14 14Z"/></>);
    // 原型 02 节里「分类胶囊」那行的四个字形（原型 06 的首页顶部第三行）。
    // 同样 32 栅格 / 描边 1.9，坐标原样照抄；「全部」用 <Rect> 是为了不动原型的
    // rect x/y/width/height/rx（手抄成圆弧路径容易算错，见文件里 canvas48 那条注释）。
    case "allGrid": // 全部（四宫格）
      return canvas32(<><Rect {...common32} height="9" rx="2" width="9" x="5" y="5"/><Rect {...common32} height="9" rx="2" width="9" x="18" y="5"/><Rect {...common32} height="9" rx="2" width="9" x="5" y="18"/><Rect {...common32} height="9" rx="2" width="9" x="18" y="18"/></>);
    case "peoplePair": // 人 / 关系（双人形）
      return canvas32(<><Circle {...common32} cx="11" cy="12" r="4"/><Circle {...common32} cx="22" cy="12" r="4"/><Path {...common32} d="M4 25C4 21 7 18.5 11 18.5C15 18.5 18 21 18 25"/><Path {...common32} d="M15 25C15 21 18 18.5 22 18.5C26 18.5 29 21 29 25"/></>);
    case "clockDot": // 机会 / 需求（时钟 · 实心圆心）
      return canvas32(<><Circle {...common32} cx="16" cy="16" r="11"/><Path {...common32} d="M16 10L16 16L20 20"/><Circle cx="16" cy="16" fill={color} r="1.5" stroke="none"/></>);
    case "hexGroup": // 活动 / 团体（六边形双框）
      return canvas32(<><Path {...common32} d="M16 4L27 9L27 22L16 27L5 22L5 9Z"/><Path {...common32} d="M16 11L21 14L21 20L16 23L11 20L11 14Z"/></>);
    default:
      return null;
  }
}

export function ProxySymbolIcon({
  symbol,
  size,
  color,
  style
}: {
  symbol: string;
  size: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const iconName = symbolMap[symbol];
  if (iconName) {
    return <ProxyIcon color={color} name={iconName} size={size} style={style} />;
  }

  // Apple 与 Android 对 ♡ / ☆ / ⌁ 的回退字体不同。保留原型符号，但固定
  // 可见尺寸，并用同色阴影补偿 Android 过细的字重。
  const glyphScale = symbol === "♡" ? 0.86 : symbol === "⌁" ? 0.9 : 1;
  return (
    <View pointerEvents="none" style={[styles.frame, { height: size, width: size }, style]}>
      <Text selectable
        allowFontScaling={false}
        style={[
          styles.prototypeGlyph,
          {
            color,
            fontSize: size * glyphScale,
            lineHeight: size,
            textShadowColor: color,
            textShadowOffset: { height: 0, width: 0 },
            textShadowRadius: symbol === "♡" ? 0.8 : 0.35
          }
        ]}
      >
        {symbol}
      </Text>
    </View>
  );
}

export function ProxyIcon({
  name,
  size,
  color,
  style,
  filled
}: {
  name: ProxyIconName;
  size: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  // FEED-ACTION-ICONS-001: heart/bookmark 的"已点亮"实心态，跟 isLiked/isSaved
  // 的语义对齐——不加这个就只能靠 color 变化表达状态，比原来的 ♥/♡ 字符切换
  // 还弱（描边心形不管什么颜色都不像"已喜欢"）。
  filled?: boolean;
}): React.JSX.Element {
  const stroke = Math.max(1.6, size * 0.11);
  const frame = [styles.frame, { height: size, width: size }, style];
  const masterIcon = MasterModuleIcon({ name, size, color, filled });
  if (masterIcon) {
    return <View pointerEvents="none" style={frame}>{masterIcon}</View>;
  }

  if (name === "diamond") {
    const side = size * 0.58;
    return (
      <View pointerEvents="none" style={frame}>
        <View
          style={[
            styles.diamond,
            {
              borderColor: color,
              borderRadius: size * 0.05,
              borderWidth: stroke,
              height: side,
              width: side
            }
          ]}
        />
      </View>
    );
  }

  if (name === "circle") {
    const diameter = size * 0.68;
    return (
      <View pointerEvents="none" style={frame}>
        <View
          style={[
            styles.circle,
            {
              borderColor: color,
              borderRadius: diameter / 2,
              borderWidth: stroke,
              height: diameter,
              width: diameter
            }
          ]}
        />
      </View>
    );
  }

  if (name === "ring") {
    const diameter = size * 0.78;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.circle, { borderColor: color, borderRadius: diameter / 2, borderWidth: stroke, height: diameter, width: diameter }]} />
      </View>
    );
  }

  if (name === "profileRing" || name === "meRing") {
    const outer = size * 0.78;
    const head = size * 0.22;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.profileOuter, { borderColor: color, borderRadius: outer / 2, borderWidth: stroke, height: outer, width: outer }]}>
          <View style={[styles.profileHead, { borderColor: color, borderRadius: head / 2, borderWidth: stroke, height: head, width: head }]} />
          <View style={[styles.profileBody, { borderColor: color, borderTopWidth: stroke, borderLeftWidth: stroke, borderRightWidth: stroke, borderRadius: size * 0.18, height: size * 0.22, width: size * 0.42 }]} />
        </View>
      </View>
    );
  }

  if (name === "crosshair") {
    const dot = size * 0.36;
    return (
      <View pointerEvents="none" style={frame}>
        <View
          style={[
            styles.crosshairDot,
            {
              borderColor: color,
              borderRadius: dot / 2,
              borderWidth: Math.max(1.2, stroke * 0.65),
              height: dot,
              width: dot
            }
          ]}
        />
        <View style={[styles.crosshairH, { backgroundColor: color, height: Math.max(1, stroke * 0.55), width: size * 0.82 }]} />
        <View style={[styles.crosshairV, { backgroundColor: color, height: size * 0.82, width: Math.max(1, stroke * 0.55) }]} />
      </View>
    );
  }

  if (name === "home") {
    const roof = size * 0.49;
    return (
      <View pointerEvents="none" style={frame}>
        <View
          style={[
            styles.homeRoof,
            {
              borderColor: color,
              borderLeftWidth: stroke,
              borderTopWidth: stroke,
              height: roof,
              top: size * 0.11,
              width: roof
            }
          ]}
        />
        <View
          style={[
            styles.homeBody,
            {
              borderColor: color,
              borderWidth: stroke,
              bottom: size * 0.08,
              height: size * 0.42,
              width: size * 0.56
            }
          ]}
        />
      </View>
    );
  }

  if (name === "check") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.checkShort, { backgroundColor: color, height: stroke, width: size * 0.34 }]} />
        <View style={[styles.checkLong, { backgroundColor: color, height: stroke, width: size * 0.62 }]} />
      </View>
    );
  }

  if (name === "sparkle" || name === "spark") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.sparkleV, { backgroundColor: color, height: size * 0.86, width: stroke }]} />
        <View style={[styles.sparkleH, { backgroundColor: color, height: stroke, width: size * 0.86 }]} />
        <View style={[styles.sparkleD1, { backgroundColor: color, height: stroke, width: size * 0.64 }]} />
        <View style={[styles.sparkleD2, { backgroundColor: color, height: stroke, width: size * 0.64 }]} />
      </View>
    );
  }

  if (name === "arrowUpRight") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.arrowDiagonal, { backgroundColor: color, height: stroke, width: size * 0.78 }]} />
        <View style={[styles.arrowHeadA, { borderTopColor: color, borderTopWidth: stroke, height: size * 0.38, right: size * 0.08, top: size * 0.08, width: stroke }]} />
        <View style={[styles.arrowHeadB, { backgroundColor: color, height: stroke, right: size * 0.07, top: size * 0.17, width: size * 0.38 }]} />
      </View>
    );
  }

  if (name === "arrowUp") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.arrowUpStem, { backgroundColor: color, height: size * 0.68, width: stroke }]} />
        <View style={[styles.arrowUpLeft, { backgroundColor: color, height: stroke, width: size * 0.38 }]} />
        <View style={[styles.arrowUpRight, { backgroundColor: color, height: stroke, width: size * 0.38 }]} />
      </View>
    );
  }

  // chevronLeft 已搬到 MasterModuleIcon 走真描边路径（SPORT-BADMINTON-HEADER-002）：
  // 两根 ±45° 方条拼 chevron 时，顶点处两条会交叉戳出一根刺。
  // close 留在这里：它是个 ×，两根条本来就要**交叉**，没有顶点要接，不存在那个问题。
  if (name === "close") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.actionLineA, { backgroundColor: color, height: stroke, width: size * 0.62 }, styles.closeLineA]} />
        <View style={[styles.actionLineB, { backgroundColor: color, height: stroke, width: size * 0.62 }, styles.closeLineB]} />
      </View>
    );
  }

  if (name === "plus") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.plusH, { backgroundColor: color, height: stroke, width: size * 0.76 }]} />
        <View style={[styles.plusV, { backgroundColor: color, height: size * 0.76, width: stroke }]} />
      </View>
    );
  }

  if (name === "clock") {
    const diameter = size * 0.72;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.clockFace, { borderColor: color, borderRadius: diameter / 2, borderWidth: stroke, height: diameter, width: diameter }]} />
        <View style={[styles.clockHour, { backgroundColor: color, height: stroke, width: size * 0.23 }]} />
        <View style={[styles.clockMinute, { backgroundColor: color, height: size * 0.23, width: stroke }]} />
      </View>
    );
  }

  if (name === "star") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.starV, { backgroundColor: color, height: size * 0.9, width: stroke }]} />
        <View style={[styles.starD1, { backgroundColor: color, height: stroke, width: size * 0.86 }]} />
        <View style={[styles.starD2, { backgroundColor: color, height: stroke, width: size * 0.86 }]} />
      </View>
    );
  }

  if (name === "wallet") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.walletBody, { borderColor: color, borderRadius: size * 0.1, borderWidth: stroke, height: size * 0.56, width: size * 0.82 }]} />
        <View style={[styles.walletTab, { backgroundColor: color, borderRadius: stroke, height: stroke * 1.5, right: size * 0.17, width: stroke * 1.5 }]} />
      </View>
    );
  }

  if (name === "settings") {
    const hub = size * 0.38;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.settingsHub, { borderColor: color, borderRadius: hub / 2, borderWidth: stroke, height: hub, width: hub }]} />
        <View style={[styles.settingsH, { backgroundColor: color, height: stroke, width: size * 0.9 }]} />
        <View style={[styles.settingsV, { backgroundColor: color, height: size * 0.9, width: stroke }]} />
        <View style={[styles.settingsD1, { backgroundColor: color, height: stroke, width: size * 0.72 }]} />
        <View style={[styles.settingsD2, { backgroundColor: color, height: stroke, width: size * 0.72 }]} />
      </View>
    );
  }

  if (name === "cup") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.cupBody, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.08, height: size * 0.42, width: size * 0.58 }]} />
        <View style={[styles.cupHandle, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.18, height: size * 0.22, width: size * 0.2 }]} />
        <View style={[styles.cupSteam, { backgroundColor: color, height: size * 0.2, width: stroke, left: size * 0.28 }]} />
        <View style={[styles.cupSteam, { backgroundColor: color, height: size * 0.2, width: stroke, left: size * 0.48, transform: [{ rotate: "12deg" }] }]} />
      </View>
    );
  }

  if (name === "ticket") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.ticketBody, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.08, height: size * 0.58, width: size * 0.8 }]} />
        <View style={[styles.ticketCut, { backgroundColor: color, height: stroke, width: size * 0.5 }]} />
      </View>
    );
  }

  if (name === "coin") {
    const diameter = size * 0.72;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.coinFace, { borderColor: color, borderRadius: diameter / 2, borderWidth: stroke, height: diameter, width: diameter }]} />
        <View style={[styles.coinLine, { backgroundColor: color, height: stroke, width: size * 0.28 }]} />
        <View style={[styles.coinLine, { backgroundColor: color, height: stroke, width: size * 0.28, transform: [{ rotate: "90deg" }] }]} />
      </View>
    );
  }

  if (name === "chat") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.chatBubble, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.12, height: size * 0.58, width: size * 0.78 }]} />
        <View style={[styles.chatTail, { borderBottomColor: color, borderBottomWidth: stroke, borderLeftColor: color, borderLeftWidth: stroke, height: size * 0.18, width: size * 0.18 }]} />
      </View>
    );
  }

  if (name === "camera" || name === "image") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.cameraFrame, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.08, height: size * 0.58, width: size * 0.8 }]} />
        <View style={[styles.cameraTop, { backgroundColor: color, height: stroke, width: size * 0.25 }]} />
        <View style={[styles.cameraLens, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.13, height: size * 0.25, width: size * 0.25 }]} />
      </View>
    );
  }

  if (name === "microphone") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.micHead, { borderColor: color, borderWidth: stroke, borderRadius: size * 0.14, height: size * 0.46, width: size * 0.25 }]} />
        <View style={[styles.micArc, { borderColor: color, borderBottomWidth: stroke, borderLeftWidth: stroke, borderRightWidth: stroke, borderRadius: size * 0.28, height: size * 0.34, width: size * 0.58 }]} />
        <View style={[styles.micStem, { backgroundColor: color, height: size * 0.22, width: stroke }]} />
        <View style={[styles.micBase, { backgroundColor: color, height: stroke, width: size * 0.32 }]} />
      </View>
    );
  }

  if (name === "infoCircle") {
    const diameter = size * 0.78;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.circle, { borderColor: color, borderRadius: diameter / 2, borderWidth: stroke, height: diameter, width: diameter }]} />
        <View style={[styles.infoDot, { backgroundColor: color, borderRadius: stroke, height: stroke * 1.2, width: stroke * 1.2 }]} />
        <View style={[styles.infoStem, { backgroundColor: color, height: size * 0.25, width: stroke }]} />
      </View>
    );
  }

  if (name === "qrGrid") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.qrOutline, { borderColor: color, borderWidth: stroke, height: size * 0.72, width: size * 0.72 }]} />
        <View style={[styles.qrLineA, { backgroundColor: color, height: stroke, width: size * 0.2 }]} />
        <View style={[styles.qrLineB, { backgroundColor: color, height: size * 0.2, width: stroke }]} />
      </View>
    );
  }

  if (name === "ellipsis") {
    return (
      <View pointerEvents="none" style={[frame, styles.ellipsisRow]}>
        {[0, 1, 2].map((item) => <View key={item} style={[styles.ellipsisDot, { backgroundColor: color, borderRadius: size * 0.06, height: size * 0.12, width: size * 0.12 }]} />)}
      </View>
    );
  }

  if (name === "search") {
    const diameter = size * 0.52;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.searchFace, { borderColor: color, borderRadius: diameter / 2, borderWidth: stroke, height: diameter, width: diameter }]} />
        <View style={[styles.searchHandle, { backgroundColor: color, height: stroke, width: size * 0.36 }]} />
      </View>
    );
  }

  if (name === "storefront") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.storeOuter, { borderColor: color, borderWidth: stroke, height: size * 0.7, width: size * 0.74 }]} />
        <View style={[styles.storeInner, { borderColor: color, borderWidth: stroke, height: size * 0.29, width: size * 0.3 }]} />
      </View>
    );
  }

  if (name === "storeLines") {
    return (
      <View pointerEvents="none" style={frame}>
        {[0, 1, 2, 3].map((item) => <View key={item} style={[styles.storeLine, { backgroundColor: color, height: stroke, width: size * 0.64, top: size * (0.2 + item * 0.16) }]} />)}
      </View>
    );
  }

  // 2026-09-28 删除：这里原来还有一个 `if (name === "heart")`（2026-08-22 的
  // 「两根圆角方条拼一颗心」写法，配 heartLeft / heartRight / heartPoint 三个 style）。
  // 它**不可达** —— 上面 MasterModuleIcon 的 switch 里已经有 `case "heart"`（:184，
  // 走 Feather 那条真描边路径、读 filled），返回非空 ⇒ ProxyIcon 在 :452 就 return 了。
  // 留着只会误导：我照着它推理过一次，把「heart 不读 filled」写进了别处的注释。
  // 那三个 style 也一起删了（除这个死分支外没有第二个引用点）。

  if (name === "route") {
    const node = size * 0.22;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.routeLineA, { backgroundColor: color, height: stroke, width: size * 0.43 }]} />
        <View style={[styles.routeLineB, { backgroundColor: color, height: stroke, width: size * 0.43 }]} />
        <View style={[styles.routeNodeA, { borderColor: color, borderRadius: node / 2, borderWidth: stroke, height: node, width: node }]} />
        <View style={[styles.routeNodeB, { borderColor: color, borderRadius: node / 2, borderWidth: stroke, height: node, width: node }]} />
        <View style={[styles.routeNodeC, { backgroundColor: color, borderRadius: node / 2, height: node, width: node }]} />
      </View>
    );
  }

  if (name === "user") {
    const head = size * 0.34;
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.userHead, { borderColor: color, borderRadius: head / 2, borderWidth: stroke, height: head, width: head }]} />
        <View style={[styles.userBody, { borderColor: color, borderRadius: size * 0.32, borderTopWidth: stroke, height: size * 0.32, width: size * 0.7 }]} />
      </View>
    );
  }

  if (name === "mail") {
    return (
      <View pointerEvents="none" style={frame}>
        <View style={[styles.mailBox, { borderColor: color, borderRadius: size * 0.08, borderWidth: stroke, height: size * 0.57, width: size * 0.78 }]} />
        <View style={[styles.mailFoldLeft, { backgroundColor: color, height: stroke, width: size * 0.46 }]} />
        <View style={[styles.mailFoldRight, { backgroundColor: color, height: stroke, width: size * 0.46 }]} />
      </View>
    );
  }

  const outer = size * 0.78;
  const inner = size * 0.43;
  const center = size * 0.12;
  return (
    <View pointerEvents="none" style={frame}>
      <View
        style={[
          styles.targetOuter,
          {
            borderColor: color,
            borderRadius: outer / 2,
            borderWidth: stroke,
            height: outer,
            width: outer
          }
        ]}
      >
        <View
          style={[
            styles.targetInner,
            {
              borderColor: color,
              borderRadius: inner / 2,
              borderWidth: stroke,
              height: inner,
              width: inner
            }
          ]}
        >
          <View style={{ backgroundColor: color, borderRadius: center / 2, height: center, width: center }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", justifyContent: "center", position: "relative" },
  prototypeGlyph: { includeFontPadding: false, textAlign: "center", textAlignVertical: "center" },
  diamond: { position: "absolute", transform: [{ rotate: "45deg" }] },
  circle: { position: "absolute" },
  profileOuter: { alignItems: "center", justifyContent: "center", position: "absolute" },
  profileHead: { position: "absolute", top: "18%" },
  profileBody: { bottom: "12%", position: "absolute" },
  crosshairDot: { position: "absolute" },
  crosshairH: { position: "absolute" },
  crosshairV: { position: "absolute" },
  homeRoof: { position: "absolute", transform: [{ rotate: "45deg" }] },
  homeBody: { borderTopWidth: 0, position: "absolute" },
  checkShort: { left: "17%", position: "absolute", top: "57%", transform: [{ rotate: "45deg" }] },
  checkLong: { left: "35%", position: "absolute", top: "47%", transform: [{ rotate: "-45deg" }] },
  sparkleV: { position: "absolute" },
  sparkleH: { position: "absolute" },
  sparkleD1: { position: "absolute", transform: [{ rotate: "45deg" }] },
  sparkleD2: { position: "absolute", transform: [{ rotate: "-45deg" }] },
  arrowDiagonal: { position: "absolute", transform: [{ rotate: "-45deg" }] },
  arrowHeadA: { borderRightWidth: 0, position: "absolute" },
  arrowHeadB: { position: "absolute" },
  arrowUpStem: { position: "absolute", top: "24%" },
  arrowUpLeft: { position: "absolute", right: "50%", top: "18%", transform: [{ rotate: "-45deg" }] },
  arrowUpRight: { left: "50%", position: "absolute", top: "18%", transform: [{ rotate: "45deg" }] },
  actionLineA: { position: "absolute" },
  actionLineB: { position: "absolute" },
  // 那份「两根旋转方条拼 chevron」的样式已删：顶点处两条会交叉戳出一根刺，
  // chevronLeft 改成真描边路径了（SPORT-BADMINTON-HEADER-002）。
  // ⚠️ 这里刻意不写出被删掉的那两个样式名：门禁 [SPORT-BADMINTON-HEADER-002] 有一条
  //    grep 反向钉扫**这个文件的全文、不剥注释**，注释里写着它，那颗钉会被自己的说明喂红
  //    （REPLY-EMPTY-VIEWER-001 踩过同一个坑，这是第四次）。
  closeLineA: { transform: [{ rotate: "45deg" }] },
  closeLineB: { transform: [{ rotate: "-45deg" }] },
  plusH: { position: "absolute" },
  plusV: { position: "absolute" },
  clockFace: { position: "absolute" },
  clockHour: { left: "50%", position: "absolute", top: "50%" },
  clockMinute: { left: "50%", position: "absolute", top: "31%" },
  starV: { position: "absolute" },
  starD1: { position: "absolute", transform: [{ rotate: "36deg" }] },
  starD2: { position: "absolute", transform: [{ rotate: "-36deg" }] },
  walletBody: { position: "absolute" },
  walletTab: { position: "absolute" },
  settingsHub: { position: "absolute" },
  settingsH: { position: "absolute" },
  settingsV: { position: "absolute" },
  settingsD1: { position: "absolute", transform: [{ rotate: "45deg" }] },
  settingsD2: { position: "absolute", transform: [{ rotate: "-45deg" }] },
  cupBody: { position: "absolute", top: "42%" },
  cupHandle: { position: "absolute", right: "8%", top: "48%" },
  cupSteam: { position: "absolute", top: "13%", transform: [{ rotate: "12deg" }] },
  ticketBody: { position: "absolute" },
  ticketCut: { position: "absolute", transform: [{ rotate: "90deg" }] },
  coinFace: { position: "absolute" },
  coinLine: { position: "absolute" },
  chatBubble: { position: "absolute" },
  chatTail: { bottom: "17%", left: "19%", position: "absolute", transform: [{ rotate: "-25deg" }] },
  cameraFrame: { position: "absolute" },
  cameraTop: { position: "absolute", top: "22%" },
  cameraLens: { position: "absolute" },
  micHead: { position: "absolute", top: "10%" },
  micArc: { bottom: "20%", position: "absolute" },
  micStem: { bottom: "10%", position: "absolute" },
  micBase: { bottom: "7%", position: "absolute" },
  infoDot: { position: "absolute", top: "27%" },
  infoStem: { position: "absolute", top: "45%" },
  qrOutline: { position: "absolute" },
  qrLineA: { position: "absolute", top: "42%" },
  qrLineB: { left: "42%", position: "absolute" },
  ellipsisRow: { flexDirection: "row", gap: 3 },
  ellipsisDot: {},
  searchFace: { position: "absolute", top: "20%" },
  searchHandle: { bottom: "20%", position: "absolute", right: "16%", transform: [{ rotate: "45deg" }] },
  storeOuter: { position: "absolute" },
  storeInner: { position: "absolute" },
  storeLine: { position: "absolute" },
  routeLineA: { left: "17%", position: "absolute", top: "36%", transform: [{ rotate: "32deg" }] },
  routeLineB: { position: "absolute", right: "17%", top: "62%", transform: [{ rotate: "-32deg" }] },
  routeNodeA: { left: "8%", position: "absolute", top: "18%" },
  routeNodeB: { position: "absolute", right: "8%", top: "70%" },
  routeNodeC: { position: "absolute", top: "39%" },
  userHead: { position: "absolute", top: "9%" },
  userBody: { bottom: "7%", position: "absolute" },
  mailBox: { position: "absolute" },
  mailFoldLeft: { left: "15%", position: "absolute", top: "47%", transform: [{ rotate: "31deg" }] },
  mailFoldRight: { position: "absolute", right: "15%", top: "47%", transform: [{ rotate: "-31deg" }] },
  targetOuter: { alignItems: "center", justifyContent: "center", position: "absolute" },
  targetInner: { alignItems: "center", justifyContent: "center" }
});
