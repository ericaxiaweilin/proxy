// Lotus RFC §8.1 — 顶部身份切换器 (工作号/私人号/备用号)
// 整个 App 上下文随切换：会话列表/未读/好友/素材/设置。MVP 仅做 UI 壳 + client 接线。

import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { DisplayIdentity, DisplayIdentityClient } from "../display-identity-client";
import { color } from "../theme";

export function IdentitySwitcher({
  client,
  activeId,
  onSwitch,
}: {
  client: DisplayIdentityClient;
  activeId?: string | undefined;
  onSwitch: (id: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DisplayIdentity[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void client
      .list()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, client]);

  const active = items.find((i) => i.id === activeId) ?? items[0];

  return (
    <View>
      <Pressable onPress={() => setOpen(true)} style={styles.trigger} accessibilityLabel="切换身份">
        <Text selectable style={styles.triggerText}>💼 {active ? `${active.alias} (${active.displayName})` : "选择身份"} ▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <Text selectable style={styles.title}>切换身份</Text>
          {loading ? <Text selectable style={styles.hint}>加载中…</Text> : null}
          {items.map((it) => {
            const isActive = it.id === active?.id;
            const burnerHint = it.type === "BURNER" && it.expiresAt ? ` · ${Math.ceil((new Date(it.expiresAt).getTime() - Date.now()) / 86400000)}天后销毁` : "";
            return (
              <Pressable
                key={it.id}
                onPress={() => {
                  onSwitch(it.id);
                  setOpen(false);
                }}
                style={[styles.row, isActive && styles.rowActive]}
              >
                <Text selectable style={styles.alias}>{it.alias} ({it.displayName}){burnerHint}</Text>
                <Text selectable style={styles.type}>{it.type}</Text>
              </Pressable>
            );
          })}
          {!loading && items.length === 0 ? <Text selectable style={styles.hint}>暂无身份，请先创建工作号</Text> : null}
          <Pressable onPress={() => setOpen(false)} style={styles.close}>
            <Text selectable style={styles.closeText}>关闭</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  triggerText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  backdrop: { backgroundColor: "rgba(0,0,0,0.32)", flex: 1 },
  sheet: { backgroundColor: color.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, bottom: 0, left: 0, padding: 16, position: "absolute", right: 0 },
  title: { color: color.ink, fontSize: 16, fontWeight: "900", marginBottom: 12 },
  row: { alignItems: "center", borderColor: color.line, borderRadius: 12, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10 },
  rowActive: { backgroundColor: "#F0E8FF", borderColor: color.proxyPurple },
  alias: { color: color.ink, fontSize: 13, fontWeight: "700" },
  type: { color: color.muted, fontSize: 11, fontWeight: "700" },
  hint: { color: color.muted, fontSize: 11, marginBottom: 8 },
  close: { alignItems: "center", marginTop: 8, paddingVertical: 10 },
  closeText: { color: color.proxyPurple, fontSize: 13, fontWeight: "800" },
});
