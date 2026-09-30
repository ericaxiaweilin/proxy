import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Defs, LinearGradient, Rect, Stop, Svg } from "react-native-svg";
import { Image } from "expo-image";
import { color } from "../theme";
import { sessionAuthClient } from "../native-clients";
import type { MediaClient } from "../media-client";
import { ProxyBackGlyph, ProxyLoading } from "../components/proxy-foundation";
import { KYC_LOGO } from "../media/asset-sources";
import { ProxyIcon } from "../components/proxy-icon";
import { CircularAvatarImage } from "../components/circular-avatar-image";
import {
  fetchProviderApplication, kycPipeline, providerApplicationErrorText,
  phoneDigitsError, formatPhoneInput, requestPhoneVerification, verifyPhoneVerification,
  providerApplicationStatusCard, submitProviderApplication, withdrawProviderApplication,
  type ProviderApplicationInput, type ProviderApplicationView,
} from "../provider-application-client";

// ORDER-PERMISSION-KYC-001（原型 deepseek_html_20260924_33987c「接单中心 · KYC + 履约管线」）：
// 开始前 → 1 基础信息 → 2 手机验证 → 3 声明 + 履约条款 → 提交 → 运营审核。
// 任何人都能申请，性别是可选自述、不参与任何判断。
//
// KYC-PHONE-ONLY-001（2026-09-27，用户：「证件正面 反面 手持自拍的移除在kyc里 越南合规这个隐私数据困难
// kyc我们就验证电话号码真实性就好了 签承诺声明不变」）：原第 2 步的 CCCD 正反面 + 手持证件自拍 + 运营人工
// 比对已删除——那类证件图像 / 生物特征比对在越南算高风险个人数据，而"运营看着像不像"从来也不是可审计的
// 验证。KYC 改成第 2 步真的发短信验证码、真的校验（走 internal/identity 同一套已配好的短信厂商）。
// 第 3 步的声明（无犯罪 + 数据使用同意 + 履约条款）机制不变，只是把原来挂在"证件"步骤下的两条声明
// 一起搬到这里——它们本来就是声明，不是照片。

type Step = "intro" | "basic" | "phone" | "terms";
// KYC-PHONE-ONLY-001：验证码这两步靠 busy（"phoneRequest"/"phoneVerify"）标"正在
// 请求网络"，phoneVerifyState 只用来记两个静止态：还没发过 / 已验证。
type PhoneVerifyState = "idle" | "sent" | "verified";

