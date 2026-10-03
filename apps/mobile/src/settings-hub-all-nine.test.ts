// SETTINGS-HUB-ALL-NINE-001（2026-10-01）
//
// 用户的原话：「丢失了 黑名单管理 服务协议与隐私政策 清理缓存 深色模式 盲盒匹配偏好」。
//
// 上一轮（SETTINGS-HUB-001）按「没有实现就不画」只摆了 4 行，注释里列了 4 条
// 理由。这一轮把 9 行全摆回来 —— 但**摆回来 ≠ 接通**，所以这里逐行钉两件事：
//
//   ① 9 行的图标一个不少，且每个字形在 proxy-icon.tsx 里**真的有形状**。
//      这一条不是形式主义：MasterModuleIcon 的 `default:` 分支是 `return null`
//      —— 类型里声明了名字、switch 里没实现，就是**静默不渲染**，按钮位置上空着。
//      这个仓已经吃过好几次这种亏（search / crosshair / chart 都是这么"有"的）。
//
//   ② 接不通的那几行必须**禁用 + 明写「暂不可用」**，不许摆一个按了没反应的
//      按钮（PLACEHOLDER-001 / UI-HONEST-CAPABILITY-001）。同时也不许"干脆不画"
//      —— 那是上一轮的做法，用户的反应就是「丢失了」。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");

const meRaw = read("./surfaces/me.tsx");
const meCode = stripComments(meRaw);
const iconRaw = read("./components/proxy-icon.tsx");
const iconCode = stripComments(iconRaw);
const cacheSrc = stripComments(read("./feed-disk-cache.ts"));
const i18nRaw = read("./i18n.ts");

const hubStart = meCode.indexOf('subPage.route === "appbehavior"');
const hubEnd = meCode.indexOf('subPage.route === "locationprivacy"');
const hub = hubStart >= 0 && hubEnd > hubStart ? meCode.slice(hubStart, hubEnd) : "";

// 原型 Proxy_Settings_20261001_726714.html 的 9 行，按原型从上到下的顺序。
// 顺序有意义：换了顺序，用户看到的分组顺序就变了。
// route 形如 "subpage" 的行：必须通往一个真的有渲染分支的子页。
const PROTOTYPE_ROWS: ReadonlyArray<{ icon: string; subpage: string | null }> = [
  { icon: "lock", subpage: "settingssecurity" },
  { icon: "shield", subpage: "providerapply" },
  { icon: "heartSolid", subpage: null },
  { icon: "pin", subpage: "locationprivacy" },
  { icon: "blockCircle", subpage: "blocklist" },
  { icon: "fileText", subpage: null },
  { icon: "trash", subpage: null },
  { icon: "globe", subpage: null },
  { icon: "moon", subpage: null }
];

// SETTINGS-BLOCKLIST-001 / SETTINGS-LEGALDOCS-001（2026-10-01，用户：
// 「黑名单还没做 服务隐私也没做 不可用 要做 基本功能」）之后，真正还没接通的
// 只剩两行：深色模式（color 是静态 const，98 文件换肤）与盲盒匹配偏好（另一个产品）。
const NOT_WIRED: ReadonlyArray<string> = ["heartSolid", "moon"];

