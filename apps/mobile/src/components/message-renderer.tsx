// Lotus v1 §16 — 统一 MessageRenderer: kind → 具体组件，再按 proxy_object.objectType 二级分发
// 取代 if (message.invitation) else if (message.activity) 的发散

import { Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";

export type MessageV1 = {
  id: string;
  kind: "text" | "image" | "video" | "file" | "location" | "contact" | "proxy_object" | "poll" | "call_recording" | "system_event";
  text?: string | null;
  attachments?: { id: string; media_type: string; url_ref?: string | null; mime?: string | null }[] | null;
  proxy_object?: { object_type: "invitation" | "activity" | "opportunity" | "voucher" | "post" | "order"; object_id: string; snapshot: Record<string, unknown>; liveState?: Record<string, unknown> | null } | null;
  poll?: { question: string; options: { id: string; text: string }[] } | null;
  call_recording?: { call_id: string; duration_ms: number } | null;
  security?: { mode: "normal" | "secure" } | null;
  delivery?: { state: string } | null;
};

export function MessageRenderer({ message, onPressProxyObject }: { message: MessageV1; onPressProxyObject?: (o: NonNullable<MessageV1["proxy_object"]>) => void }): React.JSX.Element {
  switch (message.kind) {
    case "text":
      return (
        <View style={styles.bubble}>
          <Text style={styles.text}>{message.text ?? ""}</Text>
        </View>
      );
    case "image":
    case "video":
      return (
        <View style={styles.media}>
          <Text style={styles.mediaPlaceholder}>{message.kind === "image" ? "🖼 图片" : "🎬 视频"}</Text>
          {message.text ? <Text style={styles.caption}>{message.text}</Text> : null}
        </View>
      );
    case "file":
      return (
        <View style={styles.file}>
          <Text style={styles.fileName}>{(message.attachments?.[0] as { mime?: string })?.mime ?? "文件"}</Text>
          <Text style={styles.meta}>点击查看</Text>
        </View>
      );
    case "proxy_object":
      return <ProxyObjectMessage object={message.proxy_object!} onPress={onPressProxyObject as unknown as (o: NonNullable<MessageV1["proxy_object"]>) => void} />;
    case "poll":
      return (
        <View style={styles.poll}>
          <Text style={styles.pollQ}>{message.poll?.question ?? "投票"}</Text>
          {(message.poll?.options ?? []).map((o) => (
            <View key={o.id} style={styles.pollOpt}><Text style={styles.pollOptText}>{o.text}</Text></View>
          ))}
        </View>
      );
    case "call_recording":
      return (
        <View style={styles.callRec}>
          <Text style={styles.callRecText}>📞 录音 · {Math.round((message.call_recording?.duration_ms ?? 0) / 1000)}s</Text>
        </View>
      );
    case "system_event":
      return (
        <View style={styles.system}>
          <Text style={styles.systemText}>{message.text ?? "系统事件"}</Text>
        </View>
      );
    default:
      return (
        <View style={styles.bubble}>
          <Text style={styles.text}>{message.text ?? ""}</Text>
        </View>
      );
  }
}

function ProxyObjectMessage({ object, onPress }: { object: NonNullable<MessageV1["proxy_object"]>; onPress?: (o: NonNullable<MessageV1["proxy_object"]>) => void }): React.JSX.Element {
  const snap = object.snapshot as Record<string, unknown>;
  const live = object.liveState as Record<string, unknown> | undefined;
  const title = (snap.title as string) ?? (snap.name as string) ?? object.object_type;
  const subtitle = live ? `当前：${String((live.state as string) ?? (live.status as string) ?? JSON.stringify(live).slice(0, 40))}` : `发送时：${String((snap.state as string) ?? "")}`;
  return (
    <Pressable onPress={() => onPress?.(object)} style={styles.proxyCard}>
      <View style={styles.proxyHead}><Text style={styles.proxyType}>{object.object_type}</Text><Text style={styles.proxyTitle}>{title}</Text></View>
      <Text style={styles.proxyMeta}>{subtitle}</Text>
      {live ? <Text style={styles.proxyLive}>实时已更新</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: { borderWidth: 1, borderColor: "#e8e3da", backgroundColor: "#fff", borderRadius: 16, paddingHorizontal: 11, paddingVertical: 8, maxWidth: 260 },
  text: { fontSize: 13.5, lineHeight: 19, color: "#11110f" },
  media: { width: 180, height: 140, borderRadius: 12, backgroundColor: "#f6f3ee", borderWidth: 1, borderColor: "#e8e3da", alignItems: "center", justifyContent: "center", padding: 8 },
  mediaPlaceholder: { fontSize: 12, color: "#77736c" },
  caption: { marginTop: 6, fontSize: 11, color: "#77736c" },
  file: { borderWidth: 1, borderColor: "#e8e3da", backgroundColor: "#fffefa", borderRadius: 12, padding: 11, width: 220 },
  fileName: { fontSize: 12, fontWeight: "700", color: "#11110f" },
  meta: { fontSize: 11, color: "#8d8982", marginTop: 4 },
  poll: { borderWidth: 1, borderColor: "#e8e3da", backgroundColor: "#fff", borderRadius: 12, padding: 11, width: 220 },
  pollQ: { fontSize: 12.5, fontWeight: "700", color: "#11110f", marginBottom: 8 },
  pollOpt: { height: 32, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 8, justifyContent: "center", paddingHorizontal: 9, marginTop: 6 },
  pollOptText: { fontSize: 11, color: "#11110f" },
  callRec: { borderWidth: 1, borderColor: "#e8e3da", backgroundColor: "#fffefa", borderRadius: 12, padding: 11, width: 220 },
  callRecText: { fontSize: 11, fontWeight: "700", color: "#11110f" },
  system: { alignSelf: "center", backgroundColor: "#f6f3ee", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  systemText: { fontSize: 11, color: "#77736c" },
  proxyCard: { width: 258, borderWidth: 1, borderColor: "#e8e3da", borderRadius: 15, backgroundColor: "#fff", overflow: "hidden" },
  proxyHead: { padding: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  proxyType: { fontSize: 11, fontWeight: "700", color: "#8f6b1b", backgroundColor: "#fff4da", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, overflow: "hidden" },
  proxyTitle: { flex: 1, fontSize: 12.5, fontWeight: "700", color: "#11110f" },
  proxyMeta: { paddingHorizontal: 11, fontSize: 11, lineHeight: 16, color: "#66625b" },
  proxyLive: { marginTop: 6, marginHorizontal: 11, marginBottom: 11, fontSize: 11, color: "#8d681b", fontWeight: "700" },
});
