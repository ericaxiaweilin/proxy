import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { AiPersonaClient } from "../ai-persona-client";
import type { TransportResponse } from "../auth-client";
import {
  analyzeUserModel,
  fetchUserModel,
  updateUserModel,
  USER_MODELING_LOGO,
  UserModelError,
  userModelErrorText,
  userModelSummary,
  type UserModel,
  type UserModelField,
  type UserModelPatch,
  type UserModelView,
} from "../user-model-client";
import { promptLikenessConsent } from "./likeness-consent-prompt";

// AI-MANAGE-015（2026-09-23，用户原型 deepseek_html_20260923_c9c642.html + logo user_modeling_black_white_clean.svg）：
// AI 分身中心最上面的「用户建模」。AI 分身的核心是给小美生成模型资产（照片 / 视频），
// 建模就是生成时锁住的「她长什么样」：物理锚点 + 亚洲人特征锁定。
//
// 和原型的差别（都是为了不放假数据）：
//   - 原型写死「AI 已从 12 张照片识别出 8 项特征」「165cm / 22 岁」—— 这里全是服务端真值：
//     AI 识别 = vision 模型读本人授权的公共图库照片（POST /v1/ai/user-model/analyze），
//     没识别过就说没识别过，识别不出的项就是「待补充」；
//   - 原型头像是卡通画，这里用本人头像 / 首字；
//   - 原型「编辑模型」只弹 toast，这里是真能改、真能存的表单；本人改过的项 AI 以后不覆盖。
// 没有形象授权 = 没有 AI 分身 = 没有建模（AI-MANAGE-010），只给授权入口。

type Requester = { request(path: string, init: { method: "GET" | "POST" | "PUT"; body?: unknown }): Promise<TransportResponse> };

type Row = { field: UserModelField; label: string; value: string | undefined; unit?: string };

const PURPLE = "#7C3AED";

function rowsOf(model: UserModel): Row[] {
  return [
    { field: "heightCm", label: "身高", value: model.heightCm !== undefined ? `${model.heightCm} cm` : undefined },
    { field: "weightKg", label: "体重", value: model.weightKg !== undefined ? `${model.weightKg} kg` : undefined },
    { field: "age", label: "年龄", value: model.age !== undefined ? `${model.age} 岁` : undefined },
    { field: "bodyType", label: "身材", value: model.bodyType || undefined },
    { field: "skinTone", label: "肤色", value: model.skinTone || undefined },
    { field: "hair", label: "发型", value: model.hair || undefined },
  ];
}