describe("SETTINGS-HUB-ALL-NINE-001 all nine prototype rows are present", () => {
  it("renders one row per prototype item, in the prototype's order", () => {
    expect(hubStart).toBeGreaterThan(-1);
    // 三种写法都要认（三种都出现过）：`<ProxyIcon name="x" …>`（多数行）、
    // `<BlocklistRow />`（自读 getBlocklist，图标写在组件里）、
    // `SettingsRowUnavailable icon="x"`。只认前一种的话少一行照样绿 ——
    // 那正是本文件要防的假绿。
    //
    // 用**一条**正则按文档顺序扫：分成三次 matchAll 再拼，顺序会错，而这条钉
    // 钉的就是顺序（原型从上到下 9 行，换序 = 用户看到的分组顺序变了）。
    const rowPattern = /<ProxyIcon[^>]*\bname="(\w+)"|<BlocklistRow\b|SettingsRowUnavailable icon="(\w+)"/g;
    const raw = [...hub.matchAll(rowPattern)].map((m) => m[1] ?? m[2] ?? "blockCircle");
    const seen = [...new Set(raw)];
    expect(
      seen,
      `the hub shows [${seen.join(", ")}] — the prototype has 9 rows`
    ).toEqual(PROTOTYPE_ROWS.map((r) => r.icon));
  });

  it("implements every glyph it uses — a name without a shape renders nothing", () => {
    // MasterModuleIcon 的 default 分支是 `return null`：声明了类型但 switch 没
    // 实现 ⇒ 图标位置空白，而且**没有任何报错**。这正是「原型有 logo、模拟器
    // 没有」最可能的成因，所以这里逐个查形状。
    for (const { icon } of PROTOTYPE_ROWS) {
      expect(iconCode, `"${icon}" is used by the settings hub`).toContain(`case "${icon}":`);
      // 真的有路径数据，不是一句 case "x": break;
      const body = iconCode.slice(iconCode.indexOf(`case "${icon}":`));
      const next = body.indexOf("\n    case ", 1);
      const chunk = next > 0 ? body.slice(0, next) : body.slice(0, 400);
      expect(chunk, `"${icon}" has no path data`).toMatch(/<(Path|Circle|Rect|SvgText)/);
    }
  });

  it("keeps the connected rows wired to real sub-pages", () => {
    for (const route of ["settingssecurity", "providerapply", "locationprivacy"]) {
      expect(hub, `${route} row must open a real sub-page`).toContain(`openSubPage("${route}")`);
      // 每个目的地都要有专属渲染分支 —— 落到通用兜底就只剩一句「正在准备」。
      expect(meCode, `${route} has no dedicated render branch`).toContain(`subPage.route === "${route}"`);
    }
    // SETTINGS-BLOCKLIST-001：黑名单这一行真的开子页，且子页有专属渲染分支。
    expect(hub).toContain('openSubPage("blocklist")');
    expect(meCode).toContain('subPage.route === "blocklist"');
    // SETTINGS-LEGALDOCS-001：条款这一行就地开共用查看器（terms/privacy 同一个）。
    expect(hub).toContain('setLegalDocKind("terms")');
    expect(hub).toContain("<LegalDocViewer");
    // 语言行是就地开面板，不是子页。
    expect(hub).toContain("setLanguageSheetOpen(true)");
    // 清理缓存这一行接的是真文件系统。
    expect(meCode).toContain("handleClearCache");
  });

  it("disables the not-yet-wired rows instead of shipping dead buttons", () => {
    // PLACEHOLDER-001：占位按钮不许只弹演示 toast。这里连 toast 都不给 ——
    // 整行没有 onPress，并且明写「暂不可用」。
    const unavailableAt = meCode.indexOf("function SettingsRowUnavailable");
    expect(unavailableAt).toBeGreaterThan(-1);
    const comp = meCode.slice(meCode.indexOf("function SettingsRowUnavailable"));
    expect(comp.slice(0, 900), "the unavailable row must carry a disabled state").toContain("disabled: true");
    expect(comp.slice(0, 900), "the unavailable row must not have an onPress").not.toContain("onPress");
    expect(comp.slice(0, 900), "the unavailable row must say why it is unavailable").toContain('t("settingsRowUnavailable")');

    for (const icon of NOT_WIRED) {
      expect(hub, `${icon} must go through the unavailable row`).toContain(`SettingsRowUnavailable icon="${icon}"`);
    }
  });

  it("never points an unavailable row at a route", () => {
    // 上一轮那句注释把「黑名单管理」整行拿掉的理由是"服务端没有列出黑名单的命令"。
    // 但 placeholder-honest-actions.test.ts 明写「无后端走本地演示状态机」是
    // 允许的。所以"没接通"的正确表达是禁用 + 说明，不是藏起来，也不是
    // 指向一个空的子页。
    for (const icon of NOT_WIRED) {
      const at = hub.indexOf(`SettingsRowUnavailable icon="${icon}"`);
      expect(at).toBeGreaterThan(-1);
      const line = hub.slice(at, hub.indexOf("\n", at));
      expect(line, `${icon} must not open anything`).not.toContain("openSubPage");
    }
  });
});

