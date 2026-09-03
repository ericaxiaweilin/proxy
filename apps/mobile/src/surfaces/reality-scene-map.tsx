import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { ProxyIcon } from "../components/proxy-icon";
import { color } from "../theme";
import type { SessionAuthClient } from "../auth-client";
import type { SecureSessionStore, StoredSession } from "../secure-session";
import { parseCommandResult } from "../login-client";

type SceneFilter = "ALL" | "UNSEEN" | "ACTIVE" | "SAVED" | "VISITED";
type SceneView = "MAP" | "LIST";
type AuthenticatedStoredSession = StoredSession & { principal: NonNullable<StoredSession["principal"]> };

type RealityScene = {
  id: string;
  name: string;
  area: string;
  type: string;
  latitude: number;
  longitude: number;
  quality: number;
  best: string;
  posts: number;
  creators: number;
  activities: number;
  invites: number;
  active: boolean;
  description: string;
};

// R15.16 approved catalog. This is the UI bootstrap only; user state is kept
// outside these records so the later server read model can replace the source
// without changing Scene Map rendering semantics.
const SCENES: ReadonlyArray<RealityScene> = [
  { id: "trucbach", name: "Trúc Bạch 湖边", area: "Ba Đình", type: "湖边 · 夜景", latitude: 21.0454, longitude: 105.8361, quality: 93, best: "17:20–19:10", posts: 86, creators: 31, activities: 8, invites: 22, active: true, description: "湖边步行、夜景与小型聚会密度高。第一次去的内容产出率明显高于复访。" },
  { id: "westlake", name: "West Lake Sunset Loop", area: "Tây Hồ", type: "骑行 · 日落", latitude: 21.0669, longitude: 105.8192, quality: 96, best: "16:30–18:40", posts: 214, creators: 72, activities: 21, invites: 48, active: false, description: "高复访路线。适合骑行、散步和摄影，不同季节仍有新的场景价值。" },
  { id: "phunghung", name: "Phùng Hưng Mural Street", area: "Hoàn Kiếm", type: "街区 · 摄影", latitude: 21.034, longitude: 105.8442, quality: 88, best: "08:00–10:30", posts: 102, creators: 45, activities: 4, invites: 13, active: false, description: "第一次探索价值高，适合街拍、壁画和老城主题内容。" },
  { id: "train", name: "Hanoi Train Street", area: "Hoàn Kiếm", type: "街区 · 体验", latitude: 21.0292, longitude: 105.8426, quality: 84, best: "15:00–17:30", posts: 167, creators: 64, activities: 3, invites: 18, active: false, description: "游客内容密度高。Proxy 只记录公开场景，不展示任何人的实时位置。" },
  { id: "complex01", name: "Complex 01", area: "Đống Đa", type: "空间 · 活动", latitude: 21.0062, longitude: 105.8284, quality: 91, best: "14:00–21:00", posts: 74, creators: 39, activities: 14, invites: 19, active: true, description: "近期活动密度高，适合作为 Creator 联动和公开小型活动节点。" },
  { id: "manzi", name: "Manzi Art Space", area: "Ba Đình", type: "艺术 · 展览", latitude: 21.0395, longitude: 105.846, quality: 89, best: "10:00–18:00", posts: 43, creators: 22, activities: 5, invites: 9, active: false, description: "内容质量高但低频，展览更新时重新获得未探索价值。" },
  { id: "banana", name: "Red River Banana Island", area: "Long Biên", type: "自然 · 骑行", latitude: 21.054, longitude: 105.868, quality: 87, best: "06:30–09:00", posts: 58, creators: 26, activities: 7, invites: 17, active: false, description: "适合重复骑行和自然内容，共同出行转化率较高。" },
  { id: "bonsaidon", name: "Bonsaidon · Tây Hồ", area: "Tây Hồ", type: "商家 · 社交", latitude: 21.0621, longitude: 105.8256, quality: 90, best: "14:00–20:30", posts: 119, creators: 41, activities: 17, invites: 32, active: true, description: "公开活动、Creator 到店与内容可归因；商业赞助不改变自然场景质量。" }
];

