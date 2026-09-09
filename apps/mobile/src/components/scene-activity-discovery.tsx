import { useMemo, useState } from "react";
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
type MomentSeed = {
  id: string;
  title: string;
  action: string;
  scene: string;
  themes: readonly string[];
  photo: ImageSource;
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

const COFFEE_PHOTO = require("../../assets/market-scene-samples/coffee-photo-v1.jpg");
const WALK_PHOTO = require("../../assets/market-scene-samples/city-walk-photo-v1.jpg");
const EVENT_PHOTO = require("../../assets/market-scene-samples/event-photo-v1.jpg");
const STORE_PHOTO = require("../../assets/market-scene-samples/bilingual-store-v1.jpg");

const MOMENTS: readonly MomentSeed[] = [
  { id: "sunset-coffee", title: "日落咖啡", action: "coffee", scene: "lake", themes: ["sunset"], photo: COFFEE_PHOTO },
  { id: "ao-dai-ride", title: "奥黛骑行", action: "cycling", scene: "old-town", themes: ["ao-dai"], photo: WALK_PHOTO },
  { id: "film-city-walk", title: "胶片 City Walk", action: "city-walk", scene: "old-town", themes: ["film"], photo: WALK_PHOTO },
  { id: "night-market-food", title: "夜市探吃", action: "dining", scene: "night-market", themes: ["local", "food"], photo: EVENT_PHOTO },
  { id: "gallery-coffee", title: "看展 + 咖啡", action: "exhibition", scene: "gallery", themes: ["art"], photo: STORE_PHOTO },
  { id: "beach-walk", title: "海边散步", action: "city-walk", scene: "beach", themes: ["sunset", "nature"], photo: EVENT_PHOTO },
  { id: "local-store", title: "本地探店", action: "explore-store", scene: "cafe", themes: ["local"], photo: STORE_PHOTO },
  { id: "nature-ride", title: "自然骑行", action: "cycling", scene: "park", themes: ["nature"], photo: WALK_PHOTO },
] as const;

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
  onOpenScene,
  onCompose,
}: {
  scenes: readonly SceneDiscoveryBrief[];
  onOpenScene?: (sceneId: string) => void;
  onCompose?: (prompt: string) => void;
}): React.JSX.Element {
  const [actionId, setActionId] = useState<string>();
  const [sceneId, setSceneId] = useState<string>();
  const [themeIds, setThemeIds] = useState<readonly string[]>([]);
  const [saved, setSaved] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<MomentSeed>();

  const filtered = useMemo(() => MOMENTS.filter((moment) =>
    (!actionId || moment.action === actionId)
    && (!sceneId || moment.scene === sceneId)
    && (themeIds.length === 0 || themeIds.every((id) => moment.themes.includes(id)))
  ), [actionId, sceneId, themeIds]);

  const liveSceneFor = (semanticSceneId: string): SceneDiscoveryBrief | undefined =>
    scenes.find((scene) => sceneMatches(scene, semanticSceneId));

  return (
    <View style={styles.root}>
      <SectionHead label="动作" onReset={() => setActionId(undefined)} />
      <HorizontalSwipeRail contentContainerStyle={styles.actionRail}>
        {ACTIONS.map((action) => {
          const active = action.id === actionId;
          return <Pressable accessibilityLabel={`动作 ${action.label}`} key={action.id} onPress={() => setActionId(active ? undefined : action.id)} style={[styles.actionCard, active && styles.selected]}>
            <Image contentFit="contain" source={action.icon} style={styles.actionIcon} />
            <Text numberOfLines={1} style={styles.actionLabel}>{action.label}</Text>
          </Pressable>;
        })}
      </HorizontalSwipeRail>

      <SectionHead label="场景" onReset={() => setSceneId(undefined)} />
      <HorizontalSwipeRail contentContainerStyle={styles.sceneRail}>
        {SCENES.map((scene) => {
          const active = scene.id === sceneId;
          const live = liveSceneFor(scene.id);
          const fallback = scene.id === "cafe" || scene.id === "restaurant" ? COFFEE_PHOTO : scene.id === "old-town" || scene.id === "gallery" ? WALK_PHOTO : scene.id === "night-market" || scene.id === "event" ? EVENT_PHOTO : STORE_PHOTO;
          return <Pressable accessibilityLabel={`场景 ${scene.label}`} key={scene.id} onPress={() => setSceneId(active ? undefined : scene.id)} style={[styles.sceneCard, active && styles.selected]}>
            <Image contentFit="cover" source={live?.imageUrl ? { uri: live.imageUrl } : fallback} style={styles.scenePhoto} />
            <View style={styles.sceneShade} />
            <View style={styles.sceneNameRow}><Image contentFit="contain" source={scene.icon} style={styles.sceneToken} /><Text style={styles.sceneName}>{scene.label}</Text></View>
          </Pressable>;
        })}
      </HorizontalSwipeRail>

      <SectionHead label="主题" onReset={() => setThemeIds([])} />
      <HorizontalSwipeRail contentContainerStyle={styles.themeRail}>
        {THEMES.map((theme) => {
          const active = themeIds.includes(theme.id);
          return <Pressable accessibilityLabel={`主题 ${theme.label}`} key={theme.id} onPress={() => setThemeIds((current) => active ? current.filter((id) => id !== theme.id) : [...current, theme.id])} style={[styles.themeChip, active && styles.themeSelected]}>
            <Image contentFit="contain" source={theme.icon} style={styles.themeIcon} /><Text style={styles.themeLabel}>{theme.label}</Text>
          </Pressable>;
        })}
      </HorizontalSwipeRail>

      {(actionId || sceneId || themeIds.length > 0) ? <View style={styles.filterState}><Text style={styles.filterStateText}>{[actionId ? taxon(ACTIONS, actionId).label : "", sceneId ? taxon(SCENES, sceneId).label : "", ...themeIds.map((id) => taxon(THEMES, id).label)].filter(Boolean).join(" × ")}</Text><Pressable onPress={() => { setActionId(undefined); setSceneId(undefined); setThemeIds([]); }}><Text style={styles.clear}>清除</Text></Pressable></View> : null}

      {filtered.length > 0 ? <View style={styles.grid}>{filtered.map((moment) => {
        const live = liveSceneFor(moment.scene);
        const action = taxon(ACTIONS, moment.action);
        const scene = taxon(SCENES, moment.scene);
        return <Pressable accessibilityLabel={`Moment ${moment.title}`} key={moment.id} onPress={() => setDetail(moment)} style={styles.momentCard}>
          <Image contentFit="cover" source={live?.imageUrl ? { uri: live.imageUrl } : moment.photo} style={styles.momentPhoto} />
          <View style={styles.momentShade} />
          <Pressable accessibilityLabel={saved.includes(moment.id) ? "取消收藏" : "收藏"} hitSlop={8} onPress={() => setSaved((items) => items.includes(moment.id) ? items.filter((id) => id !== moment.id) : [...items, moment.id])} style={styles.heart}><ProxyIcon color="#FFFFFF" name="heart" size={23} /></Pressable>
          <View style={styles.momentCopy}><Text numberOfLines={1} style={styles.momentTitle}>{moment.title}</Text><View style={styles.tagRow}>
            <Tag icon={action.icon} label={action.label} />
            <Tag icon={scene.icon} label={scene.label} />
            <Tag icon={taxon(THEMES, moment.themes[0]!).icon} label={taxon(THEMES, moment.themes[0]!).label} />
          </View></View>
        </Pressable>;
      })}</View> : <View style={styles.empty}><Text style={styles.emptyTitle}>暂时没有完全匹配的 Moment</Text><Text style={styles.emptyText}>减少一个筛选条件，看看更多组合。</Text></View>}

      <Modal animationType="slide" onRequestClose={() => setDetail(undefined)} transparent visible={detail !== undefined}>
        <Pressable onPress={() => setDetail(undefined)} style={styles.backdrop}>
          {detail ? <View onStartShouldSetResponder={() => true} style={styles.sheet}>
            <View style={styles.grab} /><Image contentFit="cover" source={liveSceneFor(detail.scene)?.imageUrl ? { uri: liveSceneFor(detail.scene)!.imageUrl } : detail.photo} style={styles.detailPhoto} />
            <Text style={styles.detailTitle}>{detail.title}</Text>
            <View style={styles.detailLayers}><DetailLayer icon={taxon(ACTIONS, detail.action).icon} label="动作" value={taxon(ACTIONS, detail.action).label} /><DetailLayer icon={taxon(SCENES, detail.scene).icon} label="场景" value={taxon(SCENES, detail.scene).label} /><DetailLayer icon={taxon(THEMES, detail.themes[0]!).icon} label="主题" value={detail.themes.map((id) => taxon(THEMES, id).label).join("、")} /></View>
            <View style={styles.detailActions}><Pressable onPress={() => { onCompose?.(`配一个类似的：${detail.title}`); setDetail(undefined); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>配一个类似的</Text></Pressable><Pressable onPress={() => { const target = liveSceneFor(detail.scene); if (target) onOpenScene?.(target.id); setDetail(undefined); }} style={[styles.primaryButton, !liveSceneFor(detail.scene) && styles.disabled]} disabled={!liveSceneFor(detail.scene)}><Text style={styles.primaryText}>{liveSceneFor(detail.scene) ? "查看真实场景" : "场景数据接入中"}</Text></Pressable></View>
          </View> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function SectionHead({ label, onReset }: { label: string; onReset: () => void }): React.JSX.Element {
  return <View style={styles.sectionHead}><Text style={styles.sectionTitle}>{label}</Text><Pressable hitSlop={8} onPress={onReset}><Text style={styles.all}>全部 〉</Text></Pressable></View>;
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
  actionRail: { gap: 8, paddingRight: 16 }, actionCard: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.82)", borderColor: "#E8E1D8", borderRadius: 18, borderWidth: 1, gap: 7, height: 88, justifyContent: "center", width: 72 }, selected: { borderColor: "#151515", borderWidth: 2 }, actionIcon: { height: 34, width: 34 }, actionLabel: { color: "#151515", fontSize: 11, fontWeight: "700" },
  sceneRail: { gap: 8, paddingRight: 16 }, sceneCard: { backgroundColor: "#DDD", borderColor: "transparent", borderRadius: 15, borderWidth: 2, height: 86, overflow: "hidden", width: 126 }, scenePhoto: { height: "100%", width: "100%" }, sceneShade: { backgroundColor: "rgba(0,0,0,0.24)", bottom: 0, height: 42, left: 0, position: "absolute", right: 0 }, sceneNameRow: { alignItems: "center", bottom: 7, flexDirection: "row", gap: 4, left: 8, position: "absolute" }, sceneToken: { backgroundColor: "#FFFFFF", borderRadius: 9, height: 19, width: 19 }, sceneName: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  themeRail: { gap: 7, paddingRight: 16 }, themeChip: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E8E1D8", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 5, height: 40, paddingHorizontal: 11 }, themeSelected: { backgroundColor: "#FFF6DF", borderColor: "#D99218" }, themeIcon: { height: 23, width: 23 }, themeLabel: { color: "#151515", fontSize: 11, fontWeight: "700" },
  filterState: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 10 }, filterStateText: { color: "#8C867E", flex: 1, fontSize: 11 }, clear: { color: "#151515", fontSize: 11, fontWeight: "900" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 13 }, momentCard: { borderRadius: 17, height: 194, overflow: "hidden", width: "48.8%" }, momentPhoto: { height: "100%", width: "100%" }, momentShade: { backgroundColor: "rgba(0,0,0,0.18)", bottom: 0, height: 90, left: 0, position: "absolute", right: 0 }, heart: { position: "absolute", right: 8, top: 8 }, momentCopy: { bottom: 9, left: 9, position: "absolute", right: 7 }, momentTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "900", marginBottom: 8 }, tagRow: { flexDirection: "row", gap: 3 }, tag: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.94)", borderRadius: 999, flexDirection: "row", gap: 2, height: 25, maxWidth: "34%", paddingHorizontal: 4 }, tagIcon: { height: 17, width: 17 }, tagText: { color: "#151515", fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E8E1D8", borderRadius: 18, borderWidth: 1, marginTop: 13, padding: 22 }, emptyTitle: { color: "#151515", fontSize: 13, fontWeight: "800" }, emptyText: { color: "#8C867E", fontSize: 11, marginTop: 6 },
  backdrop: { backgroundColor: "rgba(0,0,0,0.28)", flex: 1, justifyContent: "flex-end" }, sheet: { backgroundColor: "#F7F4EF", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, paddingBottom: 34 }, grab: { alignSelf: "center", backgroundColor: "#CFC8BF", borderRadius: 3, height: 4, marginBottom: 14, width: 42 }, detailPhoto: { borderRadius: 18, height: 180, width: "100%" }, detailTitle: { color: "#151515", fontSize: 24, fontWeight: "900", marginTop: 15 }, detailLayers: { flexDirection: "row", gap: 8, marginTop: 13 }, detailLayer: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E8E1D8", borderRadius: 15, borderWidth: 1, flex: 1, padding: 10 }, detailIcon: { height: 30, width: 30 }, detailLabel: { color: "#8C867E", fontSize: 11, marginTop: 4 }, detailValue: { color: "#151515", fontSize: 11, fontWeight: "800", marginTop: 2 }, detailActions: { flexDirection: "row", gap: 8, marginTop: 16 }, secondaryButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#151515", borderRadius: 18, borderWidth: 1, flex: 1, paddingVertical: 13 }, secondaryText: { color: "#151515", fontSize: 12, fontWeight: "800" }, primaryButton: { alignItems: "center", backgroundColor: "#151515", borderRadius: 18, flex: 1.2, paddingVertical: 13 }, primaryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" }, disabled: { opacity: 0.45 },
});
