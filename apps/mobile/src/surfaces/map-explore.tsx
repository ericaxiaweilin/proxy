// MapExploreSurface — R15.32 Instagram-style map of posts/agents/orders.
//
// 设计原则：
//  - 全屏 MapView，Apple Maps (R15.29) + GPS (R15.30) 都已经在
//    MapCanvas 验证过；这里直接复用 MapView 标记能力，单独写是因为
//    surface 跟设置工具的交互模型不同（探索 vs 选择）。
//  - 顶部 filter chips：全部/帖/用户/订单；切换时立刻重发 query。
//  - onRegionChangeComplete 防抖 350ms 触发 refetch，避免每次像素级
//    pan/zoom 都发请求。
//  - pin 用纯 react-native-maps <Marker>，不引入 supercluster：
//    demo 数据量 ~30 pins，clustering 在视觉上是噪音。当真实数据
//    超过 200 pins 时再加（保持 R15.32.1 scope）。
//  - 底部 HUD 显示当前结果数 + 缩放级别（lat/lng delta），跟 MapCanvas
//    的 R15.30 HUD 同款。

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import MapView, { Circle, Marker, type Region } from "react-native-maps";
import type { AgentPin, MapItemKind, MapItemsPayload, OrderPin, PostPin } from "@proxy/contracts";
import { MapClient, bboxFromRegion, type PublicRequester } from "../map-client";
import { color } from "../theme";
import type { TransportResponse } from "../auth-client";

type FilterKind = "all" | "post" | "agent" | "order";

const FILTER_LABELS: Record<FilterKind, string> = {
  all: "全部",
  post: "帖",
  agent: "用户",
  order: "订单",
};

const KIND_OF_FILTER: Record<FilterKind, MapItemKind[] | null> = {
  all: null, // null = no types filter, server returns everything
  post: ["post"],
  agent: ["agent"],
  order: ["order"],
};

// Vietnam default region (Hanoi center) so first paint shows pins.
const DEFAULT_REGION: Region = {
  latitude: 21.0285,
  longitude: 105.8542,
  latitudeDelta: 0.6,
  longitudeDelta: 0.6,
};

type SelectedPin =
  | { kind: "post"; pin: PostPin }
  | { kind: "agent"; pin: AgentPin }
  | { kind: "order"; pin: OrderPin };

export type MapExploreSurfaceProps = {
  requester: PublicRequester;
  baseUrl: string;
  initialRegion?: Region;
  onClose?: (() => void) | undefined;
};

