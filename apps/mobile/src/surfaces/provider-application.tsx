import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { color } from "../theme";
import { sessionAuthClient } from "../native-clients";
import type { MediaClient } from "../media-client";
import { ProxyLoading } from "../components/proxy-foundation";
import { CircularAvatarImage } from "../components/circular-avatar-image";
import {
  GENDER_OPTIONS, fetchProviderApplication, kycPipeline, providerApplicationErrorText,
  providerApplicationStatusCard, submitProviderApplication, withdrawProviderApplication,
  type ProviderApplicationInput, type ProviderApplicationView,
} from "../provider-application-client";

// ORDER-PERMISSION-KYC-001（原型 deepseek_html_20260924_33987c「接单中心 · KYC + 履约管线」）：
// 开始前 → 1 基础信息 → 2 证件 + 手持证件自拍 + 声明 → 3 履约条款 → 提交 → 运营人工审核。
// 任何人都能申请，性别是可选自述、不参与任何判断。
// 与原型的差异（都是为了不说假话）：
//   - 没有「Face ID 扫脸 / 真人比对通过」：Face ID 只能证明是手机主人，不能和证件比对 —— 改为手持证件自拍，运营人工比对；
//   - 没有「获取验证码」：开发环境短信通道没接（sms=false），手机号如实记为「未验证」，运营电话核实；
//   - 不写「24 小时内出结果 / 自动比对」：审核是人工的，没有时效承诺。

type Step = "intro" | "basic" | "documents" | "terms";
type DocSlot = "front" | "back" | "selfie";
type Doc = { mediaAssetId: string; uri: string };

