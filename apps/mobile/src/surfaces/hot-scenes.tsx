// HOT-SCENES-PAGE-001（2026-09-27，原型 deepseek_html_20260927_752586「热门场景」）
//
// 首页热榜「更多」进的那一页：排序下拉 + 分类 chip + 距离圈 + 两列卡片网格。
// 数据同 SceneShopDirectory：公开目录 /v1/reality-scenes（免登录），排序/筛选
// 全部走 scene-shop-directory.ts 的纯函数（HOT-SCENES-PAGE-001 段）。
//
// ⚠️ 原型上有、这一页**故意没有**的东西（都有原因，别当成漏做）：
//   · 城市切换 chip（「北宁 ›」）—— 切城市是一整套定位/行政区子系统，这页
//     够不到；放一个点了只会弹提示的按钮就是 placeholder-honest-actions
//     钉的死按钮。距离圈（下面这行）承担"缩小范围"的真实职责；大致城市
//     改成纯展示（UI-CITY-LABEL-001，来自设备反查，不可点）。
//   · 「最新添加」排序 —— reality.scenes 没有开业时间列，同 SHOP_SORTS 的
//     「最近新开」红线（见 sortHotScenes 的注释）。
//   · 分类 chip 按 Scene.Type 的桶分（SCENE-TYPE-BUCKET-001：「咖啡 · 动态
//     场景」取「咖啡」），比 Category 三态粗分细——只列数据里真的出现的桶，
//     计数是真实条数，不搬原型写死的 ☕/🍜/🏸/🎵 固定清单（真实目录现在没有
//     餐厅/运动/娱乐场景，对应 chip 自然不出现）。
//   · 「N 人去过」「暂无评分」都是真实字段（SCENE-REAL-COUNTS-001 /
//     SCENE-RATING-CHIP-001：ratingCount > 0 才画分，没数据不冒充 0 分）。
//
// SCENE-SEARCH-001（用户反馈"搜索按钮丢了 没做"）：目录接口没有关键词查询
// API，但目录本来就是一次性拉全量再客户端排序/筛选（HOT-SCENES-PAGE-001
// 头部说明），所以搜索也走客户端子串匹配——跟 reality-scene-map.tsx 的搜索
// 同一个口径（name+area+type+category 拼一行，小写子串），不是假放大镜。
// TOP 1/2/3 角标只有「去过人数」排序下才挂（hotTopRank：真的有去过人数的
// 前 3），换排序后角标整体消失 —— TOP 是热榜语义，不是卡片装饰。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color } from "../theme";
import { useI18n } from "../i18n";
import { getCurrentFix } from "../device-location";
import { expoLocationApi } from "../device-location-native";
import { ProxyIcon } from "../components/proxy-icon";
import { PhotoScrim, ProxyBackGlyph } from "../components/proxy-foundation";
import {
  availableHotSorts, formatShopDistance, hotTopRank, sceneDistanceMeters, sceneTypeBucket, shopCardDistance, sortHotScenes,
  type HotSortId, type SceneOrigin,
} from "../scene-shop-directory";

type HotSceneBrief = {
  id: string;
  name: string;
  area: string;
  type: string;
  category: string;
  active: boolean;
  imageUrl: string;
  latitude: number;
  longitude: number;
  visitedCount: number;
  // SCENE-RATING-CHIP-001：服务端 omitempty，两个字段必须**成对**判断。
  rating?: number | undefined;
  ratingCount?: number | undefined;
};

/** 距离圈档位（km）：不限 → 2 → 5 → 10 → 不限。全部是真实的客户端距离过滤。 */
const RADIUS_STEPS: readonly (number | undefined)[] = [undefined, 2, 5, 10];

// 原型 TOP 角标三色（渐变的收尾纯色；RN 不为此引 linear-gradient）。
const RANK_COLORS = ["#E22F56", "#6B7280", "#8B5A2B"] as const;

