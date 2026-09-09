// Lotus v1 §7 — Folder 只做 Dialog 分类，不复制消息
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color } from "../theme";

export type FolderV1 = { id: string; name: string; dialogIds: string[] };

export function FolderManager({
  folders,
  onCreate,
  selectedId,
  onSelect,
}: {
  folders: FolderV1[];
  onCreate: (name: string) => void;
  // 选中过滤：点 chip 只看该文件夹的会话，再点取消选中回全部。
  selectedId?: string | null | undefined;
  onSelect?: ((folderId: string | null) => void) | undefined;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  return (
    <View style={styles.root}>
      <Text style={styles.title}>自建文件夹</Text>
      <View style={styles.chips}>
        {folders.map((f) => {
          const active = selectedId === f.id;
          const selectable = Boolean(onSelect);
          return (
            <Pressable
              key={f.id}
              disabled={!selectable}
              onPress={() => onSelect?.(active ? null : f.id)}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityLabel={`文件夹${f.name}，${f.dialogIds.length} 个会话`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.name} · {f.dialogIds.length}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => setShowCreate((v) => !v)} style={styles.addChip}>
          <Text style={styles.addText}>＋ 新建</Text>
        </Pressable>
      </View>
      {showCreate ? (
        <View style={styles.createRow}>
          <TextInput value={name} onChangeText={setName} placeholder="文件夹名称" placeholderTextColor="#9a968f" style={styles.input} />
          <Pressable onPress={() => { if (name.trim()) { onCreate(name.trim()); setName(""); setShowCreate(false); } }} style={styles.createBtn}>
            <Text style={styles.createText}>创建</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.hint}>Folder 只分类 Dialog，不复制消息，未读 = sum(dialog unread)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 11, fontWeight: "700", color: "#9b978f" },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: "#e8e3da", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#f6f3ee" },
  chipActive: { backgroundColor: "#11110f", borderColor: "#11110f" },
  chipText: { fontSize: 11, fontWeight: "600", color: "#77736c" },
  chipTextActive: { color: "#fff" },
  addChip: { borderWidth: 1, borderColor: "#e8e3da", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#fff" },
  addText: { fontSize: 11, fontWeight: "600", color: "#11110f" },
  createRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  input: { flex: 1, height: 36, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 12, paddingHorizontal: 10, fontSize: 12 },
  createBtn: { backgroundColor: "#11110f", borderRadius: 12, paddingHorizontal: 14, justifyContent: "center" },
  createText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  hint: { fontSize: 11, color: "#9a968e", marginTop: 4 },
});
