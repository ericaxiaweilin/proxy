// ContextSwitcherSheet（R15.12.7）：切换身份 Sheet，只保留 用户 / 商家 两种前台身份。
// 找人、接机会、开放能力、发活动都是行为，不是另一种身份。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html（openContextSwitcher）。
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { ProxyIcon, type ProxyIconName } from "./proxy-icon";
import { color } from "../theme";
import { type ActiveContext } from "../uiplan/types";

export interface ContextOption {
  id: ActiveContext;
  icon: ProxyIconName;
  title: string;
  desc: string;
}

export function ContextSwitcherSheet({
  open,
  current,
  options,
  onSelect,
  onClose,
  onManageBusiness
}: {
  open: boolean;
  current: ActiveContext;
  options: ContextOption[];
  onSelect: (next: ActiveContext) => void;
  onClose: () => void;
  onManageBusiness: () => void;
}): React.JSX.Element {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
      <Pressable onPress={onClose} style={styles.overlay}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <View style={styles.head}>
            <Text selectable style={styles.headTitle}>切换身份</Text>
            <Text selectable style={styles.headSub}>
              Proxy 只保留用户与商家。找人、接机会、开放能力、发活动都是行为，不是另一种身份。
            </Text>
          </View>
          {options.map((option) => {
            const active = current === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => {
                  onSelect(option.id);
                  onClose();
                }}
                style={[styles.opt, active && styles.optActive]}
              >
                <View style={[styles.optIcon, active && styles.optIconActive]}>
                  <ProxyIcon color={active ? color.white : color.ink} name={option.icon} size={24} />
                </View>
                <View style={styles.optCopy}>
                  <Text selectable style={styles.optTitle}>{option.title}</Text>
                  <Text selectable style={styles.optDesc}>{option.desc}</Text>
                </View>
                <Text selectable style={styles.optAction}>{active ? "当前" : "切换"}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={onManageBusiness} style={styles.manage}>
            <View style={styles.manageTitleRow}>
              <ProxyIcon color={color.ink} name="plus" size={20} />
              <Text selectable style={styles.manageTitle}>管理商家主体</Text>
            </View>
            <Text selectable style={styles.manageDesc}>拥有企业 / 店铺权限时，在这里管理主体。</Text>
          </Pressable>
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
  sheet: { backgroundColor: color.white, borderRadius: 25, padding: 19 },
  head: { paddingBottom: 10, paddingHorizontal: 1 },
  headTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  headSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  opt: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginBottom: 7,
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
  manage: {
    backgroundColor: "#F6F1F9",
    borderRadius: 14,
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  manageTitleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  manageTitle: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  manageDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 }
});