function parseHotScene(item: Record<string, unknown>): HotSceneBrief | undefined {
  if (typeof item.id !== "string" || item.id === "") return undefined;
  if (typeof item.name !== "string") return undefined;
  return {
    id: item.id,
    name: item.name,
    area: typeof item.area === "string" ? item.area : "",
    type: typeof item.type === "string" ? item.type : "",
    category: typeof item.category === "string" ? item.category : "",
    active: item.active === true,
    imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : "",
    latitude: typeof item.latitude === "number" && Number.isFinite(item.latitude) ? item.latitude : NaN,
    longitude: typeof item.longitude === "number" && Number.isFinite(item.longitude) ? item.longitude : NaN,
    visitedCount: typeof item.visitedCount === "number" && Number.isFinite(item.visitedCount) ? item.visitedCount : 0,
    ...(typeof item.rating === "number" && Number.isFinite(item.rating) ? { rating: item.rating } : {}),
    ...(typeof item.ratingCount === "number" && Number.isFinite(item.ratingCount) ? { ratingCount: item.ratingCount } : {}),
  };
}

export function HotScenesSurface({
  apiBaseUrl,
  onBack,
  onOpenSceneMap,
}: {
  apiBaseUrl: string | undefined;
  onBack: () => void;
  onOpenSceneMap: (sceneId?: string) => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [scenes, setScenes] = useState<readonly HotSceneBrief[]>([]);
  const [catalogState, setCatalogState] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [origin, setOrigin] = useState<SceneOrigin>();
  const [cityLabel, setCityLabel] = useState<string>();
  // SCENE-SEARCH-001：客户端子串搜索——目录已经整批拉到本地了，不用等一个
  // 关键词查询接口。
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortId, setSortId] = useState<HotSortId>("visited");
  const [sortOpen, setSortOpen] = useState(false);
  const [category, setCategory] = useState<string>();
  const [radiusKm, setRadiusKm] = useState<number | undefined>(undefined);
  const [reloadNonce, setReloadNonce] = useState(0);

  // 公开目录：失败就明说失败 + 给真的能点的重试 —— 不留一片空列表让人
  // 以为是"附近没有"（同 SceneShopDirectory 的口径）。
  useEffect(() => {
    let cancelled = false;
    if (!apiBaseUrl) { setCatalogState("ERROR"); return; }
    setCatalogState("LOADING");
    void fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/reality-scenes`, { headers: { Accept: "application/json", "X-Proxy-App-Version": "1.0.0" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`scene catalog status ${response.status}`);
        const body = await response.json() as { scenes?: unknown };
        if (!Array.isArray(body.scenes)) throw new Error("scene catalog malformed");
        const rows = (body.scenes as Array<Record<string, unknown>>)
          .filter((item) => item && typeof item === "object")
          .map(parseHotScene)
          .filter((row): row is HotSceneBrief => row !== undefined && row.active);
        if (!cancelled) { setScenes(rows); setCatalogState("READY"); }
      })
      .catch(() => { if (!cancelled) setCatalogState("ERROR"); });
    return () => { cancelled = true; };
  }, [apiBaseUrl, reloadNonce]);

  // 定位：距离圈和「距离最近」都靠它。取不到就不给距离圈、排序里去掉
  // 「最近」—— 不编一个位置（同 SceneShopDirectory）。
  //
  // UI-CITY-LABEL-001（用户反馈"原型有大致定位城市"）：getCurrentFix 本来就会
  // 反查地址（reverseGeocode 默认 true），只是这一屏之前把 fix.address 直接
  // 丢了。address 是 "城市 · 区 · 街道" 拼好的一整行（formatDeviceAddress），
  // 取第一段当"大致城市"——不是新接一套反查，是把已经拿到的结果多读一个字段。
  // 反查失败/没授权就是 undefined，界面不显示这一块，不编一个城市名。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fix = await getCurrentFix(expoLocationApi, { requestPermission: true });
        if (cancelled || !fix) return;
        setOrigin({ latitude: fix.latitude, longitude: fix.longitude });
        const city = fix.address?.split(" · ")[0]?.trim();
        if (city) setCityLabel(city);
      } catch { /* 没定位：没有距离圈，「最近」不进排序菜单，也没有城市名 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // SCENE-TYPE-BUCKET-001：分类 chip 按 Scene.Type 的桶分（"咖啡 · 动态场景"
  // 取"咖啡"），不按粗的三态 Category——商家/景点没法把两家咖啡店单独挑出来，
  // 用户要的「咖啡店 / 餐厅」这级细分只有 Type 能给。桶名只列数据里真的出现
  // 的，计数是真实条数；真实目录现在没有餐厅/运动/娱乐，chip 就不会有。
  const categoryChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const scene of scenes) {
      const key = sceneTypeBucket(scene.type);
      if (key === "") continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  }, [scenes]);

  const visibleScenes = useMemo(() => {
    let rows = scenes;
    const term = query.trim().toLocaleLowerCase();
    if (term) rows = rows.filter((scene) => `${scene.name} ${scene.area} ${scene.type} ${scene.category}`.toLocaleLowerCase().includes(term));
    if (category !== undefined) rows = rows.filter((scene) => sceneTypeBucket(scene.type) === category);
    if (radiusKm !== undefined) {
      rows = rows.filter((scene) => {
        const meters = sceneDistanceMeters(origin, scene);
        return meters !== undefined && meters <= radiusKm * 1000;
      });
    }
    return sortHotScenes(rows, sortId, origin);
  }, [scenes, query, category, radiusKm, sortId, origin]);

  const sorts = useMemo(() => availableHotSorts(origin !== undefined), [origin]);
  // 距离圈只在没有「编位置」的可能时出现；档位固定 2/5/10km。
  const cycleRadius = useCallback(() => {
    setRadiusKm((current) => RADIUS_STEPS[(RADIUS_STEPS.indexOf(current) + 1) % RADIUS_STEPS.length]);
  }, []);
  const activeSortLabel = sorts.find((sort) => sort.id === sortId)?.label ?? "";

  return (
    <View style={styles.root}>
      {/* 顶部栏：返回 + 标题 + 地图（真目的地：场景地图总览）。
          UI-SPACING-001：这一屏挂在 app-shell body 的 SafeAreaView（edges=["top"]）
          之内——那层已经把整块 body 顶下去让出状态栏，这里再加 insets.top 就是
          双计（59+59+8 的大空白，用户反馈"顶部空白空间浪费多"就是这个）。同
          reality-scene-map.tsx 的规矩：只留 8 的内容间距，paddingTop 不动
          insets。 */}
      <View style={styles.topbar}>
        <Pressable accessibilityLabel={t("hotBack")} hitSlop={8} onPress={onBack} style={styles.iconButton}>
          <ProxyBackGlyph />
        </Pressable>
        <Text selectable style={styles.title}>{t("hotScenes")}</Text>
        <Pressable accessibilityLabel={t("hotOpenMap")} hitSlop={8} onPress={() => onOpenSceneMap()} style={styles.iconButton}>
          {/* UI-SPACING-001：mapFold 的 48 格画布里图形只占中间一小块（大量内建
              留白，跟 backArrow 的取景比例不一样），跟 ProxyBackGlyph 并排时
              size=18 明显更小——这颗按钮单独把 size 调到 20 去补偏移，不改
              mapFold 本身（市场头部那颗切换按钮还在用原尺寸，改公共定义会
              连带影响它）。 */}
          <ProxyIcon color={color.ink} name="mapFold" size={20} />
        </Pressable>
        <Pressable accessibilityLabel={searchOpen ? t("hotSearchClose") : t("hotSearch")} hitSlop={8} onPress={() => { if (searchOpen) setQuery(""); setSearchOpen((open) => !open); }} style={styles.iconButton}>
          <ProxyIcon color={color.ink} name="search" size={19} />
        </Pressable>
      </View>

      {searchOpen ? (
        <View style={styles.searchBox}>
          <ProxyIcon color={color.muted} name="search" size={17} />
          <TextInput autoFocus onChangeText={setQuery} placeholder={t("hotSearchPlaceholder")} placeholderTextColor={color.muted} style={styles.searchInput} value={query} />
          <Pressable accessibilityLabel={t("hotSearchClose")} onPress={() => { setQuery(""); setSearchOpen(false); }}><Text selectable style={styles.searchClose}>×</Text></Pressable>
        </View>
      ) : null}

      {/* 控制行：大致城市（有反查结果才出现，纯展示不可点——切城市是一整套
          定位/行政区子系统，这页够不到，见文件头注）+ 距离圈（有定位才出现）+
          排序下拉（只有真的能排的项）。 */}
      <View style={styles.controlsRow}>
        {cityLabel !== undefined ? (
          <View style={styles.cityChip}>
            <ProxyIcon color={color.muted} name="pin" size={12} />
            <Text selectable style={styles.cityText} numberOfLines={1}>{cityLabel}</Text>
          </View>
        ) : null}
        {origin !== undefined ? (
          <Pressable accessibilityLabel={t("hotRadius")} onPress={cycleRadius} style={styles.radiusChip}>
            <ProxyIcon color={color.muted} name="crosshair" size={12} />
            <Text selectable style={styles.radiusText}>{radiusKm === undefined ? t("hotRadiusOff") : t("hotRadiusKm", { n: radiusKm })}</Text>
          </Pressable>
        ) : null}
        <View style={styles.sortWrap}>
          <Pressable accessibilityLabel={t("hotSort")} onPress={() => setSortOpen((open) => !open)} style={styles.sortChip}>
            <Text selectable style={styles.sortText}>{activeSortLabel}</Text>
            <Text selectable style={styles.sortChevron}>{sortOpen ? "↑" : "↓"}</Text>
          </Pressable>
          {sortOpen ? (
            <>
              {/* 透明遮罩：点外面收菜单（原型 document click 的等价物）。 */}
              <Pressable accessibilityLabel={t("hotSort")} onPress={() => setSortOpen(false)} style={styles.sortMask} />
              <View style={styles.sortMenu}>
                {sorts.map((sort) => (
                  <Pressable
                    key={sort.id}
                    accessibilityLabel={sort.label}
                    onPress={() => { setSortId(sort.id); setSortOpen(false); scrollRef.current?.scrollTo({ y: 0, animated: false }); }}
                    style={[styles.sortOption, sortId === sort.id && styles.sortOptionOn]}
                  >
                    <Text selectable style={[styles.sortOptionText, sortId === sort.id && styles.sortOptionTextOn]}>{sort.label}</Text>
                    {sortId === sort.id ? <Text selectable style={styles.sortOptionCheck}>✓</Text> : null}
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </View>
      </View>

      {/* 分类 chips：真实封闭顶类 + 真实计数；空类不出现。 */}
      {catalogState === "READY" && categoryChips.length > 0 ? (
        <View style={styles.chipsRail}>
          <Pressable onPress={() => setCategory(undefined)} style={[styles.categoryChip, category === undefined && styles.categoryChipOn]}>
            <Text selectable style={[styles.categoryChipText, category === undefined && styles.categoryChipTextOn]}>{t("hotAll")}</Text>
            <Text selectable style={[styles.categoryChipCount, category === undefined && styles.categoryChipCountOn]}>{scenes.length}</Text>
          </Pressable>
          {categoryChips.map(([key, count]) => (
            <Pressable key={key} onPress={() => setCategory(category === key ? undefined : key)} style={[styles.categoryChip, category === key && styles.categoryChipOn]}>
              <Text selectable style={[styles.categoryChipText, category === key && styles.categoryChipTextOn]}>{key}</Text>
              <Text selectable style={[styles.categoryChipCount, category === key && styles.categoryChipCountOn]}>{count}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ScrollView contentContainerStyle={[styles.gridWrap, { paddingBottom: 30 + Math.max(insets.bottom, 0) }]} ref={scrollRef} style={styles.scroll}>
        {catalogState === "ERROR" ? (
          <View style={styles.stateBlock}>
            <Text selectable style={styles.stateText}>{t("hotCatalogError")}</Text>
            <Pressable accessibilityLabel={t("hotRetry")} onPress={() => setReloadNonce((nonce) => nonce + 1)} style={styles.retryButton}>
              <Text selectable style={styles.retryText}>{t("hotRetry")}</Text>
            </Pressable>
          </View>
        ) : catalogState === "LOADING" ? (
          <View style={styles.stateBlock}><Text selectable style={styles.stateText}>{t("hotCatalogLoading")}</Text></View>
        ) : visibleScenes.length === 0 ? (
          <View style={styles.stateBlock}><Text selectable style={styles.stateText}>{t("hotEmpty")}</Text></View>
        ) : (
          <View style={styles.grid}>
            {visibleScenes.map((scene) => {
              const meters = sceneDistanceMeters(origin, scene);
              const distance = shopCardDistance(meters);
              const rank = sortId === "visited" ? hotTopRank(visibleScenes, scene.id) : undefined;
              const hasRating = (scene.ratingCount ?? 0) > 0 && typeof scene.rating === "number";
              return (
                <Pressable key={scene.id} accessibilityLabel={scene.name} onPress={() => onOpenSceneMap(scene.id)} style={styles.sceneCard}>
                  <View style={styles.sceneCover}>
                    {scene.imageUrl !== "" ? (
                      <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`hot-page:${scene.id}`} source={{ uri: scene.imageUrl }} style={styles.coverImage} transition={0} />
                    ) : (
                      <View style={[styles.coverImage, styles.coverFallback]}><Text selectable style={styles.coverFallbackText}>{scene.type.slice(0, 2) || "场景"}</Text></View>
                    )}
                    {/* PHOTO-SCRIM-001（2026-09-28）：这里原来是
                        `coverShade: { backgroundColor: "rgba(0,0,0,0.18)", height: "100%" }`
                        —— 整张方形照片均匀平涂一层暗，没有渐变，顶上的 TOP/距离角标
                        也压在平涂上。原型 .scene-cover::after 是
                        `linear-gradient(180deg, rgba(0,0,0,.15) 0%, transparent 40%,
                        transparent 50%, rgba(0,0,0,.75) 100%)`。 */}
                    <PhotoScrim maxOpacity={0.75} top={0.5} topDarken={0.15} topEnd={0.4} />
                    {/* TOP 角标：只有「去过人数」排序下、真的有去过人数的前 3。 */}
                    {rank !== undefined ? (
                      <View style={[styles.rankBadge, { backgroundColor: RANK_COLORS[rank] }]}>
                        <Text selectable style={styles.rankText}>{`TOP ${rank + 1}`}</Text>
                      </View>
                    ) : null}
                    {/* 距离角标：真实直线距离；没定位或超出远距阈值整颗不画。 */}
                    {distance !== "" ? (
                      <View style={styles.distanceBadge}>
                        <ProxyIcon color={color.white} name="pin" size={9} />
                        <Text selectable style={styles.distanceText}>{distance}</Text>
                      </View>
                    ) : null}
                    <Text selectable style={styles.sceneName} numberOfLines={2}>{scene.name}</Text>
                  </View>
                  <View style={styles.sceneInfo}>
                    <Text selectable style={styles.sceneMeta} numberOfLines={1}>{[sceneTypeBucket(scene.type), scene.area].filter(Boolean).join(" · ") || scene.category}</Text>
                    <View style={styles.sceneFoot}>
                      <Text selectable style={styles.visitsText}>{t("hotScenesVisits", { count: scene.visitedCount })}</Text>
                      {hasRating ? (
                        <View style={styles.ratingRow}>
                          <Text selectable style={styles.ratingStar}>★</Text>
                          <Text selectable style={styles.ratingText}>{scene.rating?.toFixed(1)}</Text>
                        </View>
                      ) : (
                        <Text selectable style={styles.noRatingText}>{t("hotNoRating")}</Text>
                      )}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        {catalogState === "READY" && visibleScenes.length > 0 ? (
          <Text selectable style={styles.footerHint}>{t("hotListEnd")}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  topbar: { alignItems: "center", flexDirection: "row", gap: 10, paddingBottom: 4, paddingHorizontal: 16, paddingTop: 2 },
  title: { color: color.ink, flex: 1, fontSize: 24, fontWeight: "900", letterSpacing: -0.6 },
  iconButton: { alignItems: "center", backgroundColor: color.surface, borderRadius: 20, height: 40, justifyContent: "center", width: 40 },
  controlsRow: { alignItems: "center", flexDirection: "row", gap: 8, paddingBottom: 8, paddingHorizontal: 16 },
  searchBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 8, marginBottom: 10, marginHorizontal: 16, paddingHorizontal: 13 },
  searchInput: { color: color.ink, flex: 1, fontSize: 15, height: 44 },
  searchClose: { color: color.muted, fontSize: 20, paddingHorizontal: 4 },
  cityChip: { alignItems: "center", backgroundColor: color.surface, borderRadius: 20, flexDirection: "row", gap: 5, maxWidth: 120, paddingHorizontal: 10, paddingVertical: 7 },
  cityText: { color: color.ink, fontSize: 12, fontWeight: "900" },
  radiusChip: { alignItems: "center", backgroundColor: color.surface, borderRadius: 20, flexDirection: "row", gap: 5, paddingHorizontal: 10, paddingVertical: 7 },
  radiusText: { color: color.muted, fontSize: 12, fontWeight: "800" },
  sortWrap: { marginLeft: "auto", position: "relative" },
  sortChip: { alignItems: "center", backgroundColor: color.white, borderColor: "#F0E4C0", borderRadius: 20, borderWidth: 1.5, flexDirection: "row", gap: 5, paddingLeft: 12, paddingRight: 10, paddingVertical: 7 },
  sortText: { color: "#8C6A00", fontSize: 11.5, fontWeight: "900" },
  sortChevron: { color: "#8C6A00", fontSize: 11, fontWeight: "900" },
  sortMask: { bottom: -1000, left: -1000, position: "absolute", right: -1000, top: -1000 },
  sortMenu: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, minWidth: 160, padding: 6, position: "absolute", right: 0, top: 44, zIndex: 30 },
  sortOption: { alignItems: "center", borderRadius: 9, flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  sortOptionOn: { backgroundColor: "#FDF6E3" },
  sortOptionText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  sortOptionTextOn: { color: "#8C6A00", fontWeight: "900" },
  sortOptionCheck: { color: "#8C6A00", fontSize: 13, fontWeight: "900", marginLeft: "auto" },
  chipsRail: { flexDirection: "row", gap: 8, paddingBottom: 12, paddingHorizontal: 16 },
  categoryChip: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 4, paddingHorizontal: 14, paddingVertical: 8 },
  categoryChipOn: { backgroundColor: color.ink, borderColor: color.ink },
  categoryChipText: { color: color.muted, fontSize: 12.5, fontWeight: "900" },
  categoryChipTextOn: { color: color.white },
  categoryChipCount: { color: color.muted, fontSize: 11, fontWeight: "900", opacity: 0.55 },
  categoryChipCountOn: { color: color.white },
  scroll: { flex: 1 },
  gridWrap: { paddingBottom: 30, paddingHorizontal: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  sceneCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, overflow: "hidden", width: "47.2%" },
  sceneCover: { aspectRatio: 1, justifyContent: "flex-end", position: "relative" },
  coverImage: { height: "100%", position: "absolute", width: "100%" },
  coverFallback: { alignItems: "center", backgroundColor: color.surface, justifyContent: "center" },
  coverFallbackText: { color: color.muted, fontSize: 26, fontWeight: "900" },
  rankBadge: { borderRadius: 6, left: 10, paddingHorizontal: 9, paddingVertical: 4, position: "absolute", top: 10 },
  rankText: { color: color.white, fontSize: 10, fontWeight: "900", letterSpacing: 0.4, textShadowColor: "rgba(0,0,0,0.15)", textShadowOffset: { height: 1, width: 0 }, textShadowRadius: 3 },
  distanceBadge: { alignItems: "center", backgroundColor: "rgba(30,27,22,0.55)", borderRadius: 6, flexDirection: "row", gap: 3, paddingHorizontal: 7, paddingVertical: 4, position: "absolute", right: 10, top: 10 },
  distanceText: { color: color.white, fontSize: 9.5, fontWeight: "900", letterSpacing: 0.2 },
  sceneName: { bottom: 10, color: color.white, fontSize: 13.5, fontWeight: "900", left: 12, letterSpacing: -0.25, lineHeight: 17, position: "absolute", right: 12, textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { height: 2, width: 0 }, textShadowRadius: 8 },
  sceneInfo: { paddingBottom: 12, paddingHorizontal: 12, paddingTop: 11 },
  sceneMeta: { color: color.muted, fontSize: 11, fontWeight: "800", marginBottom: 7 },
  sceneFoot: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  visitsText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  ratingRow: { alignItems: "center", flexDirection: "row", gap: 3 },
  ratingStar: { color: "#F5B400", fontSize: 10 },
  ratingText: { color: "#8C6A00", fontSize: 11, fontWeight: "900" },
  noRatingText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  footerHint: { color: color.muted, fontSize: 11.5, fontWeight: "700", paddingTop: 24, textAlign: "center" },
  stateBlock: { alignItems: "center", gap: 12, paddingTop: 60 },
  stateText: { color: color.muted, fontSize: 13, fontWeight: "700", textAlign: "center" },
  retryButton: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  retryText: { color: color.white, fontSize: 12.5, fontWeight: "900" },
});
