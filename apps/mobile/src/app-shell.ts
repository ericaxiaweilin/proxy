import type { SecureSessionStore, StoredSession } from "./secure-session";

export type AppShellStatus = "BOOTSTRAPPING" | "AUTHENTICATED" | "OFFLINE" | "RESTRICTED" | "SIGNED_OUT";
export type PrincipalContext = "INDIVIDUAL" | "BUSINESS";

export type AppShellState = {
  status: AppShellStatus;
  principal?: PrincipalContext;
  initialRoute: "auth" | "home" | "offline" | "restricted";
};

export type RestoredAppShell = {
  state: AppShellState;
  session?: StoredSession;
};

export function resolveInitialRoute(input: { hasSession: boolean; isRestricted: boolean; isOffline: boolean }): AppShellState {
  if (input.isRestricted) return { status: "RESTRICTED", initialRoute: "restricted" };
  if (!input.hasSession) return { status: "SIGNED_OUT", initialRoute: "auth" };
  if (input.isOffline) return { status: "OFFLINE", initialRoute: "offline" };
  return { status: "AUTHENTICATED", initialRoute: "home" };
}

export async function restoreAppShell(input: {
  secureSessionStore: SecureSessionStore;
  isRestricted: boolean;
  isOffline: boolean;
}): Promise<RestoredAppShell> {
  const session = await input.secureSessionStore.read();
  // R15.39: 用户主动登出后, session 仍在 keychain 里, 但带 signedOut=true。
  //   restore 阶段不认这种 session — 交回 PUBLIC 状态, 让 user
  //   看到认证页 + “继续使用” 卡片。点 “继续” 走 silent re-auth。
  const effectivelySignedOut = session?.signedOut === true;
  return {
    state: resolveInitialRoute({
      hasSession: session !== undefined && !effectivelySignedOut,
      isRestricted: input.isRestricted,
      isOffline: input.isOffline
    }),
    ...(session ? { session } : {})
  };
}

export async function signOutApp(secureSessionStore: SecureSessionStore): Promise<AppShellState> {
  // R15.39: signOutApp 只在彻底登出 / 测例 / 重置时调用。生产里走
  //   sessionAuthClient.signOut() (保留 refreshToken, 设 signedOut=true)。
  await secureSessionStore.clear();
  return resolveInitialRoute({ hasSession: false, isRestricted: false, isOffline: false });
}