describe("CACHE-CLEAR-MATURE-001 the cache row clears what a cache actually is", () => {
  const clearSrc = stripComments(read("./clearable-cache.ts"));

  it("clears the OS-designated cache directory, not a hand-picked folder", () => {
    // expo-file-system 的类型定义把这件事写死了：
    //   Paths.cache    : "a place to store files that can be deleted by the system"
    //   Paths.document : "a place to store files that are safe from being deleted"
    // iOS 存储紧张时清的就是 Caches/，Android 应用信息里的「清除缓存」同理。
    // 所以成熟实现只有一条路：清 Paths.cache。
    expect(clearSrc).toContain("Paths.cache");
    // 上一版（SETTINGS-HUB-CACHE-CLEAR-001）只清 proxy-feed-cache 一个目录，
    // 于是行名叫「清理缓存」而实际只删一个 JSON —— 标签与范围不符。
    // 那三个函数现在必须在 clearable-cache.ts，不许留在 feed-disk-cache.ts。
    expect(cacheSrc).not.toContain("feedDiskCacheSize");
    expect(cacheSrc).not.toContain("clearFeedDiskCache");
  });

  it("never puts a user-data directory on the clearable list", () => {
    // 这条是整份白名单存在的意义。本仓在 Paths.document 下有 6 个目录，
    // 其中 5 个是用户数据：feed 偏好 / 自定义源 / **发帖草稿 + 照片** / 头像 /
    // 黑名单。删任何一个都是数据丢失。
    const FORBIDDEN = [
      "proxy-feed-prefs",
      "proxy-custom-feeds",
      "proxy-composer-draft",
      "proxy-store-photos",
      "proxy-profile",
      "proxy-local"
    ];
    for (const dir of FORBIDDEN) {
      expect(clearSrc, `${dir} is user data and must never be clearable as cache`)
        .not.toContain(dir);
    }
    // 而且清理实现里不许出现 Paths.document 本身。
    expect(clearSrc).not.toMatch(/Paths\.document\s*\)/);
  });

  it("recreates the OS cache directory after wiping it", () => {
    // delete() 会把目录本身删掉，而 expo-image / expo-video 之后还要往里写。
    // 不重建的话下一个要缓存东西的库会碰到「目录不存在」。
    expect(clearSrc).toContain('if (root.id === "SYSTEM_CACHE") dir.create({ idempotent: true, intermediates: true });');
  });

  it("reports a partial failure as a failure and never claims freed space for it", () => {
    // 部分没删掉却报一个漂亮的数字，用户会以为清干净了。
    expect(clearSrc).toContain("freedBytes: ok ? Math.max(0, before.totalBytes - after.totalBytes) : 0");
    expect(clearSrc).toMatch(/catch\s*\{\s*failed\.push\(root\.id\);/);
    // 逐个目录 try —— 一个失败不能连带把别的也判失败。
    expect(clearSrc).toContain("for (const root of CLEARABLE_CACHE_ROOTS)");
  });

  it("asks before deleting, and says what will NOT be touched", () => {
    // 删除不可逆。确认框里必须写清「草稿 / 头像 / 黑名单 / 订阅 保留」——
    // 用户看到「清理草稿」会点下去吗？不会。所以那句话不是客套。
    expect(meCode).toContain("Alert.alert(");
    expect(meCode).toContain('t("settingsCacheConfirmBody"');
    expect(meCode).toContain('t("settingsCacheKeptList")');
    expect(meCode).toContain('t("settingsCacheConfirmCta")');
    // 取消是默认选项。
    expect(meCode).toContain('{ text: t("cancel"), style: "cancel" }');
  });

  it("still binds the row to its handler — the dead-row regression", () => {
    // 用户原话：「清理缓存没实现 点击没响应」。
    //
    // 上一版的死法：函数写了，界面那一行却是 <View>，**从没绑到 onPress**。
    // 而当时那条钉只查 `toContain("handleClearCache")` —— 名字在文件里就绿。
    // 「查存在」不等于「查被调用」，这就是本仓反复修的那个洞。
    expect(hub, "the clear-cache row must bind the handler").toContain("onPress={handleClearCache}");
    const at = hub.indexOf("onPress={handleClearCache}");
    const rowStart = hub.lastIndexOf("<Pressable", at);
    expect(rowStart).toBeGreaterThan(-1);
    const rowEnd = hub.indexOf("</Pressable>", at);
    const row = hub.slice(rowStart, rowEnd);
    expect(row).toContain('name="trash"');
    expect(row).toContain('t("settingsRowClearCache")');
    // 清完必须说一句话，且说清释放了多少。
    expect(meCode).toContain("setCacheNotice(");
    expect(meCode).toContain('t("settingsCacheClearedWith"');
    expect(meCode).toContain('t("settingsCacheClearFailed")');
  });
});

