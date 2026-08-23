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
  return {
    state: resolveInitialRoute({
      hasSession: session !== undefined,
      isRestricted: input.isRestricted,
      isOffline: input.isOffline
    }),
    ...(session ? { session } : {})
  };
}

export async function signOutApp(secureSessionStore: SecureSessionStore): Promise<AppShellState> {
  await secureSessionStore.clear();
  return resolveInitialRoute({ hasSession: false, isRestricted: false, isOffline: false });
}