export function RealitySceneMapSurface({ apiBaseUrl, authClient, initialSceneId, secureSessionStore, onBack }: { apiBaseUrl: string; authClient: SessionAuthClient; initialSceneId?: string | undefined; secureSessionStore?: SecureSessionStore | undefined; onBack: () => void }): React.JSX.Element {
  const [view, setView] = useState<SceneView>("MAP");
  const [filter, setFilter] = useState<SceneFilter>("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSceneId);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set(["westlake", "train"]));
  const [planned, setPlanned] = useState<ReadonlySet<string>>(new Set());
  const [scenes, setScenes] = useState<ReadonlyArray<RealityScene>>(SCENES);
  const [session, setSession] = useState<AuthenticatedStoredSession>();

  useEffect(() => {
    let cancelled = false;
    void fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/reality-scenes`, {
      method: "GET",
      headers: { Accept: "application/json", "X-Proxy-App-Version": "1.0.0" }
    }).then(async (response) => {
      if (!response.ok) throw new Error(`scene catalog status ${response.status}`);
      const body = await response.json() as { scenes?: unknown };
      if (!Array.isArray(body.scenes) || body.scenes.length === 0) throw new Error("scene catalog malformed");
      const valid = body.scenes.filter(isRealityScene);
      if (valid.length !== body.scenes.length) throw new Error("scene catalog contained invalid records");
      if (!cancelled) setScenes(valid);
    }).catch(() => {
      // Keep the last-known launch projection during an outage. Server data wins
      // as soon as it validates; malformed partial responses never replace it.
    });
    return () => { cancelled = true; };
  }, [apiBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!secureSessionStore) return;
    void secureSessionStore.read().then(async (nextSession) => {
      if (cancelled || !nextSession?.principal) return;
      const authenticated = nextSession as AuthenticatedStoredSession;
      setSession(authenticated);
      const payload = await sendSceneCommand(authClient, authenticated, "ListMyRealitySceneState", "me", {});
      if (cancelled) return;
      const states = Array.isArray(payload.states) ? payload.states : [];
      setSaved(new Set(states.filter((item) => isUserSceneState(item) && item.saved).map((item) => (item as { sceneId: string }).sceneId)));
      setPlanned(new Set(states.filter((item) => isUserSceneState(item) && item.planned).map((item) => (item as { sceneId: string }).sceneId)));
      setVisited(new Set(states.filter((item) => isUserSceneState(item) && item.privateVisited).map((item) => (item as { sceneId: string }).sceneId)));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [authClient, secureSessionStore]);

  const selected = scenes.find((scene) => scene.id === selectedId);
  const filtered = useMemo(() => scenes.filter((scene) => {
    const term = query.trim().toLocaleLowerCase();
    if (term && !`${scene.name} ${scene.area} ${scene.type}`.toLocaleLowerCase().includes(term)) return false;
    if (filter === "ACTIVE") return scene.active;
    if (filter === "SAVED") return saved.has(scene.id);
    if (filter === "VISITED") return visited.has(scene.id);
    if (filter === "UNSEEN") return !visited.has(scene.id);
    return true;
  }), [filter, query, saved, scenes, visited]);

  const toggle = (source: ReadonlySet<string>, id: string, commit: (next: ReadonlySet<string>) => void): void => {
    const next = new Set(source);
    if (next.has(id)) next.delete(id); else next.add(id);
    commit(next);
  };
  const persistToggle = (source: ReadonlySet<string>, id: string, commit: (next: ReadonlySet<string>) => void, commandType: string): void => {
    if (!session?.principal) return;
    const enabled = !source.has(id);
    toggle(source, id, commit);
    void sendSceneCommand(authClient, session, commandType, id, { sceneId: id, enabled }).catch(() => commit(source));
  };

  if (selected) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.detailContent}>
        <Pressable accessibilityLabel="返回场景地图" onPress={() => setSelectedId(undefined)} style={styles.backButton}>
          <ProxyIcon color={color.ink} name="chevronLeft" size={21} />
          <Text style={styles.backText}>场景地图</Text>
        </Pressable>
        <View style={styles.hero}>
          <MapView
            initialRegion={{ latitude: selected.latitude, longitude: selected.longitude, latitudeDelta: 0.025, longitudeDelta: 0.025 }}
            pointerEvents="none"
            style={styles.heroMap}
          >
            <Marker coordinate={{ latitude: selected.latitude, longitude: selected.longitude }} pinColor={selected.active ? color.magenta : color.violet} />
          </MapView>
          <View style={[styles.statePill, selected.active && styles.statePillActive]}><Text style={[styles.stateText, selected.active && styles.stateTextActive]}>{selected.active ? "● 正在发生" : visited.has(selected.id) ? "✓ 去过" : saved.has(selected.id) ? "☆ 已收藏" : "● 没去过"}</Text></View>
          <Text style={styles.eyebrow}>{selected.area} · {selected.type}</Text>
          <Text style={styles.detailTitle}>{selected.name}</Text>
          <Text style={styles.detailDescription}>{selected.description}</Text>
        </View>
        <View style={styles.metrics}>
          {[[selected.creators, "Creator"], [selected.posts, "帖文"], [selected.activities, "活动"], [selected.invites, "邀约完成"]].map(([value, label]) => (
            <View key={String(label)} style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>
          ))}
        </View>
        <View style={styles.actions}>
          <Pressable onPress={() => persistToggle(saved, selected.id, setSaved, "SetRealitySceneSaved")} style={[styles.action, saved.has(selected.id) && styles.actionSelected]}><Text style={styles.actionText}>{saved.has(selected.id) ? "★ 已收藏" : "☆ 收藏"}</Text></Pressable>
          <Pressable onPress={() => persistToggle(visited, selected.id, setVisited, "SetPrivateRealitySceneVisited")} style={styles.action}><Text style={styles.actionText}>{visited.has(selected.id) ? "✓ 已去过" : "标记去过"}</Text></Pressable>
          <Pressable onPress={() => persistToggle(planned, selected.id, setPlanned, "SetRealityScenePlanned")} style={styles.primaryAction}><Text style={styles.primaryActionText}>{planned.has(selected.id) ? "✓ 已计划" : "去这里"}</Text></Pressable>
        </View>
        <Text style={styles.sectionTitle}>场景数据</Text>
        <View style={styles.dataCard}>
          <DataRow label="Scene Quality" value={String(selected.quality)} />
          <DataRow label="最佳时间" value={selected.best} />
          <DataRow label="隐私" value="历史公开记录 · 非实时位置" last />
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.roundButton}><ProxyIcon color={color.ink} name="chevronLeft" size={22} /></Pressable>
        <View style={styles.topCopy}><Text style={styles.title}>场景地图</Text><Text style={styles.subtitle}>河内 · 精选 {scenes.length} / 47 个 Scene</Text></View>
        <Pressable accessibilityLabel={view === "MAP" ? "切换列表" : "切换地图"} onPress={() => setView(view === "MAP" ? "LIST" : "MAP")} style={styles.roundButton}><ProxyIcon color={color.ink} name={view === "MAP" ? "storeLines" : "crosshair"} size={21} /></Pressable>
      </View>
      <View style={styles.stats}>
        <Stat value={47 - visited.size} label="未探索" onPress={() => setFilter("UNSEEN")} />
        <Stat value={scenes.filter((scene) => scene.active).length} label="正在发生" onPress={() => setFilter("ACTIVE")} />
        <Stat value={visited.size} label="我的足迹" onPress={() => setFilter("VISITED")} />
      </View>
      <View style={styles.searchBox}><ProxyIcon color={color.muted} name="search" size={19} /><TextInput value={query} onChangeText={setQuery} placeholder="搜场景、区域、主题" placeholderTextColor={color.muted} style={styles.searchInput} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRail} contentContainerStyle={styles.filters}>
        {([['ALL','全部'], ['UNSEEN','没去过'], ['ACTIVE','正在发生'], ['SAVED','收藏'], ['VISITED','足迹']] as const).map(([id, label]) => (
          <Pressable key={id} onPress={() => setFilter(id)} style={[styles.filter, filter === id && styles.filterActive]}><Text style={[styles.filterText, filter === id && styles.filterTextActive]}>{label}</Text></Pressable>
        ))}
      </ScrollView>
      {view === "MAP" ? (
        <View style={styles.mapWrap}>
          <MapView initialRegion={{ latitude: 21.036, longitude: 105.842, latitudeDelta: 0.115, longitudeDelta: 0.115 }} style={StyleSheet.absoluteFill}>
            {filtered.map((scene) => <Marker key={scene.id} coordinate={{ latitude: scene.latitude, longitude: scene.longitude }} onPress={() => setSelectedId(scene.id)} pinColor={scene.active ? color.magenta : visited.has(scene.id) ? color.muted : color.violet} title={scene.name} description={`${scene.area} · ${scene.type}`} />)}
          </MapView>
          <View pointerEvents="none" style={styles.privacyPill}><Text style={styles.privacyText}>公开足迹 · 非实时位置</Text></View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {filtered.map((scene) => <SceneRow key={scene.id} scene={scene} visited={visited.has(scene.id)} saved={saved.has(scene.id)} onPress={() => setSelectedId(scene.id)} />)}
          {!filtered.length ? <Text style={styles.empty}>没有符合条件的场景</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

function isRealityScene(value: unknown): value is RealityScene {
  if (!value || typeof value !== "object") return false;
  const scene = value as Partial<RealityScene>;
  return typeof scene.id === "string" && typeof scene.name === "string" && typeof scene.area === "string" && typeof scene.type === "string" && typeof scene.latitude === "number" && Number.isFinite(scene.latitude) && typeof scene.longitude === "number" && Number.isFinite(scene.longitude) && typeof scene.quality === "number" && typeof scene.best === "string" && typeof scene.posts === "number" && typeof scene.creators === "number" && typeof scene.activities === "number" && typeof scene.invites === "number" && typeof scene.active === "boolean" && typeof scene.description === "string";
}

function isUserSceneState(value: unknown): value is { sceneId: string; saved: boolean; planned: boolean; privateVisited: boolean } {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.sceneId === "string" && typeof item.saved === "boolean" && typeof item.planned === "boolean" && typeof item.privateVisited === "boolean";
}

async function sendSceneCommand(authClient: SessionAuthClient, session: AuthenticatedStoredSession, commandType: string, targetId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const response = await authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: {
    commandId: `scene_${nonce}`, commandType, commandVersion: 1,
    actor: { type: "USER", id: session.userAccountId }, principal: session.principal,
    target: { type: "RealityScene", id: targetId }, idempotencyKey: `scene_idem_${nonce}`,
    authContext: { sessionId: session.auth.sessionId }, purpose: "reality_scene_user_state",
    correlationId: `scene_corr_${nonce}`, requestedAt: new Date().toISOString(), payload
  }});
  const result = parseCommandResult(await response.json());
  if (!result || response.status < 200 || response.status >= 300 || result.outcome === "REJECTED" || !result.operationRef) throw new Error("reality scene command failed");
  const decoded = JSON.parse(result.operationRef) as unknown;
  if (!decoded || typeof decoded !== "object") throw new Error("reality scene response malformed");
  return decoded as Record<string, unknown>;
}

function Stat({ value, label, onPress }: { value: number; label: string; onPress: () => void }): React.JSX.Element {
  return <Pressable onPress={onPress} style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></Pressable>;
}

function SceneRow({ scene, visited, saved, onPress }: { scene: RealityScene; visited: boolean; saved: boolean; onPress: () => void }): React.JSX.Element {
  return <Pressable onPress={onPress} style={styles.sceneRow}><View style={[styles.sceneDot, scene.active && styles.sceneDotActive, visited && styles.sceneDotVisited]} /><View style={styles.sceneCopy}><Text style={styles.sceneName}>{scene.name}</Text><Text style={styles.sceneMeta}>{scene.area} · {scene.type}</Text><Text style={styles.sceneSignal}>{scene.active ? "正在发生" : visited ? "去过" : saved ? "已收藏" : `Scene Quality ${scene.quality}`}</Text></View><ProxyIcon color={color.muted} name="arrowUpRight" size={19} /></Pressable>;
}

function DataRow({ label, value, last = false }: { label: string; value: string; last?: boolean }): React.JSX.Element {
  return <View style={[styles.dataRow, last && styles.dataRowLast]}><Text style={styles.dataLabel}>{label}</Text><Text style={styles.dataValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  topBar: { alignItems: "center", flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  topCopy: { flex: 1 }, title: { color: color.ink, fontSize: 27, fontWeight: "900", lineHeight: 34 }, subtitle: { color: color.muted, fontSize: 12, marginTop: 1 },
  roundButton: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 22, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  stats: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 10 }, stat: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 9 }, statValue: { color: color.ink, fontSize: 19, fontWeight: "900" }, statLabel: { color: color.muted, fontSize: 11, marginTop: 2 },
  searchBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 8, marginHorizontal: 16, paddingHorizontal: 13 }, searchInput: { color: color.ink, flex: 1, fontSize: 15, height: 46 },
  filterRail: { flexGrow: 0, height: 54, maxHeight: 54, minHeight: 54 },
  filters: { alignItems: "center", gap: 8, height: 54, paddingHorizontal: 16 }, filter: { alignItems: "center", alignSelf: "center", backgroundColor: color.surface, borderRadius: 18, height: 34, justifyContent: "center", paddingHorizontal: 15 }, filterActive: { backgroundColor: color.ink }, filterText: { color: color.muted, fontSize: 13, fontWeight: "700", lineHeight: 18 }, filterTextActive: { color: color.white },
  mapWrap: { borderColor: color.line, borderRadius: 22, borderWidth: 1, flex: 1, marginBottom: 14, marginHorizontal: 16, overflow: "hidden" }, privacyPill: { alignSelf: "center", backgroundColor: "rgba(23,19,31,0.84)", borderRadius: 14, bottom: 12, paddingHorizontal: 12, paddingVertical: 7, position: "absolute" }, privacyText: { color: color.white, fontSize: 11, fontWeight: "700" },
  list: { gap: 9, paddingBottom: 24, paddingHorizontal: 16 }, sceneRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, minHeight: 82, padding: 14 }, sceneDot: { backgroundColor: color.violet, borderRadius: 9, height: 18, width: 18 }, sceneDotActive: { backgroundColor: color.magenta }, sceneDotVisited: { backgroundColor: color.muted }, sceneCopy: { flex: 1 }, sceneName: { color: color.ink, fontSize: 16, fontWeight: "800" }, sceneMeta: { color: color.muted, fontSize: 12, marginTop: 3 }, sceneSignal: { color: color.violet, fontSize: 11, fontWeight: "700", marginTop: 5 }, empty: { color: color.muted, paddingTop: 40, textAlign: "center" },
  detailContent: { paddingBottom: 36, paddingHorizontal: 16 }, backButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 2, paddingVertical: 9 }, backText: { color: color.ink, fontSize: 14, fontWeight: "800" }, hero: { backgroundColor: color.white, borderColor: color.line, borderRadius: 22, borderWidth: 1, overflow: "hidden", padding: 16, paddingTop: 158 }, heroMap: { height: 142, left: 0, position: "absolute", right: 0, top: 0 }, statePill: { alignSelf: "flex-start", backgroundColor: color.surface, borderRadius: 14, marginTop: 4, paddingHorizontal: 10, paddingVertical: 6 }, statePillActive: { backgroundColor: color.attentionBg }, stateText: { color: color.muted, fontSize: 11, fontWeight: "800" }, stateTextActive: { color: color.error }, eyebrow: { color: color.muted, fontSize: 12, marginTop: 12 }, detailTitle: { color: color.ink, fontSize: 25, fontWeight: "900", marginTop: 3 }, detailDescription: { color: color.muted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  metrics: { flexDirection: "row", gap: 7, marginTop: 10 }, metric: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 11 }, metricValue: { color: color.ink, fontSize: 17, fontWeight: "900" }, metricLabel: { color: color.muted, fontSize: 11, marginTop: 2 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 }, action: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flex: 1, paddingVertical: 13 }, actionSelected: { backgroundColor: color.proxyPurpleSoft }, actionText: { color: color.ink, fontSize: 13, fontWeight: "800" }, primaryAction: { alignItems: "center", backgroundColor: color.ink, borderRadius: 16, flex: 1, paddingVertical: 13 }, primaryActionText: { color: color.white, fontSize: 13, fontWeight: "800" },
  sectionTitle: { color: color.ink, fontSize: 18, fontWeight: "900", marginBottom: 8, marginTop: 20 }, dataCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14 }, dataRow: { borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 }, dataRowLast: { borderBottomWidth: 0 }, dataLabel: { color: color.ink, fontSize: 13, fontWeight: "700" }, dataValue: { color: color.muted, fontSize: 13 }
});
