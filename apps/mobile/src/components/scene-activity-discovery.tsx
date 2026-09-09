import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image, type ImageSource } from "expo-image";
import { ProxyIcon } from "./proxy-icon";
import { HorizontalSwipeRail } from "./horizontal-swipe-rail";

export type SceneDiscoveryBrief = {
  id: string;
  name: string;
  area: string;
  type: string;
  imageUrl: string;
};

type Taxon = { id: string; label: string; icon: ImageSource };
type SceneAssetCatalog = {
  actions: Record<string, string>;
  scenes: Record<string, string>;
  themes: Record<string, string>;
  moments: Record<string, string>;
};
type MomentSeed = {
  id: string;
  title: string;
  action: string;
  scene: string;
  themes: readonly string[];
};

const ACTIONS: readonly Taxon[] = [
  { id: "coffee", label: "咖啡", icon: require("../../assets/scene-activity/actions/coffee.svg") },
  { id: "dining", label: "用餐", icon: require("../../assets/scene-activity/actions/dining.svg") },
  { id: "city-walk", label: "City Walk", icon: require("../../assets/scene-activity/actions/city-walk.svg") },
  { id: "photo", label: "拍照", icon: require("../../assets/scene-activity/actions/photo.svg") },
  { id: "cycling", label: "骑行", icon: require("../../assets/scene-activity/actions/cycling.svg") },
  { id: "exhibition", label: "看展", icon: require("../../assets/scene-activity/actions/exhibition.svg") },
  { id: "shopping", label: "逛街", icon: require("../../assets/scene-activity/actions/shopping.svg") },
  { id: "movie", label: "观影", icon: require("../../assets/scene-activity/actions/movie.svg") },
  { id: "music", label: "音乐", icon: require("../../assets/scene-activity/actions/music.svg") },
  { id: "explore-store", label: "探店", icon: require("../../assets/scene-activity/actions/explore-store.svg") },
  { id: "travel", label: "出游", icon: require("../../assets/scene-activity/actions/travel.svg") },
  { id: "sport", label: "运动", icon: require("../../assets/scene-activity/actions/sport.svg") },
] as const;

const SCENES: readonly Taxon[] = [
  { id: "cafe", label: "咖啡馆", icon: require("../../assets/scene-activity/scenes/cafe.svg") },
  { id: "lake", label: "湖边", icon: require("../../assets/scene-activity/scenes/lake.svg") },
  { id: "old-town", label: "老城区", icon: require("../../assets/scene-activity/scenes/old-town.svg") },
  { id: "night-market", label: "夜市", icon: require("../../assets/scene-activity/scenes/night-market.svg") },
  { id: "gallery", label: "美术馆", icon: require("../../assets/scene-activity/scenes/gallery.svg") },
  { id: "beach", label: "海边", icon: require("../../assets/scene-activity/scenes/beach.svg") },
  { id: "park", label: "公园", icon: require("../../assets/scene-activity/scenes/park.svg") },
  { id: "mall", label: "商场", icon: require("../../assets/scene-activity/scenes/mall.svg") },
  { id: "restaurant", label: "餐厅", icon: require("../../assets/scene-activity/scenes/restaurant.svg") },
  { id: "event", label: "活动现场", icon: require("../../assets/scene-activity/scenes/event.svg") },
] as const;

const THEMES: readonly Taxon[] = [
  { id: "ao-dai", label: "奥黛", icon: require("../../assets/scene-activity/themes/ao-dai.svg") },
  { id: "sunset", label: "日落", icon: require("../../assets/scene-activity/themes/sunset.svg") },
  { id: "film", label: "胶片", icon: require("../../assets/scene-activity/themes/film.svg") },
  { id: "local", label: "本地人", icon: require("../../assets/scene-activity/themes/local.svg") },
  { id: "food", label: "美食", icon: require("../../assets/scene-activity/themes/food.svg") },
  { id: "art", label: "艺术", icon: require("../../assets/scene-activity/themes/art.svg") },
  { id: "nature", label: "自然", icon: require("../../assets/scene-activity/themes/nature.svg") },
  { id: "night", label: "夜晚", icon: require("../../assets/scene-activity/themes/night.svg") },
  { id: "retro", label: "复古", icon: require("../../assets/scene-activity/themes/retro.svg") },
  { id: "vietnam", label: "越南传统", icon: require("../../assets/scene-activity/themes/vietnam.svg") },
] as const;

