// R15.29 + R15.30: Real Apple Maps (MapKit) with optional GPS positioning.
// Previously the picker rendered a hand-drawn SVG grid (10×10 cells
// faking 河内/胡志明/岘港). Now it's a real MapKit-backed MapView from
// react-native-maps 1.29, and `expo-location` 17.x powers the
// "use my location" button so users can snap the pin to where they
// actually are without manual pan/zoom.
//
// Permission flow:
//   - User taps "📍 用我当前位置" → `requestForegroundPermissionsAsync`
//   - iOS shows the system dialog with `NSLocationWhenInUseUsageDescription`
//   - If granted: `getCurrentPositionAsync` → snap MapView to that
//     coordinate (accuracy: Balanced) and drop the pin there
//   - If denied: inline hint, picker keeps working manually
//   - showsUserLocation: true draws the blue dot in MapKit when the
//     app already has permission (we don't double-prompt)
//
// Coordinate model is unchanged: the picker still uses GridCoord
// (0..10 × 0..10) for storage and display, and a small latLngToGrid
// function projects real-world coords back into a grid cell so the
// rest of the picker / store / surface code keeps working without
// change. Tap and pin-drag both commit on idle (throttled so
// onChange doesn't fire every frame).
//
// Android: react-native-maps is installed but the provider is hard
// pinned to Apple (PROVIDER_DEFAULT = MapKit on iOS, but on Android
// that resolves to Google Maps and needs an API key). R15.30+ will
// add Google Maps key for Android.
import MapView, { Circle, Marker, type LatLng, type Region } from "react-native-maps";
import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { CITY_BOUNDS, GRID_W, GRID_H, type GridCoord, gridToLatLng } from "./location-options";
import { color } from "../theme";

export interface MapCanvasProps {
  // 初始 pin 位置（grid coord）。0,0 = 城市西北角；
  // GRID_W, GRID_H = 东南角。
  initialPin: GridCoord;
  // 半径（米）。
  radiusMeters: 1000 | 3000 | 5000;
  // 城市名（显示在角标）。"" 表示未知 — 不再默认任何城市。
  cityHint: string;
  // pin / 拖动 / 完成时回调 (新 grid coord)
  initialCoordinate?: { lat: number; lng: number } | undefined;
  onChange: (next: GridCoord, coordinate?: { lat: number; lng: number }) => void;
  // 可选：测试 ID
  testID?: string;
  // 打开自动定位：无真实坐标时 mount 即请求一次 GPS（默认 true）。
  // 关掉则保持手动（仅点按钮才定位）。
  autoLocate?: boolean;
}

// City bounds key for the city hint. Falls back to 河内 if unknown —
// 仅用于 grid 换算兼容，地图初始视角不再用它做默认（见 VIETNAM_WIDE_REGION）。
function resolveCityKey(hint: string): string {
  if (hint in CITY_BOUNDS) return hint;
  for (const key of Object.keys(CITY_BOUNDS)) {
    if (key.includes(hint) || hint.includes(key)) return key;
  }
  return "河内";
}

// hint 是否指向已知城市。"" / 未知 => 不固定任何城市。
function isKnownCityHint(hint: string): boolean {
  if (!hint) return false;
  if (hint in CITY_BOUNDS) return true;
  return Object.keys(CITY_BOUNDS).some((key) => key.includes(hint) || hint.includes(key));
}

// 无固定城市时的初始视角：全国视野，等 GPS 回来再 animate 到人。
// 不是默认值 — 拿到真实坐标后立即离开这里。
const VIETNAM_WIDE_REGION: Region = {
  latitude: 15.8,
  longitude: 107.5,
  latitudeDelta: 12,
  longitudeDelta: 12
};

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

