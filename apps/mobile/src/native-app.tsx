import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { restoreAppShell, resolveInitialRoute, type AppShellState } from "./app-shell";
import { type Transport, SessionAuthClient } from "./auth-client";
import { ConversationClient } from "./conversation-client";
import { DemandClient } from "./demand-client";
import { LoginClient } from "./login-client";
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
import { SecureSessionStore } from "./secure-session";
import { nativeSecureStorageDriver } from "./native-secure-storage";
import { AppShell } from "./shell/app-shell";
import { color, Gradient, shadows } from "./theme";

const absoluteFillStyle = { bottom: 0, left: 0, position: "absolute" as const, right: 0, top: 0 };

WebBrowser.maybeCompleteAuthSession();

const secureSessionStore = new SecureSessionStore(nativeSecureStorageDriver);
const INSTALLATION_DEVICE_ID_KEY = "proxy.installation.device-id.v1";
const localApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? (Platform.OS === "android" ? "http://10.0.2.2:4100" : "http://127.0.0.1:4100");
const nativeTransport: Transport = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
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
// 服务端驱动 Surface 的认证客户端：读模型/命令全部走 /v1/commands/ envelope。
const sessionAuthClient = new SessionAuthClient({
  baseUrl: localApiBaseUrl,
  secureSessionStore,
  transport: nativeTransport
});
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
type BootPhase = "BOOTSTRAPPING" | "AUTHENTICATED" | "SIGNED_OUT";

export function ProxyApp(): React.JSX.Element {
  // R15 Model-Driven UI：不再内嵌 HTML 原型（Gate O）。
  // 启动引导 → 统一认证入口 → 认证后渲染 App Shell。
  const [phase, setPhase] = useState<BootPhase>("BOOTSTRAPPING");

  useEffect(() => {
    let cancelled = false;
    void restoreNativeShell().then((state) => {
      if (cancelled) return;
      setPhase(state.status === "AUTHENTICATED" ? "AUTHENTICATED" : "SIGNED_OUT");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === "BOOTSTRAPPING") return <BootScreen />;
  if (phase === "AUTHENTICATED") {
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
        onSignOut={() => {
          void secureSessionStore.clear().catch(() => undefined).then(() => setPhase("SIGNED_OUT"));
        }}
      />
    );
  }
  return <AuthenticationEntryScreen onAuthenticated={() => setPhase("AUTHENTICATED")} />;
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

function AuthenticationEntryScreen({ onAuthenticated }: { onAuthenticated: () => void }): React.JSX.Element {
  const [challengeId, setChallengeId] = useState<string>();
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [googleEmail, setGoogleEmail] = useState("");
  const [authChannel, setAuthChannel] = useState<"SMS" | "EMAIL">("SMS");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function requestChallenge(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
		const loginClient = await getNativeLoginClient();
      const isEmail = authChannel === "EMAIL";
      let rawEmail = googleEmail.trim().toLowerCase();
      // 自动补全 gmail.com 后缀（用户只输用户名时）
      if (isEmail && rawEmail && !rawEmail.includes("@")) rawEmail = `${rawEmail}@gmail.com`;
      if (isEmail && rawEmail !== googleEmail.trim().toLowerCase()) setGoogleEmail(rawEmail);
      const identifier = isEmail ? rawEmail : `+84${phone.replace(/\D/g, "")}`;
      if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
        setError("请输入有效的 Google 邮箱地址（可只输用户名自动补全 @gmail.com）。");
        setBusy(false);
        return;
      }
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
    } catch {
      setError(authChannel === "EMAIL" ? "无法发送验证码到该邮箱，请检查地址或使用手机号。" : "无法发送验证码。请检查越南手机号和认证服务配置。");
    } finally {
      setBusy(false);
    }
  }

  async function continueAsGuest(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
		const loginClient = await getNativeLoginClient();
      await loginClient.createAnonymousSession(Platform.OS === "ios" ? "IOS" : "ANDROID");
      onAuthenticated();
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
            <Text style={styles.helper}>验证码已发送至 {authChannel === "EMAIL" ? googleEmail.trim().toLowerCase() : `+84 ${phone.replace(/\D/g, "")}`}</Text>
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
                <Text style={styles.divider}>或使用越南手机号</Text>
                <View style={styles.phoneRow}><Text style={styles.countryCode}>+84</Text><TextInput blurOnSubmit keyboardType="phone-pad" onChangeText={setPhone} onSubmitEditing={() => Keyboard.dismiss()} placeholder="请输入手机号" placeholderTextColor="#A9A2B0" returnKeyType="done" style={styles.phoneInput} value={phone} /></View>
                <View style={[styles.button, busy || phone.replace(/\D/g, "").length < 8 ? styles.disabled : null]}>
                  <Gradient from={color.magenta} to={color.violet} style={absoluteFillStyle} />
                  <Pressable disabled={busy || phone.replace(/\D/g, "").length < 8} onPress={() => void requestChallenge()} style={styles.buttonPressable}>
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
  const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
  if (!googleAuthConfigured(platform, googleClientConfig)) {
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
  return <ConfiguredGoogleSignIn {...props} />;
}

function ConfiguredGoogleSignIn(props: GoogleSignInProps): React.JSX.Element {
  const { onAuthenticated, setBusy, setError } = props;
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

async function restoreNativeShell(): Promise<AppShellState> {
  try {
    const restored = await restoreAppShell({
      secureSessionStore,
      isRestricted: false,
      isOffline: false
    });
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
  }
});
