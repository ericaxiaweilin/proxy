import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { badgeText, relativeTimeKey, sortNewestFirst, unreadCount } from "./notification-bell";

// NOTIF-BELL-001（2026-10-01，用户：「新增了铃铛提醒」）
//
// 原型 docs/design/references/Proxy_Home_Notifications_20261001_7b9953.html 的首页
// 顶栏多了一颗铃铛（角标写死 "9+"），点开是一页「通知」，列表里四条示意数据。
//
// 这条钉守三件事：
//   1. **接线真的接上了** —— `notification` 这个 prop 在 AppShell 里原来是**死的**
//      （只写进类型、从没读过）。钉住它现在真的在拉 ListInbox。
//   2. **角标是数出来的**，不是原型那个写死的 "9+"；0 条不画角标。
//   3. **没有把设计稿的示意数据当真的**：原型那四条（Nguyễn Thị Hương 接受邀请 /
//      盲盒已开启 / KYC 通过 / 收到 12 个赞）后端一条都没有，界面里不许出现。
const sourceRoot = dirname(fileURLToPath(import.meta.url));

// 剥注释再断言：注释里**故意**引用了原型那四条（解释为什么不照抄它们）。
// 不剥的话「代码里没有这些串」这条反向臂会被自己的注释喂绿。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const shell = stripComments(readFileSync(join(sourceRoot, "shell", "app-shell.tsx"), "utf8"));
const center = stripComments(readFileSync(join(sourceRoot, "surfaces", "notification-center.tsx"), "utf8"));
const icon = stripComments(readFileSync(join(sourceRoot, "components", "proxy-icon.tsx"), "utf8"));
// NOTIF-DEEPLINK-ROUTE-001：深链→页面的路由表，单独剥注释读 ——
// 表里那三个「故意不登记」的前缀写在注释里，不剥会喂绿反向臂。
const routes = stripComments(readFileSync(join(sourceRoot, "notif-deeplink-route.ts"), "utf8"));

const item = (over: Partial<{ id: string; read: boolean; createdAt: string }> = {}) => ({
  id: over.id ?? "inbox_1",
  recipientId: "user_x",
  type: "OfferCreated",
  title: "收到 Offer",
  body: "",
  read: over.read ?? false,
  createdAt: over.createdAt ?? "2026-10-01T10:00:00.000Z"
});

describe("NOTIF-BELL-001: 未读数与角标", () => {
  it("只数未读；全读时是 0", () => {
    expect(unreadCount([item({ read: false }), item({ id: "b", read: true }), item({ id: "c", read: false })])).toBe(2);
    expect(unreadCount([item({ read: true })])).toBe(0);
    expect(unreadCount([])).toBe(0);
  });

  it("角标 1–9 原样、>9 收成 9+、0 条**不画角标**（不是画一个 0）", () => {
    expect(badgeText(0)).toBeUndefined();
    expect(badgeText(-1)).toBeUndefined();
    expect(badgeText(1)).toBe("1");
    expect(badgeText(9)).toBe("9");
    expect(badgeText(10)).toBe("9+");
    expect(badgeText(845)).toBe("9+");
  });
});

describe("NOTIF-BELL-001: 相对时间走字典键，不写死中文", () => {
  const now = Date.parse("2026-10-01T12:00:00.000Z");
  it("五档跟 composer-body 的 formatRelativeTime 对齐", () => {
    expect(relativeTimeKey("2026-10-01T11:59:30.000Z", now).key).toBe("notifRelJustNow");
    expect(relativeTimeKey("2026-10-01T11:45:00.000Z", now)).toEqual({ key: "notifRelMinutes", vars: { n: 15 } });
    expect(relativeTimeKey("2026-10-01T09:00:00.000Z", now)).toEqual({ key: "notifRelHours", vars: { n: 3 } });
    expect(relativeTimeKey("2026-09-28T12:00:00.000Z", now)).toEqual({ key: "notifRelDays", vars: { n: 3 } });
    expect(relativeTimeKey("2026-01-01T12:00:00.000Z", now).key).toBe("notifRelOlder");
  });

  it("脏时间戳按「刚刚」处理，不抛（一条坏数据不该让整页白屏）", () => {
    expect(relativeTimeKey("not-a-date", now).key).toBe("notifRelJustNow");
    expect(relativeTimeKey("", now).key).toBe("notifRelJustNow");
  });

  it("返回的是键，不是中文句子 —— 换语言之后这里不会还是中文", () => {
    const { key } = relativeTimeKey("2026-10-01T11:45:00.000Z", now);
    expect(key).not.toMatch(/[\u4e00-\u9fff]/);
  });
});