// Find the nearest city in CITY_BOUNDS to a given (lat, lng).
// Used to auto-snap "use my location" to the closest supported city
// so the user gets a sensible cityHint + zoom level even if they
// happen to be a few km outside the hardcoded 12 km city span.
function nearestCity(lat: number, lng: number): string {
  let best = "河内";
  let bestDist = Infinity;
  for (const key of Object.keys(CITY_BOUNDS)) {
    const b = CITY_BOUNDS[key]!;
    const dx = (b.centerLng - lng) * 111 * Math.cos((lat * Math.PI) / 180);
    const dy = (b.centerLat - lat) * 111;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  return best;
}

export function MapCanvas({
  initialPin,
  radiusMeters,
  cityHint,
  initialCoordinate,
  onChange,
  testID,
  autoLocate = true
}: MapCanvasProps): React.JSX.Element {
  const cityKey = resolveCityKey(cityHint);
  const bounds = CITY_BOUNDS[cityKey] ?? CITY_BOUNDS["河内"]!;
  const hasKnownCity = isKnownCityHint(cityHint);

  // 当前 pin (grid → lat/lng for the marker)
  const [pin, setPin] = useState<GridCoord>(initialPin);
  const [exactCoordinate, setExactCoordinate] = useState<LatLng | undefined>(initialCoordinate ? { latitude: initialCoordinate.lat, longitude: initialCoordinate.lng } : undefined);
  const pinLatLng = useMemo<LatLng>(() => {
    if (exactCoordinate) return exactCoordinate;
    const { lat, lng } = gridToLatLng(cityKey, pin.x, pin.y);
    return { latitude: lat, longitude: lng };
  }, [cityKey, exactCoordinate, pin.x, pin.y]);

  // Initial region — 不再固定某个城市：
  // 有真实坐标直接居中；有明确城市看该城市；否则全国视野等 GPS。
  const initialRegion: Region = useMemo(() => {
    if (initialCoordinate) {
      return {
        latitude: initialCoordinate.lat,
        longitude: initialCoordinate.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02
      };
    }
    if (hasKnownCity) {
      return {
        latitude: bounds.centerLat,
        longitude: bounds.centerLng,
        // 0.7 * spanKm 留点内边距
        latitudeDelta: (bounds.spanKm * 0.7) / 111,
        longitudeDelta: (bounds.spanKm * 0.7) / 111
      };
    }
    return { ...VIETNAM_WIDE_REGION };
  }, [bounds, hasKnownCity, initialCoordinate]);

  // Region state — tracks user pan/zoom so the HUD shows the current view
  const [region, setRegion] = useState<Region>(initialRegion);

  // Map ref so we can imperatively animate to the user's GPS coord
  const mapRef = useRef<MapView | null>(null);

  // GPS button state
  const [locBusy, setLocBusy] = useState<boolean>(false);
  const [locError, setLocError] = useState<string | null>(null);

  // Sync external pin changes (e.g. radius change resets pin)
  useEffect(() => {
    setPin(initialPin);
    setExactCoordinate(initialCoordinate ? { latitude: initialCoordinate.lat, longitude: initialCoordinate.lng } : undefined);
  }, [initialCoordinate?.lat, initialCoordinate?.lng, initialPin.x, initialPin.y]);

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
    setExactCoordinate(coord);
    onChange(g, { lat: coord.latitude, lng: coord.longitude });
  };

  // GPS 定位并把地图 + pin 吸到真实坐标 — 手动按钮和打开自动定位共用。
  // grid 只做存储兼容（按最近城市换算），真相以 exactCoordinate / onChange 为准。
  async function useMyLocation(): Promise<void> {
    if (locBusy) return;
    setLocError(null);
    setLocBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocError("未授权定位 — 在 iOS 设置 → Proxy → 位置 里开"  );
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });
      const { latitude, longitude } = pos.coords;
      const targetCity = nearestCity(latitude, longitude);
      const g = latLngToGrid(targetCity, latitude, longitude);
      lastCommittedRef.current = g;
      setPin(g);
      setExactCoordinate({ latitude, longitude });
      onChange(g, { lat: latitude, lng: longitude });
      // Animate map camera to the GPS coord. We use a tight delta
      // (~ 2 km) so the user sees the immediate neighborhood.
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude,
          longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02
        }, 350);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "获取位置失败";
      setLocError(msg);
    } finally {
      setLocBusy(false);
    }
  }

  // 打开自动定位：无真实坐标时 mount 即请求一次 GPS，不再停在固定城市。
  // 有坐标（回访/历史恢复）直接用，不重复打扰；失败就地提示，用户仍可手动。
  const autoTriedRef = useRef(false);
  useEffect(() => {
    if (!autoLocate) return;
    if (Platform.OS !== "ios") return;
    if (initialCoordinate) return;
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    void useMyLocation();
    // mount 跑一次即可，guard 靠 autoTriedRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLocate, initialCoordinate?.lat, initialCoordinate?.lng]);

  // 角标：未知城市不写死，GPS 回来前诚实显示定位中。
  const hudCityText = cityHint || (exactCoordinate ? "当前位置" : "正在定位…");

  // Skip the map entirely on Android for now (no Google key yet).
  // Render a simple fallback so the rest of the UI doesn't break.
  if (Platform.OS !== "ios") {
    return <FallbackNotice cityHint={hudCityText} onChange={onChange} pin={pin} radiusMeters={radiusMeters} />;
  }

  return (
    <View testID={testID} style={styles.canvas}>
      <MapView
        ref={mapRef}
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
        // iOS-only MapKit polish: show the user's current location dot.
        // iOS only shows this if the app already has WhenInUse auth;
        // until then the dot is hidden (no "?" appears).
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
          // R15.32.1.2: PNG-backed violet teardrop icon. The
          // <Marker icon={require(...)}> path is the recommended way
          // for a custom marker on iOS MapKit — it gives us a
          // proper UIImage-backed annotation view (vs an SVG child
          // which never paints inside the MapKit view hierarchy).
          // Asset: 24×30 logical, 48×60 @2x, 72×90 @3x.
          // Anchor defaults to (0.5, 1.0) — bottom-center, so the
          // teardrop tip sits exactly on the marker's coordinate.
          icon={require("../../assets/map-pin/pin-violet.png")}
          title={hudCityText}
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

      {/* Top-right: 用我当前位置 button. Sits on top of the map
          (pointerEvents=box-none so taps fall through except on the
          button itself). */}
      <View pointerEvents="box-none" style={styles.topBar}>
        <Pressable
          accessibilityLabel="用我当前位置"
          disabled={locBusy}
          onPress={() => {
            void useMyLocation();
          }}
          style={({ pressed }) => [styles.locButton, pressed && styles.locButtonPressed, locBusy && styles.locButtonBusy]}
        >
          {locBusy ? (
            <ActivityIndicator color={color.white} size="small" />
          ) : (
            <Text style={styles.locButtonText}>📍 用我当前位置</Text>
          )}
        </Pressable>
      </View>

      {/* Error banner — shown when GPS request fails. Auto-clears
          when the user retries (or pans / drags the pin). */}
      {locError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{locError}</Text>
          <Pressable
            accessibilityLabel="关闭错误提示"
            onPress={() => setLocError(null)}
            style={styles.errorClose}
          >
            <Text style={styles.errorCloseText}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {/* HUD 角标：城市（未知不写死） + 当前 grid + 半径 */}
      <View pointerEvents="none" style={styles.hud}>
        <Text style={styles.hudCity}>{hudCityText}</Text>
        <Text style={styles.hudCoord}>
          ({pin.x}, {pin.y}) · 半径 {radiusMeters / 1000} km
        </Text>
        <Text style={styles.hudHint}>拖 pin / 点地图 / 📍用我位置</Text>
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
        (R15.30+)。当前覆盖范围：{radiusMeters / 1000} km
      </Text>
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
  topBar: {
    position: "absolute",
    right: 10,
    top: 10,
    flexDirection: "row"
  },
  locButton: {
    backgroundColor: "rgba(128, 51, 240, 0.92)",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
    elevation: 2
  },
  locButtonPressed: {
    backgroundColor: "rgba(98, 25, 200, 0.96)"
  },
  locButtonBusy: {
    backgroundColor: "rgba(128, 51, 240, 0.55)"
  },
  locButtonText: {
    color: color.white,
    fontSize: 12,
    fontWeight: "700"
  },
  errorBanner: {
    backgroundColor: "rgba(214, 78, 70, 0.95)",
    borderRadius: 8,
    bottom: 70,
    flexDirection: "row",
    left: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: "absolute",
    right: 10,
    alignItems: "center"
  },
  errorText: {
    color: color.white,
    flex: 1,
    fontSize: 12,
    fontWeight: "500"
  },
  errorClose: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 0
  },
  errorCloseText: {
    color: color.white,
    fontSize: 18,
    fontWeight: "800"
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
  hudHint: { color: color.muted, fontSize: 11, fontWeight: "500", marginTop: 2 },
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
