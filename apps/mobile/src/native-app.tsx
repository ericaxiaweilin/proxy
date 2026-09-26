import { useEffect, useState } from "react";
import { Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import Svg, { Path } from "react-native-svg";
import { restoreAppShell, resolveInitialRoute, type AppShellState } from "./app-shell";
import { type Transport, SessionAuthClient } from "./auth-client";
import { ConversationClient } from "./conversation-client";
import { DemandClient } from "./demand-client";
import { LoginClient, LoginCommandRejectedError, otpRetryAfterSeconds } from "./login-client";
import { LegalDocClient, type LegalDoc, type LegalDocKind } from "./legal-doc";
import { LegalDocRenderer } from "./legal-doc-render";
import { LegalStatusClient } from "./legal-status-client";
import { formatVietnamesePhoneForDisplay, normalizeVietnamesePhone, vietnamesePhoneReady } from "./vn-phone";
import { MAX_LOGIN_EMAIL_LENGTH, normalizeLoginEmail } from "./email-identifier";
import { formatDateOfBirthInput, getDateOfBirthError } from "./date-of-birth-input";
import { googleAuthConfigured, type GoogleClientConfig } from "./google-auth-config";
import { LocalNetClient } from "./localnet-client";
import { MediaClient } from "./media-client";
import { ActivityClient } from "./activity-client";
import { ExperienceClient } from "./experience-client";
import { VoucherClient } from "./voucher-client";
import { EngagementClient } from "./engagement-client";
import { ModerationClient } from "./moderation-client";
import { MarketplaceClient } from "./marketplace-client";
import { SocialSpaceClient } from "./socialspace-client";
import { FulfillmentClient } from "./fulfillment-client";
import { PaymentClient } from "./payment-client";
import { NotificationClient } from "./notification-client";
import { BusinessClient } from "./business-client";
import { ProfileClient } from "./profile-client";
import { SessionClient } from "./session-client";
import { AIAccountClient } from "./ai-account-client";
import { RelationshipClient } from "./relationship-client";
import { SceneClient } from "./scene-client";
import { SupplyClient } from "./supply-client";
import { SocialSettingsClient } from "./social-settings-client";
import { nativeSecureStorageDriver } from "./native-secure-storage";
import { createLastSignInStore, maskIdentifier, avatarLetterFor, type LastSignIn } from "./last-signin-store";
import { AppShell } from "./shell/app-shell";
import { color, Gradient, shadows } from "./theme";
import { sessionAuthClient, localApiBaseUrl, nativeSecureSessionStore } from "./native-clients";
import { SECURE_SESSION_STORAGE_KEY } from "./secure-session";
import { getOrCreateDeviceIdentity, rotateDeviceIdentity, INSTALLATION_DEVICE_ID_KEY } from "./device-credential";
import { ProxyButton, ProxyLoading } from "./components/proxy-foundation";

const APP_VERSION = "1.0.0";

const absoluteFillStyle = { bottom: 0, left: 0, position: "absolute" as const, right: 0, top: 0 };

WebBrowser.maybeCompleteAuthSession();

const secureSessionStore = nativeSecureSessionStore;
// R15.36: 历史登录账户 — UI hint 存储层 (avatar + 脱敏 identifier)。
const lastSignInStore = createLastSignInStore(nativeSecureStorageDriver);
const nativeTransport: Transport = async (request) => {
  const headers: Record<string, string> = {};
  const src: unknown = request.headers;
  if (src) {
    if (typeof Headers !== "undefined" && src instanceof Headers) {
      src.forEach((v, k) => { headers[k] = v; });
    } else if (typeof src === "object") {
      Object.assign(headers, src as Record<string, string>);
    }
  }
  headers["X-Proxy-App-Version"] = APP_VERSION;
  const response = await fetch(request.url, {
    method: request.method,
    headers,
    ...(request.body !== undefined ? { body: request.body } : {})
  });
  return { status: response.status, json: () => response.json() };
};
let nativeLoginClient: LoginClient | undefined;
async function getNativeLoginClient(): Promise<LoginClient> {
  if (nativeLoginClient) return nativeLoginClient;
  const { deviceId, deviceCredential } = await getOrCreateDeviceIdentity(nativeSecureStorageDriver);
  nativeLoginClient = new LoginClient({ baseUrl: localApiBaseUrl, deviceId, deviceCredential, secureSessionStore, transport: nativeTransport });
  return nativeLoginClient;
}

async function rotateGuestDeviceIdentity(): Promise<LoginClient> {
  await rotateDeviceIdentity(nativeSecureStorageDriver);
  // 重建 client 并更新 module-level cache, 避免后续调用仍用旧 deviceId
  nativeLoginClient = undefined;
  const client = await getNativeLoginClient();
  nativeLoginClient = client;
  return client;
}

const GUEST_FLAG_KEY = "proxy.isGuest.v1";
async function createNativeGuestSession(): Promise<void> {
  const platform = Platform.OS === "ios" ? "IOS" : "ANDROID";
  try {
    await (await getNativeLoginClient()).createAnonymousSession(platform);
    await nativeSecureStorageDriver.setItem(GUEST_FLAG_KEY, "1");
    return;
  } catch (error) {
    if (error instanceof LoginCommandRejectedError && error.result.error?.errorCode === "ACCOUNT_NOT_ACTIVE") {
      try {
        await (await rotateGuestDeviceIdentity()).createAnonymousSession(platform);
        await nativeSecureStorageDriver.setItem(GUEST_FLAG_KEY, "1");
        return;
      } catch {}
    }
    // 访客必须可用：API 不可达/限流/服务端错误时降级为本地离线访客，不阻塞浏览
    const deviceId = (await nativeSecureStorageDriver.getItem(INSTALLATION_DEVICE_ID_KEY)) ?? `guest_${Date.now().toString(36)}`;
    const guestUserId = `guest_${deviceId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`;
    const now = new Date();
    const offlineSession = {
      userAccountId: guestUserId,
      principal: { type: "INDIVIDUAL" as const, id: guestUserId },
      // R15.34.1: 标记这是本地离线 fallback session，server 端
      //   没有这条记录，accessToken 是 fake — 不能发写命令 (CreatePost
      //   / Engagement / Demand 等)。读匿名路径仍可用。
      serverSession: false,
      auth: {
        sessionId: `sess_offline_${Date.now().toString(36)}`,
        userAccountId: guestUserId,
        principal: { type: "INDIVIDUAL" as const, id: guestUserId },
        accessToken: `offline_${Math.random().toString(36).slice(2)}`,
        refreshToken: `offline_r_${Math.random().toString(36).slice(2)}`,
        accessExpiresAt: new Date(now.getTime() + 3600_000).toISOString(),
        refreshExpiresAt: new Date(now.getTime() + 30 * 86400_000).toISOString(),
        rotation: 1,
      },
    };
    await secureSessionStore.write(offlineSession as any);
    await nativeSecureStorageDriver.setItem(GUEST_FLAG_KEY, "1");
  }
}

async function ensureNativeGuestSession(): Promise<void> {
  try {
    const stored = await secureSessionStore.read();
    if (stored) {
      await sessionAuthClient.refresh();
      return;
    }
  } catch {
    // refresh() clears an invalid server session; recreate it below.
  }
  await createNativeGuestSession();
}
// sessionAuthClient + localApiBaseUrl 现在来自 ./native-clients 避免 require cycle。
// (FACET Phase 1 只需要 baseUrl + 一个匿名 GET transport, 拆到独立 module)
const localNetClient = new LocalNetClient({ authClient: sessionAuthClient, secureSessionStore, baseUrl: localApiBaseUrl });
const activityClient = new ActivityClient({ authClient: sessionAuthClient, secureSessionStore });
const experienceClient = new ExperienceClient({ authClient: sessionAuthClient, secureSessionStore });
const conversationClient = new ConversationClient({ authClient: sessionAuthClient, secureSessionStore, baseUrl: localApiBaseUrl });
const mediaClient = new MediaClient({ authClient: sessionAuthClient, secureSessionStore, baseUrl: localApiBaseUrl });
const demandClient = new DemandClient({ authClient: sessionAuthClient, secureSessionStore });
const voucherClient = new VoucherClient({ authClient: sessionAuthClient, secureSessionStore });
const engagementClient = new EngagementClient({ authClient: sessionAuthClient, secureSessionStore });
// COMP-REPORT-002: 举报入口。法律文件 §38 承诺可举报八类目标，用户得
// 真能点到 —— 服务端接得上而客户端没入口，等于没改。
const moderationClient = new ModerationClient({ authClient: sessionAuthClient, secureSessionStore });
const marketplaceClient = new MarketplaceClient({ authClient: sessionAuthClient, secureSessionStore });
const socialSpaceClient = new SocialSpaceClient({ authClient: sessionAuthClient, secureSessionStore });
const fulfillmentClient = new FulfillmentClient({ authClient: sessionAuthClient, secureSessionStore });
const paymentClient = new PaymentClient({ authClient: sessionAuthClient, secureSessionStore });
const notificationClient = new NotificationClient({ authClient: sessionAuthClient, secureSessionStore });
const businessClient = new BusinessClient({ authClient: sessionAuthClient, secureSessionStore });
const profileClient = new ProfileClient({ authClient: sessionAuthClient, secureSessionStore });
// DEVICE-LIST-001: 设置页设备管理从此读真会话列表（ previously "设备列表尚未接入"）。
const sessionClient = new SessionClient({ authClient: sessionAuthClient, secureSessionStore });
const aiAccountClient = new AIAccountClient(sessionAuthClient);
const relationshipClient = new RelationshipClient({ authClient: sessionAuthClient, secureSessionStore });
const sceneClient = new SceneClient({ authClient: sessionAuthClient, secureSessionStore });
const supplyClient = new SupplyClient({ authClient: sessionAuthClient, secureSessionStore });
const socialSettingsClient = new SocialSettingsClient({ authClient: sessionAuthClient, secureSessionStore });
// LEGAL-BANNER-001: 法律状态是公开接口（无需登录），和登录态无关，模块级单例。
const legalStatusClient = new LegalStatusClient({ baseUrl: localApiBaseUrl, transport: nativeTransport });
type BootPhase = "BOOTSTRAPPING" | "PUBLIC" | "AUTHENTICATED" | "SIGNED_OUT";

export function ProxyApp(): React.JSX.Element {
  // R15 Model-Driven UI：不再内嵌 HTML 原型（Gate O）。
  // 启动引导 → 统一认证入口 → 认证后渲染 App Shell。
  const [phase, setPhase] = useState<BootPhase>("BOOTSTRAPPING");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await restoreNativeShell().catch(() => null);
      if (cancelled) return;
      if (!state) { setPhase("SIGNED_OUT"); return; }
      const isGuestFlag = await nativeSecureStorageDriver.getItem(GUEST_FLAG_KEY).catch(() => null);
      // A Keychain record is not proof that the server still accepts it.
      // Security migrations/revocation can invalidate server tokens while the
      // phone keeps an apparently valid access token. Validate on cold start;
      // if refresh is no longer usable, recover only through this trusted
      // installation's device credential. This prevents a false "logged in"
      // UI that fails later on CreatePost/media upload.
      if (state.status === "AUTHENTICATED") {
        const expectedUserAccountId = (await secureSessionStore.read().catch(() => undefined))?.userAccountId;
        try {
          await sessionAuthClient.refresh();
        } catch (error) {
          if (isGuestFlag === "1") {
            if (!cancelled) setPhase("PUBLIC");
            return;
          }
          const resumed = await (await getNativeLoginClient()).resumeTrustedDeviceSession().catch(() => undefined);
          if (!resumed || (expectedUserAccountId && resumed.userAccountId !== expectedUserAccountId)) {
            // A temporary outage must not erase credentials, but neither may
            // it claim write access. The sign-in screen can retry trusted
            // resume or OTP without losing the remembered account card.
            if (!cancelled) setPhase("SIGNED_OUT");
            return;
          }
          await nativeSecureStorageDriver.setItem(GUEST_FLAG_KEY, "0").catch(() => undefined);
        }
      }
      if (cancelled) return;
      if (isGuestFlag === "1" && state.status === "AUTHENTICATED") {
        setPhase("PUBLIC");
      } else {
        setPhase(state.status === "AUTHENTICATED" ? "AUTHENTICATED" : "PUBLIC");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // R15.36.1: 如果用户已经 authed 了但 lastSignIn entry 还没设
  //   (迁移场景: 之前没记, 或被旧 onSignOut 误清了), 现在补一个。
  //   以后他们点退出会看到 “继续使用” 卡片。
  //   placeholder 形式: "Proxy 账号" — 等后续 server 返回
  //   principal.email / principal.phone 就能换回真实 identifier。
  useEffect(() => {
    if (phase !== "AUTHENTICATED") return;
    let cancelled = false;
    void (async () => {
      const existing = await lastSignInStore.read().catch(() => undefined);
      if (cancelled) return;
      const storedSession = await secureSessionStore.read().catch(() => undefined);
      if (existing?.userAccountId || !storedSession?.userAccountId) return;
      await lastSignInStore.write({
        channel: existing?.channel ?? "EMAIL",
        identifier: existing?.identifier ?? "proxy@account",
        signedInAt: existing?.signedInAt ?? new Date().toISOString(),
        userAccountId: storedSession.userAccountId
      }).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  if (phase === "BOOTSTRAPPING") return <BootScreen />;
  if (phase === "AUTHENTICATED" || phase === "PUBLIC") {
    return (
      <AppShell
        localNet={localNetClient}
        activities={activityClient}
        experience={experienceClient}
        conversation={conversationClient}
        media={mediaClient}
        demand={demandClient}
        vouchers={voucherClient}
        engagement={engagementClient}
        moderation={moderationClient}
        marketplace={marketplaceClient}
        socialSpace={socialSpaceClient}
        fulfillment={fulfillmentClient}
        payment={paymentClient}
        secureSessionStore={secureSessionStore}
        notification={notificationClient}
        business={businessClient}
        profile={profileClient}
        sessionClient={sessionClient}
        aiAccounts={aiAccountClient}
        relationship={relationshipClient}
        supply={supplyClient}
        socialSettings={socialSettingsClient}
        scene={sceneClient}
        legalStatus={legalStatusClient}
        isGuest={phase === "PUBLIC"}
        ensureConversationSession={phase === "PUBLIC" ? ensureNativeGuestSession : undefined}
        sessionAuthClient={sessionAuthClient}
        localApiBaseUrl={localApiBaseUrl}
        onSignOut={() => {
		  // R15.36.1: 退出登录不重写 lastSignIn — 反而是
		  // 历史登录账户显示的时机。sessionAuthClient.signOut() 只清
		  // accessToken, keychain 里的 lastSignIn entry 保留。
		  void Promise.all([sessionAuthClient.signOut().catch(()=>undefined), nativeSecureStorageDriver.setItem(GUEST_FLAG_KEY,"0").catch(()=>undefined)]).then(() => setPhase("SIGNED_OUT"));
        }}
      />
    );
  }
  return <AuthenticationEntryScreen onAuthenticated={() => setPhase("AUTHENTICATED")} onGuest={() => setPhase("PUBLIC")} />;
}

function BootScreen(): React.JSX.Element {
  return (
    <View style={styles.screen}>
      <BrandMark large />
      <ProxyLoading tone="brand" style={styles.spinner} />
      <Text selectable style={styles.secondary}>让时间遇见需要。</Text>
    </View>
  );
}

function BrandMark({ large = false, showSlogan = true }: { large?: boolean; showSlogan?: boolean }): React.JSX.Element {
  return (
    <View style={styles.brandBlock}>
      <Image accessibilityLabel="Proxy" source={require("../assets/otter-logo.png")} style={[styles.otterLogo, large && styles.otterLogoLarge]} />
      <Text selectable style={[styles.brandName, large && styles.brandNameLarge]}>Proxy</Text>
      {showSlogan ? <><Text selectable style={styles.brandSlogan}>让时间遇见需要。</Text><Text selectable style={styles.brandSloganEn}>Where time meets need.</Text></> : null}
    </View>
  );
}

// R16.9: in-app fullscreen legal doc viewer. Fetches the Terms /
// Privacy text from /v1/legal/{kind} on the API server and renders it
// in a scrollable modal. The user must be able to actually read the
// text BEFORE the consent checkbox is enabled; we explicitly do not
// rely on a "the link works" promise or an external browser.
function LegalDocViewer({ kind, onClose }: { kind: LegalDocKind; onClose: () => void }): React.JSX.Element {
  const [doc, setDoc] = useState<LegalDoc | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(undefined);
    setDoc(null);
    new LegalDocClient({ baseUrl: localApiBaseUrl })
      .load(kind)
      .then((loaded) => {
        if (!cancelled) setDoc(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent={false} visible>
      <View style={styles.legalScreen}>
        <View style={styles.legalHeader}>
          <Text selectable style={styles.legalHeaderTitle}>{kind === "terms" ? "服务使用协议" : "隐私政策"} (v{doc?.version ?? "1.1"})</Text>
          <Pressable disabled={busy} onPress={onClose} style={styles.legalCloseBtn}><Text selectable style={styles.legalCloseBtnText}>关闭</Text></Pressable>
        </View>
        {busy ? (
          <View style={styles.legalBusy}><ProxyLoading tone="violet" label="加载中…" /></View>
        ) : error ? (
          <View style={styles.legalErrorBlock}>
            <Text selectable style={styles.legalErrorTitle}>无法加载条款</Text>
            <Text selectable style={styles.legalErrorBody}>{error}</Text>
            <Text selectable style={styles.legalErrorHint}>请检查网络或稍后再试。条款未成功加载前，不能勾选同意。</Text>
          </View>
        ) : doc ? (
          <ScrollView contentContainerStyle={styles.legalScroll}>
            <Text selectable style={styles.legalTitle}>{doc.title}</Text>
            <Text selectable style={styles.legalMeta}>适用地区：{doc.locale} · 更新日期：{doc.updatedAt.slice(0, 10)}</Text>
            {/* R15.x+: 用 LegalDocRenderer 替换平铺 Text — 渲染 serif
                + 15pt + 1.6 lineHeight + heading + 列表 + TOC。 */}
            <LegalDocRenderer content={doc.content} />
            <Text selectable style={styles.legalFooter}>本版本仍属于产品法律草案。正式发布前，应由当地执业律师依据实际法人、许可证/登记状态、技术架构、支付模式和数据流进行最终法律审阅。</Text>
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

function loginChallengeErrorMessage(error: unknown, channel: "SMS" | "EMAIL"): string {
  const code = error instanceof LoginCommandRejectedError ? error.result.error?.errorCode : undefined;
  if (code === "LOGIN_PROVIDER_NOT_CONFIGURED") {
    return "验证码服务尚未配置，请联系管理员（错误码：LOGIN_PROVIDER_NOT_CONFIGURED）。";
  }
  if (code === "PASSWORDLESS_IDENTITY_UNAVAILABLE") {
    return "当前账号或设备绑定不可用，请重试（错误码：PASSWORDLESS_IDENTITY_UNAVAILABLE）。";
  }
  if (code === "LOGIN_CHALLENGE_REQUEST_FAILED") {
    return "验证码发送服务拒绝了请求，请稍后重试（错误码：LOGIN_CHALLENGE_REQUEST_FAILED）。";
  }
  // OTP-RESEND-COOLDOWN-001: 限流不是"发送失败"，是"还在冷却"。把服务端给的
  // 秒数直接说出来，否则用户只会反复点、反复看到同一句无信息量的错误。
  if (code === "OTP_THROTTLED") {
    const wait = otpRetryAfterSeconds(error);
    return wait
      ? `验证码发送过于频繁，请 ${wait} 秒后重试。`
      : "验证码发送过于频繁，请稍后重试。";
  }
  return channel === "EMAIL"
    ? "暂时无法发送邮箱验证码，请稍后重试或改用手机号。"
    : "暂时无法发送验证码，请检查手机号后重试。";
}

function AuthenticationEntryScreen({ onAuthenticated, onGuest }: { onAuthenticated: () => void; onGuest: () => void }): React.JSX.Element {
  const [challengeId, setChallengeId] = useState<string>();
  const [authMode, setAuthMode] = useState<"login" | "register" | "guest">("login");
  const [phone, setPhone] = useState("");
  const [googleEmail, setGoogleEmail] = useState("");
  const [authChannel, setAuthChannel] = useState<"SMS" | "EMAIL">("SMS");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // R16.7-P0-A/B/C: register-time legal consent + 18+ DOB.
  // Reset to defaults whenever the user switches between auth modes so a
  // partially-completed signup does not leak into the next attempt.
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  // R16.9: which legal doc is currently being shown in the in-app
  // LegalDocViewer modal. null = modal hidden.
  const [openLegal, setOpenLegal] = useState<LegalDocKind | null>(null);
  // R15.36: 历史登录账户 — 只在 login 模式 展示。
  // 脱敏的 identifier 已经读取, 用户点 "继续" 会自动填 + 发起验证码。
  // "换号" 本地 dismiss (不写盘), 下次开 app 重新出现 — 因为上一个
  // session 仍然有效 (记忆者还可以 “返回上号”)。
  const [lastSignIn, setLastSignIn] = useState<LastSignIn | undefined>(undefined);
  const [lastSignInDismissed, setLastSignInDismissed] = useState(false);
  // OTP-RESEND-COOLDOWN-001: 服务端限流的剩余秒数。>0 时「重新发送」置灰并显示
  // 倒计时 —— 否则界面摆着一个按下去必然失败的按钮。秒数只从服务端的
  // safeDetails.retryAfterSeconds 来，客户端不写死窗口。
  const [resendCooldown, setResendCooldown] = useState(0);
  const resendCoolingDown = resendCooldown > 0;

  // 每秒走一格。依赖用布尔而非秒数 —— 否则每次 tick 都会重建 interval。
  useEffect(() => {
    if (!resendCoolingDown) return undefined;
    const timer = setInterval(() => setResendCooldown((left) => (left <= 1 ? 0 : left - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCoolingDown]);

  useEffect(() => {
    let cancelled = false;
    void lastSignInStore.read().then((entry) => {
      if (cancelled) return;
      setLastSignIn(entry);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // "继续" 按钮: 不需要用户重新输 identifier, 直接填 + 发起验证码。
  // 复用了 requestChallenge() 的核心路径 — 但在调用前先填表单状态,
  // 让用户能在 OTP 输入屏幕看到 “验证码已发送至 ...” 中的地址。
  // R15.39: 优先走 silent re-auth — keychain 里还存着 refreshToken
  //   (signOut 只设了 signedOut=true, 没 clear)。如果 server 接受
  //   refreshToken (RevokeSession 可能没完全作废 refresh), user
  //   一步登入, 不走 OTP。失败才走 OTP fallback。
  async function continueAsLastSignIn(entry: LastSignIn): Promise<void> {
    setAuthMode("login");
    setAuthChannel(entry.channel);
    if (entry.channel === "EMAIL") {
      setGoogleEmail(entry.identifier);
      setPhone("");
    } else {
      setPhone(entry.identifier);
      setGoogleEmail("");
    }
    setChallengeId(undefined);
    setCode("");
    setError(undefined);
    setBusy(true);
    try {
      // A remembered card is only a hint. Passwordless resume is allowed only
      // when this installation proves its Keychain/Keystore credential and the
      // server maps that trusted device back to the same account.
      if (entry.userAccountId) {
        const resumed = await (await getNativeLoginClient()).resumeTrustedDeviceSession().catch(() => undefined);
        if (resumed?.userAccountId === entry.userAccountId) {
        await nativeSecureStorageDriver.setItem(GUEST_FLAG_KEY, "0").catch(() => undefined);
        onAuthenticated();
        return;
        }
      }
      // 2) Silent re-auth 失败, 走 OTP fallback
      const loginClient = await getNativeLoginClient();
      const result = await loginClient.beginPasswordlessAuthentication({
        channel: entry.channel,
        identifier: entry.identifier,
        platform: Platform.OS === "ios" ? "IOS" : "ANDROID"
      });
      setChallengeId(result.challengeId);
    } catch (err) {
      // OTP-RESEND-COOLDOWN-001: 这条路径（「继续上次登录」）也会发验证码，限流同样
      // 要记冷却并说清秒数 —— 否则从这里撞上限流后，重发按钮依然可点。顺带把它从
      // 裸 messageKey 换成与主路径同一套映射文案。
      reportChallengeFailure(err, entry.channel);
    } finally {
      setBusy(false);
    }
  }

  // OTP-RESEND-COOLDOWN-001: 挑战请求失败统一走这里 —— 限流要**同时**把冷却记下来，
  // 否则界面只会重复给同一句错误、按钮仍然可点。首次失败与轮换重试失败共用这一个
  // 出口，避免只改一处。
  function reportChallengeFailure(err: unknown, channel: "SMS" | "EMAIL"): void {
    const wait = otpRetryAfterSeconds(err);
    if (wait !== undefined) setResendCooldown(wait);
    setError(loginChallengeErrorMessage(err, channel));
  }

  async function requestChallenge(channelOverride?: "SMS" | "EMAIL"): Promise<void> {
    setBusy(true);
    setError(undefined);
    const channel = channelOverride ?? authChannel;
    const isEmail = channel === "EMAIL";
    const normalizedEmail = isEmail ? normalizeLoginEmail(googleEmail) : undefined;
    const rawEmail = normalizedEmail ?? googleEmail.trim().toLowerCase();
    if (isEmail && rawEmail !== googleEmail.trim().toLowerCase()) setGoogleEmail(rawEmail);
    const identifier = isEmail ? rawEmail : normalizeVietnamesePhone(phone);
    if (isEmail && !normalizedEmail) {
      setError(`请输入有效邮箱，完整邮箱不能超过 ${MAX_LOGIN_EMAIL_LENGTH} 个字符。`);
      setBusy(false);
    } else {
      if (!isEmail && identifier === "") {
        setError("请输入有效的越南手机号（09xxxxxxxx / +84xxxxxxxxx），座机请带区号如 02412345678。");
        setBusy(false);
        return;
      }
      // AUTH-LOGIN-HINT-001: login must not silently start a registration
      // OTP flow for unknown identifiers. Probe first; unregistered accounts
      // get an explicit prompt instead of a verification code.
      if (authMode === "login") {
        try {
          const lookupClient = await getNativeLoginClient();
          const lookup = await lookupClient.lookupPasswordlessIdentity({ channel, identifier });
          if (!lookup.registered) {
            setError(isEmail ? "该邮箱尚未注册，请先去注册。" : "该手机号尚未注册，请先去注册。");
            setBusy(false);
            return;
          }
        } catch {
          // Lookup outage: fall through to the challenge request (legacy
          // behaviour) rather than blocking login entirely.
        }
      }
      // R16.7-P0-A/B: register requires Terms + Privacy consent and 18+ DOB
      // before requesting a verification challenge. Server will
      // re-validate (fail-closed defense in depth). The DOB check shares
      // getDateOfBirthError with the inline hint so submit-time and
      // typing-time messages always agree.
      if (authMode === "register") {
        const dobError = getDateOfBirthError(dateOfBirth);
        if (dobError) {
          setError(dobError);
          setBusy(false);
          return;
        }
        if (!termsAccepted || !privacyAccepted) {
          setError("请勾选《服务使用协议》和《隐私政策》。");
          setBusy(false);
          return;
        }
      }
      try {
        const loginClient = await getNativeLoginClient();
        const result = await loginClient.beginPasswordlessAuthentication({
          channel,
          identifier,
          platform: Platform.OS === "ios" ? "IOS" : "ANDROID"
        });
        // R16.7-P0-A/B: once the challenge is accepted by the server, persist
        // the legal consent + DOB so they can be forwarded to the eventual
        // session creation step. Backlog: P1-A wires the server-side
        // privacy.legal_consent_records write for the passwordless path
        // (today only the anonymous-session path writes the record).
        if (authMode === "register") {
          await nativeSecureStorageDriver.setItem("proxy.legalConsent.v1", JSON.stringify({
            dateOfBirth,
            termsAccepted: true,
            privacyAccepted: true,
            legalDocVersion: "1.1",
            acceptedAt: new Date().toISOString()
          }));
        }
        setChallengeId(result.challengeId);
        // Register may request a channel different from the toggle state
        // (email + phone are both shown); sync it so the OTP screen and the
        // remembered-account write below report the right destination.
        setAuthChannel(channel);
        // NOTE: We deliberately do NOT auto-open Gmail / mail.google.com
        // here. Doing so yanks the user out of the App and makes the OTP
        // input screen invisible — they come back to a "stuck" feeling
        // because the App is in the background. The helper text on the
        // next screen ("验证码已发送至 ...") tells them to switch to the
        // Mail app themselves when they are ready.
      } catch (err) {
        if (__DEV__) console.warn("[proxy.login] begin passwordless failed", err);
        // R15.27: if device is already bound to a different user (anonymous/legacy),
        // rotate the deviceId and retry once. Same pattern as createNativeGuestSession.
        if (
          err instanceof LoginCommandRejectedError &&
          (err.result.error?.errorCode === "PASSWORDLESS_IDENTITY_UNAVAILABLE" ||
            err.result.error?.errorCode === "LOGIN_PROVIDER_NOT_CONFIGURED" ||
            err.result.error?.errorCode === "ACCOUNT_NOT_ACTIVE" ||
            err.result.error?.errorCode === "INVALID_ACCESS_TOKEN")
        ) {
          let retrySucceeded = false;
          try {
            // eslint-disable-next-line no-console
            console.log("[proxy.login] rotating deviceId and retrying BeginPasswordlessAuthentication");
            // INVALID_ACCESS_TOKEN = 旧 keychain session 失效 (server 重启), 先清 keychain
            if (err.result.error?.errorCode === "INVALID_ACCESS_TOKEN") {
              try {
                await nativeSecureStorageDriver.deleteItem(SECURE_SESSION_STORAGE_KEY);
                console.log("[proxy.login] cleared stale keychain session for INVALID_ACCESS_TOKEN");
              } catch (clearErr) {
                console.log("[proxy.login] keychain clear skipped:", clearErr instanceof Error ? clearErr.message : String(clearErr));
              }
            }
            const rotated = await rotateGuestDeviceIdentity();
            const result = await rotated.beginPasswordlessAuthentication({
              channel,
              identifier,
              platform: Platform.OS === "ios" ? "IOS" : "ANDROID"
            });
            setChallengeId(result.challengeId);
            setAuthChannel(channel);
            retrySucceeded = true;
          } catch (retryErr) {
            // eslint-disable-next-line no-console
            console.log("[proxy.login] retry after rotate FAILED:", retryErr instanceof Error ? `${retryErr.name}: ${retryErr.message}` : String(retryErr));
          }
          if (!retrySucceeded) reportChallengeFailure(err, channel);
        } else {
          reportChallengeFailure(err, channel);
        }
      } finally {
        setBusy(false);
      }
    }
  }

  // R16.9: open the legal doc in an in-app modal. The LegalDocViewer
  // fetches the actual text from /v1/legal/{kind} on the API server
  // and shows it inline; the user can scroll the full text without
  // leaving the app. The checkbox is gated until the doc loads
  // successfully (see requestChallenge + continueAsGuest).
  function openLegalDoc(kind: LegalDocKind): void {
    setOpenLegal(kind);
  }

  async function continueAsGuest(): Promise<void> {
    // R16.7-P0-A: even guest browsing touches Proxy APIs (anonymous
    // session creation, /v1/feed reads with IP / UA logged), so the user
    // must accept the Privacy Policy before continuing. The server-side
    // CreateAnonymousSession command will independently enforce this
    // (fail-closed) on the request that creates the ANONYMOUS user.
    if (!privacyAccepted) {
      setError("请先勾选《隐私政策》再以访客身份进入。");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await createNativeGuestSession();
      onGuest();
    } catch {
      setError("暂时无法创建访客会话，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function completeLogin(): Promise<void> {
    if (!challengeId || code.trim() === "") return;
    setBusy(true);
    setError(undefined);
    try {
		const loginClient = await getNativeLoginClient();
      await loginClient.verifyChallenge(challengeId, code);
      const session = await loginClient.createSessionFromChallenge(challengeId);
      await nativeSecureStorageDriver.setItem(GUEST_FLAG_KEY, "0").catch(()=>undefined);
      // R15.36: 记住上次的 identifier, 下次进来在登录页顶部展示
      // "继续使用" 卡片。
      await lastSignInStore.write({
        channel: authChannel,
        identifier: authChannel === "EMAIL" ? googleEmail.trim().toLowerCase() : normalizeVietnamesePhone(phone),
        signedInAt: new Date().toISOString(),
        userAccountId: session.userAccountId
      }).catch(() => undefined);
      onAuthenticated();
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.warn("[completeLogin] failed:", message);
      setError(`验证码流程失败：${message}`);
    } finally {
      setBusy(false);
    }
  }

  // Register: surface the 18+ gate the moment the birth date entry is
  // complete, instead of waiting until the challenge submit after the
  // phone/email step. Only a complete YYYY-MM-DD value is judged so
  // partial typing does not flash errors.
  const dobInlineError = authMode === "register" && dateOfBirth.length === 10
    ? getDateOfBirthError(dateOfBirth)
    : undefined;

  // 注册页只有一个「获取验证码」按钮（对齐 docs/design/references/
  // Proxy_Auth_Standard_UI_v7.html —— 该参考文档里验证码按钮文案只有
  // 「获取验证码」一种，没有按渠道分开的两种叫法）。
  // 渠道由用户填了哪个标识决定，而不是由按了哪个按钮决定：
  //   * 邮箱可用 → EMAIL（也覆盖「邮箱手机都填了」时以邮箱为准）
  //   * 邮箱没填、手机填了 → SMS
  //   * 邮箱填了但格式还不对、手机空着 → 仍走 EMAIL，好让 requestChallenge
  //     里的邮箱格式校验给出提示，而不是按钮静默无反应
  //   * 两个都空 → 按钮置灰
  const registerEmailFilled = googleEmail.trim().length > 0;
  const registerPhoneFilled = phone.trim().length > 0;
  const registerEmailReady = normalizeLoginEmail(googleEmail) !== undefined;
  const registerChannel: "SMS" | "EMAIL" =
    registerEmailReady || (registerEmailFilled && !registerPhoneFilled) ? "EMAIL" : "SMS";
  const registerCodeDisabled = busy || !!dobInlineError || (!registerEmailFilled && !registerPhoneFilled);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.screenAvoid}>
      <ScrollView contentContainerStyle={styles.screenScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.screenInner}>
            <View style={styles.card}>
        <BrandMark showSlogan={false} />
        {authMode === "login" && lastSignIn && !lastSignInDismissed ? (
          <View style={styles.rememberedCard}>
            <View style={styles.rememberedAvatar}>
              <Text selectable style={styles.rememberedAvatarText}>
                {avatarLetterFor(lastSignIn.channel, lastSignIn.identifier)}
              </Text>
            </View>
            <View style={styles.rememberedAcct}>
              <Text selectable style={styles.rememberedLabel}>继续使用</Text>
              <Text selectable style={styles.rememberedIdentifier} numberOfLines={1}>
                {maskIdentifier(lastSignIn.channel, lastSignIn.identifier)}
              </Text>
            </View>
            {/* BUTTON-UNIFY-003：「继续」改用公共 ProxyButton。原来手写 ink 底 +
                圆角 11（恰好是 foundation.radius.sm 的原值）+ 写死 height 38 + 白字
                13/700。迁完形状与按压反馈只有一个出处。文案和 accessibilityLabel
                一字未改。⚠️ height 38 去掉了：ProxyButton 的 minHeight 是 40，两个
                都写 minHeight 会赢，留着就是死代码。 */}
            <ProxyButton
              accessibilityLabel="继续上次的账号"
              onPress={() => void continueAsLastSignIn(lastSignIn)}
              style={styles.rememberedContinue}
            >
              继续
            </ProxyButton>
            <Pressable
              onPress={() => {
                setLastSignInDismissed(true);
                setError(undefined);
              }}
              style={styles.rememberedSwitch}
              accessibilityLabel="切换其他账号"
            >
              <Text selectable style={styles.rememberedSwitchText}>换号</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.authTabs}>
          <Pressable onPress={() => { setAuthMode("login"); setChallengeId(undefined); setCode(""); setError(undefined); }} style={[styles.authTab, authMode === "login" && styles.authTabActive]}>
            <Text selectable style={[styles.authTabText, authMode === "login" && styles.authTabTextActive]}>登录</Text>
          </Pressable>
          <Pressable onPress={() => { setAuthMode("register"); setAuthChannel("SMS"); setChallengeId(undefined); setCode(""); setError(undefined); setDateOfBirth(""); setTermsAccepted(false); setPrivacyAccepted(false); }} style={[styles.authTab, authMode === "register" && styles.authTabActive]}>
            <Text selectable style={[styles.authTabText, authMode === "register" && styles.authTabTextActive]}>注册</Text>
          </Pressable>
          <Pressable onPress={() => { setAuthMode("guest"); setChallengeId(undefined); setCode(""); setError(undefined); setTermsAccepted(false); setPrivacyAccepted(false); }} style={[styles.authTab, styles.authGuestTab, authMode === "guest" && styles.authTabActive]}>
            <Text selectable style={[styles.authTabText, authMode === "guest" && styles.authTabTextActive]}>访客</Text>
          </Pressable>
        </View>
        {authMode === "guest" ? (
          <View style={styles.guestPanel}>
            <Text selectable style={styles.guestTitle}>先逛逛 Proxy</Text>
            <Text selectable style={styles.guestDescription}>可浏览首页、市场和动态；发布、互动、交易与长期保存时再登录。</Text>
            <Pressable onPress={() => setPrivacyAccepted((v) => !v)} style={styles.consentRow}>
              <View style={[styles.consentBox, privacyAccepted && styles.consentBoxOn]}><Text selectable style={styles.consentBoxMark}>{privacyAccepted ? "✓" : ""}</Text></View>
              <Text selectable style={styles.consentText}>我已阅读并同意{"\n"}<Text selectable style={styles.consentLink} onPress={() => openLegalDoc("privacy")}>《隐私政策》</Text> (v1.1, 越南)</Text>
            </Pressable>
            <View style={[styles.button, busy || !privacyAccepted ? styles.disabled : null]}><Gradient from={color.magenta} to={color.violet} style={absoluteFillStyle} /><Pressable disabled={busy || !privacyAccepted} onPress={() => void continueAsGuest()} style={styles.buttonPressable}><Text selectable style={styles.buttonText}>{busy ? "进入中…" : "以访客身份进入"}</Text></Pressable></View>
          </View>
        ) : challengeId ? (
          <>
            <Text selectable style={styles.helper}>验证码已发送至 {authChannel === "EMAIL" ? googleEmail.trim().toLowerCase() : formatVietnamesePhoneForDisplay(normalizeVietnamesePhone(phone))}</Text>
            <TextInput
              autoFocus
              blurOnSubmit
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={setCode}
              onSubmitEditing={() => Keyboard.dismiss()}
              placeholder="输入验证码"
              placeholderTextColor="#A9A2B0"
              returnKeyType="done"
              style={styles.input}
              value={code}
            />
            <View style={[styles.button, busy || code.trim() === "" ? styles.disabled : null]}>
              <Gradient from={color.magenta} to={color.violet} style={absoluteFillStyle} />
              <Pressable disabled={busy || code.trim() === ""} onPress={() => void completeLogin()} style={styles.buttonPressable}>
                <Text selectable style={styles.buttonText}>{busy ? "验证中…" : "继续"}</Text>
              </Pressable>
            </View>
            <View style={styles.inlineActions}>
              <Pressable disabled={busy} onPress={() => { setChallengeId(undefined); setCode(""); setResendCooldown(0); }}><Text selectable style={styles.linkText}>{authChannel === "EMAIL" ? "更换邮箱" : "更换手机号"}</Text></Pressable>
              <Pressable disabled={busy || resendCoolingDown} onPress={() => void requestChallenge()}><Text selectable style={styles.linkText}>{resendCoolingDown ? `重新发送（${resendCooldown}s）` : "重新发送"}</Text></Pressable>
            </View>
          </>
        ) : (
          <>
            <View style={styles.googleButtonRow}>
              <GoogleSignInSlot
                active={authChannel === "EMAIL"}
                busy={busy}
                onAuthenticated={onAuthenticated}
                onSelectEmail={() => setAuthChannel("EMAIL")}
                setBusy={setBusy}
                setError={setError}
              />
              {/* Register shows both email + phone identifier sections below,
                  so the SMS/EMAIL toggle is login-only. */}
              {authMode === "register" ? null : (
              <Pressable onPress={() => { setAuthChannel("SMS"); setError(undefined); }} style={[styles.googleButton, authChannel === "SMS" && styles.googleButtonActive, styles.googleButtonSmall]}>
                <Text selectable style={styles.googleLabel}>手机</Text>
              </Pressable>
              )}
            </View>
            {authMode === "register" ? (
              <View style={styles.dobBlock}>
                <Text selectable style={styles.dobLabel}>出生日期 · 需年满 18 岁</Text>
                <TextInput
                  blurOnSubmit
                  keyboardType="number-pad"
                  maxLength={10}
                  onChangeText={(value) => { setDateOfBirth(formatDateOfBirthInput(value)); setError(undefined); }}
                  onSubmitEditing={() => Keyboard.dismiss()}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#A9A2B0"
                  returnKeyType="done"
                  style={styles.dobInput}
                  value={dateOfBirth}
                />
                {dobInlineError ? <Text selectable style={styles.dobError}>{dobInlineError}</Text> : null}
              </View>
            ) : null}
            {authMode === "register" ? (
              <>
                <View style={styles.phoneRow}><Text selectable style={styles.countryCode}>@</Text><TextInput autoCapitalize="none" blurOnSubmit keyboardType="email-address" maxLength={MAX_LOGIN_EMAIL_LENGTH} onChangeText={setGoogleEmail} onSubmitEditing={() => Keyboard.dismiss()} placeholder="用户名或完整邮箱（最多 50 字符）" placeholderTextColor="#A9A2B0" returnKeyType="done" style={styles.phoneInput} value={googleEmail} /></View>
                <View style={styles.orRow}>
                  <View style={styles.orLine} />
                  <Text selectable style={styles.orText}>OR</Text>
                  <View style={styles.orLine} />
                </View>
                <View style={styles.phoneRow}><Text selectable style={styles.countryCode}>+84</Text><TextInput blurOnSubmit keyboardType="phone-pad" onChangeText={setPhone} onSubmitEditing={() => Keyboard.dismiss()} placeholder="0912345678 或粘贴 +84 号码" placeholderTextColor="#A9A2B0" returnKeyType="done" style={styles.phoneInput} value={phone} /></View>
                {/* 邮箱与手机共用一个「获取验证码」：渠道由上面填了哪个标识决定。 */}
                <View style={[styles.button, registerCodeDisabled ? styles.disabled : null]}>
                  <Gradient from={color.magenta} to={color.violet} style={absoluteFillStyle} />
                  <Pressable disabled={registerCodeDisabled} onPress={() => void requestChallenge(registerChannel)} style={styles.buttonPressable}>
                    <Text selectable style={styles.buttonText}>{busy ? "发送中…" : "获取验证码"}</Text>
                  </Pressable>
                </View>
                <View style={styles.consentBlock}>
                  <Pressable onPress={() => setTermsAccepted((v) => !v)} style={styles.consentRow}>
                    <View style={[styles.consentBox, termsAccepted && styles.consentBoxOn]}><Text selectable style={styles.consentBoxMark}>{termsAccepted ? "✓" : ""}</Text></View>
                    <Text selectable style={styles.consentText}>我已阅读并同意{"\n"}<Text selectable style={styles.consentLink} onPress={() => openLegalDoc("terms")}>《服务使用协议》</Text> (v1.1, 越南)</Text>
                  </Pressable>
                  <Pressable onPress={() => setPrivacyAccepted((v) => !v)} style={styles.consentRow}>
                    <View style={[styles.consentBox, privacyAccepted && styles.consentBoxOn]}><Text selectable style={styles.consentBoxMark}>{privacyAccepted ? "✓" : ""}</Text></View>
                    <Text selectable style={styles.consentText}>我已阅读并同意{"\n"}<Text selectable style={styles.consentLink} onPress={() => openLegalDoc("privacy")}>《隐私政策》</Text> (v1.1, 越南)</Text>
                  </Pressable>
                </View>
              </>
            ) : authChannel === "EMAIL" ? (
              <>
                <View style={styles.phoneRow}><Text selectable style={styles.countryCode}>@</Text><TextInput autoCapitalize="none" blurOnSubmit keyboardType="email-address" maxLength={MAX_LOGIN_EMAIL_LENGTH} onChangeText={setGoogleEmail} onSubmitEditing={() => Keyboard.dismiss()} placeholder="用户名或完整邮箱（最多 50 字符）" placeholderTextColor="#A9A2B0" returnKeyType="done" style={styles.phoneInput} value={googleEmail} /></View>
                <View style={[styles.button, busy || googleEmail.trim().length === 0 ? styles.disabled : null]}>
                  <Gradient from={color.magenta} to={color.violet} style={absoluteFillStyle} />
                  <Pressable disabled={busy || googleEmail.trim().length === 0} onPress={() => void requestChallenge()} style={styles.buttonPressable}>
                    <Text selectable style={styles.buttonText}>{busy ? "发送中…" : "获取验证码"}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={styles.phoneRow}><Text selectable style={styles.countryCode}>+84</Text><TextInput blurOnSubmit keyboardType="phone-pad" onChangeText={setPhone} onSubmitEditing={() => Keyboard.dismiss()} placeholder="0912345678 或粘贴 +84 号码" placeholderTextColor="#A9A2B0" returnKeyType="done" style={styles.phoneInput} value={phone} /></View>
                <View style={[styles.button, busy || !vietnamesePhoneReady(phone) ? styles.disabled : null]}>
                  <Gradient from={color.magenta} to={color.violet} style={absoluteFillStyle} />
                  <Pressable disabled={busy || !vietnamesePhoneReady(phone)} onPress={() => void requestChallenge()} style={styles.buttonPressable}>
                    <Text selectable style={styles.buttonText}>{busy ? "发送中…" : "获取验证码"}</Text>
                  </Pressable>
                </View>
              </>
            )}
            <Pressable onPress={() => { setAuthMode(authMode === "login" ? "register" : "login"); setError(undefined); }} style={styles.switchAuthRow}>
              <Text selectable style={styles.switchAuthText}>{authMode === "login" ? "没有账号？去注册" : "已有账号？去登录"}</Text>
            </Pressable>
          </>
        )}
        {error ? <Text selectable style={styles.error}>{error}</Text> : null}
            </View>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
      {openLegal ? <LegalDocViewer kind={openLegal} onClose={() => setOpenLegal(null)} /> : null}
    </KeyboardAvoidingView>
  );
}

type GoogleSignInProps = {
  active: boolean;
  busy: boolean;
  onAuthenticated: () => void;
  onSelectEmail: () => void;
  setBusy: (busy: boolean) => void;
  setError: (message: string | undefined) => void;
};

const googleClientConfig: GoogleClientConfig = {
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
};

function GoogleSignInSlot(props: GoogleSignInProps): React.JSX.Element {
  // R15.29: the platform check is a module-level constant, not a runtime
  // decision, so we can compute it at top of every render without changing
  // hook order. The actual branch happens here in the slot, and each branch
  // is a SEPARATE component so neither one mixes hooks with the other.
  const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
  if (!googleAuthConfigured(platform, googleClientConfig)) {
    return <GoogleEmailFallback {...props} />;
  }
  return <ConfiguredGoogleSignIn {...props} />;
}

function GoogleMark(): React.JSX.Element {
  return <Svg accessibilityLabel="Google" height={21} viewBox="0 0 24 24" width={21}><Path d="M21.35 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.23a4.47 4.47 0 0 1-1.94 2.93v2.43h3.14c1.84-1.7 2.92-4.2 2.92-7.19z" fill="#4285F4"/><Path d="M12 21.75c2.63 0 4.84-.87 6.45-2.36l-3.14-2.43c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.51A9.75 9.75 0 0 0 12 21.75z" fill="#34A853"/><Path d="M6.54 13.85A5.86 5.86 0 0 1 6.23 12c0-.64.11-1.26.31-1.85V7.64H3.3A9.75 9.75 0 0 0 2.25 12c0 1.57.38 3.05 1.05 4.36l3.24-2.51z" fill="#FBBC05"/><Path d="M12 6.12c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.15 14.63 2.25 12 2.25a9.75 9.75 0 0 0-8.7 5.39l3.24 2.51c.77-2.31 2.92-4.03 5.46-4.03z" fill="#EA4335"/></Svg>;
}

function ConfiguredGoogleSignIn(props: GoogleSignInProps): React.JSX.Element {
  const { onAuthenticated, setBusy, setError } = props;
  // R15.29: this component is keyed on isConfigured by the slot, so we
  // either always have a config (mounted under "cfg") or always render
  // the unconfigured fallback (mounted under "plain"). useAuthRequest is
  // only called when the config is valid.
  const [request, response, promptAsync] = Google.useAuthRequest({
    ...googleClientConfig,
    scopes: ["openid", "profile", "email"],
    useProxy: true,
    projectNameForProxy: "@proxy/proxy",
  } as any);

  useEffect(() => {
    if (!response) return;
    if (response.type === "success" && response.authentication?.idToken) {
      void (async () => {
        setBusy(true);
        setError(undefined);
        try {
          const loginClient = await getNativeLoginClient();
          const session = await loginClient.authenticateWithGoogle(response.authentication!.idToken!, Platform.OS === "ios" ? "IOS" : "ANDROID");
          await nativeSecureStorageDriver.setItem(GUEST_FLAG_KEY, "0").catch(()=>undefined);
          // R15.36: Google 流程下我们没有 email (需要额外 fetch userinfo),
          // 暂以 "Google 账号" + 唯一末位来记住。后续如果 server 返回
          // principal.email 可以换。
          await lastSignInStore.write({
            channel: "EMAIL",
            identifier: "google@account",
            signedInAt: new Date().toISOString(),
            userAccountId: session.userAccountId
          }).catch(() => undefined);
          onAuthenticated();
        } catch (error) {
          setError(error instanceof Error ? error.message : "Google 登录失败，请重试或用手机号/邮箱");
        } finally {
          setBusy(false);
        }
      })();
    } else if (response.type === "error") {
      setError("Google 授权失败，请重试");
    } else if (response.type === "dismiss") {
      setError(undefined);
    }
  }, [onAuthenticated, response, setBusy, setError]);

  // If we got here but the config is not actually valid, the useAuthRequest
  // above will have already thrown — so the only way to reach this line is
  // when Google is configured. Render the "press to start auth" button.
  return (
    <Pressable
      disabled={props.busy || !request}
      onPress={async () => {
        props.setError(undefined);
        props.onSelectEmail();
        try {
          await promptAsync();
        } catch {
          props.setError("无法启动 Google 授权，请改用邮箱验证码");
        }
      }}
      style={[styles.googleButton, props.active && styles.googleButtonActive, (props.busy || !request) && styles.disabled]}
    >
      <GoogleMark /><Text selectable style={styles.googleLabel}>使用 Google 继续</Text>
    </Pressable>
  );
}

// R15.29: when Google is not configured, render a fallback "use Google
// email" entry. This is a separate component (NOT a branch inside the
// hooks-using ConfiguredGoogleSignIn) so hook count stays 0.
function GoogleEmailFallback(props: GoogleSignInProps): React.JSX.Element {
  return (
    <Pressable
      disabled={props.busy}
      onPress={() => {
        props.setError(undefined);
        props.onSelectEmail();
      }}
      style={[styles.googleButton, props.active && styles.googleButtonActive, props.busy && styles.disabled]}
    >
      <GoogleMark /><Text selectable style={styles.googleLabel}>使用 Google 邮箱</Text>
    </Pressable>
  );
}

async function restoreNativeShell(): Promise<AppShellState> {
  try {
    const restored = await restoreAppShell({
      secureSessionStore,
      isRestricted: false,
      isOffline: false
    });
    if (__DEV__) {
      // Dev-only: lets `idevicesyslog` and the Mac smoke script verify that
      // the iOS Keychain is actually persisting session tokens across an app
      // kill / re-launch. Production builds drop this branch entirely.
      if (restored.state.status === "AUTHENTICATED" && restored.session) {
        const principalId = restored.session.principal?.id ?? restored.session.userAccountId;
        const signedOut = restored.session.signedOut ? " signedOut=true" : "";
        console.log(
          `[proxy.smoke] keychain=present principalId=${principalId} sessionId=${restored.session.auth.sessionId}${signedOut}`
        );
      } else {
        console.log(`[proxy.smoke] keychain=absent status=${restored.state.status}`);
      }
    }
    return restored.state;
  } catch {
    // A Keychain/Keystore read failure must never leave an ambiguous session.
    await secureSessionStore.clear().catch(() => undefined);
    return resolveInitialRoute({ hasSession: false, isRestricted: false, isOffline: false });
  }
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: color.offWhite,
    flex: 1,
    justifyContent: "center",
    padding: 24
  },
  screenAvoid: { backgroundColor: color.offWhite, flex: 1 },
  screenScroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  screenInner: { alignItems: "center", flex: 1, justifyContent: "center" },
  card: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 24,
    borderWidth: 1,
    ...shadows.card,
    maxWidth: 420,
    padding: 32,
    width: "100%"
  },
  brandBlock: { alignItems: "center", marginBottom: 26 },
  otterLogo: { borderRadius: 18, height: 56, overflow: "hidden", resizeMode: "contain", width: 56 },
  otterLogoLarge: { borderRadius: 24, height: 76, width: 76 },
  brandName: { color: color.ink, fontSize: 30, fontWeight: "900", letterSpacing: 2, marginTop: 16 },
  brandNameLarge: { fontSize: 34 },
  brandSlogan: { color: color.muted, fontSize: 12, letterSpacing: 0.4, marginTop: 6 },
  brandSloganEn: { color: "#8A8490", fontSize: 9, letterSpacing: 2.2, marginTop: 4, textTransform: "uppercase" },
  spinner: { marginTop: 22 },
  title: {
    color: color.ink,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 8
  },
  secondary: {
    color: color.muted,
    fontSize: 13,
    marginTop: 8,
    textAlign: "center"
  },
  helper: {
    color: color.violet,
    fontSize: 12,
    marginTop: 16,
    textAlign: "center"
  },
  input: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: 14,
    borderWidth: 1,
    color: color.ink,
    fontSize: 18,
    letterSpacing: 8,
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    textAlign: "center",
    width: "100%"
  },
  authTabs: { flexDirection: "row", backgroundColor: "#F5F2F8", borderRadius: 21, padding: 5, marginTop: 14, width: "100%" },
  authTab: { alignItems: "center", borderRadius: 17, flex: 1, minHeight: 48, justifyContent: "center", paddingVertical: 8 },
  authGuestTab: { flex: 1.15 },
  authTabActive: { backgroundColor: color.white, ...shadows.card },
  authTabText: { color: color.muted, fontSize: 14, fontWeight: "700" },
  authTabTextActive: { color: color.ink },
  switchAuthRow: { alignItems: "center", marginTop: 12, paddingVertical: 6 },
  switchAuthText: { color: color.violet, fontSize: 13, fontWeight: "700" },
  googleButton: { alignItems: "center", borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", justifyContent: "center", marginTop: 20, minHeight: 50, width: "100%" },
  googleButtonRow: { flexDirection: "row", gap: 8, width: "100%" },
  googleButtonActive: { borderColor: color.violet, backgroundColor: "#F0EBF5" },
  googleButtonSmall: { flex: 0.4 },
  googleLabel: { color: color.ink, fontSize: 15, fontWeight: "800" },
  // 邮箱 / 手机二选一的分隔标记。用「横线 + OR + 横线」这个通行写法，
  // 取代原来那行独立的号码格式说明文字 —— 号码格式 placeholder 里
  // 已经写了，再解释一遍是噪音。
  orRow: { alignItems: "center", flexDirection: "row", marginTop: 18, width: "100%" },
  orLine: { backgroundColor: color.line, flex: 1, height: 1 },
  orText: { color: color.muted, fontSize: 12, fontWeight: "700", marginHorizontal: 12 },
  phoneRow: { alignItems: "center", backgroundColor: color.surface, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", marginTop: 10, minHeight: 52, paddingHorizontal: 16, width: "100%" },
  countryCode: { color: color.ink, fontSize: 16, fontWeight: "800", marginRight: 12 },
  phoneInput: { color: color.ink, flex: 1, fontSize: 16, paddingVertical: 12 },
  guestButton: { alignItems: "center", marginTop: 18, paddingVertical: 10 },
  guestText: { color: color.violet, fontSize: 14, fontWeight: "800" },
  guestPanel: { alignSelf: "stretch", paddingTop: 27 },
  // R16.7-P0-A/B: register-time consent + DOB form.
  dobBlock: { alignSelf: "stretch", marginTop: 12 },
  dobLabel: { color: color.muted, fontSize: 12, marginTop: 8, textAlign: "left" },
  dobInput: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: 12,
    borderWidth: 1,
    color: color.ink,
    fontSize: 15,
    letterSpacing: 1,
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    textAlign: "left"
  },
  // Register inline 18+ hint: shown as soon as the birth date is complete.
  dobError: {
    color: color.error,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
    textAlign: "left"
  },
  // Register consents sit below both identifier sections.
  consentBlock: { alignSelf: "stretch", marginTop: 4 },
  consentRow: { alignItems: "flex-start", flexDirection: "row", marginTop: 12, paddingVertical: 4 },
  consentBox: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 6,
    borderWidth: 1.5,
    height: 22,
    justifyContent: "center",
    marginRight: 10,
    marginTop: 2,
    width: 22
  },
  consentBoxOn: { backgroundColor: color.violet, borderColor: color.violet },
  consentBoxMark: { color: color.white, fontSize: 14, fontWeight: "900", lineHeight: 18 },
  consentText: { color: color.ink, flex: 1, fontSize: 12, lineHeight: 18 },
  consentLink: { color: color.violet, fontWeight: "800" },
  // R16.9 legal doc viewer styles.
  legalScreen: { backgroundColor: color.white, flex: 1, paddingTop: 50 },
  legalHeader: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  legalHeaderTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  legalCloseBtn: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  legalCloseBtnText: { color: color.ink, fontSize: 13, fontWeight: "700" },
  legalBusy: { alignItems: "center", flex: 1, justifyContent: "center" },
  legalBusyText: { color: color.muted, fontSize: 13, marginTop: 8 },
  legalErrorBlock: { padding: 24 },
  legalErrorTitle: { color: color.ink, fontSize: 16, fontWeight: "800", marginBottom: 8 },
  legalErrorBody: { color: color.muted, fontSize: 13, marginBottom: 12 },
  legalErrorHint: { color: color.ink, fontSize: 12, lineHeight: 18 },
  legalScroll: { padding: 20, paddingBottom: 60 },
  legalTitle: { color: color.ink, fontFamily: Platform.select({ ios: "New York", android: "serif", default: "serif" }), fontSize: 22, fontWeight: "900", marginBottom: 6 },
  legalMeta: { color: color.muted, fontSize: 12, marginBottom: 16 },
  // legalBody 由 LegalDocRenderer 负责 (serif + 15pt + 1.6)。本样式
  // 保留以防其它代码路径 fallback。
  legalBody: { color: color.ink, fontFamily: Platform.select({ ios: "New York", android: "serif", default: "serif" }), fontSize: 15, lineHeight: 24 },
  legalFooter: { color: color.muted, fontFamily: Platform.select({ ios: "New York", android: "serif", default: "serif" }), fontSize: 12, fontStyle: "italic", lineHeight: 20, marginTop: 24 },
  guestTitle: { color: color.ink, fontSize: 22, fontWeight: "900", textAlign: "center" },
  guestDescription: { color: color.muted, fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: "center" },
  inlineActions: { flexDirection: "row", gap: 28, justifyContent: "center", marginTop: 18 },
  linkText: { color: color.violet, fontSize: 13, fontWeight: "700" },
  button: {
    alignItems: "center",
    borderRadius: 14,
    marginTop: 16,
    minHeight: 50,
    overflow: "hidden",
    width: "100%"
  },
  buttonPressable: {
    ...absoluteFillStyle,
    alignItems: "center",
    justifyContent: "center"
  },
  buttonText: {
    color: color.white,
    fontSize: 15,
    fontWeight: "900"
  },
  disabled: {
    opacity: 0.5
  },
  error: {
    color: color.error,
    fontSize: 12,
    marginTop: 16,
    textAlign: "center"
  },
  // R15.36: 历史登录账户卡片 (Proxy_Auth_Standard_UI_v7 “继续使用” 设计)。
  //   1px line 边框 + 17px 圆角 + 40×40 字母 avatar + ink 黑 “继续” 按钮
  //   + “换号” 文本按钮。展示位置: BrandMark 与 authTabs 之间。
  rememberedCard: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    padding: 12
  },
  rememberedAvatar: {
    alignItems: "center",
    backgroundColor: color.ink,
    borderRadius: 13,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  rememberedAvatarText: {
    color: color.white,
    fontSize: 17,
    fontWeight: "800"
  },
  rememberedAcct: {
    flex: 1,
    minWidth: 0
  },
  rememberedLabel: {
    color: color.ink,
    fontSize: 14,
    fontWeight: "700"
  },
  rememberedIdentifier: {
    color: color.muted,
    fontSize: 12,
    marginTop: 3
  },
  // BUTTON-UNIFY-003: 只剩布局（横向内边距）。ink 底 / 圆角 11 / 最小高 40 /
  // 白字 13 800 / 按压反馈由 ProxyButton tone="primary" 提供。
  // rememberedContinueText 键已删。
  rememberedContinue: {
    paddingHorizontal: 13
  },
  rememberedSwitch: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: 6
  },
  rememberedSwitchText: {
    color: color.violet,
    fontSize: 12,
    fontWeight: "700"
  }
});