// ORDER-PERMISSION-KYC-003（原型 807348；用户：「把会说的语言也放入了 干什么」）：KYC 只认人 ——
// 第 1 步只有头像、实名、出生年份、性别（可选）、手机号；城市 / 服务区域 / 语言是接单范围和能力，不在 KYC 里。
export function ProviderApplicationSurface({ mediaClient, avatarUri, displayName, onEditProfile, onBack }: {
  mediaClient?: MediaClient | undefined;
  avatarUri?: string | undefined;
  displayName?: string | undefined;
  onEditProfile?: (() => void) | undefined;
  // KYC-CENTER-001：接单中心包着表单时用，回到中心首页。不传就没有返回行。
  onBack?: (() => void) | undefined;
}): React.JSX.Element {
  const [view, setView] = useState<ProviderApplicationView>();
  const [loadError, setLoadError] = useState<string>();
  const [step, setStep] = useState<Step>("intro");
  const [busy, setBusy] = useState<"submit" | "withdraw" | DocSlot>();
  const [error, setError] = useState<string>();
  const [realName, setRealName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [gender, setGender] = useState<ProviderApplicationInput["gender"]>("");
  const [phone, setPhone] = useState("");
  const [idType, setIdType] = useState<"CCCD" | "PASSPORT">("CCCD");
  const [docs, setDocs] = useState<Partial<Record<DocSlot, Doc>>>({});
  const [noCrime, setNoCrime] = useState(false);
  const [dataConsent, setDataConsent] = useState(false);
  const [emergency, setEmergency] = useState("");
  const [accepted, setAccepted] = useState<string[]>([]);
  // KYC-CENTER-001：Step 1 行内错误 —— 空名/年份格式/未成年/空电话在客户端先拦，
  // 免得走一次服务端往返才知道；格式争议一律以服务端为准（这里只拦明显错的）。
  const [basicErrors, setBasicErrors] = useState<{ realName?: string; birthYear?: string; phone?: string }>({});
  function validateBasic(): boolean {
    const errors: { realName?: string; birthYear?: string; phone?: string } = {};
    if (realName.trim().length < 2) errors.realName = "请填写真实姓名（至少 2 个字）";
    const year = Number.parseInt(birthYear.trim(), 10);
    const thisYear = new Date().getFullYear();
    if (!/^\d{4}$/.test(birthYear.trim()) || year < 1900 || year > thisYear) {
      errors.birthYear = "出生年份填 4 位数字";
    } else if (thisYear - year < 18) {
      errors.birthYear = "接单需年满 18 岁";
    }
    if (phone.trim() === "") errors.phone = "请填写手机号";
    setBasicErrors(errors);
    return Object.keys(errors).length === 0;
  }

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

  // 证件 / 自拍上传后保持 OWNER_ONLY（不挂到任何帖子），只有运营控制台能看。
  const pickDoc = async (slot: DocSlot): Promise<void> => {
    if (!mediaClient) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9, selectionLimit: 1 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    setBusy(slot);
    setError(undefined);
    try {
      const uploaded = await mediaClient.uploadImage({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg", width: asset.width, height: asset.height });
      setDocs((current) => ({ ...current, [slot]: { mediaAssetId: uploaded.mediaAssetId, uri: asset.uri } }));
    } catch {
      setError("上传失败，请重试。");
    } finally {
      setBusy(undefined);
    }
  };

  const submit = async (): Promise<void> => {
    if (!view?.terms) return;
    setBusy("submit");
    setError(undefined);
    try {
      setView(await submitProviderApplication(sessionAuthClient, {
        realName, birthYear: Number.parseInt(birthYear, 10) || 0, gender, phone,
        idType, idFrontAsset: docs.front?.mediaAssetId ?? "", idBackAsset: idType === "CCCD" ? docs.back?.mediaAssetId ?? "" : "",
        selfieAsset: docs.selfie?.mediaAssetId ?? "", noCrimeDeclared: noCrime, dataConsent, emergencyContact: emergency,
        termsVersion: view.terms.version, termsAccepted: accepted,
      }));
      setStep("intro");
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
  const check = (on: boolean, set: (v: boolean) => void, title: string, body?: string, note?: string) => (
    <Pressable accessibilityLabel={`${title}${on ? "，已勾选" : ""}`} key={title} onPress={() => set(!on)} style={s.check}>
      <View style={[s.box, on && s.boxOn]}>{on ? <Text selectable style={s.boxTick}>✓</Text> : null}</View>
      <View style={s.checkCopy}>
        <Text selectable style={s.checkTitle}>{title}</Text>
        {body ? <Text selectable style={s.muted}>{body}</Text> : null}
        {note ? <Text selectable style={s.note}>{note}</Text> : null}
      </View>
    </Pressable>
  );
  const docTile = (slot: DocSlot, label: string, hint: string) => {
    const doc = docs[slot];
    return <Pressable accessibilityLabel={`${label}${doc ? "，已上传" : ""}`} disabled={!mediaClient || busy !== undefined} key={slot} onPress={() => { void pickDoc(slot); }} style={s.doc}>
      {doc ? <Image contentFit="cover" source={{ uri: doc.uri }} style={s.docImage} /> : null}
      <View style={doc ? s.docLabelOn : s.docLabel}>
        <Text selectable style={[s.docTitle, doc && s.docTitleOn]}>{busy === slot ? "上传中…" : doc ? `${label} · 已上传` : label}</Text>
        {!doc ? <Text selectable style={s.muted}>{hint}</Text> : null}
      </View>
    </Pressable>;
  };
  const stepHead = (n: number, title: string, lead: string) => (
    <View style={s.stepHead}>
      <Text selectable style={s.stepNo}>{`${n} / 3`}</Text>
      <Text selectable style={s.cardTitle}>{title}</Text>
      <Text selectable style={s.muted}>{lead}</Text>
    </View>
  );
  const nav = (back: Step, next: () => void, nextLabel: string) => (
    <View style={s.navRow}>
      <Pressable onPress={() => { setError(undefined); setStep(back); }} style={[s.secondary, s.navBack]}><Text selectable style={s.secondaryText}>上一步</Text></Pressable>
      <Pressable accessibilityLabel={nextLabel} disabled={busy !== undefined} onPress={next} style={[s.primary, s.navNext, busy !== undefined && s.busy]}><Text selectable style={s.primaryText}>{nextLabel}</Text></Pressable>
    </View>
  );

  return (
    <View style={s.wrap}>
      {onBack ? <Pressable accessibilityLabel="返回接单中心" onPress={onBack} style={s.backRow}><Text selectable style={s.backText}>‹ 返回接单中心</Text></Pressable> : null}
      {step === "intro" ? <>
        {card ? <View style={s.card}>
          <Text selectable style={s.cardTitle}>{card.title}</Text>
          <Text selectable style={s.muted}>{card.detail}</Text>
          <View style={s.pipeline}>{kycPipeline(view.application).map((item) => (
            <View key={item.title} style={s.pipeRow}>
              <View style={[s.pipeDot, item.state === "done" && s.pipeDotDone, item.state === "active" && s.pipeDotActive, item.state === "failed" && s.pipeDotFailed]} />
              <View style={s.checkCopy}>
                <Text selectable style={s.checkTitle}>{item.title}</Text>
                <Text selectable style={s.muted}>{item.hint}</Text>
              </View>
              <Text selectable style={[s.pipeBadge, item.state === "failed" && s.error]}>{item.badge}</Text>
            </View>
          ))}</View>
          {card.canWithdraw ? <Pressable disabled={busy !== undefined} onPress={() => { void withdraw(); }} style={s.secondary}><Text selectable style={s.secondaryText}>{busy === "withdraw" ? "撤回中…" : "撤回申请"}</Text></Pressable> : null}
          {card.canReapply ? <Pressable onPress={() => setStep("basic")} style={s.primary}><Text selectable style={s.primaryText}>修改后重新提交</Text></Pressable> : null}
        </View> : <View style={s.card}>
          <Text selectable style={s.kicker}>开始前</Text>
          <Text selectable style={s.cardTitle}>KYC · 3 步走完</Text>
          <Text selectable style={s.muted}>基础信息 → 证件 + 手持证件自拍 → 履约条款。任何人都可以申请接单，性别不影响审核。</Text>
          <Text selectable style={s.bullet}>· 头像、实名、出生年份（需年满 18 岁）、手机号</Text>
          <Text selectable style={s.bullet}>· 身份证（正反面）或护照 + 一张手持证件的自拍，运营人工比对</Text>
          <Text selectable style={s.bullet}>· 审核由运营人工完成，结果显示在这里；不通过可以修改后重新提交</Text>
          <Text selectable style={s.fine}>提交的资料只用于 KYC 审核，不会公开给客户。</Text>
          <Pressable accessibilityLabel="开始填写" onPress={() => setStep("basic")} style={s.primary}><Text selectable style={s.primaryText}>开始填写</Text></Pressable>
        </View>}
      </> : null}

      {step === "basic" ? <View style={s.card}>
        {stepHead(1, "先填基础信息", "用于实名比对。")}
        <Pressable accessibilityLabel="头像，在个人管理里修改" disabled={!onEditProfile} onPress={onEditProfile} style={s.avatarRow}>
          <View style={s.avatarBox}>{avatarUri ? <CircularAvatarImage size={52} uri={avatarUri} /> : <Text selectable style={s.avatarLetter}>{(displayName ?? "").slice(0, 1).toUpperCase() || "?"}</Text>}</View>
          <View style={s.checkCopy}>
            <Text selectable style={s.checkTitle}>{avatarUri ? "头像" : "还没有头像"}</Text>
            <Text selectable style={s.muted}>正面清晰 · 别用滤镜 · 用你主页的头像，在「个人管理」里改</Text>
          </View>
          {onEditProfile ? <Text selectable style={s.pipeBadge}>›</Text> : null}
        </Pressable>
        <Text selectable style={s.label}>真实姓名 *</Text>
        <TextInput accessibilityLabel="真实姓名" onChangeText={(v) => { setRealName(v); setBasicErrors((p) => { const next = { ...p }; delete next.realName; return next; }); }} placeholder="与证件一致" placeholderTextColor={color.muted} style={[s.input, basicErrors.realName ? s.inputError : null]} value={realName} />
        {basicErrors.realName ? <Text selectable style={s.fieldError}>{basicErrors.realName}</Text> : null}
        <Text selectable style={s.label}>出生年份 *</Text>
        <TextInput accessibilityLabel="出生年份" keyboardType="number-pad" maxLength={4} onChangeText={(v) => { setBirthYear(v); setBasicErrors((p) => { const next = { ...p }; delete next.birthYear; return next; }); }} placeholder="例如 1998" placeholderTextColor={color.muted} style={[s.input, basicErrors.birthYear ? s.inputError : null]} value={birthYear} />
        {basicErrors.birthYear ? <Text selectable style={s.fieldError}>{basicErrors.birthYear}</Text> : null}
        <Text selectable style={s.label}>性别（可不填，不影响审核）</Text>
        <View style={s.chips}>{GENDER_OPTIONS.map((option) => <Pressable accessibilityLabel={`性别 ${option.label}${gender === option.code ? "，已选" : ""}`} key={option.label} onPress={() => setGender(option.code)} style={[s.chip, gender === option.code && s.chipOn]}><Text selectable style={[s.chipText, gender === option.code && s.chipTextOn]}>{option.label}</Text></Pressable>)}</View>
        <Text selectable style={s.label}>手机号 *</Text>
        <TextInput accessibilityLabel="手机号" keyboardType="phone-pad" onChangeText={(v) => { setPhone(v); setBasicErrors((p) => { const next = { ...p }; delete next.phone; return next; }); }} placeholder="09xx xxx xxx" placeholderTextColor={color.muted} style={[s.input, basicErrors.phone ? s.inputError : null]} value={phone} />
        {basicErrors.phone ? <Text selectable style={s.fieldError}>{basicErrors.phone}</Text> : null}
        <Text selectable style={s.note}>短信验证码暂未接入：手机号会标为「未验证」，运营审核时电话核实。</Text>
        {nav("intro", () => { setError(undefined); if (validateBasic()) setStep("documents"); }, "下一步 · 证件认证")}
      </View> : null}

      {step === "documents" ? <View style={s.card}>
        {stepHead(2, "证件认证", "上传身份证或护照，再拍一张手持证件的自拍。运营会把自拍、证件和你的头像放在一起人工比对。资料只用于 KYC 审核。")}
        <View style={s.chips}>{(["CCCD", "PASSPORT"] as const).map((type) => <Pressable accessibilityLabel={`${type === "CCCD" ? "身份证" : "护照"}${idType === type ? "，已选" : ""}`} key={type} onPress={() => setIdType(type)} style={[s.chip, idType === type && s.chipOn]}><Text selectable style={[s.chipText, idType === type && s.chipTextOn]}>{type === "CCCD" ? "身份证 CCCD" : "护照"}</Text></Pressable>)}</View>
        {docTile("front", "证件正面", "四角清晰、不反光")}
        {idType === "CCCD" ? docTile("back", "证件反面", "四角清晰、不反光") : null}
        {docTile("selfie", "手持证件自拍", "脸和证件都要拍清楚，别用滤镜")}
        {check(noCrime, setNoCrime, "无犯罪声明", "我承诺无犯罪记录，若违反将立即冻结并配合调查。此声明将电子留档。")}
        {check(dataConsent, setDataConsent, "同意 KYC 数据使用", "同意平台按《隐私政策》使用证件信息进行实名比对。")}
        {nav("basic", () => { setError(undefined); setStep("terms"); }, "下一步 · 履约条款")}
      </View> : null}

      {step === "terms" ? <View style={s.card}>
        {stepHead(3, "接受条款，正式接单", "这几条是接单身份的底线。接单后可以随时暂停接单。")}
        <Text selectable style={s.label}>紧急联系人 *（不对客户公开）</Text>
        <TextInput accessibilityLabel="紧急联系人" onChangeText={setEmergency} placeholder="姓名 + 电话" placeholderTextColor={color.muted} style={s.input} value={emergency} />
        {view.terms ? view.terms.items.map((item) => check(
          accepted.includes(item.id),
          () => toggle(accepted, setAccepted, item.id),
          item.title,
          item.body,
          item.enforced ? undefined : "这条规则的执行机制还没上线，上线后按此生效。",
        )) : <Text selectable style={s.error}>履约条款暂时读不到，稍后再试。</Text>}
        {nav("documents", () => { void submit(); }, busy === "submit" ? "提交中…" : "提交 KYC 审核")}
      </View> : null}

      {error ? <Text selectable style={s.error}>{error}</Text> : null}
    </View>
  );
}

// ORDER-PERMISSION-TWIN-001（用户：「有接单权限才开动 ai 分身」）：AI 分身页的门。服务端同样拦
// （建分身 / 模型读照片 / 代回复），这里只是把「为什么打不开、去哪开」说清楚，不靠前端藏入口当安全。
export function OrderPermissionGate({ children, onApply, onBack }: { children: React.ReactNode; onApply: () => void; onBack: () => void }): React.JSX.Element {
  const [state, setState] = useState<"loading" | "granted" | "locked" | "error">("loading");
  const [pending, setPending] = useState(false);
  const check = useCallback(() => {
    setState("loading");
    fetchProviderApplication(sessionAuthClient)
      .then((view) => {
        setPending(view.application?.status === "SUBMITTED");
        setState(view.application?.status === "APPROVED" ? "granted" : "locked");
      })
      .catch(() => setState("error"));
  }, []);
  useEffect(check, [check]);
  if (state === "granted") return <>{children}</>;
  return (
    <ScrollView contentContainerStyle={s.gatePage}>
      <Pressable accessibilityLabel="返回" onPress={onBack}><Text selectable style={s.gateBack}>‹ 返回</Text></Pressable>
      <Text selectable style={s.gateTitle}>AI 分身</Text>
      {state === "loading" ? <ProxyLoading label="正在确认KYC认证状态" tone="muted" /> : <View style={s.card}>
        <Text selectable style={s.cardTitle}>{state === "error" ? "暂时确认不了KYC认证状态" : pending ? "KYC认证审核中" : "完成KYC认证后才能用 AI 分身"}</Text>
        <Text selectable style={s.muted}>{state === "error"
          ? "网络或服务有问题，稍后再试。"
          : "AI 分身会用你的形象生成照片、视频，并在私聊里替你回复 —— 只对完成KYC认证的人开放。"}</Text>
        {state === "error" ? <Pressable onPress={check} style={s.secondary}><Text selectable style={s.secondaryText}>重试</Text></Pressable>
          : <Pressable accessibilityLabel={pending ? "查看KYC认证进度" : "去KYC认证"} onPress={onApply} style={s.primary}><Text selectable style={s.primaryText}>{pending ? "查看KYC认证进度" : "去KYC认证"}</Text></Pressable>}
      </View>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  gatePage: { gap: 12, paddingBottom: 40, paddingHorizontal: 16, paddingTop: 12 },
  backRow: { alignSelf: "flex-start", paddingVertical: 4 },
  backText: { color: color.magenta, fontSize: 13, fontWeight: "800" },
  gateBack: { color: color.magenta, fontSize: 13, fontWeight: "800" },
  gateTitle: { color: color.ink, fontSize: 22, fontWeight: "900" },
  wrap: { gap: 12, paddingBottom: 24 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, gap: 8, padding: 14 },
  kicker: { color: color.muted, fontSize: 11, fontWeight: "900" },
  cardTitle: { color: color.ink, fontSize: 17, fontWeight: "900" },
  muted: { color: color.muted, fontSize: 12.5, fontWeight: "700", lineHeight: 19 },
  bullet: { color: color.ink, fontSize: 12.5, fontWeight: "700", lineHeight: 19 },
  note: { color: color.muted, fontSize: 11, fontWeight: "800", lineHeight: 16 },
  fine: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 4 },
  label: { color: color.ink, fontSize: 12.5, fontWeight: "900", marginTop: 6 },
  input: { backgroundColor: color.surface, borderRadius: 12, color: color.ink, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  inputError: { borderColor: color.magenta, borderWidth: 1.5 },
  fieldError: { color: color.magenta, fontSize: 12, fontWeight: "800", marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: color.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: color.ink },
  chipText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  chipTextOn: { color: color.white },
  stepHead: { gap: 4, marginBottom: 4 },
  avatarRow: { alignItems: "center", backgroundColor: color.surface, borderRadius: 14, flexDirection: "row", gap: 12, padding: 10 },
  avatarBox: { alignItems: "center", backgroundColor: color.white, borderRadius: 26, height: 52, justifyContent: "center", overflow: "hidden", width: 52 },
  avatarLetter: { color: color.muted, fontSize: 20, fontWeight: "900" },
  pipeline: { gap: 10, marginTop: 6 },
  pipeRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  pipeDot: { backgroundColor: color.line, borderRadius: 6, height: 12, width: 12 },
  pipeDotDone: { backgroundColor: color.ink },
  pipeDotActive: { backgroundColor: color.lime },
  pipeDotFailed: { backgroundColor: color.magenta },
  pipeBadge: { color: color.muted, fontSize: 12, fontWeight: "900" },
  stepNo: { color: color.muted, fontSize: 11, fontWeight: "900" },
  doc: { backgroundColor: color.surface, borderRadius: 14, height: 120, marginTop: 6, overflow: "hidden" },
  docImage: { height: "100%", position: "absolute", width: "100%" },
  docLabel: { flex: 1, gap: 4, justifyContent: "center", paddingHorizontal: 14 },
  docLabelOn: { backgroundColor: "rgba(0,0,0,0.45)", bottom: 0, left: 0, paddingHorizontal: 12, paddingVertical: 6, position: "absolute", right: 0 },
  docTitle: { color: color.ink, fontSize: 13, fontWeight: "900" },
  docTitleOn: { color: color.white },
  check: { alignItems: "flex-start", flexDirection: "row", gap: 10, marginTop: 8 },
  checkCopy: { flex: 1, gap: 2 },
  checkTitle: { color: color.ink, fontSize: 13, fontWeight: "900" },
  box: { alignItems: "center", borderColor: color.ink, borderRadius: 5, borderWidth: 1.5, height: 20, justifyContent: "center", marginTop: 1, width: 20 },
  boxOn: { backgroundColor: color.ink },
  boxTick: { color: color.white, fontSize: 12, fontWeight: "900" },
  navRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  navBack: { flex: 1, marginTop: 0 },
  navNext: { flex: 2, marginTop: 0 },
  primary: { alignItems: "center", backgroundColor: color.ink, borderRadius: 14, marginTop: 8, paddingVertical: 13 },
  primaryText: { color: color.white, fontSize: 14, fontWeight: "900" },
  secondary: { alignItems: "center", borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 4, paddingVertical: 12 },
  secondaryText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  busy: { opacity: 0.5 },
  error: { color: color.magenta, fontSize: 12.5, fontWeight: "800", lineHeight: 19 },
});
