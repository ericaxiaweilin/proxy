import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import {
  STAGE_LABEL,
  contentErrorText,
  platformLabel,
  publicationUrlOk,
  taskTitle,
  type ContentTaskView,
} from "../content-task";
import type { MediaClient } from "../media-client";
import type { SupplyClient } from "../supply-client";

// CONTENT-TASK-001：creator 侧「我的内容任务」—— 商家发的内容任务接单之后在这里交稿、
// 看审核意见、审核通过后贴回各平台发布链接。待接单的还在上面「收到的合作邀请」里接 / 拒，
// 这里不重复（服务端 ListMyContentTasks 本来就不返回待接单的）。
// 商家看到的进度 = 这里做的事：交稿 → 商家「待审核」，贴链接 → 商家「已发布」。

type Picked = { uri: string; mimeType: string; width: number; height: number; isVideo: boolean; durationMs: number };

export function CreatorContentTasks({ supply, mediaClient, refreshKey }: {
  supply: SupplyClient;
  mediaClient?: MediaClient | undefined;
  // 上面接了一单邀约后变一下，这里跟着刷新（刚接的 UGC 单要马上出现）。
  refreshKey?: number | undefined;
}): React.JSX.Element | null {
  const [tasks, setTasks] = useState<ContentTaskView[]>([]);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setTasks(await supply.listMyContentTasks());
    } catch {
      setTasks([]);
    }
  }, [supply]);

  useEffect(() => { void reload(); }, [reload, refreshKey]);

  if (tasks.length === 0) return null;
  return (
    <View style={s.wrap}>
      <Text selectable style={s.section}>我的内容任务</Text>
      {notice ? <Text selectable style={s.ok}>{notice}</Text> : null}
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} supply={supply} mediaClient={mediaClient} onDone={async (message) => { setNotice(message); await reload(); }} />
      ))}
    </View>
  );
}

