import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SPORT-BADMINTON-001：home 场景「运动 · 羽毛球」卡片 + 它点进去那张表的**接线**。
//
// 为什么是源码级 tripwire 而不是渲染测试：这个仓库的 surface 测试都是读源码的
// （placeholder-honest-actions / subpage-generic-fabricated 都是），
// vitest 这边没有 RN 渲染器。能做成真行为测试的部分（筛选、排序、取词、高亮）
// 全在 ../badminton-companion.test.ts 里 —— 这个文件只钉「界面有没有真的接上」。
//
// 这个文件同时钉四件事：
//   · 卡片在首页、点了开整页、而且**没有**编出来的「N 家」角标；
//   · 整页只有**一个** Modal（iOS 一次只呈现一个，套第二层会被无声吞掉）；
//   · 演示数据的提示行在，且详情页不写「已通过 KYC 认证」这种没人做过的核验结论；
//   · 原型里那些没接线的控件（四个筛选 chip、预约陪打）在这里都真的接上了。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const surfaceRaw = readFileSync(here("./badminton-companion.tsx"), "utf8");
const sceneRaw = readFileSync(here("../components/scene-activity-discovery.tsx"), "utf8");

// 钉「某段代码在不在」之前先剥注释：本文件与源文件的注释里刻意写着那些
// 被禁字符串（比如 surface 文件头就写着「详情页不写『已通过 KYC 认证』」），
// 不剥注释的话，把代码删掉、注释留着，断言照样绿 —— 反向臂会被自己的说明喂饱。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const surface = stripComments(surfaceRaw);
const scene = stripComments(sceneRaw);

// 首页那张卡的 JSX 片段：从它的 accessibilityLabel 到第一个 </Pressable>。
// 剥注释后再取，所以卡上方那段解释性注释不会混进来。
function cardBlock(): string {
  const start = scene.indexOf('accessibilityLabel="运动 羽毛球 陪打"');
  expect(start, "首页找不到运动 · 羽毛球那张卡").toBeGreaterThan(-1);
  const end = scene.indexOf("</Pressable>", start);
  expect(end, "那张卡没有闭合的 </Pressable>").toBeGreaterThan(start);
  return scene.slice(start, end);
}

describe("SPORT-BADMINTON-001 首页入口卡", () => {
  it("卡上不许挂「N 家」角标，也不许把持证说成事实", () => {
    // 反向臂写在前面：正向臂是「卡上有标题」，如果先跑正向臂，
    // 把整张卡换成一个带角标的版本时正向臂仍然绿、这条反向臂根本不会被求值。
    const card = cardBlock();
    // 卡现在和旁边那几张入口卡**共用** entryCountPill 版式（用户要求它别再是一行 list），
    // 但胶囊里只能有一个「›」—— 不许出现计数文字，也不许出现任何计数插值。
    expect(card).toContain("entryCountChevron");
    expect(card).not.toContain("entryCountText");
    expect(card).not.toContain("entry.count");
    expect(card).not.toContain("entry.unit");
    expect(card).not.toContain("家");
    // 「场馆持证」是合规性断言，演示数据没资格在首页就把它写成事实。
    // 它在表面内部出现，和顶部那条演示数据提示行在一起。
    expect(card).not.toContain("场馆持证");
  });

  it("它是大图卡，不是一行 list（用户：「大卡片怎么成了 list 了」）", () => {
    const card = cardBlock();
    // 版式必须和旁边那几张入口卡**同源**：同一段渐变、同一个内容块、同一个角标胶囊。
    expect(card).toContain("styles.entryShade");
    expect(card).toContain("styles.entryContent");
    expect(card).toContain("styles.entryTitle");
    expect(card).toContain("styles.entrySub");
    expect(card).toContain("styles.entryCountPill");
    // 反向臂：不许退回那种「图标 + 标题 + 副标题 + ›」的横排窄卡。
    expect(card).not.toContain("sportBody");
    expect(card).not.toContain("sportChevron");
    // 尺寸和 entryCard 对齐（圆角 22 / minHeight 224 / 内容压左下）。
    // 只钉这三个不变量，不钉整行样式串 —— 免得改个间距顺序就假红。
    const styleBlock = scene.slice(scene.indexOf("sportCard: {"));
    const styleLine = styleBlock.slice(0, styleBlock.indexOf("},"));
    expect(styleLine).toContain("borderRadius: 22");
    expect(styleLine).toContain("minHeight: 224");
    expect(styleLine).toContain('justifyContent: "flex-end"');
  });

  it("卡上写的是运动 · 羽毛球，副标题描述服务形态", () => {
    const card = cardBlock();
    expect(card).toContain("运动 · 羽毛球");
    expect(card).toContain("陪打 · 场馆 · 按小时计费");
  });

  it("卡点下去开的是陪打整页，不是场景目录那条路", () => {
    const card = cardBlock();
    expect(card).toContain("setBadmintonOpen(true)");
    // 反向臂：它不该走「场景分类」入口那条路（那是场馆目录，不是陪打人列表）。
    expect(card).not.toContain("setDirectoryEntry");
  });

  it("整页接在首页组件上，且开关成对", () => {
    expect(scene).toContain('import { BadmintonCompanion } from "../surfaces/badminton-companion";');
    expect(scene).toContain("<BadmintonCompanion onClose={() => setBadmintonOpen(false)} visible={badmintonOpen} />");
    expect(scene).toContain("const [badmintonOpen, setBadmintonOpen] = useState(false);");
    // 只挂一次 —— 挂两次会同时 present 两个全屏 Modal，iOS 上第二个被吞掉。
    expect((scene.match(/<BadmintonCompanion/g) ?? []).length).toBe(1);
  });

  it("运动图标复用动作表那一份，不另 require 一遍", () => {
    expect(scene).toContain('const SPORT_ACTION_ICON: ImageSource = ACTIONS.find((action) => action.id === "sport")!.icon;');
    // 反向臂：卡里不许再 require 同一个 svg（两处各一份，换图标只换一处）。
    expect(cardBlock()).not.toContain("require(");
  });
});

