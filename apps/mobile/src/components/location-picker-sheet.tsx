// LocationPickerSheet v2 (R15.13 P6)：tabbed picker — 推荐地点 / 自定义坐标。
// 之前 P5 只是 4 个预设地点 (河内还剑湖 / 河内西湖 / 胡志明市 / 岘港)。
// P6 加"自定义坐标" tab，让用户能 tap / 拖动 SVG 地图上的 pin，
// 设定 1 / 3 / 5 km 半径，命名保存。地图走 react-native-svg 自绘
// (不引 react-native-maps，避免 prebuild / pod install 阻塞)，但
// 给了真实 grid 坐标 + 半径 + 城市名 — 这三件对"feed 怎么用
// location" 已经够。
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as ExpoLocation from "expo-location";
import { ProxyIcon, type ProxyIconName } from "./proxy-icon";
import { MapCanvas } from "./map-canvas";
import type { GridCoord } from "./location-options";
import { color } from "../theme";
import {
  CITY_BOUNDS,
  DEFAULT_LOCATION,
  clampToRadius,
  formatRadius,
  formatLocationTitle,
  googleMapsUrl,
  gridToLatLng,
  LOCATION_OPTIONS,
  MAX_MANUAL_TWEAK_METERS,
  reverseGeocode,
  reverseGeocodeViaProxy,
  type AnyLocation,
  type CustomLocation,
  type Location,
  type PresetLocation,
  type CustomLocationFields,
  type ReverseGeocodeShape
} from "./location-options";
import {
  loadActiveCustomId,
  loadCustomHistory,
  saveCustomLocation
} from "./location-store";
import type { DeviceLocationState } from "../device-location";
import { fetchNearbySpots, formatSpotDistance, type NearbySpot } from "../nearby-spots";
import { ProxyButton, ProxyEmptyState } from "./proxy-foundation";

export { DEFAULT_LOCATION, LOCATION_OPTIONS };
export type { Location, CustomLocation, PresetLocation, AnyLocation, CustomLocationFields, ReverseGeocodeShape };

// gridToLatLng / formatRadius / reverseGeocode re-export 给 app-shell 单独用 —
// shell 要把 active location 显示成 "河内 · (5,5) · 3 km" 时
// 不需要再 import location-options 两次。reverseGeocode 让 shell
// 在自定义 tab 里把 lat/lng 走 Nominatim 反查"还剑湖附近"。
export { gridToLatLng, formatLocationTitle, formatRadius, reverseGeocode };

type Tab = "PRESET" | "CUSTOM" | "HISTORY";

// DEVICE-LOCATION-001：设备跟随那一行的文案。
//
// 每一态都要有自己的说法 —— 「没授权」不能写成「跟随中」，「不可用」
// 不能看起来像「已关闭」。失败必须长得像失败（全仓一贯口径）。
function describeDeviceRow(
  state: DeviceLocationState,
  following: boolean
): { title: string; desc: string; action: string; next: boolean; enabled: boolean } {
  switch (state.kind) {
    case "permission_denied":
      // 不写「去设置」—— 那是个会承诺动作却不发生的按钮。如实说未授权。
      return { title: "跟随我的位置", desc: "系统定位未授权 · 现在用的是手动选点", action: "未授权", next: true, enabled: false };
    case "unavailable":
      return { title: "跟随我的位置", desc: `定位不可用 · ${state.message}`, action: "不可用", next: true, enabled: false };
    case "acquiring":
      return following
        ? { title: "跟随我的位置", desc: "正在定位…", action: "关闭", next: false, enabled: true }
        : { title: "跟随我的位置", desc: "正在定位…", action: "定位中", next: true, enabled: false };
    case "tracking":
      return following
        ? { title: "跟随我的位置", desc: "已跟随 · 移动后自动更新", action: "关闭", next: false, enabled: true }
        : { title: "跟随我的位置", desc: "当前是手动选点 · 开启后跟随设备", action: "开启", next: true, enabled: true };
    default:
      return { title: "跟随我的位置", desc: "开启后跟随设备位置 · 仅城市 / 区域，不用精确定位", action: "开启", next: true, enabled: true };
  }
}