describe("NOTIF-BELL-001: 列表排序", () => {
  it("新的在上；脏时间戳沉底而不是把整列搅乱", () => {
    const sorted = sortNewestFirst([
      item({ id: "old", createdAt: "2026-09-01T00:00:00.000Z" }),
      item({ id: "bad", createdAt: "nope" }),
      item({ id: "new", createdAt: "2026-10-01T00:00:00.000Z" })
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["new", "old", "bad"]);
  });

  it("不改原数组", () => {
    const input = [item({ id: "a", createdAt: "2026-09-01T00:00:00.000Z" }), item({ id: "b", createdAt: "2026-10-01T00:00:00.000Z" })];
    sortNewestFirst(input);
    expect(input.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("NOTIF-BELL-001: 接线（这条是本次的真病）", () => {
  it("AppShell 真的读了 notification prop —— 它原来是死的", () => {
    // 反向臂在前：改动前 AppShell 里 `notification` 只出现 3 次（import / 解构 / 类型），
    // 一次都不调。把调用删掉，下面第一条立刻红。
    expect(shell, "notification prop 又变回死的了（只声明不读）").toContain("notification.listInbox()");
    expect(shell).toContain("notification");
  });

  it("角标是数出来的，不是原型那个写死的 9+", () => {
    expect(shell).toContain("badgeText(unreadCount(inboxItems))");
    // 顶栏里不许出现字面量角标。
    expect(shell, "顶栏又写死了一个 9+ 角标").not.toContain('badge="9+"');
  });

  it("铃铛字形在 switch 里有实现，路径照抄原型；顶栏真的在用它", () => {
    expect(icon).not.toContain('if (name === "bell") {');
    expect(icon).toContain('case "bell":');
    expect(icon).toContain('d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"');
    expect(icon).toContain('d="M13.73 21a2 2 0 0 1-3.46 0"');
    // 声明了字形但没人画 = 假绿，所以顶栏那一处也要在。
    expect(shell).toContain('name="bell"');
  });

  // 2026-10-02 这条钉**反过来了**（原来的反向臂已经删掉）。
  //
  // 原来写的是「不跳转，因为服务端 ResolveDeepLink 还是个桩」，后来换成
  // 「不跳转，因为客户端没有路由表」。两条理由现在**都不成立**：
  //   - 服务端做了归属校验（NOTIF-DEEPLINK-001）；
  //   - 客户端有了路由表（notif-deeplink-route.ts，只登记真有屏幕的前缀）。
  //
  // 所以现在钉的是**跳转的两道门**都在，而且顺序不能省：
  //   1. deepLinkRouteFor —— 没有对应页面就不跳（编目的地比不跳更糟）；
  //   2. resolveDeepLink —— 这条链接必须真的投递给我（服务端归属，fail-closed）。
  // 只有第 2 条而没有第 1 条 = 跳到不存在的页面；只有第 1 条 = 改 id 就能跳别人的。
  it("点一条先标已读，能跳的才跳（两道门：有页面 + 投递给我）", () => {
    expect(center).toContain("markRead");
    expect(center, "没有页面判定就开始跳 = 编目的地").toContain("deepLinkRouteFor");
    expect(center, "没有归属校验就跳 = 改个 id 能跳到别人的").toContain("resolveDeepLink");
    // 跳转前**先**标已读：读没读是本地状态，跳不跳取决于上面两道门。
    expect(center.indexOf("markRead(item)")).toBeLessThan(center.indexOf("resolveDeepLink"));
    // 归属过了才真的跳 —— 不是「拿到路由就跳」。
    expect(center).toContain("if (resolved) onNavigate(route)");
  });

  it("路由表只登记真有屏幕的前缀（/tasks /vouchers /offers 不许编目的地）", () => {
    for (const prefix of ["/tasks", "/vouchers", "/offers"]) {
      expect(routes, `「${prefix}」被映射到一个不存在的页面`).not.toContain(`"${prefix}"`);
    }
    expect(routes).toContain('"/orders"');
    expect(routes).toContain('"/invitations"');
  });
});

describe("NOTIF-BELL-001: 不把设计稿的示意数据当成真的", () => {
  it("原型那四条通知的文案一条都不许出现在界面代码里", () => {
    for (const ghost of ["Nguyễn Thị Hương", "盲盒", "12 个赞", "已成功开启"]) {
      expect(center, `原型示意数据「${ghost}」被当成真数据渲染了`).not.toContain(ghost);
      expect(shell, `原型示意数据「${ghost}」被当成真数据渲染了`).not.toContain(ghost);
    }
  });

  it("原型那排 tab（全部/互动/匹配/系统）没有实现 —— 跟服务端 type 不是一套", () => {
    // 服务端真实 type：OfferCreated / TaskPublished / SlotOfferCreated / OfferAccepted / OrderCreated。
    // 硬映射成 4 个 tab 就是编分类，所以这里只有一列。
    for (const tab of ["互动", "匹配"]) {
      expect(center, `凭空多了一个「${tab}」分类 tab`).not.toContain(`>${tab}<`);
    }
  });

  it("界面文案全部走字典（不写死中文）", () => {
    expect(center).toContain('t("notifCenterTitle")');
    expect(center).toContain('t("notifCenterEmptyTitle")');
    expect(center).toContain('t("notifCenterEmptyBody")');
  });
});

// 2026-10-01 追加（用户：「没做完整 提醒只弹出半页就可以 不用完整 参考bigo」，
// 随后更正：「没改好 你这改的是下半页提醒 我要的是竖向右半页提醒」）：
// 通知中心从**全屏页**改成**竖向右半页侧栏**。
//
// 下面钉的是结构，不是样式微调。**「半页」的方向**是这组断言的重点 ——
// 第一版做成了底部半屏（按**高度**算、贴底、圆角在顶），被用户否掉，所以这里
// 每一条都配了一个反例臂专门守住那个错法。
describe("NOTIF-PANEL-001: 通知是竖向右半页侧栏，不是底部半屏", () => {
  it("宽度 = 窗口宽度的一半（不是高度的一半）", () => {
    expect(center).toContain("const PANEL_WIDTH_RATIO = 0.5;");
    expect(center).toContain("useWindowDimensions()");
    expect(center).toContain("Math.round(windowWidth * PANEL_WIDTH_RATIO)");
    // 反例臂：按**高度**算 = 底部半屏，就是被否掉的那一版。
    expect(center, "又按高度算面板尺寸了（那是底部半屏的做法）").not.toContain("windowHeight");
    expect(center, "底部半屏那个高度常量回来了").not.toContain("SHEET_HEIGHT_RATIO");
    expect(center, "又变回内容自适应高度了").not.toContain("maxHeight");
    // 反例臂：老的全屏写法（offWhite 铺满 + flex:1）。
    expect(center, "又变回全屏页了").not.toContain("root: { backgroundColor: color.offWhite");
  });

  it("贴右（遮罩是 row + 靠主轴末端），不是贴底", () => {
    // 必须**只在遮罩那一段**里断言：`flexDirection: "row"` 在表头样式里也有一份，
    // 全文件 contains 的话，遮罩翻成 column 了这条还是绿的（假绿）。
    const backdrop = center.slice(center.indexOf("backdrop: {"), center.indexOf("panel: {"));
    expect(backdrop.length, "没切出遮罩样式块").toBeGreaterThan(0);
    expect(backdrop).toContain('flexDirection: "row"');
    expect(backdrop).toContain('justifyContent: "flex-end"');
    expect(center).toContain("onPress={onClose}");
    // 内层 no-op 挡住「点面板本身也关掉」的冒泡。带 ScrollView 的面板必须这么写：
    // LanguageSheet 那个 onStartShouldSetResponder 会抢走 touch start，滚动就废了。
    expect(center).toContain("onPress={() => undefined}");
    // 反例臂：row 容器的交叉轴是**竖直**的，用 alignItems 贴边会把面板压到底部 ——
    // 那正是第一版错法的等价写法，所以明确禁掉。
    expect(backdrop, "用 alignItems 贴边会把面板压到底部去").not.toContain('alignItems: "flex-end"');
  });

  it("圆角只在左边（面板贴右，右侧贴屏幕边缘）", () => {
    expect(center).toContain("borderTopLeftRadius: 24");
    expect(center).toContain("borderBottomLeftRadius: 24");
    expect(center, "右边也圆了 —— 面板贴右时右侧不该有圆角").not.toContain("borderTopRightRadius");
  });

  it("面板里列表要能滚（ScrollView 自己 flex，否则撑破面板）", () => {
    expect(center).toContain("style={styles.scroll}");
    expect(center).toContain("scroll: { flex: 1 }");
  });

  it("表头是关闭的 ×，不是返回箭头（侧栏不是更深一层）", () => {
    expect(center).toContain('name="close"');
    expect(center).toContain('t("close")');
    // ProxyBackGlyph 的注释写明它是全 App 唯一的**返回**字形，不该拿来当关闭用。
    expect(center, "侧栏里混进了返回字形").not.toContain("ProxyBackGlyph");
  });

  it("遮罩和内层容器都不是 a11y 叶子（否则 VoiceOver 读不到面板内容）", () => {
    // 实测（idb ui describe-all）：带 accessibilityLabel 的 Pressable 在 RN 里会变成
    // **a11y 叶子**，把子节点全部吞掉 —— 整棵树只剩遮罩那一个「取消」，标题、× 和每一条
    // 通知都不在树里。两处都要显式 accessible={false}，VoiceOver 才读得到。
    // 数出来应该恰好 2（center 已剥注释，所以注释里提到它不会被算进来）。
    const leaves = center.match(/accessible=\{false\}/g) ?? [];
    expect(leaves.length, "遮罩/内层容器又变成 a11y 叶子了，面板内容对读屏不可见").toBe(2);
  });
});
