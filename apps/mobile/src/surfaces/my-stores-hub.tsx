// STORE-HUB-001：我的店铺 hub（原型 deepseek_html_20260925_2ef163「我的店铺 · 推荐管理」）。
// 列表 → 详情。本页只有店铺 —— 推荐管理不在这里（理由见下面 STORE-HUB-003）。
//
// STORE-HUB-NAV-001（2026-09-25 修）：
//   - **返回按钮归本组件所有**。以前 me.tsx 的 bdash 分支自己画一个「‹ 返回」（退出整页），
//     本组件底部又画一个（同一个动作），详情页顶上再画一个（回列表）⇒ 详情页有两个返回，
//     而用户会点的那个（最上面那个）直接把他踢出「我的店铺」。现在整个 hub 只有一条返回：
//     列表态 = 退出，详情态 = 回列表。me.tsx 那一层不再画 back / title。
//   - **建店入口不在这一页**（STORE-HUB-MOVE-001）。建店 / 二维码归推荐管理，
//     这一页只放**已经处理完**的店；空态 CTA 去推荐管理。
//   - 空态文案不再说「推荐的店被签约后会自动进来」—— 那跟服务端语义相反（采纳 ≠ 店铺已存在）。
//
// STORE-HUB-003（2026-09-25，产品决定）：**「我的店铺」里没有推荐管理。**
// STORE-HUB-002 在页内加过「店铺 | 推荐管理」分段 tab（直接把 StoreRecommendationManage 嵌进来），
// 用户看实机截图后否掉了。三条理由，都不是口味问题：
//   ① 原型 2ef163 的「我的店铺」就是一张店铺列表，没有分段 tab；
//   ② 推荐管理在「我的 → 企业 / 店铺」已经是**独立磁贴**（me.tsx 的 tiles）——
//      页内再嵌一遍 = 同一个功能两个入口、两套壳，用户会分不清哪条是正门；
//   ③ 嵌进来的那一份要自己再传一遍 tabs / 队列入口，等于把 storerecmanage 那一页
//      的分工复制到第二个地方，两边迟早漂。
// 所以这里只留店铺列表。**推荐管理的可达性没丢** —— 由磁贴 + `storerecmanage`
// 路由负责（`store-section-tiles.test.ts` 钉的那 4 个目的地一个没动）。
// 空态里那句「……或先去「推荐管理」推荐新店」也一并去掉：这一页不再往别处指路，
// 只留一个真能点的「建店」。
//
// 诚实边界（都是这轮后端刚补的，没有就砍，没有假数）：
//   - 概览/卡片/详情的单数/满意率/复购/最近接单全部来自 GetStoreOrderStats（只数
//     COMPLETED 归因单；老订单没归因，从 0 开始攒，不回填）；
//   - 星级没有数据源 —— 显示"满意 x%"（FULL 占比），不编 ★4.9；
//   - 品类 chips 只出现我的店里真实存在的品类；对接人/电话/营业时间空就不画那一行；
//   - 打电话（tel:）和复制地址是真动作；电话为空时按钮直接不出现，不摆死按钮；
//   - 最近接单的客人只显示 profile 真名，拿不到叫"到店客人"，绝不露 user_id。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Defs, LinearGradient, Rect, Stop, Svg } from "react-native-svg";
import * as Clipboard from "expo-clipboard";
import { color } from "../theme";
import type { BusinessClient, BusinessStoreWire, StoreLinesWire, StoreProduct, StorePhoto } from "../business-client";
// STORE-CONSOLIDATE-001：菜品图走共享 helper。
import { mediaThumbUrl } from "../media-thumb-url";
// STORE-LOGO-001：店徽解析走既有口径。
import { merchantAvatarUri } from "../business-client";
import { localApiBaseUrl } from "../native-clients";
import type { FulfillmentClient, StoreOrderStats } from "../fulfillment-client";
import type { ProfileClient } from "../profile-client";
import { ProxyBackGlyph, ProxyLoading } from "../components/proxy-foundation";
import {
  coverForStore, filterHubShops, formatFullDate, formatHoursLines, formatMonthDay,
  satisfactionRate, satisfactionRateText, satisfactionText,
} from "../my-store-hub-model";

// 原型 2ef163 的品类（推荐表单同一套）：品类编辑器只给这 6 个 + 清除，不手填 ——
// 手填必然漂移（"咖啡" vs "咖啡厅"），筛选 chips 会裂成两个。
const STORE_CATEGORIES = ["咖啡厅", "SPA", "美甲", "摄影", "茶馆", "酒吧"] as const;
import { SUB_PAGE_CONTENT } from "./me-sub-pages";
// STORE-CONSOLIDATE-001：二维码卡（单店版，从旧 surface 的多店实现重写）。 
import { StoreQrCard } from "../components/store-qr-card";
// STORE-CONSOLIDATE-001：资产编辑子视图复用原子页（编辑态不复制）。
import { Image } from "expo-image";
import { MerchantStorefrontSurface, type StoreAssetScope } from "./merchant-storefront";
// MENU-HOT-001：HOT 徽。
import { HotBadge } from "../components/hot-badge";

