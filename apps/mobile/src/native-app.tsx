import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { restoreAppShell, resolveInitialRoute, type AppShellState } from "./app-shell";
import { type Transport, SessionAuthClient } from "./auth-client";
import { ConversationClient } from "./conversation-client";
import { DemandClient } from "./demand-client";
import { LoginClient, LoginCommandRejectedError } from "./login-client";
import { formatVietnamesePhoneForDisplay, normalizeVietnamesePhone, vietnamesePhoneReady } from "./vn-phone";
import { googleAuthConfigured, type GoogleClientConfig } from "./google-auth-config";
import { LocalNetClient } from "./localnet-client";
import { MediaClient } from "./media-client";
import { ActivityClient } from "./activity-client";
import { ExperienceClient } from "./experience-client";
import { VoucherClient } from "./voucher-client";
import { EngagementClient } from "./engagement-client";
import { MarketplaceClient } from "./marketplace-client";
import { SocialSpaceClient } from "./socialspace-client";
import { FulfillmentClient } from "./fulfillment-client";
import { PaymentClient } from "./payment-client";
import { NotificationClient } from "./notification-client";
import { BusinessClient } from "./business-client";
import { SceneClient } from "./scene-client";
import { SupplyClient } from "./supply-client";
import { nativeSecureStorageDriver } from "./native-secure-storage";
import { createLastSignInStore, maskIdentifier, avatarLetterFor, type LastSignIn } from "./last-signin-store";
import { AppShell } from "./shell/app-shell";
import { color, Gradient, shadows } from "./theme";
import { sessionAuthClient, localApiBaseUrl, nativeSecureSessionStore } from "./native-clients";

const APP_VERSION = "1.0.0";

const absoluteFillStyle = { bottom: 0, left: 0, position: "absolute" as const, right: 0, top: 0 };

WebBrowser.maybeCompleteAuthSession();

const secureSessionStore = nativeSecureSessionStore;
const INSTALLATION_DEVICE_ID_KEY = "proxy.installation.device-id.v1";
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
  let deviceId = await nativeSecureStorageDriver.getItem(INSTALLATION_DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    await nativeSecureStorageDriver.setItem(INSTALLATION_DEVICE_ID_KEY, deviceId);
  }
  nativeLoginClient = new LoginClient({ baseUrl: localApiBaseUrl, deviceId, secureSessionStore, transport: nativeTransport });
  return nativeLoginClient;
}

