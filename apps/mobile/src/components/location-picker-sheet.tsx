// LocationPickerSheet v2 (R15.13 P6)：tabbed picker — 推荐地点 / 自定义坐标。
// 之前 P5 只是 4 个预设地点 (河内还剑湖 / 河内西湖 / 胡志明市 / 岘港)。
// P6 加"自定义坐标" tab，让用户能 tap / 拖动 SVG 地图上的 pin，
// 设定 1 / 3 / 5 km 半径，命名保存。地图走 react-native-svg 自绘
// (不引 react-native-maps，避免 prebuild / pod install 阻塞)，但
// 给了真实 grid 坐标 + 半径 + 城市名 — 这三件对"feed 怎么用
// location" 已经够。
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ProxyIcon, type ProxyIconName } from "./proxy-icon";
import { MapCanvas } from "./map-canvas";
import type { GridCoord } from "./location-options";
import { color } from "../theme";
import {
  CITY_BOUNDS,
  DEFAULT_LOCATION,
  formatRadius,
  gridToLatLng,
  LOCATION_OPTIONS,
  pickCityFromDisplayName,
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

export { DEFAULT_LOCATION, LOCATION_OPTIONS };
export type { Location, CustomLocation, PresetLocation, AnyLocation, CustomLocationFields, ReverseGeocodeShape };

// gridToLatLng / formatRadius / reverseGeocode re-export 给 app-shell 单独用 —
// shell 要把 active location 显示成 "河内 · (5,5) · 3 km" 时
// 不需要再 import location-options 两次。reverseGeocode 让 shell
// 在自定义 tab 里把 lat/lng 走 Nominatim 反查"还剑湖附近"。
export { gridToLatLng, formatRadius, reverseGeocode };

type Tab = "PRESET" | "CUSTOM" | "HISTORY";

export function LocationPickerSheet({
  open,
  current,
  baseUrl,
  onSelect,
  onClose
}: {
  open: boolean;
  current: AnyLocation;
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
  const [tab, setTab] = useState<Tab>(current.kind === "CUSTOM" ? "CUSTOM" : "PRESET");
  const [history, setHistory] = useState<CustomLocation[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // CUSTOM tab state
  const [customCity, setCustomCity] = useState<string>(current.city || "河内");
  const [pin, setPin] = useState<GridCoord>(
    current.kind === "CUSTOM" ? { x: current.custom.gridX, y: current.custom.gridY } : { x: 5, y: 5 }
  );
  const [radius, setRadius] = useState<1000 | 3000 | 5000>(
    current.kind === "CUSTOM" ? current.custom.radiusMeters : 3000
  );
  const [label, setLabel] = useState<string>(
    current.kind === "CUSTOM" ? current.area.replace(/^自定义 · /, "") : ""
  );
  // lat/lng 提前计算 — useEffect dep + 渲染两处都需要。
  const { lat, lng } = gridToLatLng(customCity, pin.x, pin.y);
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
      // Offline / no network / no baseUrl — fall back to local grid
      // POI lookup so the user still sees something readable.
      const fallback = await reverseGeocode(customCity, lat, lng, { signal: ac.signal });
      if (!cancelled) setReverse(fallback);
    })();
    return () => { cancelled = true; ac.abort(); };
  }, [tab, baseUrl, customCity, lat, lng]);

  // 加载历史 — 只在切到 HISTORY tab 时拉一次，避免每次开 sheet 都打 keychain
  async function openHistory(): Promise<void> {
    if (!historyLoaded) {
      const items = await loadCustomHistory();
      setHistory(items);
      setHistoryLoaded(true);
    }
    setTab("HISTORY");
  }

  // 切城市时把 pin 居中 — 用户在岘港画了 (5,5)，切到河内还显示
  // (5,5) 才是符合直觉的。
  function changeCity(next: string): void {
    setCustomCity(next);
    setPin({ x: 5, y: 5 });
  }

  // R15.32.1.3: 算 commitCustom 要用的最终标签。
  // 优先级：用户手填 label > 逆编码 displayName > 网格坐标。
  // city 同样优先逆编码里的部分，最后才 fallback 到 customCity
  // chip（GPS 定位到另外一个城市时，customCity 会被忽略，改用
  // reverse.displayName 拆出来的城市名 — 不会出现"都到胡志明
  // 了还强制河内"的迷惑感）。
  const finalCommit = useMemo(() => {
    const userLabel = label.trim();
    const reverseName = reverse?.displayName?.trim();
    // 从 displayName 拿 area：Nominatim 返 "POI, City, Country"，
    // 取最后两段拼成 "POI, City" — POI + 城市名都很有用。
    let resolvedArea: string;
    if (reverse?.source === "remote" && reverseName) {
      const parts = reverseName.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        resolvedArea = parts.slice(-2).join(", ");
      } else if (parts.length === 1) {
        resolvedArea = parts[0]!;
      } else {
        resolvedArea = reverseName;
      }
    } else if (reverseName) {
      // 离线 grid fallback：例如 "还剑湖附近" — area 就是这个
      resolvedArea = reverseName;
    } else {
      // 逆编码还在进行中：用网格坐标作最后 fallback
      resolvedArea = `(${pin.x}, ${pin.y})`;
    }
    // user label 覆盖：用户手输了"家"，就用 "家"
    const area = userLabel || resolvedArea;
    // 标头：用户手输了 label 就不附加 "并切换" 之类的话
    const header = userLabel ? "保存" : "保存并切换";
    // city：优先用 reverse 拆出的越南文 city（走 LOCATION_OPTIONS
    // 里的 city 映射表，把 "Hà Nội" / "TP Hồ Chí Minh" 翻译成
    // "河内" / "胡志明市"）。没匹配上就保持 customCity。
    const cityFromDisplayName = reverse?.source === "remote" && reverseName
      ? pickCityFromDisplayName(reverseName)
      : undefined;
    return {
      header,
      area,
      city: cityFromDisplayName ?? customCity,
      id: `custom_${cityFromDisplayName ?? customCity}_${pin.x}x${pin.y}_r${radius}`
    };
  }, [label, reverse, customCity, pin.x, pin.y, radius]);

  async function commitCustom(): Promise<void> {
    const next: CustomLocation = {
      id: finalCommit.id,
      city: finalCommit.city,
      area: `自定义 · ${finalCommit.area}`,
      kind: "CUSTOM",
      custom: { gridX: pin.x, gridY: pin.y, radiusMeters: radius }
    };
    await saveCustomLocation(next);
    // 立即刷新 history (这样切回 HISTORY tab 时新点已经在头部)
    const items = await loadCustomHistory();
    setHistory(items);
    onSelect(next);
    onClose();
  }

  const presetActive = current.kind === "PRESET" && current.id !== undefined;
  const presetCurrentId = current.kind === "PRESET" ? current.id : undefined;
  const customActive = current.kind === "CUSTOM";

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
      <Pressable onPress={onClose} style={styles.overlay}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.headTitle}>切换本地范围</Text>
            <Text style={styles.headSub}>
              影响首页、动态、推荐与机会的本地筛选 · 仅城市/区域，不会反向定位你
            </Text>
          </View>

          {/* Tab strip */}
          <View style={styles.tabs}>
            <TabButton active={tab === "PRESET"} label="推荐地点" onPress={() => setTab("PRESET")} />
            <TabButton active={tab === "CUSTOM"} label="自定义坐标" onPress={() => setTab("CUSTOM")} />
            <TabButton active={tab === "HISTORY"} label={`历史${history.length > 0 ? ` · ${history.length}` : ""}`} onPress={() => void openHistory()} />
          </View>

          {tab === "PRESET" ? (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              {LOCATION_OPTIONS.map((option) => {
                const active = presetCurrentId === option.id;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => {
                      const next: PresetLocation = { id: option.id, city: option.city, area: option.area, kind: "PRESET" };
                      onSelect(next);
                      onClose();
                    }}
                    style={[styles.opt, active && styles.optActive]}
                  >
                    <View style={[styles.optIcon, active && styles.optIconActive]}>
                      <ProxyIcon color={active ? color.white : color.ink} name={option.icon as ProxyIconName} size={24} />
                    </View>
                    <View style={styles.optCopy}>
                      <Text style={styles.optTitle}>{option.city} · {option.area}</Text>
                      <Text style={styles.optDesc}>{option.desc}</Text>
                    </View>
                    <Text style={styles.optAction}>{active ? "当前" : "切换"}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : tab === "CUSTOM" ? (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              {/* City selector */}
              <Text style={styles.fieldLabel}>城市</Text>
              <View style={styles.cityRow}>
                {Object.keys(CITY_BOUNDS).map((city) => {
                  const active = city === customCity;
                  return (
                    <Pressable
                      key={city}
                      onPress={() => changeCity(city)}
                      style={[styles.cityChip, active && styles.cityChipActive]}
                    >
                      <Text style={[styles.cityChipText, active && styles.cityChipTextActive]}>{city}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Map */}
              <Text style={styles.fieldLabel}>地图</Text>
              <MapCanvas
                cityHint={`${customCity} · 网格 10×10`}
                initialPin={pin}
                radiusMeters={radius}
                onChange={setPin}
                testID="location-picker-map"
              />
              <Text style={styles.mapHint}>
                点击或拖动地图放置坐标 · 当前位置 {lat.toFixed(4)}, {lng.toFixed(4)}
                {reverse ? ` · ${reverse.displayName}` : ""}
              </Text>

              {/* Radius selector */}
              <Text style={styles.fieldLabel}>覆盖半径</Text>
              <View style={styles.radiusRow}>
                {([1000, 3000, 5000] as const).map((r) => {
                  const active = r === radius;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => setRadius(r)}
                      style={[styles.radiusChip, active && styles.radiusChipActive]}
                    >
                      <Text style={[styles.radiusChipText, active && styles.radiusChipTextActive]}>
                        {formatRadius(r)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Label input */}
              <Text style={styles.fieldLabel}>地点名（可选）</Text>
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
                <View style={styles.emptyHistory}>
                  <Text style={styles.emptyTitle}>还没有保存过自定义坐标</Text>
                  <Text style={styles.emptySub}>
                    切到"自定义坐标" tab 放置一个 pin，覆盖半径 1 / 3 / 5 km，命名后这里会留一份记录方便复用。
                  </Text>
                </View>
              ) : (
                history.map((entry) => {
                  const active = current.kind === "CUSTOM" && current.id === entry.id;
                  const { lat: eLat, lng: eLng } = gridToLatLng(entry.city, entry.custom.gridX, entry.custom.gridY);
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
                        <Text style={styles.optTitle}>{entry.city} · {entry.area.replace(/^自定义 · /, "")}</Text>
                        <Text style={styles.optDesc}>
                          ({eLat.toFixed(4)}, {eLng.toFixed(4)}) · 半径 {formatRadius(entry.custom.radiusMeters)}
                        </Text>
                      </View>
                      <Text style={styles.optAction}>{active ? "当前" : "切换"}</Text>
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
              <Pressable
                accessibilityLabel={`保存到 ${finalCommit.city} 的 ${finalCommit.area}`}
                onPress={() => void commitCustom()}
                style={({ pressed }) => [styles.confirm, pressed && styles.confirmPressed]}
              >
                <Text style={styles.confirmText} numberOfLines={1}>
                  ✓ {finalCommit.header} · {finalCommit.area} · {formatRadius(radius)}
                </Text>
                <Text style={styles.confirmSubText} numberOfLines={1}>
                  {finalCommit.city} · {lat.toFixed(4)}, {lng.toFixed(4)}
                  {reverse?.source === "offline-grid" ? " · 离线估算" : ""}
                </Text>
              </Pressable>
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
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
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
  optActive: { backgroundColor: "#FAF8FB", borderColor: "#17131F", borderWidth: 1.5 },
  optIcon: {
    alignItems: "center",
    backgroundColor: "#F2EDF5",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  optIconActive: { backgroundColor: "#17131F" },
  optCopy: { flex: 1 },
  optTitle: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  optDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  optAction: { color: "#62586A", fontSize: 11, fontWeight: "800" },
  fieldLabel: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 6 },
  cityRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  cityChip: {
    backgroundColor: "#F2EDF5",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  cityChipActive: { backgroundColor: color.ink },
  cityChipText: { color: color.ink, fontSize: 12, fontWeight: "700" },
  cityChipTextActive: { color: color.white },
  mapHint: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
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
    backgroundColor: "#FCFBFD",
    borderColor: "#DDD5E3",
    borderRadius: 13,
    borderWidth: 1,
    color: color.ink,
    fontSize: 14,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  confirm: {
    backgroundColor: color.ink,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  confirmPressed: { backgroundColor: "#3A2F4A" },
  confirmText: { color: color.white, fontSize: 14, fontWeight: "800" },
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
  emptyHistory: {
    paddingVertical: 30,
    paddingHorizontal: 10
  },
  emptyTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  emptySub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 4 }
});
