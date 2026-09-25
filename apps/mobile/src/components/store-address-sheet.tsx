// STORE-REC-ADDRESS-001：给「推荐新店」表单用的**地图选点**。
//
// 为什么不复用 LocationPickerSheet：那一屏的语义是「切换本地范围」——
// 标题、覆盖半径、历史、附近地点全是给 feed 筛选用的。给店铺地址套上
// 「覆盖半径 3 km」会让人以为这是在划经营范围，而它只是这家店的位置。
// 这里只做一件事：落一个点，回一个地址。
//
// ⚠️ 地图只在 iOS 上能看。MapCanvas 在 Android 上渲染的是「地图仅在 iOS 可用」
// 的静态卡片，**给不出任何坐标** —— 所以表单里的地址必须能直接手打，地图只是
// iOS 上的省事路径，不是唯一入口。这个组件里也不假装它是：没有落点就明说
// 「还没落点」，而不是摆一个点了没反应的确认键。
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MapCanvas } from "./map-canvas";
import { reverseGeocodeViaProxy, type GridCoord } from "./location-options";
import { color } from "../theme";

export interface PickedStoreAddress {
  address: string;
  lat: number;
  lng: number;
}

export function StoreAddressSheet({
  open,
  cityHint,
  initial,
  baseUrl,
  onConfirm,
  onClose
}: {
  open: boolean;
  /** 城市提示，只用来定地图初始视野（表单里选过的城市）。 */
  cityHint: string;
  initial?: { lat: number; lng: number } | undefined;
  /** 逆编码要用的服务端地址。不传就只存坐标 —— 不编一个假街道名出来。 */
  baseUrl?: string | undefined;
  onConfirm: (next: PickedStoreAddress) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [pin, setPin] = useState<GridCoord>({ x: 5, y: 5 });
  const [coord, setCoord] = useState<{ lat: number; lng: number } | undefined>(initial);
  const [lookup, setLookup] = useState<string>("");
  const [resolving, setResolving] = useState(false);

  // 每次打开都回到调用方给的那个位置。上一次的落点留在里面，用户会以为
  // 这次选的还是那家店 —— 那是两个不同的地方。
  useEffect(() => {
    if (!open) return;
    setCoord(initial);
    setPin({ x: 5, y: 5 });
    setLookup("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 落点变了就反查一次人话地址。查不到不算错：坐标本身就是可用的地址，
  // 显示「正在识别地址…」也比编一个街道名好。
  useEffect(() => {
    if (!open || !coord) return;
    let cancelled = false;
    const ac = new AbortController();
    setResolving(true);
    (async () => {
      let name = "";
      if (baseUrl) {
        const remote = await reverseGeocodeViaProxy(baseUrl, coord.lat, coord.lng, { signal: ac.signal });
        if (remote.source === "remote") name = (remote.displayName ?? "").trim();
      }
      if (cancelled) return;
      setLookup(name);
      setResolving(false);
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, baseUrl, coord?.lat, coord?.lng]);

  const coordText = coord ? `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}` : "";
  const addressText = lookup || coordText;

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
      <Pressable onPress={onClose} style={styles.overlay}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <View style={styles.head}>
            <Text selectable style={styles.headTitle}>在地图上标出这家店</Text>
            <Text selectable style={styles.headSub}>
              点地图或拖动 pin 落点。落点只是告诉运营这家店在哪，不影响推荐本身。
            </Text>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <View style={styles.mapWrapper}>
              <MapCanvas
                autoLocate={false}
                cityHint={cityHint}
                initialCoordinate={coord}
                initialPin={pin}
                onChange={(nextPin, nextCoord) => {
                  setPin(nextPin);
                  if (nextCoord) setCoord(nextCoord);
                }}
                testID="store-address-map"
              />
            </View>

            <Text selectable style={styles.fieldLabel}>这个点的地址</Text>
            <Text selectable style={styles.addressText}>
              {coord ? (resolving && !lookup ? "正在识别地址…" : addressText) : "还没落点 —— 点一下地图"}
            </Text>
            {coord && !resolving && !lookup ? (
              <Text selectable style={styles.hint}>
                {baseUrl ? "这一带解析不出街道名，存下来的是坐标本身。" : "没接地址解析服务，存下来的是坐标本身。"}
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              accessibilityLabel={coord ? "用这个落点" : "先在地图上落点"}
              disabled={!coord}
              onPress={() => {
                if (coord) onConfirm({ address: addressText, lat: coord.lat, lng: coord.lng });
              }}
              style={[styles.confirm, !coord && styles.confirmDisabled]}
            >
              <Text selectable style={styles.confirmText}>{coord ? "用这个落点" : "先在地图上落点"}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: "rgba(20,18,31,0.46)", flex: 1, justifyContent: "flex-end", padding: 12 },
  sheet: { backgroundColor: color.white, borderRadius: 25, flex: 1, maxHeight: "92%", padding: 19, paddingBottom: 12 },
  head: { paddingBottom: 10, paddingHorizontal: 1 },
  headTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  headSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  scroll: { flex: 1, marginTop: 4 },
  scrollContent: { gap: 8, paddingBottom: 16 },
  mapWrapper: {
    borderColor: color.line,
    borderRadius: 22,
    borderWidth: 1,
    height: 330,
    overflow: "hidden",
    width: "100%"
  },
  fieldLabel: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 6 },
  addressText: { color: color.ink, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  hint: { color: color.muted, fontSize: 11, lineHeight: 15 },
  footer: { borderTopColor: color.line, borderTopWidth: 0.5, paddingTop: 10 },
  confirm: {
    alignItems: "center",
    backgroundColor: color.ink,
    borderRadius: 14,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  confirmDisabled: { opacity: 0.45 },
  confirmText: { color: color.white, fontSize: 14, fontWeight: "800" }
});
