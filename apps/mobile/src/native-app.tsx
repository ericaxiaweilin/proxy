import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { restoreAppShell, resolveInitialRoute, type AppShellState } from "./app-shell";
import { type Transport, SessionAuthClient } from "./auth-client";
import { ConversationClient } from "./conversation-client";
import { DemandClient } from "./demand-client";
import { LoginClient } from "./login-client";
import { LocalNetClient } from "./localnet-client";
import { MediaClient } from "./media-client";
import { ActivityClient } from "./activity-client";
import { ExperienceClient } from "./experience-client";
import { VoucherClient } from "./voucher-client";
import { SecureSessionStore } from "./secure-session";
import { nativeSecureStorageDriver } from "./native-secure-storage";
import { AppShell } from "./shell/app-shell";
import { color, Gradient, shadows } from "./theme";

const absoluteFillStyle = { bottom: 0, left: 0, position: "absolute" as const, right: 0, top: 0 };

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
      const identifier = isEmail ? googleEmail.trim().toLowerCase() : `+84${phone.replace(/\D/g, "")}`;
      if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
        setError("请输入有效的 Google 邮箱地址。");
        setBusy(false);
        return;
      }
      const result = await loginClient.beginPasswordlessAuthentication({
        channel: isEmail ? "EMAIL" : "SMS",
        identifier,
        platform: Platform.OS === "ios" ? "IOS" : "ANDROID"
      });
      setChallengeId(result.challengeId);
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
    } catch {
      setError("验证码无效或已过期，请重新请求。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <BrandMark />
        <Text style={styles.title}>继续使用 Proxy</Text>
        <Text style={styles.secondary}>手机号验证后自动完成登录或注册。</Text>
        {challengeId ? (
          <>
            <Text style={styles.helper}>验证码已发送至 {authChannel === "EMAIL" ? googleEmail.trim().toLowerCase() : `+84 ${phone.replace(/\D/g, "")}`}</Text>
            <TextInput
              autoFocus
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={setCode}
              placeholder="输入验证码"
              placeholderTextColor="#A9A2B0"
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
              <Pressable onPress={() => { setAuthChannel("EMAIL"); setError(undefined); }} style={[styles.googleButton, authChannel === "EMAIL" && styles.googleButtonActive]}>
                <Text style={styles.googleText}>G</Text><Text style={styles.googleLabel}>使用 Google 邮箱继续</Text>
              </Pressable>
              <Pressable onPress={() => { setAuthChannel("SMS"); setError(undefined); }} style={[styles.googleButton, authChannel === "SMS" && styles.googleButtonActive, styles.googleButtonSmall]}>
                <Text style={styles.googleLabel}>手机</Text>
              </Pressable>
            </View>
            {authChannel === "EMAIL" ? (
              <>
                <View style={styles.phoneRow}><Text style={styles.countryCode}>@</Text><TextInput autoCapitalize="none" keyboardType="email-address" onChangeText={setGoogleEmail} placeholder="请输入 Google 邮箱" placeholderTextColor="#A9A2B0" style={styles.phoneInput} value={googleEmail} /></View>
                <View style={[styles.button, busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(googleEmail.trim()) ? styles.disabled : null]}>
                  <Gradient from={color.magenta} to={color.violet} style={absoluteFillStyle} />
                  <Pressable disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(googleEmail.trim())} onPress={() => void requestChallenge()} style={styles.buttonPressable}>
                    <Text style={styles.buttonText}>{busy ? "发送中…" : "获取邮箱验证码"}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.divider}>或使用越南手机号</Text>
                <View style={styles.phoneRow}><Text style={styles.countryCode}>+84</Text><TextInput keyboardType="phone-pad" onChangeText={setPhone} placeholder="请输入手机号" placeholderTextColor="#A9A2B0" style={styles.phoneInput} value={phone} /></View>
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
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
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