const MOMENTS: readonly MomentSeed[] = [
  { id: "sunset-coffee", title: "日落咖啡", action: "coffee", scene: "lake", themes: ["sunset"] },
  { id: "ao-dai-ride", title: "奥黛骑行", action: "cycling", scene: "old-town", themes: ["ao-dai"] },
  { id: "film-city-walk", title: "胶片 City Walk", action: "city-walk", scene: "old-town", themes: ["film"] },
  { id: "night-market-food", title: "夜市探吃", action: "dining", scene: "night-market", themes: ["local", "food"] },
  { id: "gallery-coffee", title: "看展 + 咖啡", action: "exhibition", scene: "gallery", themes: ["art"] },
  { id: "beach-walk", title: "海边散步", action: "city-walk", scene: "beach", themes: ["sunset", "nature"] },
  { id: "local-store", title: "本地探店", action: "explore-store", scene: "cafe", themes: ["local"] },
  { id: "nature-ride", title: "自然骑行", action: "cycling", scene: "park", themes: ["nature"] },
] as const;

function absoluteNetworkURL(apiBaseUrl: string, value?: string): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (!apiBaseUrl) return undefined;
  return `${apiBaseUrl.replace(/\/$/, "")}/${value.replace(/^\//, "")}`;
}

function taxon(items: readonly Taxon[], id: string): Taxon {
  return items.find((item) => item.id === id) ?? items[0]!;
}

function sceneMatches(brief: SceneDiscoveryBrief, sceneId: string): boolean {
  const haystack = `${brief.name} ${brief.area} ${brief.type}`.toLowerCase();
  const words: Record<string, readonly string[]> = {
    cafe: ["咖啡", "cafe", "coffee"], lake: ["湖", "lake", "westlake", "西湖"],
    "old-town": ["老城", "old town", "old quarter"], "night-market": ["夜市", "night market"],
    gallery: ["美术馆", "画廊", "gallery", "museum"], beach: ["海边", "沙滩", "beach", "coast"],
    park: ["公园", "park"], mall: ["商场", "mall"], restaurant: ["餐厅", "restaurant"], event: ["活动", "event"],
  };
  return (words[sceneId] ?? []).some((word) => haystack.includes(word));
}

