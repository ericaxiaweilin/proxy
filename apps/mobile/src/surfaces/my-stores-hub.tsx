// STORE-HUB-001：我的店铺 hub（原型 deepseek_html_20260925_2ef163「我的店铺 · 推荐管理」）。
// 列表 → 详情。本页只有店铺 —— 推荐管理不在这里（理由见下面 STORE-HUB-003）。
//
// STORE-HUB-NAV-001（2026-09-25 修）：
//   - **返回按钮归本组件所有**。以前 me.tsx 的 bdash 分支自己画一个「‹ 返回」（退出整页），
//     本组件底部又画一个（同一个动作），详情页顶上再画一个（回列表）⇒ 详情页有两个返回，
//     而用户会点的那个（最上面那个）直接把他踢出「我的店铺」。现在整个 hub 只有一条返回：
//     列表态 = 退出，详情态 = 回列表。me.tsx 那一层不再画 back / title。
//   - **建店入口**。这一页以前没有任何建店动作，而推荐管理在 ACCEPTED 态又把人指过来
//     ⇒ 那条 CTA 是死路（与 merchant-storefront 里「两处空态互相指'去别处建'，实际无入口」
//     是同一个 bug）。现在空态和页脚都有建店，落到 merchantstorefront（全 App 唯一的建店流程：
//     账号 + 首店一次建完）。
//     ⚠️ STORE-HUB-004 之后，推荐管理 ACCEPTED 的 CTA **直接**落 merchantstorefront，
//     不再绕经这一页 —— 那一屏（workspace）才是建店的地方，这一页只放**已经处理完**的店。
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
import type { BusinessClient, BusinessStoreWire, StoreLinesWire } from "../business-client";
import type { FulfillmentClient, StoreOrderStats } from "../fulfillment-client";
import type { ProfileClient } from "../profile-client";
import { ProxyLoading } from "../components/proxy-foundation";
import {
  coverForStore, filterHubShops, formatFullDate, formatHoursLines, formatMonthDay,
  satisfactionRate, satisfactionRateText, satisfactionText,
} from "../my-store-hub-model";

// 原型 2ef163 的品类（推荐表单同一套）：品类编辑器只给这 6 个 + 清除，不手填 ——
// 手填必然漂移（"咖啡" vs "咖啡厅"），筛选 chips 会裂成两个。
const STORE_CATEGORIES = ["咖啡厅", "SPA", "美甲", "摄影", "茶馆", "酒吧"] as const;
import { SUB_PAGE_CONTENT } from "./me-sub-pages";

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

export function MyStoresHub({ business, fulfillment, profile, onOpenStoreProfile, onOpenStoreCreate, onBack }: {
  business: BusinessClient;
  fulfillment: FulfillmentClient;
  profile: ProfileClient;
  onOpenStoreProfile: () => void;
  /** STORE-HUB-NAV-001：建店 / 添加门店 → merchantstorefront（唯一的建店流程）。 */
  onOpenStoreCreate: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const [shops, setShops] = useState<HubShop[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
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
    return (
      <View>
        <HubNav
          backLabel="‹ 返回店铺列表"
          onBack={() => { setSelectedId(undefined); setCopied(false); }}
          title={selected.store.name}
        />
        <StoreDetail
          row={selected}
          copied={copied}
          requesterNames={requesterNames}
          business={business}
          onCategorySaved={patchCategory}
          onCopyAddress={() => void copyAddress(selected.store.address)}
        />
      </View>
    );
  }

  return (
    <View>
      <HubNav backLabel="‹ 返回" onBack={onBack} title={HUB_TITLE} />

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
          return <Pressable accessibilityLabel={`店铺 ${row.store.name}`} key={row.store.id} onPress={() => setSelectedId(row.store.id)} style={s.card}>
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

      <Pressable accessibilityLabel="建店或添加门店" onPress={onOpenStoreCreate} style={s.linkRow}>
        <Text selectable style={s.linkText}>建店 / 添加门店</Text>
        <Text selectable style={s.arrow}>›</Text>
      </Pressable>
      <Pressable accessibilityLabel="店铺资料与二维码" onPress={onOpenStoreProfile} style={s.linkRow}>
        <Text selectable style={s.linkText}>店铺资料与二维码</Text>
        <Text selectable style={s.arrow}>›</Text>
      </Pressable>
    </View>
  );
}

// STORE-HUB-NAV-001：全 hub 唯一的返回条。列表态退到「我的」，详情态回列表。
function HubNav({ backLabel, onBack, title }: {
  backLabel: string;
  onBack: () => void;
  title: string;
}): React.JSX.Element {
  return (
    <View>
      <Pressable accessibilityLabel={backLabel} onPress={onBack} style={s.backRow}>
        <Text selectable style={s.backText}>{backLabel}</Text>
      </Pressable>
      <Text selectable style={s.navTitle}>{title}</Text>
    </View>
  );
}

function StoreDetail({ row, copied, requesterNames, business, onCategorySaved, onCopyAddress }: {
  row: HubShop;
  copied: boolean;
  requesterNames: ReadonlyMap<string, string>;
  business: BusinessClient;
  onCategorySaved: (storeId: string, category: string) => void;
  onCopyAddress: () => void;
}): React.JSX.Element {
  const cover = coverForStore(row.store.category?.trim() || row.store.name);
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
        <View style={[s.heroCover, { backgroundColor: cover.from }]}>
          <Text selectable style={[s.heroCoverText, { color: cover.ink }]}>{row.store.name.slice(0, 1)}</Text>
        </View>
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

      <Text selectable style={s.secTitle}>店铺信息</Text>
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
  backText: { color: color.magenta, fontSize: 13, fontWeight: "800" },
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