export function LocationPickerSheet({
  open,
  current,
  baseUrl,
  deviceState,
  followDevice,
  onFollowDevice,
  onSelect,
  onClose
}: {
  open: boolean;
  current: AnyLocation;
  // DEVICE-LOCATION-001: 设备跟随。三个都可选 —— ComposerV2Screen 这类
  // 调用点不传就完全不渲染这一行（向后兼容，不加半截 UI）。
  deviceState?: DeviceLocationState;
  followDevice?: boolean;
  /** 传 true 开启跟随 / false 关闭。是真开关，不是只能开的单向按钮。 */
  onFollowDevice?: (next: boolean) => void;
  // R15.32.1.3: baseUrl is used by the custom-tab reverse geocode
  // lookup. We call Proxy's own /v1/geocode/reverse so the result
  // is observable / cacheable from the server side, and we don't
  // need to whitelist nominatim.openstreetmap.org in the iOS ATS.
  // Optional — ComposerV2Screen and other call sites without a
  // network context fall through to the local grid POI lookup.
  baseUrl?: string;
  onSelect: (next: AnyLocation) => void;
  onClose: () => void;
}): React.JSX.Element {
  const deviceRow = deviceState && onFollowDevice ? describeDeviceRow(deviceState, followDevice === true) : undefined;
  const [tab, setTab] = useState<Tab>(current.kind === "CUSTOM" ? "CUSTOM" : "PRESET");
  const [history, setHistory] = useState<CustomLocation[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // NEARBY-SPOTS-001: 3km 热门地点（见下方 loadNearbySpots）。
  const [nearbySpots, setNearbySpots] = useState<NearbySpot[] | undefined>(undefined);
  const [nearbyBusy, setNearbyBusy] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | undefined>(undefined);
  const nearbyLoadingRef = useRef(false);

  async function loadNearbySpots(): Promise<void> {
    if (nearbyLoadingRef.current) return;
    nearbyLoadingRef.current = true;
    setNearbyBusy(true);
    setNearbyError(undefined);
    try {
      // LOC-FIX-001 同款：先看现状再申请，拒绝过的不再静默重试。
      const existing = await ExpoLocation.getForegroundPermissionsAsync();
      let status = existing.status;
      if (status !== "granted") {
        const request = await ExpoLocation.requestForegroundPermissionsAsync();
        status = request.status;
      }
      if (status !== "granted") throw new Error("系统定位未授权 — 去 iOS 设置 → Proxy → 位置，允许“使用 App 期间”");
      // 注意不用 getCurrentFix：它 10 秒超时 + 先读缓存，室内 GPS 一慢就
      // 直接判死；而地图 tab 的无超时 Balanced 单次定位是能回来的。这里跟
      // 地图同口径（Balanced），冷启动慢就自动多等一轮（见下面重试）。
      const locate = async (): Promise<{ latitude: number; longitude: number } | undefined> => {
        try {
          const pos = await Promise.race([
            ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fix timeout")), 30_000)),
          ]);
          return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        } catch {
          return undefined;
        }
      };
      let fix = await locate();
      // 首次冷启动 GPS 经常第一次拿不到、紧接着第二次就好 —— 只自动重试一次，
      // 拒权限不重试（尊重用户选择），成功一次后面都直接读缓存。
      if (!fix) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        fix = await locate();
      }
      if (!fix) throw new Error("定位超时（GPS 信号弱）— 请到开阔处重试，或用“地图选点”");
      const result = await fetchNearbySpots(baseUrl ?? "", fix.latitude, fix.longitude, 3000);
      setNearbySpots(result.spots);
      if (result.spots.length === 0) {
        setNearbyError(result.source === "offline" ? "附近地点暂时不可用（网络或上游服务）— 可用“地图选点”" : "附近暂时没有地点");
      }
    } catch (error) {
      setNearbyError(error instanceof Error && error.message !== "fix timeout" ? error.message : "定位超时（GPS 信号弱）— 请到开阔处重试，或用“地图选点”");
    } finally {
      setNearbyBusy(false);
      nearbyLoadingRef.current = false;
    }
  }

  // NEARBY-SPOTS-001: 打开默认加载，不要点按钮。只在推荐 tab 默认时触发
  // （带着自定义坐标进来的是看 CUSTOM tab 的，不浪费一次 GPS）。
  useEffect(() => {
    if (open && current.kind !== "CUSTOM") void loadNearbySpots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);
  // CUSTOM tab state
  // R15.33: customCity 仍存在但仅作离线 fallback — 线上时
  // reverse.city 才是真相。原来默认 "河内" 会误导全球用户
  // (北宁/曼谷/三藩 定位后被硬覆盖)，现在默认改为 "" —
  // 首次 reverse 完成前不预任何 city。
  const [customCity, setCustomCity] = useState<string>(current.city || "");
  const [pin, setPin] = useState<GridCoord>(
    current.kind === "CUSTOM" ? { x: current.custom.gridX, y: current.custom.gridY } : { x: 5, y: 5 }
  );
  const [radius, setRadius] = useState<1000 | 3000 | 5000>(
    current.kind === "CUSTOM" ? current.custom.radiusMeters : 3000
  );
  const [label, setLabel] = useState<string>(
    current.kind === "CUSTOM" ? current.area.replace(/^自定义 · /, "") : ""
  );
  // R15.33: 选型 pin 时 实际 lat/lng 听 MapCanvas 的 onChange。
  // MapCanvas 以前返 GridCoord，现在走“地图世界” — 我们记住
  // 上一次 tap 时的 lat/lng + 网格初始点，用于“点击别的城市
  // city chip 时重置 pin”的逻辑。
  const [lastLatLng, setLastLatLng] = useState<{ lat: number; lng: number } | undefined>(
    current.kind === "CUSTOM" && current.custom.lat !== undefined && current.custom.lng !== undefined
      ? { lat: current.custom.lat, lng: current.custom.lng }
      : undefined
  );
  // lat/lng 提前计算 — useEffect dep + 渲染两处都需要。
  const gridLatLng = gridToLatLng(customCity, pin.x, pin.y);
  const { lat, lng } = lastLatLng ?? gridLatLng;
  // LOC-PIN-3KM-001: 拖拽微调提示。钳制只发生在 onChange 里，这里只展示。
  const [pinNotice, setPinNotice] = useState<string | undefined>(undefined);
  // LOC-SHARE-001: 复制 / 地图打开的操作反馈。成功失败各说各的。
  const [shareMsg, setShareMsg] = useState<string | undefined>(undefined);
  // R15.15 P2 + R15.32.1.3: 逆编码 — 拍 pin 以后从 lat/lng 拿
  // "还剑湖附近" / "Lê Thánh Tôn, Thành phố Hồ Chí Minh" 这样
  // 的人话描述。优先走我们的 /v1/geocode/reverse（背后是
  // Photon），离线/抓不到时 fallback 到 gridToLatLng + CITY_POIS。
  const [reverse, setReverse] = useState<ReverseGeocodeShape | undefined>(undefined);
  useEffect(() => {
    if (tab !== "CUSTOM") {
      setReverse(undefined);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      let remote: ReverseGeocodeShape | undefined;
      if (baseUrl) {
        remote = await reverseGeocodeViaProxy(baseUrl, lat, lng, { signal: ac.signal });
      }
      if (cancelled) return;
      if (remote && remote.source === "remote" && remote.displayName) {
        setReverse(remote);
        return;
      }
      // 精确 GPS/地图坐标不能再退回任一预设城市网格；离线时展示坐标，
      // 恢复网络后由服务端重新解析全球行政区。
      if (lastLatLng) {
        setReverse({ displayName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, source: "offline-grid" });
        return;
      }
      // 仅旧版、没有真实坐标的数据继续使用网格兼容层。
      const fallback = await reverseGeocode(customCity, lat, lng, { signal: ac.signal });
      if (!cancelled) setReverse(fallback);
    })();
    return () => { cancelled = true; ac.abort(); };
  }, [tab, baseUrl, customCity, lastLatLng, lat, lng]);

  // LOC-SHARE-001: 复制当前点的地址 + 用 Google 地图打开。
  // 复制的是屏幕上显示的那一行（反查名，没有就写坐标）—— 复制"正在识别
  // 地址…"这种中间态等于撒谎。地图打开失败也明说，不静默。
  async function copyPickedAddress(): Promise<void> {
    const text = reverse?.displayName?.trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try {
      await Clipboard.setStringAsync(text);
      setShareMsg("已复制");
    } catch {
      setShareMsg("复制失败，请重试");
    }
  }

  function openPickedInGoogleMaps(): void {
    void Linking.openURL(googleMapsUrl(lat, lng)).catch(() => {
      setShareMsg("打不开地图应用");
    });
  }

  // 加载历史 — 只在切到 HISTORY tab 时拉一次，避免每次开 sheet 都打 keychain
  async function openHistory(): Promise<void> {    if (!historyLoaded) {
      const items = await loadCustomHistory();
      setHistory(items);
      setHistoryLoaded(true);
    }
    setTab("HISTORY");
  }

  // R15.33: changeCity 拿了 — 城市 chip 删了，customCity 现在仅
  // 充“离线 fallback”。User GPS 后 Photon 拿真实城市，customCity
  // 只是 chip 未选时给个默认值。

  // R15.32.1.5: 算 commitCustom 要用的最终标签。
  // 关键修改 — 去掉硬编码的 7 城映射。用户在全球任何地方定位
  // 都要如实显示，不强制到 "河内" / "胡志明市" 这些预设城市。
  //
  // 优先级:
  //   area  = user label > reverse.displayName > 网格坐标
  //   city  = reverse.city > reverse.state > customCity
  //   header = user label ? "保存" : "保存并切换"
  // Photon 的 city 可能是市 / 镇 / 县 / 乡；state 是上一级省。
  // 都不是 7 城表里的没事 — city 是个 free-form 字符串，只用于显示。
  const finalCommit = useMemo(() => {
    const userLabel = label.trim();
    const reverseName = reverse?.displayName?.trim();
    // area
    let resolvedArea: string;
    if (reverse?.source === "remote" && reverseName) {
      // Photon 的 displayName 已经是 "POI, City, Country"，
      // 但里面可能不带 city (例如北宁返 "Bắc Ninh, Việt Nam" 没有
      // POI)。直接用 displayName — 已是对人最友好的形式。
      resolvedArea = reverseName;
    } else if (reverseName) {
      resolvedArea = reverseName;
    } else {
      // 逆编码还在进行中：用网格坐标作最后 fallback
      resolvedArea = `(${pin.x}, ${pin.y})`;
    }
    const area = userLabel || resolvedArea;
    const header = userLabel ? "保存" : "保存并切换";
    // city: 优先 Photon 的 city，其次 state，最后 customCity
    //  (customCity 只有在 离线/未完成 逆编码时才用，remote 时
    //  绝不应该出现 "都北宁了还显示河内" 的迷惑感)
    let resolvedCity: string;
    if (reverse?.source === "remote") {
      if (reverse.city) {
        resolvedCity = reverse.city;
      } else if (reverse.state) {
        resolvedCity = reverse.state;
      } else {
        resolvedCity = customCity;
      }
    } else {
      // 离线 fallback — 用 chip 的 customCity
      resolvedCity = lastLatLng ? "当前位置" : customCity;
    }
    const coordinateKey = lastLatLng
      ? `${lastLatLng.lat.toFixed(5)}_${lastLatLng.lng.toFixed(5)}`
      : `${pin.x}x${pin.y}`;
    return {
      header,
      area,
      city: resolvedCity,
      // ID 不依赖会随行政区调整而变化的地名。
      id: `custom_geo_${coordinateKey}_r${radius}`
    };
  }, [label, reverse, customCity, lastLatLng, pin.x, pin.y, radius]);

  async function commitCustom(): Promise<void> {
    const next: CustomLocation = {
      id: finalCommit.id,
      city: finalCommit.city,
      area: `自定义 · ${finalCommit.area}`,
      kind: "CUSTOM",
      custom: {
        gridX: pin.x,
        gridY: pin.y,
        radiusMeters: radius,
        ...(lastLatLng ? { lat: lastLatLng.lat, lng: lastLatLng.lng } : {}),
        ...(reverse?.provider ? { geocodeProvider: reverse.provider } : {}),
        ...(reverse?.version ? { geocodeVersion: reverse.version } : {})
      }
    };
    await saveCustomLocation(next);
    // 立即刷新 history (这样切回 HISTORY tab 时新点已经在头部)
    const items = await loadCustomHistory();
    setHistory(items);
    onSelect(next);
    onClose();
  }

  // (城市预设已移除：NEARBY-SPOTS-001 起推荐地点只给 3km 真数据。)
  const customActive = current.kind === "CUSTOM";

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
      <Pressable onPress={onClose} style={styles.overlay}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <View style={styles.head}>
            <Text selectable style={styles.headTitle}>切换本地范围</Text>
            <Text selectable style={styles.headSub}>
              影响首页、动态、推荐与机会的本地筛选 · 仅城市/区域，位置只用于本机筛选
            </Text>
          </View>

          {/* Tab strip */}
          <View style={styles.tabs}>
            <TabButton active={tab === "PRESET"} label="推荐地点" onPress={() => setTab("PRESET")} />
            <TabButton active={tab === "CUSTOM"} label="地图选点" onPress={() => setTab("CUSTOM")} />
            <TabButton active={tab === "HISTORY"} label={`历史${history.length > 0 ? ` · ${history.length}` : ""}`} onPress={() => void openHistory()} />
          </View>

          {tab === "PRESET" ? (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              {/* DEVICE-LOCATION-001：设备跟随。没传 deviceState 的调用点
                  （ComposerV2Screen 等）这一行整个不渲染。 */}
              {deviceRow && onFollowDevice ? (
                <Pressable
                  accessibilityLabel="跟随我的位置"
                  accessibilityRole="button"
                  disabled={!deviceRow.enabled}
                  onPress={() => onFollowDevice(deviceRow.next)}
                  style={[styles.opt, followDevice === true && styles.optActive]}
                >
                  <View style={[styles.optIcon, followDevice === true && styles.optIconActive]}>
                    <ProxyIcon color={followDevice === true ? color.white : color.ink} name="route" size={24} />
                  </View>
                  <View style={styles.optCopy}>
                    <Text selectable style={styles.optTitle}>{deviceRow.title}</Text>
                    <Text selectable style={styles.optDesc}>{deviceRow.desc}</Text>
                  </View>
                  <Text selectable style={styles.optAction}>{deviceRow.action}</Text>
                </Pressable>
              ) : null}
              {/* NEARBY-SPOTS-001: 3km 热门地点（真坐标，点了能直接发）。
                  以前这里只有 4 个硬编码城市预设，点的全是"还剑湖附近"这种
                  没坐标的条目 —— 发不出去，还冒充"热门"。现在默认先给城市
                  预设（兼容无定位），点了按钮才定位拉真数据。 */}
              <Text selectable style={styles.fieldLabel}>附近地点</Text>
              {nearbySpots === undefined && !nearbyBusy && !nearbyError ? (
                <Pressable accessibilityLabel="显示附近地点" onPress={() => void loadNearbySpots()} style={styles.opt}>
                  <View style={styles.optIcon}>
                    <ProxyIcon color={color.ink} name="crosshair" size={24} />
                  </View>
                  <View style={styles.optCopy}>
                    <Text selectable style={styles.optTitle}>显示附近地点</Text>
                  </View>
                </Pressable>
              ) : null}
              {nearbyBusy ? (
                <View style={styles.opt}>
                  <ActivityIndicator color={color.ink} size="small" />
                  <View style={styles.optCopy}>
                    <Text selectable style={styles.optTitle}>正在定位…</Text>
                  </View>
                </View>
              ) : null}
              {nearbyError ? (
                <View style={styles.opt}>
                  <View style={styles.optCopy}>
                    <Text selectable style={styles.optTitle}>附近地点不可用</Text>
                    <Text selectable style={styles.optDesc}>{nearbyError}</Text>
                  </View>
                  <Text selectable style={styles.optAction} onPress={() => void loadNearbySpots()}>重试</Text>
                </View>
              ) : null}
              {(nearbySpots ?? []).map((spot) => (
                <Pressable
                  key={spot.id}
                  onPress={() => {
                    const next: CustomLocation = { id: `spot:${spot.id}`, city: "", area: spot.name, kind: "CUSTOM", custom: { gridX: 0, gridY: 0, radiusMeters: 3000, lat: spot.lat, lng: spot.lng } };
                    onSelect(next);
                    onClose();
                  }}
                  style={styles.opt}
                >
                  <View style={styles.optIcon}>
                    <ProxyIcon color={color.ink} name="pin" size={24} />
                  </View>
                  <View style={styles.optCopy}>
                    <Text selectable style={styles.optTitle}>{spot.name}</Text>
                    {formatSpotDistance(spot.distanceMeters) ? <Text selectable style={styles.optDesc}>{formatSpotDistance(spot.distanceMeters)}</Text> : null}
                  </View>
                  <Text selectable style={styles.optAction}>发送</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : tab === "CUSTOM" ? (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              {/* R15.33: 城市 chip 拿掉了 — user 在全球任意地方定位，
                  Photon 直接拿真实城市，硬编码的 7 城表会误导
                  (在北宁定位却显示“河内”正是这个 bug)。
                  customCity 仅在 “离线 / 反向地理编码未完成” 时
                  作为 fallback 保留。 */}

              {/* R15.33: 地址作为标题显眼 — MapCanvas 下面
                  “点击地图” 提示。中间是主地图。 */}
              <View style={styles.addressHeader}>
                <Text selectable style={styles.addressLabel}>当前位置</Text>
                <Text selectable style={styles.addressText} numberOfLines={2}>
                  {reverse?.source === "offline-grid" ? "已选择地图位置" : reverse?.displayName || "正在识别地址…"}
                </Text>
                {reverse?.source === "offline-grid" && (
                  <Text selectable style={styles.addressHint}>
                    离线估算 · 点地图重新定位
                  </Text>
                )}
              </View>
              {/* LOC-SHARE-001: 对当前点操作 —— 复制地址 / Google 地图打开。 */}
              <View style={styles.shareRow}>
                <Pressable accessibilityLabel="复制地址" onPress={() => void copyPickedAddress()} style={styles.shareBtn}>
                  <Text selectable style={styles.shareBtnText}>复制地址</Text>
                </Pressable>
                <Pressable accessibilityLabel="用 Google 地图打开" onPress={openPickedInGoogleMaps} style={styles.shareBtn}>
                  <Text selectable style={styles.shareBtnText}>Google地图</Text>
                </Pressable>
              </View>
              {shareMsg ? <Text selectable style={styles.shareMsg}>{shareMsg}</Text> : null}

              {/* Map — the dominant element in CUSTOM tab.
                  R15.33: 高度从 aspectRatio:1 调到 300 (路牌习惯的
                  "高一点" 地图) 。 */}
              <View style={styles.mapWrapper}>
                <MapCanvas
                  cityHint={customCity}
                  initialPin={pin}
                  initialCoordinate={lastLatLng}
                  radiusMeters={radius}
                  onChange={(nextPin, coordinate, kind) => {
                    let point = coordinate;
                    // LOC-PIN-3KM-001: 只有"拖拽微调"才限 3KM（以上次落点为锚）。
                    // 点选跳远地方不受限 —— 全球选点是既有功能，不能一起掐死。
                    // GPS 按钮给的是真相，也不受限。
                    if (kind === "drag" && point && lastLatLng) {
                      const r = clampToRadius(lastLatLng, point, MAX_MANUAL_TWEAK_METERS);
                      if (r.clamped) {
                        setPinNotice("拖动超出3公里，已停在3公里处");
                        point = r.point;
                      } else {
                        setPinNotice(undefined);
                      }
                    }
                    setPin(nextPin);
                    if (point) {
                      setLastLatLng(point);
                      // 清掉预设城市提示，避免全球坐标在解析期间显示旧城市。
                      setCustomCity("");
                    }
                  }}
                  testID="location-picker-map"
                />
              </View>
              <Text selectable style={styles.mapHint}>
                点地图或拖动 pin 重新定位
              </Text>
              {pinNotice ? <Text selectable style={styles.pinNotice}>{pinNotice}</Text> : null}

              {/* Radius selector */}
              <Text selectable style={styles.fieldLabel}>覆盖半径</Text>
              <View style={styles.radiusRow}>
                {([1000, 3000, 5000] as const).map((r) => {
                  const active = r === radius;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => setRadius(r)}
                      style={[styles.radiusChip, active && styles.radiusChipActive]}
                    >
                      <Text selectable style={[styles.radiusChipText, active && styles.radiusChipTextActive]}>
                        {formatRadius(r)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Label input */}
              <Text selectable style={styles.fieldLabel}>地点名（可选）</Text>
              <TextInput
                maxLength={24}
                onChangeText={setLabel}
                placeholder={`例如：还剑湖西南角`}
                placeholderTextColor="#A9A2B0"
                style={styles.input}
                value={label}
              />

              {/* Extra padding so content doesn't get hidden by the
                  sticky save bar. The bar lives in the sheet footer
                  (outside this ScrollView) and stays visible. */}
              <View style={styles.scrollFooterPad} />
            </ScrollView>
          ) : (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              {history.length === 0 ? (
                <ProxyEmptyState title="还没有保存过地图位置" sub="切到“地图选点”放置一个 pin，选择覆盖范围并命名后，这里会保留记录方便复用。" />
              ) : (
                history.map((entry) => {
                  const active = current.kind === "CUSTOM" && current.id === entry.id;
                  return (
                    <Pressable
                      key={entry.id}
                      onPress={() => {
                        onSelect(entry);
                        onClose();
                      }}
                      style={[styles.opt, active && styles.optActive]}
                    >
                      <View style={[styles.optIcon, active && styles.optIconActive]}>
                        <ProxyIcon color={active ? color.white : color.ink} name="route" size={24} />
                      </View>
                      <View style={styles.optCopy}>
                        <Text selectable style={styles.optTitle}>{formatLocationTitle(entry)}</Text>
                        <Text selectable style={styles.optDesc}>覆盖范围 {formatRadius(entry.custom.radiusMeters)}</Text>
                      </View>
                      <Text selectable style={styles.optAction}>{active ? "当前" : "切换"}</Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          )}

          {/* Sticky footer — only show in CUSTOM tab so the user can
              always reach "save & switch" without scrolling. PRESET
              and HISTORY are short lists and commit on tap so they
              don't need a footer. */}
          {tab === "CUSTOM" && (
            <View style={styles.footer}>
              {/* BUTTON-UNIFY-005：保存键改用公共 ProxyButton。它是全 App 唯一的
                  **两行**主按钮（主标题 + 副标题），所以两行文字与纵向内边距留着 ——
                  去掉会把 64pt 压成 ProxyButton 的 48pt 最小高。收敛的是形状：
                  按压反馈从「换 #3A2F4A 底色」改成原型的 scale(.97)。
                  accessibilityLabel 与文案一字未改。 */}
              <ProxyButton
                accessibilityLabel={`保存到 ${finalCommit.city} 的 ${finalCommit.area}`}
                onPress={() => void commitCustom()}
                style={styles.confirm}
              >
                <View style={styles.confirmCopy}>
                  <Text selectable style={styles.confirmText} numberOfLines={1}>
                    ✓ {finalCommit.header} · {finalCommit.area} · {formatRadius(radius)}
                  </Text>
                  <Text selectable style={styles.confirmSubText} numberOfLines={1}>
                    {finalCommit.city || "所选区域"}
                    {reverse?.source === "offline-grid" ? " · 离线估算" : ""}
                  </Text>
                </View>
              </ProxyButton>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TabButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text selectable style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: "rgba(20,18,31,0.46)",
    flex: 1,
    justifyContent: "flex-end",
    padding: 12
  },
  // R15.32.1: the sheet is now a column with head + tabs + scroll +
  // optional footer. `maxHeight` caps the whole stack; `flex: 1` is
  // required so the sheet fills the available vertical space inside
  // the overlay (which is itself a flex column with `flex: 1`). Without
  // `flex: 1` the sheet would shrink to its content's natural height
  // and the inner `ScrollView flex: 1` would collapse to 0, hiding the
  // map entirely.
  sheet: { backgroundColor: color.white, borderRadius: 25, flex: 1, maxHeight: "92%", padding: 19, paddingBottom: 12 },
  head: { paddingBottom: 10, paddingHorizontal: 1 },
  headTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  headSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  tabs: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
    marginBottom: 10
  },
  tab: {
    backgroundColor: "#F2EDF5",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  tabActive: { backgroundColor: color.ink },
  tabText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  tabTextActive: { color: color.white },
  // R15.32.1: ScrollView flexes (flex: 1) so the optional sticky
  // footer below it always has room. Previously the scroll's
  // content was sized by its own contentContainerStyle, hiding the
  // save button at the bottom of a long list.
  scroll: { flex: 1, marginTop: 4 },
  scrollContent: { gap: 8, paddingBottom: 16 },
  scrollFooterPad: { height: 8 },
  opt: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 72,
    padding: 12
  },
  optActive: { backgroundColor: color.domainActiveBg, borderColor: color.ink, borderWidth: 1.5 },
  optIcon: {
    alignItems: "center",
    backgroundColor: "#F2EDF5",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  optIconActive: { backgroundColor: color.ink },
  optCopy: { flex: 1 },
  optTitle: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  optDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  optAction: { color: "#62586A", fontSize: 11, fontWeight: "800" },
  fieldLabel: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 6 },
  // R15.33: 删了 cityRow / cityChip / cityChipActive / cityChipText
  //  — 城市 chip 不用了。
  mapHint: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  // R15.33: 地址标题 + 包装：MapCanvas 上面。作为 sheet 第一眼
  // 看到的"你现在在哪里" — 不再是“河内”。
  addressHeader: {
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 8
  },
  addressLabel: {
    fontSize: 11,
    color: color.muted,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4
  },
  addressText: {
    fontSize: 18,
    fontWeight: "700",
    color: color.ink,
    lineHeight: 22
  },
  addressHint: {
    fontSize: 11,
    color: "#C97A1F",
    fontWeight: "500",
    marginTop: 4
  },
  // LOC-SHARE-001：复制 / 地图打开行 + LOC-PIN-3KM-001 钳制提示。
  shareRow: { flexDirection: "row", gap: 8, marginTop: 8, paddingHorizontal: 4 },
  shareBtn: { backgroundColor: "#F2EDF5", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  shareBtnText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  shareMsg: { color: color.muted, fontSize: 11, marginTop: 4, paddingHorizontal: 4 },
  pinNotice: { color: "#C97A1F", fontSize: 11, marginTop: 4 },
  // MAP-CONTAINER-PARITY-001: sheet 里的地图框跟 Market 内联卡同规格 ——
  // 高 330、圆角 22（foundation.radius.lg）。之前 280/12 在发布器里矮一截。
  mapWrapper: {
    height: 330,
    width: "100%",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    marginTop: 4
  },
  radiusRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  radiusChip: {
    backgroundColor: "#F2EDF5",
    borderRadius: 999,
    flex: 1,
    paddingVertical: 9,
    alignItems: "center"
  },
  radiusChipActive: { backgroundColor: color.ink },
  radiusChipText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  radiusChipTextActive: { color: color.white },
  input: {
    backgroundColor: color.homeIntentInputBg,
    borderColor: "#DDD5E3",
    borderRadius: 13,
    borderWidth: 1,
    color: color.ink,
    fontSize: 14,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  // BUTTON-UNIFY-005: 只剩布局 —— 这是全 App 唯一的**两行**主按钮，纵向内边距必须
  // 留着（去掉会把 64pt 压成 ProxyButton 的 48pt 最小高）。ink 底 / 圆角 14 / 边框 /
  // 按压反馈由 ProxyButton tone="primary" 提供；confirmPressed 键已删。
  confirm: {
    paddingVertical: 14
  },
  // 两行文字的容器：ProxyButton 的行方向是 row，两行要自己竖排 + 居中。
  confirmCopy: { alignItems: "center" },
  confirmText: { color: color.white, fontSize: 13, fontWeight: "800" },
  // R15.32.1.3: 小字副标 — city + lat/lng + offline 标记，
  // 告诉用户 GPS 定位后的“真实地点 + 坐标”。
  confirmSubText: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "500", marginTop: 2 },
  // R15.32.1: sticky footer under the scroll. Pinned at the bottom
  // of the sheet so the user can always tap save even if the city
  // / map / radius / label inputs push it off-screen.
  footer: {
    paddingTop: 10,
    borderTopColor: color.line,
    borderTopWidth: 0.5
  },


});