// ORDER-PERMISSION-KYC-003（原型 807348；用户：「把会说的语言也放入了 干什么」）：KYC 只认人 ——
// 第 1 步只有头像、实名、出生年份、性别（可选）、手机号；城市 / 服务区域 / 语言是接单范围和能力，不在 KYC 里。
export function ProviderApplicationSurface({ mediaClient, avatarUri, displayName, onEditProfile }: {
  mediaClient?: MediaClient | undefined;
  avatarUri?: string | undefined;
  displayName?: string | undefined;
  onEditProfile?: (() => void) | undefined;
}): React.JSX.Element {
  const [view, setView] = useState<ProviderApplicationView>();
  const [loadError, setLoadError] = useState<string>();
  const [step, setStep] = useState<Step>("intro");
  const [busy, setBusy] = useState<"submit" | "withdraw" | "phoneRequest" | "phoneVerify">();
  const [error, setError] = useState<string>();
  const [realName, setRealName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  // KYC-UI-CLEAN-002（用户：「正常的 kyc 到底验证性别出生吗」）：正常 KYC 不采性别 ——
  // 性别不参与实名比对。后端 gender 字段保留兼容但不再收，这里永远发空。
  const [phone, setPhone] = useState("");
  // KYC-PHONE-ONLY-001：真的验证码状态机——idle（还没发）→ sent（已发，等输入）→
  // verifying（正在校验）→ verified（验对了，challengeId 就是能塞进 Submit 的那张挑战单）。
  const [phoneVerifyState, setPhoneVerifyState] = useState<PhoneVerifyState>("idle");
  const [phoneChallengeId, setPhoneChallengeId] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [phoneError, setPhoneError] = useState<string>();
  const [noCrime, setNoCrime] = useState(false);
  const [dataConsent, setDataConsent] = useState(false);
  const [emergency, setEmergency] = useState("");
  const [accepted, setAccepted] = useState<string[]>([]);
  // KYC-BIRTH-DATE-001：出生日期精确到日，客户端先拦明显错的（格式/不存在的日期/未成年/未来），
  // 服务端按精确年龄重算（这里只拦明显错的，边界以服务端为准）。
  // KYC-BIRTH-DATE-002（用户：「出生日期自动隔断」）：只管输数字，隔断自动补 ——
  // 20010520 → 2001-05-20。按纯数字重排，所以退格也是自然的。
  function formatBirthDateInput(value: string): string {
    const digits = value.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  }
  function parseBirthDate(value: string): { year: number; month: number; day: number } | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return undefined;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
    return { year, month, day };
  }
  const [basicErrors, setBasicErrors] = useState<{ realName?: string; birthDate?: string; phone?: string }>({});
  function validateBasic(): boolean {
    const errors: { realName?: string; birthDate?: string; phone?: string } = {};
    if (realName.trim().length < 2) errors.realName = "请填写真实姓名（至少 2 个字）";
    const birth = parseBirthDate(birthDate);
    if (!birth) {
      errors.birthDate = "出生日期按 2001-05-20 的格式填";
    } else {
      const today = new Date();
      let age = today.getFullYear() - birth.year;
      if (today.getMonth() + 1 < birth.month || (today.getMonth() + 1 === birth.month && today.getDate() < birth.day)) age--;
      if (age < 0 || age > 90) errors.birthDate = "出生日期不在合理范围";
      else if (age < 18) errors.birthDate = "接单需年满 18 岁";
    }
    if (phone.trim() === "") errors.phone = "请填写手机号";
    else {
      const phoneError = phoneDigitsError(phone);
      if (phoneError) errors.phone = phoneError;
    }
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

  // KYC-PHONE-ONLY-001：真的发验证码。手机号一变就作废旧的验证结果——
  // 不然可能出现"验证的是 A 号，Submit 时手机框已经改成 B 号"这种错配
  // （服务端 Submit 也会重查一遍手机号是否跟挑战单一致，这里是提前告诉用户）。
  const sendPhoneCode = async (): Promise<void> => {
    setBusy("phoneRequest");
    setPhoneError(undefined);
    try {
      const challenge = await requestPhoneVerification(sessionAuthClient, phone);
      setPhoneChallengeId(challenge.challengeId);
      setPhoneVerifyState("sent");
      setOtpCode("");
    } catch (e) {
      setPhoneError(providerApplicationErrorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  const checkPhoneCode = async (): Promise<void> => {
    if (otpCode.trim() === "") { setPhoneError("请填写验证码"); return; }
    setBusy("phoneVerify");
    setPhoneError(undefined);
    try {
      const verified = await verifyPhoneVerification(sessionAuthClient, phoneChallengeId, otpCode.trim());
      if (verified) setPhoneVerifyState("verified");
      else setPhoneError("验证码不对，请重试");
    } catch (e) {
      setPhoneError(providerApplicationErrorText(e));
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
        realName, birthDate: birthDate.trim(), gender: "", phone,
        phoneChallengeId, noCrimeDeclared: noCrime, dataConsent, emergencyContact: emergency,
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
  const stepHead = (n: number, title: string, lead: string) => (
    <View style={s.stepHead}>
      <Text selectable style={s.stepNo}>{`${n} / 3`}</Text>
      <View style={s.segRow}>{[1, 2, 3].map((i) => (
        <View key={i} style={[s.seg, i < n && s.segDone, i === n && s.segOn]} />
      ))}</View>
      <Text selectable style={s.cardTitle}>{title}</Text>
      <Text selectable style={s.muted}>{lead}</Text>
    </View>
  );
  const nav = (back: Step, next: () => void, nextLabel: string, nextDisabled?: boolean) => (
    <View style={s.navRow}>
      <Pressable onPress={() => { setError(undefined); setStep(back); }} style={[s.secondary, s.navBack]}><Text selectable style={s.secondaryText}>上一步</Text></Pressable>
      <Pressable accessibilityLabel={nextLabel} disabled={busy !== undefined || nextDisabled} onPress={next} style={[s.primary, s.navNext, (busy !== undefined || nextDisabled) && s.busy]}><Text selectable style={s.primaryText}>{nextLabel}</Text></Pressable>
    </View>
  );

  return (
    <View style={s.wrap}>
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
        </View> : <View style={s.introGap}>
          <View style={s.hero}>
            <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="kycHero" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor="#1E1B16" />
                  <Stop offset="1" stopColor="#2E2A24" />
                </LinearGradient>
              </Defs>
              <Rect height="100%" rx={18} ry={18} width="100%" x="0" y="0" fill="url(#kycHero)" />
            </Svg>
            {KYC_LOGO ? <View style={s.heroLogo}><Image contentFit="cover" source={KYC_LOGO} style={s.heroLogoImage} transition={0} /></View> : null}
            <Text selectable style={s.heroKicker}>KYC · 3 步走完</Text>
            <Text selectable style={s.heroTitle}>轻认证，不卡你</Text>
            <Text selectable style={s.heroSub}>基础信息 + 手机验证 + 条款。</Text>
          </View>
          <View style={s.infoCard}>
            <View style={s.infoRow}>
              <View style={[s.infoTile, s.infoTileTime]}><ProxyIcon color={color.ink} name="clock" size={17} /></View>
              <View style={s.checkCopy}>
                <Text selectable style={s.checkTitle}>3–5 分钟填完</Text>
                <Text selectable style={s.muted}>本人手机号 + 一条真的验证码</Text>
              </View>
            </View>
            <View style={s.infoRowLast}>
              <View style={[s.infoTile, s.infoTileHuman]}><ProxyIcon color={color.ink} name="user" size={17} /></View>
              <View style={s.checkCopy}>
                <Text selectable style={s.checkTitle}>运营审核</Text>
                <Text selectable style={s.muted}>结果显示在这里，不通过可重提</Text>
              </View>
            </View>
          </View>
          <Text selectable style={s.fine}>提交资料仅用于 KYC 审核，不会公开给客户。</Text>
          <Pressable accessibilityLabel="开始填写" onPress={() => setStep("basic")} style={s.primary}><Text selectable style={s.primaryText}>开始填写 ›</Text></Pressable>
        </View>}
      </> : null}

      {step === "basic" ? <View style={s.card}>
        {stepHead(1, "先填基础信息", "用于实名比对。")}
        <Pressable accessibilityLabel="头像，在个人管理里修改" disabled={!onEditProfile} onPress={onEditProfile} style={s.avatarRow}>
          <View style={s.avatarBox}>{avatarUri ? <CircularAvatarImage size={52} uri={avatarUri} /> : <Text selectable style={s.avatarLetter}>{(displayName ?? "").slice(0, 1).toUpperCase() || "?"}</Text>}</View>
          <View style={s.checkCopy}>
            <Text selectable style={s.checkTitle}>{avatarUri ? "头像" : "还没有头像"}</Text>
            <Text selectable style={s.muted}>正面清晰 · 别用滤镜 · 在「个人管理」里改</Text>
          </View>
          {onEditProfile ? <Text selectable style={s.pipeBadge}>›</Text> : null}
        </Pressable>
        <Text selectable style={s.label}>真实姓名 *</Text>
        <TextInput accessibilityLabel="真实姓名" onChangeText={(v) => { setRealName(v); setBasicErrors((p) => { const next = { ...p }; delete next.realName; return next; }); }} style={[s.input, basicErrors.realName ? s.inputError : null]} value={realName} />
        {basicErrors.realName ? <Text selectable style={s.fieldError}>{basicErrors.realName}</Text> : null}
        <Text selectable style={s.label}>出生日期 *</Text>
        <TextInput accessibilityLabel="出生日期" keyboardType="number-pad" maxLength={10} onChangeText={(v) => { setBirthDate(formatBirthDateInput(v)); setBasicErrors((p) => { const next = { ...p }; delete next.birthDate; return next; }); }} placeholder="20010520" placeholderTextColor={color.muted} style={[s.input, basicErrors.birthDate ? s.inputError : null]} value={birthDate} />
        {basicErrors.birthDate ? <Text selectable style={s.fieldError}>{basicErrors.birthDate}</Text> : null}
        <Text selectable style={s.label}>手机号 *</Text>
        <TextInput accessibilityLabel="手机号" keyboardType="phone-pad" maxLength={15} onChangeText={(v) => {
          setPhone(formatPhoneInput(v));
          setBasicErrors((p) => { const next = { ...p }; delete next.phone; return next; });
          // 手机号一变，之前那次验证就跟这个号不是一回事了——重置，逼着重新走一遍。
          if (phoneVerifyState !== "idle") { setPhoneVerifyState("idle"); setPhoneChallengeId(""); setOtpCode(""); }
        }} placeholder="09xx xxx xxx" placeholderTextColor={color.muted} style={[s.input, basicErrors.phone ? s.inputError : null]} value={phone} />
        {basicErrors.phone ? <Text selectable style={s.fieldError}>{basicErrors.phone}</Text> : null}
        <Text selectable style={s.note}>下一步会给这个号发一条真的验证码。</Text>
        {nav("intro", () => { setError(undefined); if (validateBasic()) setStep("phone"); }, "下一步 · 手机验证")}
      </View> : null}

      {step === "phone" ? <View style={s.card}>
        {stepHead(2, "手机验证", "验证这个号真的是你在用的。")}
        <View style={s.checkCopy}>
          <Text selectable style={s.checkTitle}>{phone || "还没填手机号"}</Text>
          <Text selectable style={s.muted}>{phoneVerifyState === "verified" ? "已验证" : "验证码有效期 5 分钟"}</Text>
        </View>
        {phoneVerifyState !== "verified" ? (
          <Pressable accessibilityLabel={phoneVerifyState === "sent" ? "重新获取验证码" : "获取验证码"} disabled={busy !== undefined || phone.trim() === ""} onPress={() => { void sendPhoneCode(); }} style={[s.secondary, busy === "phoneRequest" && s.busy]}>
            <Text selectable style={s.secondaryText}>{busy === "phoneRequest" ? "发送中…" : phoneVerifyState === "sent" ? "重新获取验证码" : "获取验证码"}</Text>
          </Pressable>
        ) : null}
        {phoneVerifyState === "sent" ? <>
          <Text selectable style={s.label}>验证码 *</Text>
          <TextInput accessibilityLabel="验证码" keyboardType="number-pad" maxLength={6} onChangeText={setOtpCode} placeholder="6 位数字" placeholderTextColor={color.muted} style={s.input} value={otpCode} />
          <Pressable accessibilityLabel="验证" disabled={busy !== undefined || otpCode.trim() === ""} onPress={() => { void checkPhoneCode(); }} style={[s.primary, busy === "phoneVerify" && s.busy]}>
            <Text selectable style={s.primaryText}>{busy === "phoneVerify" ? "验证中…" : "验证"}</Text>
          </Pressable>
        </> : null}
        {phoneVerifyState === "verified" ? <Text selectable style={s.note}>✓ 手机号已验证</Text> : null}
        {phoneError ? <Text selectable style={s.fieldError}>{phoneError}</Text> : null}
        {nav("basic", () => { setError(undefined); setStep("terms"); }, "下一步 · 声明与条款", phoneVerifyState !== "verified")}
      </View> : null}

      {step === "terms" ? <View style={s.card}>
        {stepHead(3, "接受条款，正式接单", "接单后可以随时暂停接单。")}
        <Text selectable style={s.label}>紧急联系人 *（不对客户公开）</Text>
        <TextInput accessibilityLabel="紧急联系人" onChangeText={setEmergency} placeholder="姓名 + 电话" placeholderTextColor={color.muted} style={s.input} value={emergency} />
        {check(noCrime, setNoCrime, "无犯罪声明", "我承诺无犯罪记录，若违反将立即冻结并配合调查。此声明将电子留档。")}
        {check(dataConsent, setDataConsent, "同意 KYC 数据使用", "同意平台按《隐私政策》使用手机验证结果与本人资料进行 KYC 审核。")}
        {view.terms ? view.terms.items.map((item) => check(
          accepted.includes(item.id),
          () => toggle(accepted, setAccepted, item.id),
          item.title,
          item.body,
          item.enforced ? undefined : "这条规则的执行机制还没上线，上线后按此生效。",
        )) : <Text selectable style={s.error}>没能加载履约条款，刷新再试。</Text>}
        {nav("phone", () => { void submit(); }, busy === "submit" ? "提交中…" : "提交 KYC 审核", !noCrime || !dataConsent)}
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
      <Pressable accessibilityLabel="返回" onPress={onBack}><ProxyBackGlyph /></Pressable>
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
  // gateBack 已删：字形由公共组件 ProxyBackGlyph 画（BACK-GLYPH-001）。
  gateTitle: { color: color.ink, fontSize: 22, fontWeight: "900" },
  wrap: { gap: 12, paddingBottom: 24 },
  introGap: { gap: 14 },
  hero: { borderRadius: 18, gap: 8, overflow: "hidden", paddingHorizontal: 20, paddingVertical: 24 },
  heroLogo: { backgroundColor: color.white, borderRadius: 16, height: 64, overflow: "hidden", width: 64 },
  heroLogoImage: { height: "100%", width: "100%" },
  heroKicker: { color: "#A79EAF", fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  heroTitle: { color: color.white, fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  heroSub: { color: "#D8D1E0", fontSize: 12.5, fontWeight: "600", lineHeight: 20 },
  infoCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 6 },
  infoRow: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 13, paddingVertical: 14 },
  infoRowLast: { alignItems: "center", flexDirection: "row", gap: 13, paddingVertical: 14 },
  infoTile: { alignItems: "center", borderRadius: 11, height: 36, justifyContent: "center", width: 36 },
  infoTileTime: { backgroundColor: color.warn },
  infoTileHuman: { backgroundColor: color.stateInfoBg },
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
  stepHead: { gap: 4, marginBottom: 4 },
  segRow: { flexDirection: "row", gap: 6, marginVertical: 6 },
  seg: { backgroundColor: color.line, borderRadius: 2, flex: 1, height: 4 },
  segDone: { backgroundColor: color.ink },
  segOn: { backgroundColor: color.magenta },
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