export function TwinUserModelSection({ authClient, ownerId, ownerName, ownerAvatarUri }: {
  authClient: Requester;
  ownerId: string | undefined;
  ownerName: string;
  ownerAvatarUri: string | undefined;
}): React.JSX.Element {
  const personaClient = useMemo(() => new AiPersonaClient({ authClient }), [authClient]);
  const [state, setState] = useState<{ status: "loading" | "unauthorized" | "ready" | "error"; view?: UserModelView; error?: string }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, status: prev.view ? prev.status : "loading" }));
    fetchUserModel(authClient)
      .then((view) => { if (!cancelled) setState({ status: "ready", view }); })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = error instanceof UserModelError ? error.code : "failed";
        setState(code === "likeness_consent_required" ? { status: "unauthorized" } : { status: "error", error: userModelErrorText(code) });
      });
    return () => { cancelled = true; };
  }, [authClient, attempt]);

  const grant = (): void => {
    if (!ownerId) return;
    promptLikenessConsent(() => {
      setState({ status: "loading" });
      personaClient.grantLikeness(ownerId).then(() => setAttempt((n) => n + 1)).catch(() => setState({ status: "error", error: "授权没有成功，请重试" }));
    });
  };

  const view = state.view;
  const model = view?.model;
  const aiCount = model ? Object.values(model.sources).filter((source) => source === "ai").length : 0;
  const summary = model ? userModelSummary(model) : [];

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <View style={styles.titleWrap}>
          <SvgXml height={22} width={22} xml={USER_MODELING_LOGO} />
          <Text selectable style={styles.title}>用户建模</Text>
        </View>
        {state.status === "ready" ? <Pressable accessibilityRole="button" onPress={() => setSheetOpen(true)}><Text selectable style={styles.action}>编辑</Text></Pressable> : null}
      </View>

      {state.status === "loading" ? (
        <View style={styles.card}><ActivityIndicator color={PURPLE} /></View>
      ) : state.status === "unauthorized" ? (
        <View style={styles.card}>
          <Text selectable style={styles.muted}>还没有 AI 分身：授权 AI 使用你的形象后，AI 才能从你的公共图库建模。</Text>
          <Pressable accessibilityRole="button" onPress={grant} style={styles.darkBtn}><Text selectable style={styles.darkBtnText}>授权形象</Text></Pressable>
        </View>
      ) : state.status === "error" || !model || !view ? (
        <Pressable accessibilityRole="button" onPress={() => setAttempt((n) => n + 1)} style={styles.card}>
          <Text selectable style={styles.muted}>{state.error ?? "建模没读出来"}，点这里重试</Text>
        </Pressable>
      ) : (
        <Pressable accessibilityLabel="打开用户建模" accessibilityRole="button" onPress={() => setSheetOpen(true)} style={styles.card}>
          <View style={styles.cardHead}>
            <Avatar name={ownerName} size={60} uri={ownerAvatarUri} />
            <View style={styles.info}>
              <View style={styles.nameRow}>
                <Text selectable numberOfLines={1} style={styles.name}>{ownerName}</Text>
                <Text selectable style={styles.badge}>AI 建模</Text>
              </View>
              <Text selectable numberOfLines={2} style={styles.desc}>{summary.length ? summary.join(" · ") : "还没有建模数据"}</Text>
            </View>
            <Text selectable style={styles.arrow}>›</Text>
          </View>
          <View style={styles.status}>
            <View style={styles.statusDot} />
            <Text selectable style={styles.statusText}>
              {model.analyzedAt
                ? <>AI 已从 <Text selectable style={styles.strong}>{model.analyzedPhotoCount} 张照片</Text> 识别出 <Text selectable style={styles.strong}>{aiCount} 项特征</Text></>
                : <>还没让 AI 识别 · 公共图库有 <Text selectable style={styles.strong}>{view.galleryCount} 张</Text>可用</>}
            </Text>
          </View>
          <View style={styles.chips}>
            {model.heightCm !== undefined ? <Text selectable style={[styles.chip, styles.chipPrimary]}>{model.heightCm}cm</Text> : <Text selectable style={[styles.chip, styles.chipPending]}>身高待补</Text>}
            {model.weightKg !== undefined ? <Text selectable style={styles.chip}>{model.weightKg}kg</Text> : <Text selectable style={[styles.chip, styles.chipPending]}>体重待补</Text>}
            {model.age !== undefined ? <Text selectable style={styles.chip}>{model.age} 岁</Text> : null}
            {model.bodyType ? <Text selectable style={styles.chip}>{model.bodyType.split("·")[0]?.trim()}</Text> : null}
            {model.skinTone ? <Text selectable style={styles.chip}>{model.skinTone.split("·")[0]?.trim()}</Text> : null}
            {model.hair ? <Text selectable style={styles.chip}>{model.hair.replace(/\s*·\s*/, "")}</Text> : null}
          </View>
        </Pressable>
      )}

      {sheetOpen && view ? (
        <UserModelSheet
          authClient={authClient}
          onChange={(next) => setState({ status: "ready", view: next })}
          onClose={() => setSheetOpen(false)}
          ownerAvatarUri={ownerAvatarUri}
          ownerName={ownerName}
          view={view}
        />
      ) : null}
    </View>
  );
}

function Avatar({ uri, name, size }: { uri: string | undefined; name: string; size: number }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text selectable style={[styles.avatarText, { fontSize: size * 0.36 }]}>{(name.trim()[0] ?? "我").toUpperCase()}</Text>
      {uri && !failed ? <Image onError={() => setFailed(true)} source={{ uri }} style={StyleSheet.absoluteFill} /> : null}
    </View>
  );
}

