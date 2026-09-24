import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { color } from "../theme";
import { sessionAuthClient } from "../native-clients";
import type { MediaClient } from "../media-client";
import { ProxyLoading } from "../components/proxy-foundation";
import {
  AREA_LABELS, CAPABILITY_LABELS, LANGUAGE_LABELS, fetchProviderApplication, providerApplicationErrorText,
  providerApplicationStatusCard, submitProviderApplication, withdrawProviderApplication,
  type ProviderApplicationView,
} from "../provider-application-client";

// ORDER-PERMISSION-001：「申请接单权限」（任何人可申请，性别不是门槛）。本人填表 → 运营控制台审核 → 通过才开服务者身份。
// 照片必须是本人上传的真实照片（服务端核验：本人上传、图片、非 AI 生成）。实名只给运营看。

type Photo = { mediaAssetId: string; uri: string };

export function ProviderApplicationSurface({ mediaClient }: { mediaClient?: MediaClient | undefined }): React.JSX.Element {
  const [view, setView] = useState<ProviderApplicationView>();
  const [loadError, setLoadError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"submit" | "withdraw" | "photo">();
  const [error, setError] = useState<string>();
  const [realName, setRealName] = useState("");
  const [city, setCity] = useState("河内");
  const [areas, setAreas] = useState<string[]>(["hn"]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [intro, setIntro] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [attested, setAttested] = useState(false);

  const load = useCallback(() => {
    setLoadError(undefined);
    fetchProviderApplication(sessionAuthClient)
      .then(setView)
      .catch((e: unknown) => setLoadError(providerApplicationErrorText(e)));
  }, []);
  useEffect(load, [load]);

  const toggle = (list: string[], set: (next: string[]) => void, value: string): void => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const addPhotos = async (): Promise<void> => {
    if (!mediaClient || !view) return;
    const room = view.options.maxPhotos - photos.length;
    if (room <= 0) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsMultipleSelection: true, selectionLimit: room });
    if (result.canceled) return;
    setBusy("photo");
    setError(undefined);
    try {
      for (const asset of result.assets.slice(0, room)) {
        const uploaded = await mediaClient.uploadImage({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg", width: asset.width, height: asset.height });
        setPhotos((current) => [...current, { mediaAssetId: uploaded.mediaAssetId, uri: asset.uri }]);
      }
    } catch {
      setError("照片上传失败，已上传的保留，可以再试。");
    } finally {
      setBusy(undefined);
    }
  };

  const submit = async (): Promise<void> => {
    setBusy("submit");
    setError(undefined);
    try {
      setView(await submitProviderApplication(sessionAuthClient, {
        realName, photosAttested: attested, city, serviceAreas: areas, languages, capabilities, intro,
        photoAssetIds: photos.map((p) => p.mediaAssetId),
      }));
      setEditing(false);
    } catch (e) {
      setError(providerApplicationErrorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  const withdraw = async (): Promise<void> => {
    setBusy("withdraw");
    setError(undefined);
    try {
      setView(await withdrawProviderApplication(sessionAuthClient));
    } catch (e) {
      setError(providerApplicationErrorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  if (loadError) return <View style={s.card}><Text selectable style={s.muted}>{loadError}</Text><Pressable onPress={load} style={s.secondary}><Text selectable style={s.secondaryText}>重试</Text></Pressable></View>;
  if (!view) return <ProxyLoading label="正在读取申请状态" tone="muted" />;

  const card = providerApplicationStatusCard(view.application);
  const showForm = !card || editing;
  const chips = (codes: string[], labels: Readonly<Record<string, string>>, selected: string[], set: (next: string[]) => void) => (
    <View style={s.chips}>{codes.map((code) => {
      const on = selected.includes(code);
      return <Pressable accessibilityLabel={`${labels[code] ?? code}${on ? "，已选" : ""}`} key={code} onPress={() => toggle(selected, set, code)} style={[s.chip, on && s.chipOn]}><Text selectable style={[s.chipText, on && s.chipTextOn]}>{labels[code] ?? code}</Text></Pressable>;
    })}</View>
  );

  return (
    <View style={s.wrap}>
      <Text selectable style={s.lead}>接单需要实名和本人真实照片。提交后由运营审核，通过后开放接单。</Text>
      {card ? <View style={s.card}>
        <Text selectable style={s.cardTitle}>{card.title}</Text>
        <Text selectable style={s.muted}>{card.detail}</Text>
        {card.canWithdraw ? <Pressable disabled={busy !== undefined} onPress={() => { void withdraw(); }} style={s.secondary}><Text selectable style={s.secondaryText}>{busy === "withdraw" ? "撤回中…" : "撤回申请"}</Text></Pressable> : null}
        {card.canReapply && !editing ? <Pressable onPress={() => setEditing(true)} style={s.primary}><Text selectable style={s.primaryText}>修改后重新申请</Text></Pressable> : null}
      </View> : null}

      {showForm ? <View style={s.card}>
        <Text selectable style={s.label}>真实姓名（只给运营看）</Text>
        <TextInput accessibilityLabel="真实姓名" onChangeText={setRealName} placeholder="与证件一致" placeholderTextColor={color.muted} style={s.input} value={realName} />
        <Text selectable style={s.label}>所在城市</Text>
        <TextInput accessibilityLabel="所在城市" onChangeText={setCity} style={s.input} value={city} />
        <Text selectable style={s.label}>服务区域</Text>
        {chips(view.options.serviceAreas, AREA_LABELS, areas, setAreas)}
        <Text selectable style={s.label}>会说的语言</Text>
        {chips(view.options.languages, LANGUAGE_LABELS, languages, setLanguages)}
        <Text selectable style={s.label}>能力（可不选）</Text>
        {chips(view.options.capabilities, CAPABILITY_LABELS, capabilities, setCapabilities)}
        <Text selectable style={s.label}>自我介绍</Text>
        <TextInput accessibilityLabel="自我介绍" multiline onChangeText={setIntro} placeholder="你是谁、擅长带人去哪、适合什么样的约" placeholderTextColor={color.muted} style={[s.input, s.multiline]} value={intro} />
        <Text selectable style={s.label}>{`本人照片（${photos.length}/${view.options.maxPhotos}，至少 ${view.options.minPhotos} 张，不能用 AI 生成的图）`}</Text>
        <View style={s.photos}>
          {photos.map((photo) => <Pressable accessibilityLabel="移除这张照片" key={photo.mediaAssetId} onPress={() => setPhotos((current) => current.filter((p) => p.mediaAssetId !== photo.mediaAssetId))} style={s.photo}>
            <Image contentFit="cover" source={{ uri: photo.uri }} style={s.photoImage} />
            <Text selectable style={s.photoX}>×</Text>
          </Pressable>)}
          {photos.length < view.options.maxPhotos ? <Pressable accessibilityLabel="添加本人照片" disabled={!mediaClient || busy !== undefined} onPress={() => { void addPhotos(); }} style={[s.photo, s.photoAdd]}>
            <Text selectable style={s.photoAddText}>{busy === "photo" ? "上传中" : "＋"}</Text>
          </Pressable> : null}
        </View>
        <Pressable accessibilityLabel={`我确认照片均为本人真实照片${attested ? "，已勾选" : ""}`} onPress={() => setAttested(!attested)} style={s.attest}>
          <View style={[s.box, attested && s.boxOn]}>{attested ? <Text selectable style={s.boxTick}>✓</Text> : null}</View>
          <Text selectable style={s.attestText}>我确认照片均为本人真实照片（不是别人的，也不是 AI 生成的）</Text>
        </Pressable>
        <Pressable accessibilityLabel="提交申请" disabled={busy !== undefined} onPress={() => { void submit(); }} style={[s.primary, busy !== undefined && s.busy]}>
          <Text selectable style={s.primaryText}>{busy === "submit" ? "提交中…" : "提交申请"}</Text>
        </Pressable>
      </View> : null}

      {error ? <Text selectable style={s.error}>{error}</Text> : null}
      <Text selectable style={s.fine}>照片仅用于审核与服务者主页展示</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 12, paddingBottom: 24 },
  lead: { color: color.muted, fontSize: 12.5, fontWeight: "700", lineHeight: 19 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, gap: 8, padding: 14 },
  cardTitle: { color: color.ink, fontSize: 16, fontWeight: "900" },
  muted: { color: color.muted, fontSize: 12.5, fontWeight: "700", lineHeight: 19 },
  label: { color: color.ink, fontSize: 12.5, fontWeight: "900", marginTop: 6 },
  input: { backgroundColor: color.surface, borderRadius: 12, color: color.ink, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: color.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: color.ink },
  chipText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  chipTextOn: { color: color.white },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photo: { borderRadius: 12, height: 76, overflow: "hidden", width: 76 },
  photoImage: { height: "100%", width: "100%" },
  photoX: { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 9, color: color.white, fontSize: 12, fontWeight: "900", height: 18, lineHeight: 18, position: "absolute", right: 4, textAlign: "center", top: 4, width: 18 },
  photoAdd: { alignItems: "center", backgroundColor: color.surface, justifyContent: "center" },
  photoAddText: { color: color.muted, fontSize: 18, fontWeight: "900" },
  attest: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 8 },
  box: { alignItems: "center", borderColor: color.ink, borderRadius: 5, borderWidth: 1.5, height: 20, justifyContent: "center", width: 20 },
  boxOn: { backgroundColor: color.ink },
  boxTick: { color: color.white, fontSize: 12, fontWeight: "900" },
  attestText: { color: color.ink, flex: 1, fontSize: 12.5, fontWeight: "700" },
  primary: { alignItems: "center", backgroundColor: color.ink, borderRadius: 14, marginTop: 8, paddingVertical: 13 },
  primaryText: { color: color.white, fontSize: 14, fontWeight: "900" },
  secondary: { alignItems: "center", borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 4, paddingVertical: 11 },
  secondaryText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  busy: { opacity: 0.5 },
  error: { color: color.magenta, fontSize: 12.5, fontWeight: "800", lineHeight: 19 },
  fine: { color: color.muted, fontSize: 10.5, fontWeight: "700", textAlign: "center" },
});
