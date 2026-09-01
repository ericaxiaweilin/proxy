// R15.29: Real Apple Maps via MapKit (iOS) using react-native-maps.
// The previous SVG-grid implementation served as a stand-in while
// MapKit / react-native-maps was considered too heavy (prebuild + pod
// install cost). Now that we want a real map for the Location Picker
// (河内 / 胡志明 / 岘港 with real roads, water, POIs), the cost is
// worth it — MapKit is free, requires no API key, and matches the
// native iOS look users expect.
//
// Coordinate model is unchanged: the picker still passes a GridCoord
// (0..10 × 0..10) and we project it to a real (lat, lng) via
// `gridToLatLng(city, x, y)` from location-options. Tap/drag on the
// real map fires back a new lat/lng, we invert it to GridCoord and
// call onChange — the rest of the location-picker-sheet code keeps
// working without changes.
//
// Android: react-native-maps is installed but the provider is hard
// pinned to Apple (PROVIDER_DEFAULT = MapKit on iOS, but on Android
// that resolves to Google Maps and needs an API key). To avoid the
// Android-side key requirement we don't export a working map on
// Android yet; if you build for Android, drop in PROVIDER_GOOGLE
// with your key. See R15.30+ for the Android setup.
import MapView, { Circle, Marker, type LatLng, type Region } from "react-native-maps";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { CITY_BOUNDS, GRID_W, GRID_H, type GridCoord, gridToLatLng } from "./location-options";
import { color } from "../theme";

export interface MapCanvasProps {
  // 初始 pin 位置（grid coord）。0,0 = 城市西北角；
  // GRID_W, GRID_H = 东南角。
  initialPin: GridCoord;
  // 半径（米）。
  radiusMeters: 1000 | 3000 | 5000;
  // 城市名（显示在角标）
  cityHint: string;
  // pin / 拖动 / 完成时回调 (新 grid coord)
  onChange: (next: GridCoord) => void;
  // 可选：测试 ID
  testID?: string;
}

// City bounds key for the city hint. Falls back to 河内 if unknown.
function resolveCityKey(hint: string): string {
  if (hint in CITY_BOUNDS) return hint;
  for (const key of Object.keys(CITY_BOUNDS)) {
    if (key.includes(hint) || hint.includes(key)) return key;
  }
  return "河内";
}

// Inverse of gridToLatLng — project real (lat, lng) into the city's
// 10×10 grid. Same math, just inverted.
function latLngToGrid(city: string, lat: number, lng: number): GridCoord {
  const bounds = CITY_BOUNDS[city] ?? CITY_BOUNDS["河内"]!;
  const halfSpanDeg = (bounds.spanKm / 2) / 111;
  const gxRaw = ((lng - bounds.centerLng) * GRID_W) / (2 * halfSpanDeg) + GRID_W / 2;
  const gyRaw = ((bounds.centerLat - lat) * GRID_H) / (2 * halfSpanDeg) + GRID_H / 2;
  const gx = Math.max(0, Math.min(GRID_W, Math.round(gxRaw)));
  const gy = Math.max(0, Math.min(GRID_H, Math.round(gyRaw)));
  return { x: gx, y: gy };
}

