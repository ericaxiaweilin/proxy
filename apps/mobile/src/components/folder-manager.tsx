// Lotus v1 §7 — Folder 只做 Dialog 分类，不复制消息
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color } from "../theme";

export type FolderV1 = { id: string; name: string; dialogIds: string[] };

export function FolderManager({
  folders,
  onCreate,
  onMove,
}: {
  folders: FolderV1[];
  onCreate: (name: string) => void;
  onMove: (folderId: string, dialogId: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  return (
    <View style={styles.root}>
      <Text style={styles.title}>文件夹</Text>
      <View style={styles.chips}>
        {folders.map((f) => (
          <View key={f.id} style={styles.chip}>
            <Text style={styles.chipText}>{f.name} · {f.dialogIds.length}</Text>
          </View>
        ))}
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
  chipText: { fontSize: 11, fontWeight: "600", color: "#77736c" },
  addChip: { borderWidth: 1, borderColor: "#e8e3da", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#fff" },
  addText: { fontSize: 11, fontWeight: "600", color: "#11110f" },
  createRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  input: { flex: 1, height: 36, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 12, paddingHorizontal: 10, fontSize: 12 },
  createBtn: { backgroundColor: "#11110f", borderRadius: 12, paddingHorizontal: 14, justifyContent: "center" },
  createText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  hint: { fontSize: 9.5, color: "#9a968e", marginTop: 4 },
});