describe("SETTINGS-HUB-ALL-NINE-001 the corrected comment says what is actually true", () => {
  it("no longer claims there is no way to measure the cache", () => {
    // 上一轮那段注释里的三条理由，有两条是错的，而"注释里的说法"从来没有被
    // 任何测试读过 —— 于是错话就一直留着。判负跑在**原文**上（含注释），
    // 因为要钉的正是注释。
    expect(meRaw).not.toContain("没有任何能算出缓存体积的来源");
    expect(meRaw).toContain("SETTINGS-HUB-ALL-NINE-001");
    // 而且要写清黑名单/深色模式各自真实的状态，别再一句"没有实现"盖过去。
    expect(meRaw).toContain("Object.freeze");
    expect(meRaw).toContain("走本地");
  });
});

describe("SETTINGS-BLOCKLIST-001 / SETTINGS-LEGALDOCS-001 the two rows are real", () => {
  it("keeps the blocklist on disk, not in a component that forgets on unmount", () => {
    // friend-crm 那个「拉黑」此前是组件内 useState：页面一卸载名单就没了，
    // 用户在设置页根本看不到自己拉黑过谁。所以必须有落盘 + 模块级 store。
    const store = stripComments(read("./blocked-users-store.ts"));
    expect(store).toContain("file.write(JSON.stringify(");
    expect(store).toContain("subscribeBlocklist");
    expect(store).toContain("export function unblockUser");
    // 重复拉黑不能静默成功（返回 false 让调用方说不同的话）。
    expect(store).toContain("export function blockUser(userId: string, displayName: string): boolean");
  });

  it("says the blocklist is device-local instead of implying it syncs", () => {
    // 服务端确实没有「列出黑名单」的命令。界面不写这件事，用户会以为拉黑是
    // 全局的 —— 那是本仓反复修过的"界面承诺了一个不存在的能力"。
    expect(meRaw).toContain("blocklistLocalOnly");
    expect(i18nRaw).toContain("blocklistLocalOnly:");
  });

  it("mounts one shared legal viewer instead of two copies of the document screen", () => {
    const viewer = read("./components/legal-doc-viewer.tsx");
    const native = stripComments(read("./native-app.tsx"));
    // 查看器是一份、两个调用方共用 —— 抄第二份的话，改文案要改两处，
    // 而这正是"翻译了一半"的老毛病。
    expect(viewer).toContain("export function LegalDocViewer");
    expect(native).not.toContain("function LegalDocViewer(");
    expect(native).toContain("from \"./components/legal-doc-viewer\"");
    // 真去服务端拉条款，不是把正文写死在组件里。
    expect(viewer).toContain("new LegalDocClient({ baseUrl: localApiBaseUrl })");
    expect(viewer).toContain("<LegalDocRenderer");
  });
});

describe("SETTINGS-BLOCKLIST-001 the blocklist is one source of truth", () => {
  const crm = stripComments(read("./surfaces/friend-crm.tsx"));

  it("writes to the shared store instead of a component-local list", () => {
    // 之前 friend-crm 的「拉黑」是组件内 useState：页面一卸载名单就没了，
    // 而设置页读的是另一份 —— 于是"我拉黑过谁"这件事在两个页面各有一份真相。
    expect(crm).toContain("blockUser(");
    expect(crm).toContain('from "../blocked-users-store"');
    // 列表必须**按名单过滤**，而不是在拉黑那一刻顺手 filter 掉：后者只处理
    // 一个方向，解封之后人回不来。
    expect(crm).toContain("localFriends.filter((f) => !isBlocked(f.id))");
  });

  it("records a server-side block in the device list too", () => {
    // 服务端成功 ≠ 就不记本机名单：设置页那一页是本机名单（服务端没有列出
    // 黑名单的命令），所以这条必须自己写一份，否则用户看不到自己拉黑过谁。
    expect(crm).toContain("blockUser(friend.userId, friend.name)");
  });

  it("uses a stable snapshot for useSyncExternalStore", () => {
    // 每次返回新数组会无限重渲染 —— 快照必须引用稳定。
    expect(crm).toContain("getBlocklist().map((b) => b.userId).join(");
    expect(crm).toContain("subscribeBlocklist");
  });

  it("shows blocked people gone on entry, without dropping them from the source list", () => {
    // 进页面时已被拉黑的人不该出现；但也不能把他从 localFriends 里真删掉 ——
    // 否则在设置页解封之后他再也回不来。过滤发生在**派生**那一层。
    expect(crm).toContain("const visibleFriends = useMemo(");
    expect(crm).toContain("[localFriends, blockedKey]");
    // 派生层才是喂给 UI 的那份。
    expect(crm).toContain("enrichFriends(visibleFriends)");
  });
});