export function SceneActivityDiscovery({
  scenes,
  apiBaseUrl,
  onOpenScene,
  onCompose,
}: {
  scenes: readonly SceneDiscoveryBrief[];
  apiBaseUrl: string | undefined;
  onOpenScene?: (sceneId: string) => void;
  onCompose?: (prompt: string) => void;
}): React.JSX.Element {
  const [actionId, setActionId] = useState<string>();
  const [sceneId, setSceneId] = useState<string>();
  const [themeIds, setThemeIds] = useState<readonly string[]>([]);
  const [saved, setSaved] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<MomentSeed>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assets, setAssets] = useState<SceneAssetCatalog>();

  useEffect(() => {
    if (!apiBaseUrl) return;
    let cancelled = false;
    void fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/scene-assets`, { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : undefined)
      .then((body) => {
        if (cancelled || !body || typeof body !== "object") return;
        const value = body as Partial<SceneAssetCatalog>;
        setAssets({ actions: value.actions ?? {}, scenes: value.scenes ?? {}, themes: value.themes ?? {}, moments: value.moments ?? {} });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [apiBaseUrl]);

  const networkSource = (group: keyof SceneAssetCatalog, id: string): ImageSource | undefined => {
    const uri = absoluteNetworkURL(apiBaseUrl ?? "", assets?.[group]?.[id]);
    return uri ? { uri } : undefined;
  };

  const filtered = useMemo(() => MOMENTS.filter((moment) =>
    (!actionId || moment.action === actionId)
    && (!sceneId || moment.scene === sceneId)
    && (themeIds.length === 0 || themeIds.every((id) => moment.themes.includes(id)))
  ), [actionId, sceneId, themeIds]);

  const liveSceneFor = (semanticSceneId: string): SceneDiscoveryBrief | undefined =>
    scenes.find((scene) => sceneMatches(scene, semanticSceneId));

  return (
    <View style={styles.root}>
      <SectionHead label="动作" onAll={() => setPickerOpen(true)} />
      <HorizontalSwipeRail contentContainerStyle={styles.actionRail} preserveChildPresses threshold={3}>
        {ACTIONS.map((action) => {
          const active = action.id === actionId;
          return <Pressable accessibilityLabel={`动作 ${action.label}`} key={action.id} onPress={() => setActionId(active ? undefined : action.id)} style={styles.actionOption}>
            <View style={[styles.actionGlyph, active && styles.actionGlyphActive]}><Image contentFit="contain" source={action.icon} style={styles.actionIcon} /></View>
            <Text numberOfLines={1} style={styles.actionLabel}>{action.label}</Text>
          </Pressable>;
        })}
      </HorizontalSwipeRail>

      {(actionId || sceneId || themeIds.length > 0) ? <View style={styles.filterState}><Text style={styles.filterStateText}>{[actionId ? taxon(ACTIONS, actionId).label : "", sceneId ? taxon(SCENES, sceneId).label : "", ...themeIds.map((id) => taxon(THEMES, id).label)].filter(Boolean).join(" × ")}</Text><Pressable onPress={() => { setActionId(undefined); setSceneId(undefined); setThemeIds([]); }}><Text style={styles.clear}>清除</Text></Pressable></View> : null}

      {filtered.length > 0 ? <View style={styles.grid}>{filtered.map((moment) => {
        const live = liveSceneFor(moment.scene);
        const action = taxon(ACTIONS, moment.action);
        const scene = taxon(SCENES, moment.scene);
        return <Pressable accessibilityLabel={`Moment ${moment.title}`} key={moment.id} onPress={() => setDetail(moment)} style={styles.momentCard}>
          {absoluteNetworkURL(apiBaseUrl ?? "", live?.imageUrl) || networkSource("moments", moment.id) ? <Image contentFit="cover" source={(absoluteNetworkURL(apiBaseUrl ?? "", live?.imageUrl) ? { uri: absoluteNetworkURL(apiBaseUrl ?? "", live?.imageUrl)! } : networkSource("moments", moment.id))!} style={styles.momentPhoto} /> : <View style={styles.photoPending} />}
          <View style={styles.momentShade} />
          <Pressable accessibilityLabel={saved.includes(moment.id) ? "取消收藏" : "收藏"} hitSlop={8} onPress={() => setSaved((items) => items.includes(moment.id) ? items.filter((id) => id !== moment.id) : [...items, moment.id])} style={styles.heart}><ProxyIcon color="#FFFFFF" name="heart" size={23} /></Pressable>
          <View style={styles.momentCopy}><Text numberOfLines={1} style={styles.momentTitle}>{moment.title}</Text><View style={styles.tagRow}>
            <Tag icon={action.icon} label={action.label} />
            <Tag icon={scene.icon} label={scene.label} />
            <Tag icon={taxon(THEMES, moment.themes[0]!).icon} label={taxon(THEMES, moment.themes[0]!).label} />
          </View></View>
        </Pressable>;
      })}</View> : <View style={styles.empty}><Text style={styles.emptyTitle}>暂时没有完全匹配的 Moment</Text><Text style={styles.emptyText}>减少一个筛选条件，看看更多组合。</Text></View>}

      <Modal animationType="slide" onRequestClose={() => setPickerOpen(false)} transparent visible={pickerOpen}>
        <Pressable onPress={() => setPickerOpen(false)} style={styles.backdrop}>
          <View onStartShouldSetResponder={() => true} style={styles.pickerSheet}>
            <View style={styles.grab} />
            <View style={styles.pickerHead}><Text style={styles.pickerTitle}>全部筛选</Text><Pressable onPress={() => { setActionId(undefined); setSceneId(undefined); setThemeIds([]); }}><Text style={styles.clear}>清除筛选</Text></Pressable></View>
            <ScrollView contentContainerStyle={styles.pickerContent}>
              {([
                { key: "actions", label: "动作", items: ACTIONS },
                { key: "scenes", label: "场景", items: SCENES },
                { key: "themes", label: "主题", items: THEMES },
              ] as const).map((section) => <View key={section.key} style={styles.pickerSection}>
                <Text style={styles.pickerSectionTitle}>{section.label}</Text>
                <View style={styles.pickerGrid}>{section.items.map((item) => {
                  const active = section.key === "actions" ? actionId === item.id : section.key === "scenes" ? sceneId === item.id : themeIds.includes(item.id);
                  const photo = networkSource(section.key, item.id);
                  return <Pressable key={item.id} onPress={() => {
                    if (section.key === "actions") setActionId(active ? undefined : item.id);
                    else if (section.key === "scenes") setSceneId(active ? undefined : item.id);
                    else setThemeIds((current) => active ? current.filter((id) => id !== item.id) : [...current, item.id]);
                  }} style={[styles.pickerItem, active && styles.pickerItemActive]}>{photo ? <Image contentFit="cover" source={photo} style={styles.pickerPhoto} /> : <Image contentFit="contain" source={item.icon} style={styles.pickerIcon} />}<Text style={styles.pickerLabel}>{item.label}</Text>{active ? <Text style={styles.pickerCheck}>✓</Text> : null}</Pressable>;
                })}</View>
              </View>)}
            </ScrollView>
            <Pressable onPress={() => setPickerOpen(false)} style={styles.pickerDone}><Text style={styles.pickerDoneText}>完成</Text></Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal animationType="slide" onRequestClose={() => setDetail(undefined)} transparent visible={detail !== undefined}>
        <Pressable onPress={() => setDetail(undefined)} style={styles.backdrop}>
          {detail ? <View onStartShouldSetResponder={() => true} style={styles.sheet}>
            <View style={styles.grab} />{absoluteNetworkURL(apiBaseUrl ?? "", liveSceneFor(detail.scene)?.imageUrl) || networkSource("moments", detail.id) ? <Image contentFit="cover" source={(absoluteNetworkURL(apiBaseUrl ?? "", liveSceneFor(detail.scene)?.imageUrl) ? { uri: absoluteNetworkURL(apiBaseUrl ?? "", liveSceneFor(detail.scene)!.imageUrl)! } : networkSource("moments", detail.id))!} style={styles.detailPhoto} /> : <View style={[styles.photoPending, styles.detailPhoto]} />}
            <Text style={styles.detailTitle}>{detail.title}</Text>
            <View style={styles.detailLayers}><DetailLayer icon={taxon(ACTIONS, detail.action).icon} label="动作" value={taxon(ACTIONS, detail.action).label} /><DetailLayer icon={taxon(SCENES, detail.scene).icon} label="场景" value={taxon(SCENES, detail.scene).label} /><DetailLayer icon={taxon(THEMES, detail.themes[0]!).icon} label="主题" value={detail.themes.map((id) => taxon(THEMES, id).label).join("、")} /></View>
            <View style={styles.detailActions}><Pressable onPress={() => { onCompose?.(`配一个类似的：${detail.title}`); setDetail(undefined); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>配一个类似的</Text></Pressable><Pressable onPress={() => { const target = liveSceneFor(detail.scene); if (target) onOpenScene?.(target.id); setDetail(undefined); }} style={[styles.primaryButton, !liveSceneFor(detail.scene) && styles.disabled]} disabled={!liveSceneFor(detail.scene)}><Text style={styles.primaryText}>{liveSceneFor(detail.scene) ? "查看真实场景" : "场景数据接入中"}</Text></Pressable></View>
          </View> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function SectionHead({ label, onAll }: { label: string; onAll: () => void }): React.JSX.Element {
  return <View style={styles.sectionHead}><Text style={styles.sectionTitle}>{label}</Text><Pressable accessibilityLabel="查看全部动作场景主题" hitSlop={8} onPress={onAll}><Text style={styles.all}>全部 〉</Text></Pressable></View>;
}

function Tag({ icon, label }: { icon: ImageSource; label: string }): React.JSX.Element {
  return <View style={styles.tag}><Image contentFit="contain" source={icon} style={styles.tagIcon} /><Text numberOfLines={1} style={styles.tagText}>{label}</Text></View>;
}

function DetailLayer({ icon, label, value }: { icon: ImageSource; label: string; value: string }): React.JSX.Element {
  return <View style={styles.detailLayer}><Image contentFit="contain" source={icon} style={styles.detailIcon} /><Text style={styles.detailLabel}>{label}</Text><Text numberOfLines={1} style={styles.detailValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  root: { marginHorizontal: -16, paddingHorizontal: 16 },
  sectionHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 9, marginTop: 17 },
  sectionTitle: { color: "#151515", fontSize: 17, fontWeight: "900" }, all: { color: "#777169", fontSize: 12, fontWeight: "600" },
  actionRail: { gap: 6, paddingRight: 16 }, actionOption: { alignItems: "center", gap: 4, width: 52 }, actionGlyph: { alignItems: "center", borderColor: "transparent", borderRadius: 14, borderWidth: 1, height: 46, justifyContent: "center", width: 46 }, actionGlyphActive: { backgroundColor: "#FFF6DF", borderColor: "#151515" }, actionIcon: { height: 30, width: 30 }, actionLabel: { color: "#151515", fontSize: 11, fontWeight: "700" },
  photoPending: { backgroundColor: "#DDD7CF", height: "100%", width: "100%" },
  filterState: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 10 }, filterStateText: { color: "#8C867E", flex: 1, fontSize: 11 }, clear: { color: "#151515", fontSize: 11, fontWeight: "900" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 13 }, momentCard: { borderRadius: 17, height: 194, overflow: "hidden", width: "48.8%" }, momentPhoto: { height: "100%", width: "100%" }, momentShade: { backgroundColor: "rgba(0,0,0,0.18)", bottom: 0, height: 90, left: 0, position: "absolute", right: 0 }, heart: { position: "absolute", right: 8, top: 8 }, momentCopy: { bottom: 9, left: 9, position: "absolute", right: 7 }, momentTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "900", marginBottom: 8 }, tagRow: { flexDirection: "row", gap: 3 }, tag: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.94)", borderRadius: 999, flexDirection: "row", gap: 2, height: 25, maxWidth: "34%", paddingHorizontal: 4 }, tagIcon: { height: 17, width: 17 }, tagText: { color: "#151515", fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E8E1D8", borderRadius: 18, borderWidth: 1, marginTop: 13, padding: 22 }, emptyTitle: { color: "#151515", fontSize: 13, fontWeight: "800" }, emptyText: { color: "#8C867E", fontSize: 11, marginTop: 6 },
  pickerSheet: { backgroundColor: "#F7F4EF", borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "84%", padding: 18, paddingBottom: 34 }, pickerHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }, pickerTitle: { color: "#151515", fontSize: 22, fontWeight: "900" }, pickerContent: { paddingBottom: 8 }, pickerSection: { marginTop: 12 }, pickerSectionTitle: { color: "#151515", fontSize: 15, fontWeight: "900", marginBottom: 8 }, pickerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 }, pickerItem: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E8E1D8", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 7, minHeight: 58, overflow: "hidden", paddingHorizontal: 8, width: "48.5%" }, pickerItemActive: { backgroundColor: "#FFF6DF", borderColor: "#151515", borderWidth: 2 }, pickerIcon: { height: 34, width: 34 }, pickerPhoto: { borderRadius: 11, height: 44, width: 44 }, pickerLabel: { color: "#151515", flex: 1, fontSize: 12, fontWeight: "800" }, pickerCheck: { color: "#151515", fontSize: 13, fontWeight: "900" }, pickerDone: { alignItems: "center", backgroundColor: "#151515", borderRadius: 17, marginTop: 12, paddingVertical: 13 }, pickerDoneText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  backdrop: { backgroundColor: "rgba(0,0,0,0.28)", flex: 1, justifyContent: "flex-end" }, sheet: { backgroundColor: "#F7F4EF", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, paddingBottom: 34 }, grab: { alignSelf: "center", backgroundColor: "#CFC8BF", borderRadius: 3, height: 4, marginBottom: 14, width: 42 }, detailPhoto: { borderRadius: 18, height: 180, width: "100%" }, detailTitle: { color: "#151515", fontSize: 24, fontWeight: "900", marginTop: 15 }, detailLayers: { flexDirection: "row", gap: 8, marginTop: 13 }, detailLayer: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E8E1D8", borderRadius: 15, borderWidth: 1, flex: 1, padding: 10 }, detailIcon: { height: 30, width: 30 }, detailLabel: { color: "#8C867E", fontSize: 11, marginTop: 4 }, detailValue: { color: "#151515", fontSize: 11, fontWeight: "800", marginTop: 2 }, detailActions: { flexDirection: "row", gap: 8, marginTop: 16 }, secondaryButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#151515", borderRadius: 18, borderWidth: 1, flex: 1, paddingVertical: 13 }, secondaryText: { color: "#151515", fontSize: 12, fontWeight: "800" }, primaryButton: { alignItems: "center", backgroundColor: "#151515", borderRadius: 18, flex: 1.2, paddingVertical: 13 }, primaryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" }, disabled: { opacity: 0.45 },
});
