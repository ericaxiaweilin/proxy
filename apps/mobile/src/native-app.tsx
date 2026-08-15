import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { restoreAppShell, resolveInitialRoute, type AppShellState } from "./app-shell";
import { SessionAuthClient, type Transport } from "./auth-client";
import { DemandClient } from "./demand-client";
import { LoginClient } from "./login-client";
import { RequesterApp } from "./requester-app";
import { SecureSessionStore } from "./secure-session";
import { nativeSecureStorageDriver } from "./native-secure-storage";
import { color, Gradient, shadows } from "./theme";

const absoluteFillStyle = { bottom: 0, left: 0, position: "absolute" as const, right: 0, top: 0 };

const secureSessionStore = new SecureSessionStore(nativeSecureStorageDriver);
const localApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? (Platform.OS === "android" ? "http://10.0.2.2:4100" : "http://127.0.0.1:4100");
const developmentLoginEnabled = process.env.EXPO_PUBLIC_LOGIN_MODE === "simulated";
const nativeTransport: Transport = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body !== undefined ? { body: request.body } : {})
  });
  return { status: response.status, json: () => response.json() };
};
const developmentLoginClient = new LoginClient({
  baseUrl: localApiBaseUrl,
  deviceId: "device_001",
  secureSessionStore,
  transport: nativeTransport
});
const sessionAuthClient = new SessionAuthClient({ baseUrl: localApiBaseUrl, secureSessionStore, transport: nativeTransport });
const demandClient = new DemandClient({ authClient: sessionAuthClient, secureSessionStore });

export function ProxyApp(): React.JSX.Element {
  const [state, setState] = useState<AppShellState>();

  useEffect(() => {
    let mounted = true;
    void restoreNativeShell().then((nextState) => {
      if (mounted) setState(nextState);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!state) {
    return <BootScreen />;
  }

  if (state.initialRoute === "auth") {
    return developmentLoginEnabled ? (
      <DevelopmentAuthScreen onAuthenticated={() => setState(resolveInitialRoute({ hasSession: true, isRestricted: false, isOffline: false }))} />
    ) : <AuthUnavailableScreen />;
  }

  if (state.initialRoute === "home") {
    return (
      <RequesterApp
        demandClient={demandClient}
        onSignOut={async () => {
          await sessionAuthClient.signOut();
          setState(resolveInitialRoute({ hasSession: false, isRestricted: false, isOffline: false }));
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <BrandMark />
        <Text style={styles.title}>{statusTitle(state)}</Text>
        <Text style={styles.secondary}>Native App Shell · {state.initialRoute}</Text>
      </View>
    </SafeAreaView>
  );
}

function BootScreen(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.screen}>
      <BrandMark large />
      <ActivityIndicator color={color.magenta} style={styles.spinner} />
      <Text style={styles.secondary}>让时间遇见需要。</Text>
    </SafeAreaView>
  );
}

function BrandMark({ large = false }: { large?: boolean }): React.JSX.Element {
  return (
    <View style={styles.brandBlock}>
      <Gradient from={color.magenta} to={color.violet} style={[styles.brandLogo, large && styles.brandLogoLarge, shadows.hero]}>
        <Text style={[styles.brandLogoText, large && styles.brandLogoTextLarge]}>P</Text>
      </Gradient>
      <Text style={[styles.brandName, large && styles.brandNameLarge]}>Proxy</Text>
      <Text style={styles.brandSlogan}>让时间遇见需要。</Text>
      <Text style={styles.brandSloganEn}>Where time meets need.</Text>
    </View>
  );
}

function DevelopmentAuthScreen({ onAuthenticated }: { onAuthenticated: () => void }): React.JSX.Element {
  const [challengeId, setChallengeId] = useState<string>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function requestChallenge(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const result = await developmentLoginClient.requestChallenge({ loginIdentityId: "login_001", channel: "EMAIL" });
      setChallengeId(result.challengeId);
    } catch {
      setError("无法请求模拟登录验证码，请确认 Go API 已用 simulated provider 启动。");
    } finally {
      setBusy(false);
    }
  }

  async function completeLogin(): Promise<void> {
    if (!challengeId || code.trim() === "") return;
    setBusy(true);
    setError(undefined);
    try {
      await developmentLoginClient.verifyChallenge(challengeId, code);
      await developmentLoginClient.createSession({
        userAccountId: "user_001",
        loginIdentityId: "login_001",
        challengeId,
        requestedPrincipal: { type: "INDIVIDUAL", id: "user_001" }
      });
      onAuthenticated();
    } catch {
      setError("验证码无效或已过期，请重新请求。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>登录 Proxy</Text>
        <Text style={styles.secondary}>开发模式 · user_001 · device_001</Text>
        <Text style={styles.helper}>模拟验证码：123456（仅本地开发）</Text>
        {challengeId ? (
          <>
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
                <Text style={styles.buttonText}>{busy ? "验证中…" : "验证并进入 App"}</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={[styles.button, busy ? styles.disabled : null]}>
            <Gradient from={color.magenta} to={color.violet} style={absoluteFillStyle} />
            <Pressable disabled={busy} onPress={() => void requestChallenge()} style={styles.buttonPressable}>
              <Text style={styles.buttonText}>{busy ? "请求中…" : "请求模拟验证码"}</Text>
            </Pressable>
          </View>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

function AuthUnavailableScreen(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <BrandMark />
        <Text style={styles.title}>登录服务待配置</Text>
        <Text style={styles.secondary}>当前 App 没有启用本地模拟登录 Provider。</Text>
      </View>
    </SafeAreaView>
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

function statusTitle(state: AppShellState): string {
  switch (state.status) {
    case "AUTHENTICATED":
      return "欢迎回来";
    case "OFFLINE":
      return "离线模式";
    case "RESTRICTED":
      return "需要处理账户状态";
    case "SIGNED_OUT":
      return "开始使用 Proxy";
    case "BOOTSTRAPPING":
      return "正在启动";
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
  brandLogo: { alignItems: "center", borderRadius: 22, height: 56, justifyContent: "center", width: 56 },
  brandLogoLarge: { borderRadius: 30, height: 76, width: 76 },
  brandLogoText: { color: color.white, fontSize: 30, fontWeight: "900" },
  brandLogoTextLarge: { fontSize: 40 },
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