describe("SPORT-BADMINTON-001 整页只有一个 Modal", () => {
  it("三屏是三个 View，不是三个 Modal", () => {
    // iOS 一次只呈现一个 Modal，第二个 present 被**无声**吞掉（HOME-MORE-SHEET-004）。
    // 城市选择页要是再套一层 Modal，在 iOS 上它不会出现，而且不报错。
    expect((surface.match(/<Modal/g) ?? []).length).toBe(1);
    expect(surface).toContain('presentationStyle="fullScreen"');
  });

  it("换屏靠 state，三屏都在同一个 Modal 里渲染", () => {
    expect(surface).toContain('const [screen, setScreen] = useState<Screen>("list")');
    for (const name of ["list", "city", "detail"]) {
      expect(surface).toContain(`{screen === "${name}" ? render${name[0]!.toUpperCase()}${name.slice(1)}() : null}`);
    }
  });

  it("关掉整页时回到列表，下次进来不留在上次的详情页", () => {
    expect(surface).toContain('setScreen("list");\n    onClose();');
  });
});

describe("SPORT-BADMINTON-001 演示数据的诚实边界", () => {
  it("提示行在，而且列表和详情都带着它", () => {
    // 这条提示行是整份演示数据的免责边界，只挂一处就等于详情页的执照号没人认领。
    expect(surface).toContain("export const BADMINTON_SAMPLE_NOTICE");
    expect((surface.match(/\{BADMINTON_SAMPLE_NOTICE\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("详情页不写「已通过 KYC 认证」这种没人做过的核验结论", () => {
    // 本仓库的 KYC 有真实状态（provider-application-client.ts），还真的当接单闸
    // （ORDER-APPLY-KYC-GATE-001）。给编出来的人写「已通过」，就是把没做过的
    // 核验写成已完成态 —— SUBPAGE-GENERIC-FABRICATED-001 禁的就是这个。
    expect(surface).not.toContain("已通过 KYC");
    expect(surface).not.toContain("KYC 认证");
    // 正向臂：那一行写的是服务形态。
    expect(surface).toContain("场馆合作陪打 · 平台撮合");
  });

  it("「预约陪打」不是一句会撒谎的 toast，是本地演示状态机", () => {
    // 原型的 onclick 是 toast('预约 · 会通知陪打和场馆') —— 它什么都没做。
    // 本仓库不允许死按钮（PLACEHOLDER-001）。
    expect(surface).not.toContain("会通知陪打和场馆");
    expect(surface).toContain("setRequestedRiderId(activeRider.id)");
    // 而且必须在界面上说清它不会真的通知谁 —— 否则「已预约」本身又是一句假话。
    expect(surface).toContain("不会真的通知陪打人或场馆");
    expect(surface).toContain('{requested ? "已预约 · 待确认" : "预约陪打"}');
  });

  it("价格一律过 formatVnd，不写死格式化后的串", () => {
    expect(surface).toContain("formatVnd(rider.priceVnd)");
    expect(surface).toContain("formatVnd(activeRider.priceVnd)");
    expect(surface).not.toContain("350.000");
  });
});

describe("SPORT-BADMINTON-001 原型里没接线的控件，这里都接上了", () => {
  it("四个筛选 chip 真的筛（原型里它们是纯装饰，没有 onclick）", () => {
    expect(surface).toContain("BADMINTON_FILTERS.map((entry) => {");
    expect(surface).toContain("onPress={() => setFilter(entry.id)}");
    expect(surface).toContain("const [filter, setFilter] = useState<BadmintonFilterId>(");
    // 筛选结果真的进了列表判定，不是只改了 chip 的高亮。
    expect(surface).toContain("badmintonRiders(BADMINTON_RIDERS, { cities: selectedCities, filter, keyword })");
  });

  it("城市选择真的筛列表：临时选择 → 完成才生效", () => {
    expect(surface).toContain("onPress={() => toggleDraftCity(city)}");
    expect(surface).toContain("onPress={confirmCities}");
    expect(surface).toContain("setSelectedCities(draftCities);");
    expect(surface).toContain("onPress={() => setDraftCities([])}");
  });

  it("两个搜索框都接了输入，且清空按钮只在有内容时出现", () => {
    expect(surface).toContain("onChangeText={setKeyword}");
    expect(surface).toContain("onChangeText={setCityKeyword}");
    expect((surface.match(/\{keyword\.length > 0 \? \(/g) ?? []).length + (surface.match(/\{cityKeyword\.length > 0 \? \(/g) ?? []).length).toBe(2);
  });

  it("收藏在两处都能切（列表的心 + 详情底部）", () => {
    expect(surface).toContain("onPress={() => toggleFavorite(rider.id)}");
    expect(surface).toContain("onPress={() => toggleFavorite(activeRider.id)}");
    expect(surface).toContain("filled={favorites.includes(rider.id)}");
    expect(surface).toContain("filled={favorited}");
  });

  it("空态的「切换城市」和列表里的「更多 ›」都开城市页", () => {
    expect((surface.match(/onPress={openCityPicker}/g) ?? []).length).toBe(2);
  });

  it("分享走真的系统分享，不是一句 toast", () => {
    expect(surface).toContain("Share.share({");
    expect(surface).toContain("onPress={() => shareRider(activeRider)}");
  });

  it("搜不到时不画假列表，走空态并给一条出路", () => {
    expect(surface).toContain("没有找到匹配的陪打");
    expect(surface).toContain("没有找到「{cityKeyword.trim()}」");
  });
});

describe("SPORT-BADMINTON-001 字号不低于 11pt", () => {
  it("表面里没有小于 11 的字号（R3 typography 底线）", () => {
    // 原型有一堆 8 / 9 / 9.5 / 10.5 —— 照抄就会踩 R3 的字号底线。
    const sizes = [...surface.matchAll(/fontSize:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(15);
    expect(sizes.filter((size) => size < 11)).toEqual([]);
  });

  it("头像字号是按尺寸算的，两个调用点都大于 11", () => {
    // fontSize: size * 0.36 —— 走的是算式，上面的正则扫不到，所以单独钉
    // **调用点的 size**，而不是钉那个 0.36 的写法（钉写法等于钉拼写，改个系数
    // 照样绿）。40 * 0.36 = 14.4，58 * 0.36 = 20.88，都过线。
    expect(surface).toContain("fontSize: size * 0.36");
    const sizes = [...surface.matchAll(/<Avatar rider=\{[^}]*\} size=\{(\d+)\}/g)].map((match) => Number(match[1]));
    expect(sizes).toEqual([40, 58]);
    expect(Math.min(...sizes) * 0.36).toBeGreaterThanOrEqual(11);
  });
});

// SPORT-BADMINTON-HEADER-001（2026-09-25，用户：「返回logo没有用已有的公共组件
// 排版也压住时间了」）。两条都是**看得见的**问题，所以两条都要有钉：
//
//   · 圆形返回/分享钮必须是公共组件 ProxyIconButton —— 之前手写了一份
//     Pressable + styles.backBtn，等于把公共原语复制了一遍；
//   · 详情页那条 topbar 是 absolute，而 **absolute 子节点不继承父级的
//     paddingTop** ⇒ 下面 styles.root 那句 `paddingTop: insets.top` 对它无效，
//     两个圆钮正好压在状态栏的时间和电量上。修法是在它自己身上把 insets.top 加回来。
//     （顺带：角标原本照原型写 `top:16`，而原型那条 topbar 也挂在同一个顶边 ——
//      原型里这两样本来就叠着，角标被压掉一半。我们不复刻这个缺陷。）
describe("SPORT-BADMINTON-HEADER-001 表头：公共组件 + 让开状态栏", () => {
  it("详情页那条 absolute topbar 必须自己让开安全区", () => {
    // 反向臂写在前面：正向臂是「出现了 paddingTop: insets.top + 6」，
    // 先把这一处改回旧写法，正向臂会红 —— 但反向臂就永远走不到了。
    expect(surface, "又变回不带安全区的写法了").not.toContain("[styles.topbar, styles.topbarOverlay]");
    expect(surface).toContain("styles.topbarOverlay, { paddingTop: insets.top + 6 }");
  });

  it("topbarOverlay 的唯一一处使用就是补了 insets.top 的那一处", () => {
    // 结构性判据：不钉「写了 insets.top」这句话，而是钉「用 topbarOverlay 的地方
    // 同一行必须有 insets.top」—— 换个人把 topbarOverlay 挪到别处、或再加一条
    // absolute topbar 忘了补安全区，这条就红。
    const uses = surface.split("\n").filter((line) => line.includes("styles.topbarOverlay"));
    expect(uses, "topbarOverlay 的使用处数量变了，确认一下新那处有没有补 insets.top").toHaveLength(1);
    expect(uses[0]).toContain("insets.top");
  });

  it("圆形图标钮走公共组件，不许再手写一份", () => {
    // 剥过注释，所以文件里那句「不要再手写一份 Pressable + backBtn 样式」喂不饱它。
    const uses = [...surface.matchAll(/<ProxyIconButton /g)].length;
    expect(uses, "列表关闭 / 城市返回 / 详情返回 / 详情分享 共四处都该走公共组件").toBe(4);
    expect(surface, "又手写了一份圆形按钮样式").not.toContain("backBtn");
    // BACK-GLYPH-001（2026-09-26）：这里原来钉的是 import 那一整行原文
    // （`import { ProxyIconButton } from …`）。统一返回字形之后同一个 import 里多了
    // ProxyBackGlyph，行原文就变了 —— 但这条钉要守的**不是**符号个数，而是
    // 「ProxyIconButton 是从公共模块来的」。所以改成只钉这一件事，别把符号表锁死。
    expect(surface).toMatch(/import \{[^}]*\bProxyIconButton\b[^}]*\} from "\.\.\/components\/proxy-foundation";/);
    // 三个返回钮（列表关闭 / 城市返回 / 详情返回）现在走公共字形，不再各自写
    // 一个 size={16} 的 chevronLeft —— 那正是「每个页面自己调尺寸」的老毛病。
    expect(surface, "返回钮又自己画 chevronLeft 了").not.toContain('name="chevronLeft"');
    // 只数「用了这个原语」，不锁属性 —— 详情页那颗因为浮在深色封面上要写
    // tone="onDark"，把标签原文写死会连正确的颜色一起判红。
    expect([...surface.matchAll(/<ProxyBackGlyph\b/g)].length, "三个返回钮都该走 ProxyBackGlyph").toBe(3);
  });

  it("详情页封面角标让开悬浮 topbar，偏移量由公共尺寸算出", () => {
    // 角标不许退回列表卡那个 top:8（那是 110pt 封面的值），否则又会被返回钮压住。
    const at = surface.indexOf("detailCoverBadge:");
    expect(at, "详情页封面角标没有单独定位").toBeGreaterThan(-1);
    expect(surface.slice(at, at + 80)).toContain("top: DETAIL_BADGE_TOP");
    // 偏移量必须是算式（跟着公共按钮尺寸走），不是写死的数。
    expect(surface).toContain("const DETAIL_BADGE_TOP = 6 + foundation.control.md + 10;");
    // 封面高度照原型 260（原型的 .detail-cover{height:260px}）—— 角标让开后需要这点余量。
    expect(surface).toContain("detailCover: { alignItems: \"center\", backgroundColor: color.ink, height: 260");
  });
});
