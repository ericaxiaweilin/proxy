// LocationPickerSheet (R15.13 P5)：切换首页/动态顶部的本地范围。
// 选项以"城市 · 区域"为最小单位（仅城市/区域，没有 GPS、没有设备级精细化）。
// 视觉基线：复用 ContextSwitcherSheet 的 sheet 形态以保持一致性；
// 数据范围保持小 — 三个起步城市 + 每城 1-2 个常用区域，避免变成完整地址簿。
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ProxyIcon, type ProxyIconName } from "./proxy-icon";
import { color } from "../theme";
import {
  DEFAULT_LOCATION,
  LOCATION_OPTIONS,
  type Location,
  type LocationOption
} from "./location-options";

export { DEFAULT_LOCATION, LOCATION_OPTIONS };
export type { Location, LocationOption };

export function LocationPickerSheet({
  open,
  current,
  onSelect,
  onClose
}: {
  open: boolean;
  current: Location;
  onSelect: (next: Location) => void;
  onClose: () => void;
}): React.JSX.Element {
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
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {LOCATION_OPTIONS.map((option) => {
              const active = current.id === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    onSelect({ id: option.id, city: option.city, area: option.area });
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: "rgba(20,18,31,0.46)",
    flex: 1,
    justifyContent: "flex-end",
    padding: 12
  },
  sheet: { backgroundColor: color.white, borderRadius: 25, maxHeight: "78%", padding: 19 },
  head: { paddingBottom: 10, paddingHorizontal: 1 },
  headTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  headSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  scroll: { marginTop: 4 },
  scrollContent: { gap: 7, paddingBottom: 8 },
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
  optAction: { color: "#62586A", fontSize: 11, fontWeight: "800" }
});