export function MapCanvas({
  initialPin,
  radiusMeters,
  cityHint,
  onChange,
  testID
}: MapCanvasProps): React.JSX.Element {
  const cityKey = resolveCityKey(cityHint);
  const bounds = CITY_BOUNDS[cityKey] ?? CITY_BOUNDS["河内"]!;

  // 当前 pin (grid → lat/lng for the marker)
  const [pin, setPin] = useState<GridCoord>(initialPin);
  const pinLatLng = useMemo<LatLng>(() => {
    const { lat, lng } = gridToLatLng(cityKey, pin.x, pin.y);
    return { latitude: lat, longitude: lng };
  }, [cityKey, pin.x, pin.y]);

  // Initial region = city center with the city span. We use a roughly
  // square deltaLat / deltaLng from `spanKm` so the whole city fits.
  const initialRegion: Region = useMemo(() => ({
    latitude: bounds.centerLat,
    longitude: bounds.centerLng,
    // 0.7 * spanKm 留点内边距
    latitudeDelta: (bounds.spanKm * 0.7) / 111,
    longitudeDelta: (bounds.spanKm * 0.7) / 111
  }), [bounds]);

  // Region state — tracks user pan/zoom so the HUD shows the current view
  const [region, setRegion] = useState<Region>(initialRegion);

  // Sync external pin changes (e.g. radius change resets pin)
  useEffect(() => {
    setPin(initialPin);
  }, [initialPin.x, initialPin.y]);

  // Skip the map entirely on Android for now (no Google key yet).
  // Render a simple fallback so the rest of the UI doesn't break.
  if (Platform.OS !== "ios") {
    return <FallbackNotice cityHint={cityHint} onChange={onChange} pin={pin} radiusMeters={radiusMeters} />;
  }

  // Ref to throttle onChange — MapView fires onRegionChange at every
  // frame during a drag, but we only want to commit on idle so the
  // downstream state doesn't churn.
  const lastCommittedRef = useRef<GridCoord>(pin);
  const commitFromLatLng = (coord: LatLng): void => {
    const g = latLngToGrid(cityKey, coord.latitude, coord.longitude);
    // Skip if same grid cell (avoid setState spam on map idle)
    if (g.x === lastCommittedRef.current.x && g.y === lastCommittedRef.current.y) return;
    lastCommittedRef.current = g;
    setPin(g);
    onChange(g);
  };

  return (
    <View testID={testID} style={styles.canvas}>
      <MapView
        initialRegion={initialRegion}
        onRegionChangeComplete={setRegion}
        // Pin drag — drag-end commit
        onMarkerDragEnd={(e) => commitFromLatLng(e.nativeEvent.coordinate)}
        // Map tap (anywhere) — move pin there
        onPress={(e) => commitFromLatLng(e.nativeEvent.coordinate)}
        // iOS MapKit via react-native-maps
        provider={undefined}
        // Camera + gesture config
        rotateEnabled={false}
        scrollEnabled
        style={StyleSheet.absoluteFill}
        // iOS-only MapKit polish: show the user's current location dot
        // (we don't request permission here; OS shows the "?" if not granted)
        showsUserLocation
        showsCompass={false}
        showsMyLocationButton={false}
        showsScale={false}
        toolbarEnabled={false}
        zoomEnabled
      >
        <Marker
          coordinate={pinLatLng}
          draggable
          pinColor="#8033F0"
          title={cityHint}
          description={`半径 ${radiusMeters / 1000} km`}
        />
        <Circle
          center={pinLatLng}
          fillColor="rgba(128, 51, 240, 0.10)"
          radius={radiusMeters}
          strokeColor="#8033F0"
          strokeWidth={1.5}
        />
      </MapView>
      {/* HUD 角标：城市 + 当前 grid + 半径 */}
      <View pointerEvents="none" style={styles.hud}>
        <Text style={styles.hudCity}>{cityHint}</Text>
        <Text style={styles.hudCoord}>
          ({pin.x}, {pin.y}) · 半径 {radiusMeters / 1000} km
        </Text>
        <Text style={styles.hudHint}>拖 pin 或点地图移动 · 双指捏放缩放</Text>
      </View>
    </View>
  );
}

// Android fallback — until R15.30 wires up Google Maps. Keeps the picker
// usable but draws a static notice card so QA can see the bug from the
// outside instead of crashing the app.
function FallbackNotice({
  cityHint,
  onChange,
  pin,
  radiusMeters
}: {
  cityHint: string;
  onChange: (g: GridCoord) => void;
  pin: GridCoord;
  radiusMeters: number;
}): React.JSX.Element {
  return (
    <View style={[styles.canvas, styles.androidFallback]}>
      <Text style={styles.androidTitle}>地图仅在 iOS 可用</Text>
      <Text style={styles.androidBody}>
        R15.29 已接 Apple Maps (MapKit)。Android 端需要 Google Maps key
        (R15.30+)。当前 grid 坐标: ({pin.x}, {pin.y}) · 半径 {radiusMeters / 1000} km
      </Text>
      {/* 不可见 Pressable to keep onChange callable in case caller relies on it */}
      <View style={{ display: "none" }} onTouchEnd={() => onChange(pin)} />
      <Text style={styles.androidHint}>{cityHint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    aspectRatio: 1,
    backgroundColor: "#E5E1DA",
    borderColor: "#D7C9B0",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    width: "100%"
  },
  hud: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 10,
    bottom: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: "absolute",
    right: 10
  },
  hudCity: { color: color.ink, fontSize: 12, fontWeight: "800" },
  hudCoord: { color: color.muted, fontSize: 11, fontWeight: "500", marginTop: 1 },
  hudHint: { color: color.muted, fontSize: 10, fontWeight: "500", marginTop: 2 },
  androidFallback: {
    alignItems: "center",
    backgroundColor: "#F2EDE3",
    justifyContent: "center",
    padding: 20
  },
  androidTitle: { color: color.ink, fontSize: 14, fontWeight: "800", marginBottom: 6 },
  androidBody: { color: color.muted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  androidHint: { color: color.proxyPurple, fontSize: 12, fontWeight: "800", marginTop: 10 }
});