export function MapExploreSurface(props: MapExploreSurfaceProps) {
  const client = useMemo(
    () => new MapClient({ requester: props.requester, baseUrl: props.baseUrl }),
    [props.requester, props.baseUrl]
  );

  const [region, setRegion] = useState<Region>(props.initialRegion ?? DEFAULT_REGION);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [payload, setPayload] = useState<MapItemsPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedPin | null>(null);

  const mapRef = useRef<MapView | null>(null);
  const reqId = useRef<number>(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchItems = useCallback(
    async (r: Region, f: FilterKind) => {
      const myId = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const kinds = KIND_OF_FILTER[f];
        const q = { ...bboxFromRegion(r), ...(kinds ? { types: kinds } : {}), limit: 200 };
        const data = await client.items(q);
        if (myId !== reqId.current) return; // stale
        setPayload(data);
      } catch (e) {
        if (myId !== reqId.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setPayload(null);
      } finally {
        if (myId === reqId.current) setLoading(false);
      }
    },
    [client]
  );

  // Initial load.
  useEffect(() => {
    fetchItems(region, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch on filter change (immediate, no debounce).
  useEffect(() => {
    fetchItems(region, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Debounced re-fetch on region change.
  const onRegionChangeComplete = useCallback(
    (next: Region) => {
      setRegion(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchItems(next, filter);
      }, 350);
    },
    [fetchItems, filter]
  );

  const goToMyLocation = useCallback(
    async (e: GestureResponderEvent) => {
      e.stopPropagation?.();
      try {
        const Location = await import("expo-location");
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setError("未授权定位 — 在 iOS 设置 → Proxy → 位置 里开");
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const next: Region = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        setRegion(next);
        mapRef.current?.animateToRegion(next, 400);
        fetchItems(next, filter);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [fetchItems, filter]
  );

  const posts = payload?.posts ?? [];
  const agents = payload?.agents ?? [];
  const orders = payload?.orders ?? [];
  const count = payload?.count ?? 0;

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={props.initialRegion ?? DEFAULT_REGION}
        onRegionChangeComplete={onRegionChangeComplete}
        showsUserLocation
        showsMyLocationButton={false}
        onPress={() => setSelected(null)}
      >
        {/* Visible region halo so users know what's loaded */}
        <Circle
          center={{ latitude: region.latitude, longitude: region.longitude }}
          radius={Math.min(region.latitudeDelta, region.longitudeDelta) * 50000}
          fillColor="rgba(255,107,107,0.05)"
          strokeColor="rgba(255,107,107,0.35)"
          strokeWidth={1}
        />
        {posts.map((p) => (
          <Marker
            key={`p:${p.id}`}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            pinColor="#FF6B6B"
            title={p.authorName}
            description={truncate(p.body, 60)}
            onPress={() => setSelected({ kind: "post", pin: p })}
          />
        ))}
        {agents.map((a) => (
          <Marker
            key={`a:${a.id}`}
            coordinate={{ latitude: a.lat, longitude: a.lng }}
            pinColor={a.availability === "AVAILABLE" ? "#1FA67A" : "#7A7A7A"}
            title={a.name}
            description={`${a.languages.join("/")} · ${a.availability}`}
            onPress={() => setSelected({ kind: "agent", pin: a })}
          />
        ))}
        {orders.map((o) => (
          <Marker
            key={`o:${o.id}`}
            coordinate={{ latitude: o.lat, longitude: o.lng }}
            pinColor="#7A6BFF"
            title={o.title}
            description={`${o.status} · ${o.city || ""}`}
            onPress={() => setSelected({ kind: "order", pin: o })}
          />
        ))}
      </MapView>

      {/* Top filter chips */}
      <View style={styles.filterBar}>
        {(Object.keys(FILTER_LABELS) as FilterKind[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.chip, filter === f && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f }}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
              {FILTER_LABELS[f]}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* GPS button (top-right) */}
      <Pressable
        onPress={goToMyLocation}
        style={styles.gpsBtn}
        accessibilityRole="button"
        accessibilityLabel="定位到当前位置"
      >
        <Text style={styles.gpsBtnText}>📍 当前位置</Text>
      </Pressable>

      {/* Bottom HUD: result count + status */}
      <View style={styles.hud} pointerEvents="box-none">
        {loading ? (
          <ActivityIndicator size="small" color={color.ink} />
        ) : error ? (
          <Text style={styles.hudError} numberOfLines={2}>⚠️ {error}</Text>
        ) : (
          <Text style={styles.hudText}>
            {count} 个 · 缩放 {region.latitudeDelta.toFixed(2)}°
          </Text>
        )}
      </View>

      {/* Pin preview bottom sheet */}
      {selected && <PinPreview selected={selected} baseUrl={props.baseUrl} onClose={() => setSelected(null)} />}

      {/* Close button (if launched as subpage) */}
      {props.onClose && (
        <Pressable onPress={props.onClose} style={styles.closeBtn} accessibilityRole="button">
          <Text style={styles.closeBtnText}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

function PinPreview(props: { selected: SelectedPin; baseUrl: string; onClose: () => void }) {
  const { selected, onClose } = props;
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetKind}>
          {selected.kind === "post" ? "📝 帖" : selected.kind === "agent" ? "👤 用户" : "🛒 订单"}
        </Text>
        <Pressable onPress={onClose} style={styles.sheetClose} accessibilityRole="button">
          <Text style={styles.sheetCloseText}>✕</Text>
        </Pressable>
      </View>
      {selected.kind === "post" && (
        <>
          <Text style={styles.sheetTitle}>{selected.pin.authorName}</Text>
          {selected.pin.thumbnailUrl ? (
            <Image
              source={{ uri: `${props.baseUrl}${selected.pin.thumbnailUrl}` }}
              style={styles.sheetCover}
              resizeMode="cover"
              accessibilityLabel="帖封面"
            />
          ) : (
            <View style={[styles.sheetCover, styles.sheetCoverPlaceholder]}>
              <Text style={styles.sheetCoverPlaceholderText}>
                {selected.pin.mediaType === "VIDEO" ? "🎬" : selected.pin.mediaCount > 0 ? "📷" : "📝"}
              </Text>
            </View>
          )}
          <Text style={styles.sheetBody}>{truncate(selected.pin.body, 160) || "(无文字)"}</Text>
          <Text style={styles.sheetMeta}>
            {selected.pin.cityScope} · {selected.pin.mediaCount} 个媒体 ·{" "}
            {selected.pin.sceneType !== "UNKNOWN" ? selected.pin.sceneType : ""}
          </Text>
          <Pressable style={styles.sheetAction} onPress={onClose} accessibilityRole="button">
            <Text style={styles.sheetActionText}>关闭</Text>
          </Pressable>
        </>
      )}
      {selected.kind === "agent" && (
        <>
          <View style={styles.sheetAgentHeader}>
            <View
              style={[
                styles.sheetAgentAvatar,
                selected.pin.availability === "AVAILABLE" && styles.sheetAgentAvatarOnline,
              ]}
            >
              <Text style={styles.sheetAgentAvatarText}>
                {selected.pin.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>{selected.pin.name}</Text>
              <Text style={styles.sheetAvailability}>
                {selected.pin.availability === "AVAILABLE"
                  ? "🟢 当前在线"
                  : selected.pin.availability === "BUSY"
                    ? "🟠 忙碌"
                    : "⚪ 离线"}
              </Text>
            </View>
          </View>
          <Text style={styles.sheetBody}>{truncate(selected.pin.bio, 160) || "(无简介)"}</Text>
          <View style={styles.sheetChips}>
            {selected.pin.languages.map((lang) => (
              <View key={lang} style={styles.sheetChip}>
                <Text style={styles.sheetChipText}>{lang}</Text>
              </View>
            ))}
            {selected.pin.serviceAreas.map((area) => (
              <View key={area} style={[styles.sheetChip, styles.sheetChipArea]}>
                <Text style={styles.sheetChipText}>📍 {area}</Text>
              </View>
            ))}
          </View>
          <Pressable style={styles.sheetAction} onPress={onClose} accessibilityRole="button">
            <Text style={styles.sheetActionText}>关闭</Text>
          </Pressable>
        </>
      )}
      {selected.kind === "order" && (
        <>
          <Text style={styles.sheetTitle}>{selected.pin.title || "(未命名)"}</Text>
          <View style={styles.sheetOrderRow}>
            <Text style={styles.sheetOrderBudget}>
              {selected.pin.budget > 0 ? `${selected.pin.budget.toLocaleString()} ₫` : "面议"}
            </Text>
            <View
              style={[
                styles.sheetStatus,
                selected.pin.status === "OPEN" && styles.sheetStatusOpen,
                selected.pin.status === "IN_PROGRESS" && styles.sheetStatusProgress,
              ]}
            >
              <Text style={styles.sheetStatusText}>{selected.pin.status}</Text>
            </View>
          </View>
          <Text style={styles.sheetMeta}>
            {[selected.pin.city, selected.pin.area].filter(Boolean).join(" · ")}
          </Text>
          <Pressable style={styles.sheetAction} onPress={onClose} accessibilityRole="button">
            <Text style={styles.sheetActionText}>关闭</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

// -- styles --
const HUD_FONT_SIZE = 11; // R15.30: design system rule, ≥11pt
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.appBg },
  filterBar: {
    position: "absolute",
    top: 56,
    left: 12,
    right: 12,
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 22,
    padding: 4,
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 4,
  },
  chip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    alignItems: "center",
  },
  chipActive: { backgroundColor: color.ink },
  chipText: { fontSize: HUD_FONT_SIZE + 1, color: color.muted, fontWeight: "500" },
  chipTextActive: { color: color.white, fontWeight: "700" },
  gpsBtn: {
    position: "absolute",
    right: 12,
    top: 120,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },
  gpsBtnText: { fontSize: HUD_FONT_SIZE + 1, color: color.ink, fontWeight: "600" },
  hud: {
    position: "absolute",
    bottom: 36,
    left: 12,
    right: 12,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    minHeight: 36,
    justifyContent: "center",
  },
  hudText: { fontSize: HUD_FONT_SIZE, color: color.muted },
  hudError: { fontSize: HUD_FONT_SIZE, color: "#C0392B" },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: color.appBg,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 28,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: -2 },
    shadowRadius: 8,
    elevation: 8,
  },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  sheetKind: { fontSize: HUD_FONT_SIZE + 1, color: color.muted, fontWeight: "600" },
  sheetClose: { padding: 4 },
  sheetCloseText: { fontSize: HUD_FONT_SIZE + 3, color: color.muted },
  sheetTitle: { fontSize: 17, fontWeight: "700", color: color.ink, marginBottom: 4 },
  sheetBody: { fontSize: HUD_FONT_SIZE + 1, color: color.ink, marginBottom: 6, lineHeight: 18 },
  sheetMeta: { fontSize: HUD_FONT_SIZE, color: color.muted },
  // R15.32.2: cover image (when post has media) + placeholder fallback.
  sheetCover: {
    width: "100%",
    height: 140,
    backgroundColor: color.line,
    borderRadius: 10,
    marginBottom: 8,
  },
  sheetCoverPlaceholder: {
    backgroundColor: color.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetCoverPlaceholderText: { fontSize: 36 },
  // R15.32.2: agent card with avatar + availability dot.
  sheetAgentHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  sheetAgentAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: color.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: color.line,
  },
  sheetAgentAvatarOnline: { borderColor: "#1FC8A9" },
  sheetAgentAvatarText: { fontSize: 18, fontWeight: "800", color: color.ink },
  sheetAvailability: { fontSize: HUD_FONT_SIZE, color: color.muted, marginTop: 2 },
  // R15.32.2: language / area chip row.
  sheetChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  sheetChip: {
    backgroundColor: color.surface,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sheetChipArea: { backgroundColor: "#FAF6E5" },
  sheetChipText: { fontSize: HUD_FONT_SIZE, color: color.ink, fontWeight: "600" },
  // R15.32.2: order card with budget + status pill.
  sheetOrderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  sheetOrderBudget: { fontSize: 20, fontWeight: "800", color: color.ink },
  sheetStatus: {
    backgroundColor: color.line,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sheetStatusOpen: { backgroundColor: "#1FC8A9" },
  sheetStatusProgress: { backgroundColor: "#FFD86A" },
  sheetStatusText: { fontSize: HUD_FONT_SIZE, color: color.ink, fontWeight: "700" },
  sheetAction: {
    marginTop: 12,
    backgroundColor: color.surface,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  sheetActionText: { fontSize: HUD_FONT_SIZE + 1, color: color.ink, fontWeight: "600" },
  closeBtn: {
    position: "absolute",
    top: 56,
    right: 16,
    backgroundColor: "rgba(255,255,255,0.85)",
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { fontSize: 16, color: color.ink, fontWeight: "700" },
});