async function rotateGuestDeviceIdentity(): Promise<LoginClient> {
  const deviceId = `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  await nativeSecureStorageDriver.setItem(INSTALLATION_DEVICE_ID_KEY, deviceId);
  nativeLoginClient = undefined;
  return getNativeLoginClient();
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
const marketplaceClient = new MarketplaceClient({ authClient: sessionAuthClient, secureSessionStore });
const socialSpaceClient = new SocialSpaceClient({ authClient: sessionAuthClient, secureSessionStore });
const fulfillmentClient = new FulfillmentClient({ authClient: sessionAuthClient, secureSessionStore });
const paymentClient = new PaymentClient({ authClient: sessionAuthClient, secureSessionStore });
const notificationClient = new NotificationClient({ authClient: sessionAuthClient, secureSessionStore });
const businessClient = new BusinessClient({ authClient: sessionAuthClient, secureSessionStore });
const sceneClient = new SceneClient({ authClient: sessionAuthClient, secureSessionStore });
const supplyClient = new SupplyClient({ authClient: sessionAuthClient, secureSessionStore });
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
      // Do not rotate refresh tokens on every launch. A still-valid access
      // token is enough; getAccessToken refreshes only near expiry. Transient
      // network/server failures preserve the Keychain session and the app can
      // retry when an authenticated action is made.
      if (state.status === "AUTHENTICATED") {
        try {
          const accessToken = await sessionAuthClient.getAccessToken();
          if (!accessToken) throw new Error("session_expired");
        } catch (error) {
          if (isGuestFlag === "1") {
            if (!cancelled) setPhase("PUBLIC");
            return;
          }
          // A retained Keychain record means this may only be a temporary
		  // refresh outage. Keep the account signed in; explicit auth rejection
		  // clears the record inside SessionAuthClient and reaches SIGNED_OUT.
		  const retained = await secureSessionStore.read().catch(() => undefined);
		  if (!cancelled) setPhase(retained ? "AUTHENTICATED" : "SIGNED_OUT");
          return;
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
      if (existing) return;
      await lastSignInStore.write({
        channel: "EMAIL",
        identifier: "proxy@account",
        signedInAt: new Date().toISOString()
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
        marketplace={marketplaceClient}
        socialSpace={socialSpaceClient}
        fulfillment={fulfillmentClient}
        payment={paymentClient}
        notification={notificationClient}
        business={businessClient}
        supply={supplyClient}
        scene={sceneClient}
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
      <ActivityIndicator color={color.magenta} style={styles.spinner} />
      <Text style={styles.secondary}>让时间遇见需要。</Text>
    </View>
  );
}

function BrandMark({ large = false }: { large?: boolean }): React.JSX.Element {
  return (
    <View style={styles.brandBlock}>
      <Image accessibilityLabel="Proxy" source={require("../assets/otter-logo.png")} style={[styles.otterLogo, large && styles.otterLogoLarge]} />
      <Text style={[styles.brandName, large && styles.brandNameLarge]}>Proxy</Text>
      <Text style={styles.brandSlogan}>让时间遇见需要。</Text>
      <Text style={styles.brandSloganEn}>Where time meets need.</Text>
    </View>
  );
}

function AuthenticationEntryScreen({ onAuthenticated, onGuest }: { onAuthenticated: () => void; onGuest: () => void }): React.JSX.Element {
  const [challengeId, setChallengeId] = useState<string>();
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [googleEmail, setGoogleEmail] = useState("");
  const [authChannel, setAuthChannel] = useState<"SMS" | "EMAIL">("SMS");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // R15.36: 历史登录账户 — 只在 login 模式 展示。
  // 脱敏的 identifier 已经读取, 用户点 "继续" 会自动填 + 发起验证码。
  // "换号" 本地 dismiss (不写盘), 下次开 app 重新出现 — 因为上一个
  // session 仍然有效 (记忆者还可以 “返回上号”)。
  const [lastSignIn, setLastSignIn] = useState<LastSignIn | undefined>(undefined);
  const [lastSignInDismissed, setLastSignInDismissed] = useState(false);

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
      const loginClient = await getNativeLoginClient();
      const result = await loginClient.beginPasswordlessAuthentication({
        channel: entry.channel,
        identifier: entry.identifier,
        platform: Platform.OS === "ios" ? "IOS" : "ANDROID"
      });
      setChallengeId(result.challengeId);
    } catch (err) {
      setError(`无法重新发送验证码：${err instanceof Error ? err.message : String(err)}`.slice(0, 240));
    } finally {
      setBusy(false);
    }
  }

  async function requestChallenge(): Promise<void> {
    setBusy(true);
    setError(undefined);
    const isEmail = authChannel === "EMAIL";
    let rawEmail = googleEmail.trim().toLowerCase();
    // 自动补全 gmail.com 后缀（用户只输用户名时）
    if (isEmail && rawEmail && !rawEmail.includes("@")) rawEmail = `${rawEmail}@gmail.com`;
    if (isEmail && rawEmail !== googleEmail.trim().toLowerCase()) setGoogleEmail(rawEmail);
    const identifier = isEmail ? rawEmail : normalizeVietnamesePhone(phone);
    if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
      setError("请输入有效的 Google 邮箱地址（可只输用户名自动补全 @gmail.com）。");
      setBusy(false);
    } else {
      if (!isEmail && identifier === "") {
        setError("请输入有效的越南手机号（09xxxxxxxx / +84xxxxxxxxx），座机请带区号如 02412345678。");
        setBusy(false);
        return;
      }
      try {
        const loginClient = await getNativeLoginClient();
        const result = await loginClient.beginPasswordlessAuthentication({
          channel: isEmail ? "EMAIL" : "SMS",
          identifier,
          platform: Platform.OS === "ios" ? "IOS" : "ANDROID"
        });
        setChallengeId(result.challengeId);
        // NOTE: We deliberately do NOT auto-open Gmail / mail.google.com
        // here. Doing so yanks the user out of the App and makes the OTP
        // input screen invisible — they come back to a "stuck" feeling
        // because the App is in the background. The helper text on the
        // next screen ("验证码已发送至 ...") tells them to switch to the
        // Mail app themselves when they are ready.
      } catch (err) {
        // DEBUG (R15.27): surface the real error so we know why fetch/begin fails on iPhone.
        // eslint-disable-next-line no-console
        console.log("[proxy.login] beginPasswordlessAuthentication ERROR:", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
        // R15.27: if device is already bound to a different user (anonymous/legacy),
        // rotate the deviceId and retry once. Same pattern as createNativeGuestSession.
        if (
          err instanceof LoginCommandRejectedError &&
          (err.result.error?.errorCode === "PASSWORDLESS_IDENTITY_UNAVAILABLE" ||
            err.result.error?.errorCode === "LOGIN_PROVIDER_NOT_CONFIGURED" ||
            err.result.error?.errorCode === "ACCOUNT_NOT_ACTIVE")
        ) {
          let retrySucceeded = false;
          try {
            // eslint-disable-next-line no-console
            console.log("[proxy.login] rotating deviceId and retrying BeginPasswordlessAuthentication");
            const rotated = await rotateGuestDeviceIdentity();
            const result = await rotated.beginPasswordlessAuthentication({
              channel: isEmail ? "EMAIL" : "SMS",
              identifier,
              platform: Platform.OS === "ios" ? "IOS" : "ANDROID"
            });
            setChallengeId(result.challengeId);
            retrySucceeded = true;
          } catch (retryErr) {
            // eslint-disable-next-line no-console
            console.log("[proxy.login] retry after rotate FAILED:", retryErr instanceof Error ? `${retryErr.name}: ${retryErr.message}` : String(retryErr));
          }
          if (!retrySucceeded) {
            setError(
              `DEBUG ${err instanceof Error ? err.message : String(err)}`.slice(0, 240) ||
                (authChannel === "EMAIL" ? "无法发送验证码到该邮箱，请检查地址或使用手机号。" : "无法发送验证码。请检查越南手机号格式（09xxxxxxxx / +84xxxxxxxxx）。")
            );
          }
        } else {
          setError(
            `DEBUG ${err instanceof Error ? err.message : String(err)}`.slice(0, 240) ||
              (authChannel === "EMAIL" ? "无法发送验证码到该邮箱，请检查地址或使用手机号。" : "无法发送验证码。请检查越南手机号格式（09xxxxxxxx / +84xxxxxxxxx）。")
          );
        }
      } finally {
        setBusy(false);
      }
    }
  }

  async function continueAsGuest(): Promise<void> {
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
      await loginClient.createSessionFromChallenge(challengeId);
      await nativeSecureStorageDriver.setItem(GUEST_FLAG_KEY, "0").catch(()=>undefined);
      // R15.36: 记住上次的 identifier, 下次进来在登录页顶部展示
      // "继续使用" 卡片。
      await lastSignInStore.write({
        channel: authChannel,
        identifier: authChannel === "EMAIL" ? googleEmail.trim().toLowerCase() : normalizeVietnamesePhone(phone),
        signedInAt: new Date().toISOString()
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

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.screenAvoid}>
      <ScrollView contentContainerStyle={styles.screenScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.screenInner}>
            <View style={styles.card}>
        <BrandMark />
        {authMode === "login" && lastSignIn && !lastSignInDismissed ? (
          <View style={styles.rememberedCard}>
            <View style={styles.rememberedAvatar}>
              <Text style={styles.rememberedAvatarText}>
                {avatarLetterFor(lastSignIn.channel, lastSignIn.identifier)}
              </Text>
            </View>
            <View style={styles.rememberedAcct}>
              <Text style={styles.rememberedLabel}>继续使用</Text>
              <Text style={styles.rememberedIdentifier} numberOfLines={1}>
                {maskIdentifier(lastSignIn.channel, lastSignIn.identifier)}
              </Text>
            </View>
            <Pressable
              onPress={() => void continueAsLastSignIn(lastSignIn)}
              style={styles.rememberedContinue}
              accessibilityLabel="继续上次的账号"
            >
              <Text style={styles.rememberedContinueText}>继续</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setLastSignInDismissed(true);
                setError(undefined);
              }}
              style={styles.rememberedSwitch}
              accessibilityLabel="切换其他账号"
            >
              <Text style={styles.rememberedSwitchText}>换号</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.authTabs}>
          <Pressable onPress={() => { setAuthMode("login"); setChallengeId(undefined); setCode(""); setError(undefined); }} style={[styles.authTab, authMode === "login" && styles.authTabActive]}>
            <Text style={[styles.authTabText, authMode === "login" && styles.authTabTextActive]}>登录</Text>
          </Pressable>
          <Pressable onPress={() => { setAuthMode("register"); setAuthChannel("SMS"); setChallengeId(undefined); setCode(""); setError(undefined); }} style={[styles.authTab, authMode === "register" && styles.authTabActive]}>
            <Text style={[styles.authTabText, authMode === "register" && styles.authTabTextActive]}>注册</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>{authMode === "login" ? "欢迎回来" : "创建账户"}</Text>
        <Text style={styles.secondary}>{authMode === "login" ? "手机号/邮箱验证登录" : "手机号/邮箱验证后自动注册，默认 Individual Requester"}</Text>
        {challengeId ? (
          <>
            <Text style={styles.helper}>验证码已发送至 {authChannel === "EMAIL" ? googleEmail.trim().toLowerCase() : formatVietnamesePhoneForDisplay(normalizeVietnamesePhone(phone))}</Text>
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
                <Text style={styles.buttonText}>{busy ? "验证中…" : "继续"}</Text>
              </Pressable>
            </View>
            <View style={styles.inlineActions}>
              <Pressable disabled={busy} onPress={() => { setChallengeId(undefined); setCode(""); }}><Text style={styles.linkText}>更换手机号</Text></Pressable>
              <Pressable disabled={busy} onPress={() => void requestChallenge()}><Text style={styles.linkText}>重新发送</Text></Pressable>
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
              <Pressable onPress={() => { setAuthChannel("SMS"); setError(undefined); }} style={[styles.googleButton, authChannel === "SMS" && styles.googleButtonActive, styles.googleButtonSmall]}>
                <Text style={styles.googleLabel}>手机</Text>
              </Pressable>
            </View>
            {authChannel === "EMAIL" ? (
              <>
                <View style={styles.phoneRow}><Text style={styles.countryCode}>@</Text><TextInput autoCapitalize="none" blurOnSubmit keyboardType="email-address" onChangeText={setGoogleEmail} onSubmitEditing={() => Keyboard.dismiss()} placeholder="用户名或完整 Gmail（自动补全 @gmail.com）" placeholderTextColor="#A9A2B0" returnKeyType="done" style={styles.phoneInput} value={googleEmail} /></View>
                <View style={[styles.button, busy || googleEmail.trim().length === 0 ? styles.disabled : null]}>
                  <Gradient from={color.magenta} to={color.violet} style={absoluteFillStyle} />
                  <Pressable disabled={busy || googleEmail.trim().length === 0} onPress={() => void requestChallenge()} style={styles.buttonPressable}>
                    <Text style={styles.buttonText}>{busy ? "发送中…" : "获取邮箱验证码"}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.divider}>或使用越南手机号（可输 09… / +84… / 0084…）</Text>
                <View style={styles.phoneRow}><Text style={styles.countryCode}>+84</Text><TextInput blurOnSubmit keyboardType="phone-pad" onChangeText={setPhone} onSubmitEditing={() => Keyboard.dismiss()} placeholder="0912345678 或粘贴 +84 号码" placeholderTextColor="#A9A2B0" returnKeyType="done" style={styles.phoneInput} value={phone} /></View>
                <View style={[styles.button, busy || !vietnamesePhoneReady(phone) ? styles.disabled : null]}>
                  <Gradient from={color.magenta} to={color.violet} style={absoluteFillStyle} />
                  <Pressable disabled={busy || !vietnamesePhoneReady(phone)} onPress={() => void requestChallenge()} style={styles.buttonPressable}>
                    <Text style={styles.buttonText}>{busy ? "发送中…" : "获取验证码"}</Text>
                  </Pressable>
                </View>
              </>
            )}
            <Pressable disabled={busy} onPress={() => void continueAsGuest()} style={styles.guestButton}><Text style={styles.guestText}>暂不登录，直接使用 Proxy</Text></Pressable>
            <Text style={styles.oauthHint}>访客会保存当前设备、会话与使用记录；需要发布、交易或长期保存时再升级登录。</Text>
            <Pressable onPress={() => { setAuthMode(authMode === "login" ? "register" : "login"); setError(undefined); }} style={styles.switchAuthRow}>
              <Text style={styles.switchAuthText}>{authMode === "login" ? "没有账号？去注册" : "已有账号？去登录"}</Text>
            </Pressable>
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
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
          await loginClient.authenticateWithGoogle(response.authentication!.idToken!, Platform.OS === "ios" ? "IOS" : "ANDROID");
          await nativeSecureStorageDriver.setItem(GUEST_FLAG_KEY, "0").catch(()=>undefined);
          // R15.36: Google 流程下我们没有 email (需要额外 fetch userinfo),
          // 暂以 "Google 账号" + 唯一末位来记住。后续如果 server 返回
          // principal.email 可以换。
          await lastSignInStore.write({
            channel: "EMAIL",
            identifier: "google@account",
            signedInAt: new Date().toISOString()
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
      <Text style={styles.googleText}>G</Text><Text style={styles.googleLabel}>使用 Google 继续</Text>
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
      <Text style={styles.googleText}>G</Text><Text style={styles.googleLabel}>使用 Google 邮箱</Text>
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
        console.log(
          `[proxy.smoke] keychain=present principalId=${principalId} sessionId=${restored.session.auth.sessionId}`
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
  otterLogo: { height: 56, resizeMode: "contain", width: 56 },
  otterLogoLarge: { height: 76, width: 76 },
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
  authTabs: { flexDirection: "row", backgroundColor: color.surface, borderRadius: 12, padding: 3, marginTop: 14, width: "100%" },
  authTab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 8 },
  authTabActive: { backgroundColor: color.white, ...shadows.card },
  authTabText: { color: color.muted, fontSize: 14, fontWeight: "700" },
  authTabTextActive: { color: color.ink },
  switchAuthRow: { alignItems: "center", marginTop: 12, paddingVertical: 6 },
  switchAuthText: { color: color.violet, fontSize: 13, fontWeight: "700" },
  googleButton: { alignItems: "center", borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", justifyContent: "center", marginTop: 20, minHeight: 50, width: "100%" },
  googleButtonRow: { flexDirection: "row", gap: 8, width: "100%" },
  googleButtonActive: { borderColor: color.violet, backgroundColor: "#F0EBF5" },
  googleButtonSmall: { flex: 0.4 },
  googleText: { color: "#4285F4", fontSize: 20, fontWeight: "900", marginRight: 10 },
  googleLabel: { color: color.ink, fontSize: 15, fontWeight: "800" },
  divider: { color: color.muted, fontSize: 12, marginTop: 20 },
  phoneRow: { alignItems: "center", backgroundColor: color.surface, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", marginTop: 10, minHeight: 52, paddingHorizontal: 16, width: "100%" },
  countryCode: { color: color.ink, fontSize: 16, fontWeight: "800", marginRight: 12 },
  phoneInput: { color: color.ink, flex: 1, fontSize: 16, paddingVertical: 12 },
  guestButton: { alignItems: "center", marginTop: 18, paddingVertical: 10 },
  guestText: { color: color.violet, fontSize: 14, fontWeight: "800" },
  inlineActions: { flexDirection: "row", gap: 28, justifyContent: "center", marginTop: 18 },
  linkText: { color: color.violet, fontSize: 13, fontWeight: "700" },
  oauthHint: { color: color.muted, fontSize: 11, lineHeight: 17, marginTop: 18, textAlign: "center" },
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
  rememberedContinue: {
    alignItems: "center",
    backgroundColor: color.ink,
    borderRadius: 11,
    height: 38,
    justifyContent: "center",
    paddingHorizontal: 13
  },
  rememberedContinueText: {
    color: color.white,
    fontSize: 13,
    fontWeight: "700"
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