// STORE-ASSET-SCOPE-001：子视图只有这三节可进（没有"资产管理"中间页 —— 那一页
// 的门店卡 / 二维码 / 经营数字 / 券 / Creator 和店详情是同一批东西的第二份）。
type HubAssetPage = StoreAssetScope["page"];
const HUB_ASSET_TITLE: Record<HubAssetPage, string> = {
  menu: "菜单与价格",
  photos: "照片与内容",
  details: "经营资料",
};

// 标题只有一处出处（SUB_PAGE_CONTENT.bdash）—— 以前这一屏同时存在四个名字：
// 磁贴「我的店铺」/ 磁贴副文案「企业 · 经营 · 工作台」/ 页内标题「企业 / 店铺资料」/
// 本组件的链接行「店铺资料与二维码」。
const HUB_TITLE = SUB_PAGE_CONTENT.bdash?.title ?? "我的店铺";

type HubShop = {
  store: BusinessStoreWire;
  lines: StoreLinesWire | null;
  stats: StoreOrderStats | null;
  linesFailed: boolean;
  statsFailed: boolean;
};

export function MyStoresHub({ business, fulfillment, profile, onOpenStoreCreate, onOpenVouchers, onBack }: {
  business: BusinessClient;
  fulfillment: FulfillmentClient;
  profile: ProfileClient;
  // STORE-HUB-MOVE-001：建店/二维码归推荐管理 —— 本页只放已建成的店。
  // 空态 CTA 直连建店流程（merchantstorefront）；本页不出现"推荐管理"四字（HUB-003 零出现）。
  onOpenStoreCreate: () => void;
  // STORE-CONSOLIDATE-001（2026-10-02，用户「管理别人看到你的店 有重复的ab版本」选收编）：
  // 「线上店铺」入口并进这一页，券入口要能从店详情点出去 —— 不然券就没地方去了。
  onOpenVouchers?: (() => void) | undefined;
  onBack: () => void;
}): React.JSX.Element {
  const [shops, setShops] = useState<HubShop[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  // STORE-CONSOLIDATE-001（B 口径）：资产编辑子视图开关。
  // STORE-ASSET-SCOPE-001：从「开/关」改成「进哪一节」—— 中间那层资产列表删掉，
  // 因为它整页都是店详情已有内容的第二份（且会连带列出别的主体、别的门店）。
  const [showAssets, setShowAssets] = useState<HubAssetPage | undefined>(undefined);
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<"none" | "recent" | "rate">("none");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [requesterNames, setRequesterNames] = useState<ReadonlyMap<string, string>>(new Map());

  const load = useCallback(async () => {
    setLoadError(undefined);
    setListFailed(false);
    try {
      const accounts = (await business.listMyAccounts()).filter((a) => a.status === "ACTIVE");
      const stores: BusinessStoreWire[] = [];
      for (const account of accounts) {
        try {
          stores.push(...await business.listStores(account.id));
        } catch {
          setListFailed(true);
        }
      }
      const rows = await Promise.all(stores.map(async (store): Promise<HubShop> => {
        const [lines, stats] = await Promise.all([
          business.getStoreLines(store.id).catch(() => null),
          fulfillment.getStoreOrderStats(store.id).catch(() => null),
        ]);
        return {
          store,
          lines,
          stats,
          linesFailed: lines === null,
          statsFailed: stats === null,
        };
      }));
      setShops(rows);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "读取失败");
      setShops(null);
    }
  }, [business, fulfillment]);

  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const row of shops ?? []) {
      const c = (row.store.category ?? "").trim();
      if (c !== "") set.add(c);
    }
    return [...set];
  }, [shops]);

  const overview = useMemo(() => {
    let orders = 0;
    let full = 0;
    let rated = 0;
    for (const row of shops ?? []) {
      if (!row.stats) continue;
      orders += row.stats.orderCount;
      full += row.stats.fullCount;
      rated += row.stats.fullCount + row.stats.partialCount;
    }
    return { count: shops?.length ?? 0, orders, rate: rated > 0 ? Math.round((full / rated) * 100) : undefined };
  }, [shops]);

  const visible = useMemo(() => filterHubShops(
    (shops ?? []).map((row) => ({
      id: row.store.id,
      name: row.store.name,
      address: row.store.address,
      category: (row.store.category ?? "").trim(),
      orderCount: row.stats?.orderCount ?? 0,
      fullCount: row.stats?.fullCount ?? 0,
      partialCount: row.stats?.partialCount ?? 0,
      ...(row.stats?.lastOrderAt ? { lastOrderAt: row.stats.lastOrderAt } : {}),
    })),
    query,
    category,
    sort,
  ), [shops, query, category, sort]);
  const visibleRows = useMemo(() => {
    const byId = new Map((shops ?? []).map((row) => [row.store.id, row]));
    return visible.map((v) => byId.get(v.id)).filter((r): r is HubShop => r !== undefined);
  }, [visible, shops]);

  const selected = shops?.find((row) => row.store.id === selectedId);

  // 最近接单的客人真名（detail 打开时懒加载；拿不到叫"到店客人"）。
  useEffect(() => {
    if (!selected?.stats) return;
    const wanted = selected.stats.recent.map((r) => r.requesterId).filter((id) => !requesterNames.has(id));
    if (wanted.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next = new Map(requesterNames);
      for (const id of wanted) {
        try {
          const p = await profile.getProfile(id);
          const name = p.name.trim();
          if (name !== "") next.set(id, name);
        } catch { /* 留空 = 到店客人 */ }
      }
      if (!cancelled) setRequesterNames(next);
    })();
    return () => { cancelled = true; };
  }, [selected?.stats, profile, requesterNames]);

  const copyAddress = useCallback(async (address: string) => {
    await Clipboard.setStringAsync(address);
    setCopied(true);
  }, []);

  const patchCategory = useCallback((storeId: string, saved: string) => {
    setShops((prev) => prev?.map((row) => row.store.id === storeId
      ? { ...row, store: { ...row.store, category: saved } }
      : row) ?? null);
  }, []);

  if (selected) {
    // STORE-CONSOLIDATE-001（B 口径）：资产编辑是店详情的子视图 —— 菜品/照片/
    // 详情的增删改走原子页（复用，不复制），回来还停在这家店。
    if (showAssets && business) {
      return (
        <View>
          {/* STORE-LOGO-001：从资产编辑回来必须重读。子视图里存了 logo/菜品/
              照片，但 hub 手里那份 row.lines 还是旧的。不重读就是"传了也白传"。
              load() 按 id 保留选中，不会跳页。 */}
          <HubNav
            backLabel={`返回${selected.store.name}`}
            onBack={() => { setShowAssets(undefined); void load(); }}
            title={HUB_ASSET_TITLE[showAssets]}
          />
          {/* STORE-ASSET-SCOPE-001：给原子页一个作用域（这一家店 + 要编的那一节）。
              券 / Creator / 二维码不在这里传 —— 它们已经在店详情里，再画一遍就是
              用户这次指的"重复"。 */}
          <MerchantStorefrontSurface
            client={business}
            scope={{ storeId: selected.store.id, page: showAssets }}
          />
        </View>
      );
    }
    return (
      <View>
        <HubNav
          backLabel="返回店铺列表"
          onBack={() => { setSelectedId(undefined); setCopied(false); setShowAssets(undefined); }}
          title={selected.store.name}
        />
        <StoreDetail
          row={selected}
          copied={copied}
          requesterNames={requesterNames}
          business={business}
          onCategorySaved={patchCategory}
          onCopyAddress={() => void copyAddress(selected.store.address)}
          onOpenVouchers={onOpenVouchers}
          onManageProducts={(page) => setShowAssets(page)}
        />
      </View>
    );
  }

  return (
    <View>
      <HubNav backLabel="返回" onBack={onBack} title={HUB_TITLE} />

      <View style={s.overview}>
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="storeHubOverview" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#1E1B16" />
              <Stop offset="1" stopColor="#2E2A24" />
            </LinearGradient>
          </Defs>
          <Rect height="100%" rx={18} ry={18} width="100%" x="0" y="0" fill="url(#storeHubOverview)" />
        </Svg>
        <View style={s.ovRow}>
          <View style={s.ovItem}><Text selectable style={s.ovNumDark}>{overview.count}</Text><Text selectable style={s.ovLabelDark}>合作店铺</Text></View>
          <View style={s.ovItem}><Text selectable style={s.ovNumDark}>{overview.orders}</Text><Text selectable style={s.ovLabelDark}>累计接单</Text></View>
          <View style={s.ovItem}><Text selectable style={s.ovNumDark}>{overview.rate === undefined ? "—" : `${overview.rate}%`}</Text><Text selectable style={s.ovLabelDark}>平均满意率</Text></View>
        </View>
      </View>

      <View style={s.searchBox}>
        <Text selectable style={s.searchIcon}>⌕</Text>
        <TextInput onChangeText={setQuery} placeholder="搜索店铺、区域、类型" placeholderTextColor={color.muted} style={s.searchInput} value={query} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={s.chipsContent}>
        {["全部", ...categories].map((c) => {
          const value = c === "全部" ? "" : c;
          const on = category === value && sort === "none";
          return <Pressable accessibilityLabel={`筛选 ${c}`} key={c} onPress={() => { setCategory(value); setSort("none"); }} style={[s.chip, on && s.chipOn]}>
            <Text selectable style={[s.chipText, on && s.chipTextOn]}>{c}</Text>
          </Pressable>;
        })}
        <Pressable accessibilityLabel="按最近使用排序" onPress={() => setSort((v) => v === "recent" ? "none" : "recent")} style={[s.chip, sort === "recent" && s.chipOn]}>
          <Text selectable style={[s.chipText, sort === "recent" && s.chipTextOn]}>最近使用</Text>
        </Pressable>
        <Pressable accessibilityLabel="按满意率排序" onPress={() => setSort((v) => v === "rate" ? "none" : "rate")} style={[s.chip, sort === "rate" && s.chipOn]}>
          <Text selectable style={[s.chipText, sort === "rate" && s.chipTextOn]}>满意率优先</Text>
        </Pressable>
      </ScrollView>

      <View style={s.secHead}>
        <Text selectable style={s.secTitle}>{category === "" ? "全部合作店铺" : category}</Text>
        <Text selectable style={s.secCount}>{visibleRows.length} 家</Text>
      </View>

      {shops === null ? (
        loadError ? <Text selectable style={s.error}>{loadError}</Text> : <ProxyLoading label="正在读取合作店铺" tone="muted" />
      ) : visibleRows.length === 0 ? (
        <View style={s.empty}>
          <Text selectable style={s.emptyTitle}>{shops.length === 0 ? "还没有你的店" : "没有找到店铺"}</Text>
          <Text selectable style={s.emptyText}>
            {shops.length === 0
              ? "推荐被采纳不等于店铺已存在 —— 要有人真的把店建出来才算接入。现在建一家。"
              : "换个关键词或切回「全部」试试。"}
          </Text>
          {shops.length === 0 ? (
            <Pressable accessibilityLabel="建店" onPress={onOpenStoreCreate} style={s.emptyCta}>
              <Text selectable style={s.emptyCtaText}>建店</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        visibleRows.map((row) => {
          const cover = coverForStore(row.store.category?.trim() || row.store.name);
          const last = row.stats ? formatMonthDay(row.stats.lastOrderAt) : "";
          return <Pressable accessibilityLabel={`店铺 ${row.store.name}`} key={row.store.id} onPress={() => { setSelectedId(row.store.id); setShowAssets(undefined); }} style={s.card}>
            <View style={[s.cover, { backgroundColor: cover.from }]}>
              <Text selectable style={[s.coverText, { color: cover.ink }]}>{row.store.name.slice(0, 1)}</Text>
            </View>
            <View style={s.cardBody}>
              <Text selectable style={s.cardName} numberOfLines={1}>{row.store.name}</Text>
              <Text selectable style={s.cardMeta} numberOfLines={1}>
                {[row.store.address, row.store.category?.trim()].filter((v) => v).join(" · ") || "地址待补充"}
              </Text>
              <View style={s.cardFoot}>
                {row.statsFailed ? <Text selectable style={s.cardTagMuted}>接单数读不出来</Text> : <>
                  <Text selectable style={s.cardTag}>{row.stats ? `${row.stats.orderCount} 单` : "—"}</Text>
                  <Text selectable style={s.cardTag}>{row.stats ? satisfactionRateText(row.stats.fullCount, row.stats.partialCount) : "—"}</Text>
                  {last !== "" ? <Text selectable style={s.cardTagMuted}>末单 {last}</Text> : null}
                </>}
              </View>
            </View>
            <Text selectable style={s.arrow}>›</Text>
          </Pressable>;
        })
      )}
      {listFailed ? <Text selectable style={s.error}>部分店铺没读出来，下拉刷一下试试。</Text> : null}
    </View>
  );
}

// STORE-HUB-NAV-001：全 hub 唯一的返回条。列表态退到「我的」，详情态回列表。
//
// BACK-GLYPH-001（2026-09-26）：backLabel 现在只写**文字**，字形由公共组件
// ProxyBackGlyph 画。原来这里传的是 `"‹"`（只有字形、没有目的地）—— 那正是
// STORE-HUB-NAV-001 那条钉要防的事：标签不写目的地，就等于替用户猜。
// 两个落点必须各写各的：「返回」（回我的）/「返回店铺列表」（回列表）。
function HubNav({ backLabel, onBack, title }: {
  backLabel: string;
  onBack: () => void;
  title: string;
}): React.JSX.Element {
  return (
    <View>
      <Pressable accessibilityLabel={title ? `返回${title}` : "返回"} onPress={onBack} style={s.backRow}>
        <ProxyBackGlyph label={backLabel} />
      </Pressable>
      <Text selectable style={s.navTitle}>{title}</Text>
    </View>
  );
}

function StoreDetail({ row, copied, requesterNames, business, onCategorySaved, onCopyAddress, onOpenVouchers, onManageProducts }: {
  row: HubShop;
  copied: boolean;
  requesterNames: ReadonlyMap<string, string>;
  business: BusinessClient;
  onCategorySaved: (storeId: string, category: string) => void;
  onCopyAddress: () => void;
  // STORE-CONSOLIDATE-001：券入口从 MerchantStorefrontSurface 搬过来。
  onOpenVouchers?: (() => void) | undefined;
  // STORE-CONSOLIDATE-001（B 口径）：菜品在这里只看，编辑走原子页。
  // STORE-ASSET-SCOPE-001：入口直接说清进哪一节（menu / photos / details），
  // 不再统一跳一个"资产管理"列表 —— 那一页是店详情内容的第二份。
  onManageProducts: (page: HubAssetPage) => void;
}): React.JSX.Element {
  const cover = coverForStore(row.store.category?.trim() || row.store.name);
  // STORE-LOGO-001：店徽（lines.logoAssetPath）。空就是没传，走首字 fallback。
  const storeLogoUri = merchantAvatarUri(row.lines?.logoAssetPath || undefined, localApiBaseUrl);
  const stats = row.stats;
  const rate = stats ? satisfactionRate(stats.fullCount, stats.partialCount) : undefined;
  const repeatCount = stats?.repeatRequesters ?? 0;
  const contactName = (row.lines?.contactName ?? "").trim();
  const contactPhone = (row.lines?.contactPhone ?? "").trim();
  const address = row.store.address.trim();
  const hours = formatHoursLines(row.lines?.hoursJson ?? "");
  const desc = (row.lines?.description ?? "").trim();
  const joinedDate = formatFullDate(row.store.createdAt);
  const infoRows: Array<[string, string]> = [];
  infoRows.push(["店名", row.store.name]);
  if (address !== "") infoRows.push(["地址", address]);
  if (contactName !== "" || contactPhone !== "") {
    infoRows.push(["对接人", [contactName, contactPhone].filter((v) => v !== "").join(" · ")]);
  }
  if (desc !== "") infoRows.push(["简介", desc]);
  if (joinedDate !== "") infoRows.push(["入驻时间", joinedDate]);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | undefined>(undefined);
  // STORE-CONSOLIDATE-001：本店菜品只读列表（编辑走原子页）。读不到就不画这一节，
  // 不拿"0 道菜"冒充"这家店没菜"。
  const [products, setProducts] = useState<StoreProduct[] | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setProducts(undefined);
    business.listProducts(row.store.id).then((list) => { if (active) setProducts(list); }).catch(() => { if (active) setProducts([]); });
    return () => { active = false; };
  }, [business, row.store.id]);
  // STORE-CONSOLIDATE-001：店照片只看列表（编辑走原子页）。读不到就不画这一节。
  const [photos, setPhotos] = useState<StorePhoto[] | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setPhotos(undefined);
    business.listStorePhotos(row.store.id).then((list) => { if (active) setPhotos(list); }).catch(() => { if (active) setPhotos([]); });
    return () => { active = false; };
  }, [business, row.store.id]);
  const saveCategory = (value: string): void => {
    if (value === (row.store.category ?? "").trim() || savingCategory) return;
    setSavingCategory(true);
    setCategoryError(undefined);
    business.setStoreCategory(row.store.id, value).then(
      (saved) => { onCategorySaved(row.store.id, (saved.category ?? "").trim()); },
      (e: unknown) => { setCategoryError(e instanceof Error ? e.message : "保存失败"); },
    ).finally(() => { setSavingCategory(false); });
  };

  return (
    <View>
      <View style={s.hero}>
        {/* STORE-LOGO-001：店视觉优先级 logo → 首字。logo 走 merchantAvatarUri
            解析（assets/ 前缀 → thumb）；没有 logo 就老实显示首字，不拿用户
            头像也不拿菜品图冒充（MERCHANT-AVATAR-001 同一条规矩）。 */}
        {storeLogoUri ? (
          <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: storeLogoUri }} style={s.heroLogo} transition={0} />
        ) : (
        <View style={[s.heroCover, { backgroundColor: cover.from }]}>
          <Text selectable style={[s.heroCoverText, { color: cover.ink }]}>{row.store.name.slice(0, 1)}</Text>
        </View>
        )}
        <View style={s.heroInfo}>
          <Text selectable style={s.heroName}>{row.store.name}</Text>
          <Text selectable style={s.heroMeta}>
            {[address, row.store.category?.trim()].filter((v) => v).join(" · ") || "地址待补充"}
          </Text>
          <View style={s.badge}><Text selectable style={s.badgeText}>{row.store.status === "ACTIVE" ? "合作中" : row.store.status}</Text></View>
        </View>
      </View>

      <View style={s.overview}>
        <View style={s.ovRow}>
          <View style={s.ovItem}><Text selectable style={s.ovNum}>{stats ? stats.orderCount : "—"}</Text><Text selectable style={s.ovLabel}>累计接单</Text></View>
          <View style={s.ovItem}><Text selectable style={s.ovNum}>{rate === undefined ? "—" : `${rate}%`}</Text><Text selectable style={s.ovLabel}>满意率</Text></View>
          <View style={s.ovItem}><Text selectable style={s.ovNum}>{stats ? repeatCount : "—"}</Text><Text selectable style={s.ovLabel}>复购客户</Text></View>
        </View>
      </View>
      {row.statsFailed ? <Text selectable style={s.error}>接单数据没读出来，稍后再试。</Text> : null}

      <View style={s.secHead}>
        <Text selectable style={s.secTitle}>店铺信息</Text>
        {/* STORE-ASSET-SCOPE-001：编辑简介 / 联系方式 / 营业时间的入口。它原来只在
            "资产管理"那层（旧资产列表的"店铺照片与经营资料"）—— 中间页删掉后这条
            能力不能跟着没，所以挂在它改的那一节上。 */}
        <Pressable accessibilityLabel="编辑经营资料" onPress={() => onManageProducts("details")} style={s.sectionEdit}>
          <Text selectable style={s.sectionEditText}>编辑</Text>
        </Pressable>
      </View>
      <View style={s.infoCard}>
        {infoRows.map(([label, value]) => (
          <View key={label} style={s.infoRow}>
            <Text selectable style={s.infoLabel}>{label}</Text>
            <Text selectable style={s.infoValue}>{value}</Text>
          </View>
        ))}
        {hours.length > 0 ? (
          <View style={s.infoRow}>
            <Text selectable style={s.infoLabel}>营业时间</Text>
            <Text selectable style={s.infoValue}>{hours.join("\n")}</Text>
          </View>
        ) : null}
        {row.linesFailed ? <Text selectable style={s.error}>店铺资料没读出来，稍后再试。</Text> : null}
      </View>

      {/* 品类决定列表 chips 里出现什么：只给原型那 6 个 + 清除，不手填。 */}
      <Text selectable style={s.secTitle}>店铺品类</Text>
      <View style={s.catRow}>
        {STORE_CATEGORIES.map((c) => {
          const on = (row.store.category ?? "").trim() === c;
          return <Pressable accessibilityLabel={`品类 ${c}`} disabled={savingCategory} key={c} onPress={() => saveCategory(c)} style={[s.chip, on && s.chipOn]}>
            <Text selectable style={[s.chipText, on && s.chipTextOn]}>{c}</Text>
          </Pressable>;
        })}
        {(row.store.category ?? "").trim() !== "" ? (
          <Pressable accessibilityLabel="清除品类" disabled={savingCategory} onPress={() => saveCategory("")} style={s.chip}>
            <Text selectable style={s.chipText}>清除</Text>
          </Pressable>
        ) : null}
      </View>
      {savingCategory ? <Text selectable style={s.mutedLine}>保存品类中…</Text> : null}
      {categoryError ? <Text selectable style={s.error}>{categoryError}</Text> : null}

      <View style={s.secHead}>
        <Text selectable style={s.secTitle}>最近接单</Text>
        <Text selectable style={s.secCount}>{stats ? `${stats.recent.length} 条` : ""}</Text>
      </View>
      {stats && stats.recent.length > 0 ? stats.recent.map((r) => (
        <View key={r.orderId} style={s.orderRow}>
          <View style={s.orderAvatar}><Text selectable style={s.orderAvatarText}>{(requesterNames.get(r.requesterId) ?? "客").slice(0, 1)}</Text></View>
          <View style={s.orderBody}>
            <Text selectable style={s.orderName}>{requesterNames.get(r.requesterId) ?? "到店客人"}</Text>
            <Text selectable style={s.orderMeta}>{[r.serviceSku, formatMonthDay(r.completedAt)].filter((v) => v !== "").join(" · ")}</Text>
          </View>
          <Text selectable style={s.orderRating}>{satisfactionText(r.satisfaction)}</Text>
        </View>
      )) : (
        <Text selectable style={s.emptyText}>还没有接单记录 — 订单完成时归因到这家店，这里才有数。</Text>
      )}

      {/* STORE-CONSOLIDATE-001：二维码（旧 surface 那份是多店语境，这里是单店组件）。 */}
      <Text selectable style={s.secTitle}>店铺二维码</Text>
      <StoreQrCard storeId={row.store.id} storeName={row.store.name} />

      {/* STORE-CONSOLIDATE-001（2026-10-02，用户选收编）：券入口和 Creator 权益
          从 MerchantStorefrontSurface 搬过来 —— 那边删掉独立入口后，这两样不能
          没地方去。券是跳出去（券中心），Creator 现在还是空面板（对外的展示页
          没做，配好暂时只有自己看得到 —— 原样搬，不美化空态）。 */}
      {onOpenVouchers ? (
        <Pressable accessibilityLabel="查看当前礼券" onPress={onOpenVouchers} style={s.assetRow}>
          <View style={s.assetIcon}><Text selectable style={s.assetIconText}>券</Text></View>
          <View style={s.assetMain}>
            <Text selectable style={s.assetTitle}>当前礼券</Text>
            <Text selectable style={s.assetMeta}>查看发行、领取与核销状态</Text>
          </View>
          <Text selectable style={s.assetChevron}>›</Text>
        </Pressable>
      ) : null}
      <Text selectable style={s.secTitle}>Creator 权益</Text>
      <Text selectable style={s.emptyText}>设置 Creator 到店体验、内容合作与专属权益；对外的展示页还没做，配好之后暂时只有你自己看得到。</Text>

      {/* STORE-CONSOLIDATE-001（B 口径）：菜品在这里只看 —— 读 products 显示
          列表与图。编辑（增删改、传图、上下架）走原子页，不在这里复制那 300 行。
          products 为 undefined = 还没读出来，不画；读出来是 [] = 这家店真没菜。 */}
      {products !== undefined ? (<>
        <View style={s.secHead}>
          <Text selectable style={s.secTitle}>菜品</Text>
          <Text selectable style={s.secCount}>{products.length > 0 ? `${products.length} 道` : ""}</Text>
        </View>
        {products.filter((m) => m.available !== false).slice(0, 6).map((m) => {
          const thumb = mediaThumbUrl(m.mediaAssetId, localApiBaseUrl);
          return (
            <View key={m.id} style={s.skuRow}>
              {thumb ? (
                <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: thumb }} style={s.skuThumb} transition={0} />
              ) : (
                <View style={s.skuThumbEmpty}><Text selectable style={s.skuThumbText}>{m.name.slice(0, 1)}</Text></View>
              )}
              <View style={s.skuMain}>
                <View style={s.skuNameRow}>
                  <Text selectable style={s.skuName} numberOfLines={1}>{m.name}</Text>
                  {m.isHot ? <HotBadge /> : null}
                </View>
                <Text selectable style={s.skuMeta}>{m.category || "未分类"}{m.available === false ? " · 已下架" : ""}</Text>
              </View>
            </View>
          );
        })}
        {products.length === 0 ? <Text selectable style={s.emptyText}>还没有菜品 — 去原子页添加第一道菜。</Text> : null}
        <Pressable accessibilityLabel="管理菜品" onPress={() => onManageProducts("menu")} style={s.ghostBtn}>
          <Text selectable style={s.ghostText}>管理菜品</Text>
        </Pressable>

      {/* STORE-CONSOLIDATE-001：店照片只看。旧面"照片与内容"那一节搬过来的是
          展示部分（缩略图墙 + 张数），上传/删除/排序走原子页，不在这里复制。 */}
      {photos !== undefined ? (<>
        <View style={s.secHead}>
          <Text selectable style={s.secTitle}>店铺照片</Text>
          <Text selectable style={s.secCount}>{photos.length > 0 ? `${photos.length} 张` : ""}</Text>
        </View>
        {photos.length > 0 ? (
          <View style={s.photoWall}>
            {photos.slice(0, 6).map((p) => {
              const thumb = mediaThumbUrl(p.mediaAssetId, localApiBaseUrl);
              return thumb ? (
                <Image key={p.id} cachePolicy="memory-disk" contentFit="cover" source={{ uri: thumb }} style={s.photoThumb} transition={0} />
              ) : (
                <View key={p.id} style={s.photoThumbEmpty}><Text selectable style={s.photoThumbText}>图</Text></View>
              );
            })}
          </View>
        ) : <Text selectable style={s.emptyText}>还没有店铺照片 — 去原子页上传第一张。</Text>}
        <Pressable accessibilityLabel="管理照片" onPress={() => onManageProducts("photos")} style={s.ghostBtn}>
          <Text selectable style={s.ghostText}>管理照片</Text>
        </Pressable>
      </>) : null}
      </>) : null}

      <View style={s.footerBtns}>
        {contactPhone !== "" ? (
          <Pressable accessibilityLabel={`打电话 ${contactPhone}`} onPress={() => void Linking.openURL(`tel:${contactPhone.replace(/\s/g, "")}`)} style={s.ghostBtn}>
            <Text selectable style={s.ghostText}>打电话</Text>
          </Pressable>
        ) : null}
        {address !== "" ? (
          <Pressable accessibilityLabel="复制店铺地址" onPress={onCopyAddress} style={s.limeBtn}>
            <Text selectable style={s.limeText}>{copied ? "已复制" : "复制地址"}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // 原型 2ef163 的深色概览卡（列表 + 详情共用）：白字，分隔线淡白。
  overview: { borderRadius: 18, marginBottom: 14, overflow: "hidden", paddingVertical: 16 },
  ovRow: { flexDirection: "row" },
  ovItem: { alignItems: "center", flex: 1, gap: 4 },
  ovNumDark: { color: color.white, fontSize: 20, fontWeight: "900" },
  ovLabelDark: { color: "#A79EAF", fontSize: 11, fontWeight: "700" },
  ovNum: { color: color.ink, fontSize: 20, fontWeight: "900" },
  ovLabel: { color: color.muted, fontSize: 11, fontWeight: "700" },
  searchBox: { alignItems: "center", backgroundColor: color.surface, borderRadius: 12, flexDirection: "row", gap: 8, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 10 },
  searchIcon: { color: color.muted, fontSize: 14, fontWeight: "800" },
  searchInput: { color: color.ink, flex: 1, fontSize: 14 },
  chips: { marginBottom: 12 },
  chipsContent: { flexDirection: "row", gap: 8, paddingRight: 8 },
  chip: { backgroundColor: color.surface, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: color.ink },
  chipText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  chipTextOn: { color: color.white },
  secHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 8, marginTop: 4 },
  secTitle: { color: color.ink, fontSize: 15, fontWeight: "900" },
  secCount: { color: color.muted, fontSize: 12, fontWeight: "800" },
  // STORE-ASSET-SCOPE-001：节标题右边的小编辑入口（挂在它改的那一节上）。
  sectionEdit: { paddingHorizontal: 6, paddingVertical: 2 },
  sectionEditText: { color: color.violet, fontSize: 12, fontWeight: "900" },
  card: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 10, padding: 12 },
  cover: { alignItems: "center", borderRadius: 12, height: 52, justifyContent: "center", width: 52 },
  coverText: { fontSize: 22, fontWeight: "900" },
  cardBody: { flex: 1, gap: 3 },
  cardName: { color: color.ink, fontSize: 14, fontWeight: "900" },
  cardMeta: { color: color.muted, fontSize: 11, fontWeight: "700" },
  cardFoot: { flexDirection: "row", gap: 8, marginTop: 2 },
  cardTag: { color: color.ink, fontSize: 11, fontWeight: "800" },
  cardTagMuted: { color: color.muted, fontSize: 11, fontWeight: "700" },
  arrow: { color: color.muted, fontSize: 18, fontWeight: "800" },
  empty: { alignItems: "center", gap: 6, paddingVertical: 28 },
  emptyCta: { alignItems: "center", alignSelf: "stretch", backgroundColor: color.ink, borderRadius: 14, marginTop: 8, paddingVertical: 13 },
  emptyCtaText: { color: color.white, fontSize: 14, fontWeight: "900" },
  emptyTitle: { color: color.ink, fontSize: 14, fontWeight: "900" },
  emptyText: { color: color.muted, fontSize: 12, fontWeight: "700", textAlign: "center" },
  error: { color: color.error, fontSize: 12, fontWeight: "700", marginTop: 8 },
  linkRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingHorizontal: 14, paddingVertical: 13 },
  linkText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  backRow: { alignSelf: "flex-start", paddingVertical: 6 },
  // backText 已删：字形和标签都由公共组件 ProxyBackGlyph 画（BACK-GLYPH-001）。
  navTitle: { color: color.ink, fontSize: 18, fontWeight: "800", marginBottom: 10 },
  hero: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 14, marginBottom: 14, padding: 16 },
  heroCover: { alignItems: "center", borderRadius: 14, height: 64, justifyContent: "center", width: 64 },
  heroCoverText: { fontSize: 28, fontWeight: "900" },
  heroInfo: { flex: 1, gap: 4 },
  heroName: { color: color.ink, fontSize: 17, fontWeight: "900" },
  heroMeta: { color: color.muted, fontSize: 12, fontWeight: "700" },
  badge: { alignSelf: "flex-start", backgroundColor: color.factConfirmedBg, borderRadius: 999, marginTop: 2, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { color: color.factConfirmedFg, fontSize: 11, fontWeight: "900" },
  infoCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginBottom: 6, paddingHorizontal: 14, paddingVertical: 6 },
  infoRow: { borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 12, paddingVertical: 10 },
  infoLabel: { color: color.muted, fontSize: 12, fontWeight: "800", width: 64 },
  infoValue: { color: color.ink, flex: 1, fontSize: 13, fontWeight: "700", lineHeight: 19 },
  orderRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 10 },
  orderAvatar: { alignItems: "center", backgroundColor: color.surface, borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  orderAvatarText: { color: color.muted, fontSize: 15, fontWeight: "900" },
  orderBody: { flex: 1, gap: 2 },
  orderName: { color: color.ink, fontSize: 13, fontWeight: "900" },
  orderMeta: { color: color.muted, fontSize: 11, fontWeight: "700" },
  orderRating: { color: color.ink, fontSize: 12, fontWeight: "800" },
  // STORE-CONSOLIDATE-001：从 MerchantStorefrontSurface 搬过来的资产行样式。
  assetRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E8E4E0", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 8, padding: 12 },
  assetIcon: { alignItems: "center", backgroundColor: "#F4F0EA", borderRadius: 999, height: 34, justifyContent: "center", width: 34 },
  assetIconText: { color: "#6D5B4D", fontSize: 13, fontWeight: "900" },
  assetMain: { flex: 1, minWidth: 0 },
  assetTitle: { color: "#1C191D", fontSize: 13, fontWeight: "800" },
  assetMeta: { color: "#8A8380", fontSize: 11, marginTop: 2 },
  assetChevron: { color: "#B8B0AA", fontSize: 15, fontWeight: "800" },
  // STORE-CONSOLIDATE-001：SKU 只看行 + 子视图返回行。
  skuRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E8E4E0", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 8, padding: 10 },
  skuThumb: { backgroundColor: "#F4F0EA", borderRadius: 10, height: 48, width: 48 },
  skuThumbEmpty: { alignItems: "center", backgroundColor: "#F4F0EA", borderRadius: 10, height: 48, justifyContent: "center", width: 48 },
  skuThumbText: { color: "#8A8380", fontSize: 15, fontWeight: "900" },
  skuMain: { flex: 1, minWidth: 0 },
  skuNameRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  skuName: { color: "#1C191D", flexShrink: 1, fontSize: 13, fontWeight: "800" },
  skuMeta: { color: "#8A8380", fontSize: 11, marginTop: 2 },
  // STORE-LOGO-001：详情 hero 的店徽（和首字占位同尺寸）。
  heroLogo: { borderRadius: 14, height: 64, width: 64 },
  // STORE-CONSOLIDATE-001：照片墙（3 列缩略图）。
  photoWall: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  photoThumb: { backgroundColor: "#F4F0EA", borderRadius: 10, height: 104, width: "31%" },
  photoThumbEmpty: { alignItems: "center", backgroundColor: "#F4F0EA", borderRadius: 10, height: 104, justifyContent: "center", width: "31%" },
  photoThumbText: { color: "#8A8380", fontSize: 14, fontWeight: "900" },
  footerBtns: { flexDirection: "row", gap: 10, marginTop: 12 },
  ghostBtn: { alignItems: "center", borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 13 },
  ghostText: { color: color.ink, fontSize: 14, fontWeight: "900" },
  primaryBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 14, flex: 1, paddingVertical: 13 },
  primaryText: { color: color.white, fontSize: 14, fontWeight: "900" },
  // 原型 lime 主按钮（复制地址）。
  limeBtn: { alignItems: "center", backgroundColor: color.lime, borderRadius: 14, flex: 1, paddingVertical: 13 },
  limeText: { color: color.ink, fontSize: 14, fontWeight: "900" },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  mutedLine: { color: color.muted, fontSize: 12, fontWeight: "700", marginTop: 6 },
});