function UserModelSheet({ view, authClient, ownerName, ownerAvatarUri, onChange, onClose }: {
  view: UserModelView;
  authClient: Requester;
  ownerName: string;
  ownerAvatarUri: string | undefined;
  onChange: (view: UserModelView) => void;
  onClose: () => void;
}): React.JSX.Element {
  const model = view.model;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<UserModelField, string>>(() => draftOf(model));
  const [busy, setBusy] = useState<"analyze" | "save" | "lock" | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const run = useCallback(async (kind: "analyze" | "save" | "lock", task: () => Promise<UserModelView>, done?: (next: UserModelView) => string | undefined) => {
    setBusy(kind);
    setNotice(undefined);
    try {
      const next = await task();
      onChange(next);
      setDraft(draftOf(next.model));
      setNotice(done?.(next));
      if (kind === "save") setEditing(false);
    } catch (error) {
      setNotice(userModelErrorText(error instanceof UserModelError ? error.code : "failed"));
    } finally {
      setBusy(undefined);
    }
  }, [onChange]);

  const save = (): void => {
    const patch: UserModelPatch = {};
    const clear: UserModelField[] = [];
    for (const field of ["heightCm", "weightKg", "age"] as const) {
      const text = draft[field].trim();
      const current = model[field];
      if (text === "") { if (current !== undefined) clear.push(field); continue; }
      const value = Number.parseInt(text, 10);
      if (!Number.isFinite(value)) { setNotice("身高 / 体重 / 年龄请填数字"); return; }
      if (value !== current) patch[field] = value;
    }
    for (const field of ["bodyType", "skinTone", "hair"] as const) {
      const text = draft[field].trim();
      if (text !== (model[field] ?? "")) patch[field] = text;
    }
    if (clear.length) patch.clear = clear;
    if (Object.keys(patch).length === 0) { setEditing(false); return; }
    void run("save", () => updateUserModel(authClient, patch), () => "已保存，AI 以后不会覆盖你改过的项");
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <View style={styles.titleWrap}>
            <SvgXml height={26} width={26} xml={USER_MODELING_LOGO} />
            <Text selectable style={styles.sheetTitle}>用户建模</Text>
          </View>
          <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose} style={styles.close}><Text selectable style={styles.closeText}>✕</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Avatar name={ownerName} size={88} uri={ownerAvatarUri} />
            <Text selectable style={styles.heroName}>{ownerName}</Text>
            <Text selectable style={styles.heroSub}>你的 AI 分身{model.asianLock ? " · 亚洲人特征锁定" : ""}</Text>
          </View>

          <View style={styles.bind}>
            <View style={styles.bindIcon}><Text selectable style={styles.bindIconText}>▣</Text></View>
            <View style={styles.info}>
              <Text selectable style={styles.bindTitle}>已授权公共图库 {view.galleryCount} 张</Text>
              <Text selectable style={styles.bindDesc}>{model.analyzedAt ? `上次 AI 识别用了 ${model.analyzedPhotoCount} 张` : "AI 会从这些照片识别你的形象"}</Text>
            </View>
          </View>

          <View style={styles.sectionTitleRow}>
            <Text selectable style={styles.sectionTitle}>物理锚点</Text>
            <Text selectable style={styles.aiTag}>AI 自动识别 · 手动可改</Text>
          </View>
          <View style={styles.featureList}>
            {rowsOf(model).map((row, index) => (
              <View key={row.field} style={[styles.featureRow, index === 5 && styles.featureRowLast]}>
                <Text selectable style={styles.featureLabel}>{row.label}</Text>
                {editing ? (
                  <TextInput
                    keyboardType={row.field === "heightCm" || row.field === "weightKg" || row.field === "age" ? "number-pad" : "default"}
                    onChangeText={(text) => setDraft((prev) => ({ ...prev, [row.field]: text }))}
                    placeholder={row.field === "heightCm" ? "cm" : row.field === "weightKg" ? "kg" : row.field === "age" ? "岁" : "如 " + (row.field === "bodyType" ? "匀称型" : row.field === "skinTone" ? "Fitzpatrick II · 暖金底" : "长直发 · 黑色")}
                    placeholderTextColor="#C8C8CC"
                    style={styles.featureInput}
                    value={draft[row.field]}
                  />
                ) : (
                  <Text selectable style={[styles.featureValue, !row.value && styles.featureValuePending]}>{row.value ?? (row.field === "weightKg" ? "待你补充" : "待补充")}</Text>
                )}
                {!editing && row.value ? (
                  <Text selectable style={[styles.source, model.sources[row.field] === "manual" ? styles.sourceManual : styles.sourceAi]}>{model.sources[row.field] === "manual" ? "手动" : "AI"}</Text>
                ) : null}
              </View>
            ))}
          </View>

          <View style={styles.safety}>
            <View style={styles.info}>
              <Text selectable style={styles.safetyTitle}>亚洲人特征锁定</Text>
              <Text selectable style={styles.safetyText}>生成时锁定东亚女性骨架与比例，防止跑偏为欧美体型。</Text>
            </View>
            <Switch
              disabled={busy !== undefined}
              onValueChange={(value) => void run("lock", () => updateUserModel(authClient, { asianLock: value }))}
              value={model.asianLock}
            />
          </View>

          {notice ? <Text selectable style={styles.notice}>{notice}</Text> : null}

          {editing ? (
            <View style={styles.actionRow}>
              <Pressable accessibilityRole="button" disabled={busy !== undefined} onPress={() => { setEditing(false); setDraft(draftOf(model)); }} style={[styles.ghostBtn, styles.flex]}><Text selectable style={styles.ghostBtnText}>取消</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={busy !== undefined} onPress={save} style={[styles.darkBtnWide, styles.flex]}><Text selectable style={styles.darkBtnText}>{busy === "save" ? "保存中…" : "保存"}</Text></Pressable>
            </View>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                disabled={busy !== undefined || view.galleryCount === 0}
                onPress={() => void run("analyze", () => analyzeUserModel(authClient), (next) => `AI 从 ${next.model.analyzedPhotoCount} 张照片识别出 ${next.recognised ?? 0} 项特征`)}
                style={[styles.ghostBtnWide, (busy !== undefined || view.galleryCount === 0) && styles.disabled]}
              >
                <Text selectable style={styles.ghostBtnText}>{busy === "analyze" ? "AI 识别中…" : view.galleryCount === 0 ? "公共图库还没有照片" : model.analyzedAt ? "让 AI 重新识别" : "让 AI 从图库识别"}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy !== undefined} onPress={() => setEditing(true)} style={styles.darkBtnWide}><Text selectable style={styles.darkBtnText}>编辑模型</Text></Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function draftOf(model: UserModel): Record<UserModelField, string> {
  return {
    heightCm: model.heightCm !== undefined ? String(model.heightCm) : "",
    weightKg: model.weightKg !== undefined ? String(model.weightKg) : "",
    age: model.age !== undefined ? String(model.age) : "",
    bodyType: model.bodyType ?? "",
    skinTone: model.skinTone ?? "",
    hair: model.hair ?? "",
  };
}

const styles = StyleSheet.create({
  section: { marginBottom: 26 },
  head: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  titleWrap: { alignItems: "center", flexDirection: "row", gap: 8 },
  title: { color: "#1a1a1a", fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },
  action: { color: "#8A8A8E", fontSize: 13, fontWeight: "700" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 22, gap: 10, padding: 18, shadowColor: "#140a32", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12 },
  cardHead: { alignItems: "center", flexDirection: "row", gap: 14, marginBottom: 6 },
  avatar: { alignItems: "center", backgroundColor: "#E6E2EE", justifyContent: "center", overflow: "hidden" },
  avatarText: { color: "#6b6480", fontWeight: "800" },
  info: { flex: 1, minWidth: 0 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 7, marginBottom: 5 },
  name: { color: "#1a1a1a", flexShrink: 1, fontSize: 18, fontWeight: "800", letterSpacing: -0.4 },
  badge: { backgroundColor: "#F1E8FF", borderRadius: 5, color: PURPLE, fontSize: 9, fontWeight: "800", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 3 },
  desc: { color: "#8A8A8E", fontSize: 13, fontWeight: "500" },
  arrow: { color: "#C8C8CC", fontSize: 24 },
  status: { alignItems: "center", backgroundColor: "#F5EFFF", borderRadius: 13, flexDirection: "row", gap: 10, paddingHorizontal: 13, paddingVertical: 11 },
  statusDot: { backgroundColor: "#8B5CF6", borderRadius: 4, height: 7, width: 7 },
  statusText: { color: "#5A3FA8", flex: 1, fontSize: 12, fontWeight: "700" },
  strong: { color: "#4C1D95", fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: "#F5F4F8", borderRadius: 9, color: "#5A5A60", fontSize: 11.5, fontWeight: "700", overflow: "hidden", paddingHorizontal: 11, paddingVertical: 6 },
  chipPrimary: { backgroundColor: "#1a1a1a", color: "#FFFFFF" },
  chipPending: { backgroundColor: "#FFF4D6", color: "#A06A2C" },
  muted: { color: "#8A8A8E", fontSize: 13, lineHeight: 19 },
  darkBtn: { alignSelf: "flex-start", backgroundColor: "#1a1a1a", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8 },
  darkBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", textAlign: "center" },
  sheet: { backgroundColor: "#EFEDF4", flex: 1 },
  sheetHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 18 },
  sheetTitle: { color: "#1a1a1a", fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  close: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 16, height: 32, justifyContent: "center", width: 32 },
  closeText: { color: "#5a5a60", fontSize: 14, fontWeight: "800" },
  sheetBody: { gap: 14, paddingBottom: 40, paddingHorizontal: 20 },
  hero: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 22, gap: 6, paddingBottom: 20, paddingTop: 24 },
  heroName: { color: "#1a1a1a", fontSize: 22, fontWeight: "800", letterSpacing: -0.5, marginTop: 8 },
  heroSub: { color: "#8A8A8E", fontSize: 12.5, fontWeight: "500" },
  bind: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 16, flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  bindIcon: { alignItems: "center", backgroundColor: "#EBDfFF", borderRadius: 11, height: 38, justifyContent: "center", width: 38 },
  bindIconText: { color: "#8B5CF6", fontSize: 18 },
  bindTitle: { color: "#1a1a1a", fontSize: 13, fontWeight: "800", marginBottom: 3 },
  bindDesc: { color: "#8A8A8E", fontSize: 11.5, fontWeight: "500" },
  sectionTitleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4, paddingTop: 6 },
  sectionTitle: { color: "#8A8A8E", fontSize: 11.5, fontWeight: "800", letterSpacing: 0.5 },
  aiTag: { backgroundColor: "#F1E8FF", borderRadius: 5, color: PURPLE, fontSize: 9.5, fontWeight: "800", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3 },
  featureList: { backgroundColor: "#FFFFFF", borderRadius: 16, overflow: "hidden" },
  featureRow: { alignItems: "center", borderBottomColor: "#F5F4F8", borderBottomWidth: 1, flexDirection: "row", minHeight: 50, paddingHorizontal: 16, paddingVertical: 12 },
  featureRowLast: { borderBottomWidth: 0 },
  featureLabel: { color: "#5A5A60", fontSize: 13, fontWeight: "700", minWidth: 60 },
  featureValue: { color: "#1a1a1a", flex: 1, fontSize: 14, fontWeight: "800", textAlign: "right" },
  featureValuePending: { color: "#A06A2C" },
  featureInput: { backgroundColor: "#F5F4F8", borderRadius: 10, color: "#1a1a1a", flex: 1, fontSize: 14, fontWeight: "700", paddingHorizontal: 10, paddingVertical: 8, textAlign: "right" },
  source: { borderRadius: 5, fontSize: 9.5, fontWeight: "800", marginLeft: 10, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3 },
  sourceAi: { backgroundColor: "#F1E8FF", color: PURPLE },
  sourceManual: { backgroundColor: "#FFF4D6", color: "#A06A2C" },
  safety: { alignItems: "center", backgroundColor: "#FFF8E6", borderLeftColor: "#FFB800", borderLeftWidth: 3, borderRadius: 14, flexDirection: "row", gap: 11, paddingHorizontal: 16, paddingVertical: 14 },
  safetyTitle: { color: "#5C3A00", fontSize: 12.5, fontWeight: "800", marginBottom: 3 },
  safetyText: { color: "#7C5210", fontSize: 12, lineHeight: 18 },
  notice: { color: "#5A3FA8", fontSize: 12.5, fontWeight: "700", textAlign: "center" },
  actionRow: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  darkBtnWide: { backgroundColor: "#1a1a1a", borderRadius: 16, paddingVertical: 16 },
  ghostBtn: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 16, paddingVertical: 16 },
  ghostBtnWide: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 16, paddingVertical: 16 },
  ghostBtnText: { color: "#1a1a1a", fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.5 },
});