function TaskCard({ task: t, supply, mediaClient, onDone }: {
  task: ContentTaskView;
  supply: SupplyClient;
  mediaClient?: MediaClient | undefined;
  onDone: (message: string) => Promise<void>;
}): React.JSX.Element {
  const [composing, setComposing] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [links, setLinks] = useState<Record<string, string>>({});
  const published = new Map(t.publications.map((p) => [p.platform, p]));
  const platforms = [...new Set([...t.platforms, ...t.publications.map((p) => p.platform)])];

  const pick = async (): Promise<void> => {
    setError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("请允许 Proxy 读取相册才能交稿。"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.8, allowsMultipleSelection: true, selectionLimit: 9 });
    if (result.canceled) return;
    setPicked(result.assets.slice(0, 9).map((a) => ({
      uri: a.uri,
      mimeType: a.mimeType ?? (a.type === "video" ? "video/mp4" : "image/jpeg"),
      width: a.width ?? 0,
      height: a.height ?? 0,
      isVideo: a.type === "video",
      durationMs: a.duration ?? 0,
    })));
  };

  const submit = async (): Promise<void> => {
    if (!mediaClient) { setError("现在上传不了素材，稍后再试"); return; }
    if (picked.length === 0) { setError("至少选一张图或一段视频"); return; }
    setBusy(true);
    setError(undefined);
    try {
      const ids: string[] = [];
      for (const m of picked) {
        const uploaded = m.isVideo
          ? await mediaClient.uploadMedia({ uri: m.uri, mimeType: m.mimeType, width: m.width, height: m.height, mediaType: "VIDEO", durationMs: m.durationMs, defaultMime: "video/mp4" })
          : await mediaClient.uploadImage({ uri: m.uri, mimeType: m.mimeType, width: m.width, height: m.height });
        ids.push(uploaded.mediaAssetId);
      }
      const durationSec = Math.round(Math.max(0, ...picked.map((m) => m.durationMs)) / 1000);
      await supply.submitContentDraft({ taskId: t.id, mediaAssetIds: ids, caption: caption.trim(), durationSec });
      setComposing(false);
      setPicked([]);
      setCaption("");
      await onDone("已交稿，等商家审核");
    } catch (e) {
      setError(contentErrorText(e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
    }
  };

  const saveLink = async (platform: string): Promise<void> => {
    const url = (links[platform] ?? "").trim();
    if (!publicationUrlOk(platform, url)) { setError(`贴 ${platformLabel(platform)} 自己的 https 链接`); return; }
    setBusy(true);
    setError(undefined);
    try {
      await supply.addContentPublication({ taskId: t.id, platform, url });
      setLinks((cur) => ({ ...cur, [platform]: "" }));
      await onDone(`${platformLabel(platform)} 链接已保存，商家那边显示已发布`);
    } catch (e) {
      setError(contentErrorText(e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text selectable style={s.store} numberOfLines={1}>{t.merchantName || "商家"}</Text>
        <Text selectable style={s.stage}>{STAGE_LABEL[t.stage]}</Text>
      </View>
      <Text selectable style={s.title}>{`“${taskTitle(t)}”`}</Text>
      {t.title && t.brief ? <Text selectable style={s.brief}>{t.brief}</Text> : null}
      {t.platforms.length > 0 ? <Text selectable style={s.meta}>{`计划发布：${t.platforms.map(platformLabel).join(" · ")}`}</Text> : null}
      {t.stage === "SHOOTING" && t.review?.decision === "REJECT" ? <Text selectable style={s.reject}>{`商家意见：${t.review.note}`}</Text> : null}

      {t.stage === "SHOOTING" && !composing ? (
        <Pressable onPress={() => setComposing(true)} style={[s.btn, s.btnPrimary]} accessibilityLabel="交稿">
          <Text selectable style={s.btnText}>{t.review?.decision === "REJECT" ? "改好了，重新交稿" : "交稿"}</Text>
        </Pressable>
      ) : null}
      {t.stage === "SHOOTING" && composing ? (
        <View>
          <Pressable onPress={() => void pick()} style={s.btn} accessibilityLabel="选图片或视频">
            <Text selectable style={s.btnText}>{picked.length > 0 ? `已选 ${picked.length} 个，重新选` : "选图片 / 视频（最多 9 个）"}</Text>
          </Pressable>
          {picked.length > 0 ? (
            <View style={s.thumbRow}>
              {picked.map((m) => <Image key={m.uri} contentFit="cover" source={{ uri: m.uri }} style={s.thumb} />)}
            </View>
          ) : null}
          <TextInput
            maxLength={1000}
            multiline
            onChangeText={setCaption}
            placeholder="发布文案（不要写电话 / Zalo / 外链，审核会拦）"
            placeholderTextColor="#86868B"
            style={s.input}
            value={caption}
          />
          <Pressable disabled={busy} onPress={() => void submit()} style={[s.btn, s.btnPrimary]} accessibilityLabel="提交稿件">
            <Text selectable style={s.btnText}>{busy ? "上传中…" : "提交给商家审核"}</Text>
          </Pressable>
        </View>
      ) : null}
      {t.stage === "IN_REVIEW" ? <Text selectable style={s.meta}>已交稿，等商家审核；通过后在这里贴各平台发布链接。</Text> : null}

      {t.stage === "APPROVED" || t.stage === "PUBLISHED" ? (
        <View style={{ marginTop: 6 }}>
          <Text selectable style={s.meta}>审核已通过：去各平台发布，再把链接贴回来，商家就能看到。</Text>
          {platforms.map((p) => {
            const pub = published.get(p);
            return (
              <View key={p} style={s.linkRow}>
                <Text selectable style={s.platform}>{platformLabel(p)}</Text>
                {pub ? (
                  <Pressable onPress={() => void Linking.openURL(pub.url)} accessibilityLabel={`打开${platformLabel(p)}链接`} style={{ flex: 1 }}>
                    <Text selectable numberOfLines={1} style={s.linkDone}>{`✓ ${pub.url}`}</Text>
                  </Pressable>
                ) : (
                  <>
                    <TextInput
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={(v) => setLinks((cur) => ({ ...cur, [p]: v }))}
                      placeholder="https://…"
                      placeholderTextColor="#86868B"
                      style={s.linkInput}
                      value={links[p] ?? ""}
                    />
                    <Pressable disabled={busy} onPress={() => void saveLink(p)} style={s.linkSave} accessibilityLabel={`保存${platformLabel(p)}链接`}>
                      <Text selectable style={s.btnText}>保存</Text>
                    </Pressable>
                  </>
                )}
              </View>
            );
          })}
        </View>
      ) : null}
      {error ? <Text selectable style={s.error}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 11 },
  section: { color: "#111111", fontSize: 12, fontWeight: "900", marginBottom: 7 },
  ok: { color: "#1E8E3E", fontSize: 12, fontWeight: "700", marginBottom: 6 },
  card: { backgroundColor: "#FFFFFF", borderColor: "#EAEAEA", borderRadius: 16, borderWidth: 1, marginBottom: 8, padding: 14 },
  head: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  store: { color: "#111111", flex: 1, fontSize: 14, fontWeight: "800" },
  stage: { color: "#0071E3", fontSize: 11, fontWeight: "700", marginLeft: 8 },
  title: { color: "#111111", fontSize: 14, fontWeight: "700", marginBottom: 4 },
  brief: { color: "#333333", fontSize: 12, lineHeight: 17, marginBottom: 4 },
  meta: { color: "#86868B", fontSize: 11, lineHeight: 16, marginTop: 2 },
  reject: { backgroundColor: "#FFF1F0", borderRadius: 8, color: "#C4302B", fontSize: 12, marginTop: 6, padding: 8 },
  btn: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#EAEAEA", borderRadius: 10, borderWidth: 1, marginTop: 8, padding: 10 },
  btnPrimary: { backgroundColor: "#D0F55C", borderColor: "#D0F55C" },
  btnText: { color: "#111111", fontSize: 12, fontWeight: "700" },
  thumbRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  thumb: { backgroundColor: "#F2F2F2", borderRadius: 8, height: 64, width: 48 },
  input: { backgroundColor: "#F9F9FB", borderColor: "#EAEAEA", borderRadius: 10, borderWidth: 1, color: "#111111", fontSize: 13, marginTop: 8, minHeight: 64, padding: 10 },
  linkRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 8 },
  platform: { color: "#111111", fontSize: 12, fontWeight: "800", width: 72 },
  linkInput: { backgroundColor: "#F9F9FB", borderColor: "#EAEAEA", borderRadius: 8, borderWidth: 1, color: "#111111", flex: 1, fontSize: 12, height: 36, paddingHorizontal: 8 },
  linkSave: { backgroundColor: "#D0F55C", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  linkDone: { color: "#1E8E3E", fontSize: 12, fontWeight: "700" },
  error: { color: "#FF3B30", fontSize: 12, marginTop: 6 },
});
