import type { PrincipalContext, SessionAuthTokens } from "@proxy/contracts";

export const SECURE_SESSION_STORAGE_KEY = "proxy.secure.session.v1";

// R15.34.1 P0 fix: 拒绝 “离线 fallback guest” 走写路径。
//   createNativeGuestSession 在 API 不可达/限流/服务端错误时会降级
//   造一个 fake accessToken 的本地 session，让用户能读匿名内容。
//   但 server 端没有这条 session 记录，accessToken 是假的，发写命令
//   (CreatePost / Engagement / Demand / Scene / Conversation 等)
//   必被 server 拒。客户端必须先拦在门口，不要让用户看见 “发布中”
//   再出“远端抛 INVALID_ACCESS_TOKEN”的脱节体验。
//   读路径 (listFeedPosts / listMarketplace 走 requestPublic) 不走这里。
export class OfflineFallbackSessionError extends Error {
  public constructor() {
    super("offline fallback session cannot perform write operations — sign in to continue");
    this.name = "OfflineFallbackSessionError";
  }
}

export type AuthenticatedStoredSession = StoredSession & { principal: NonNullable<StoredSession["principal"]> };

/**
 * Read the current session and require that it is a real server-issued
 * session (not the offline fallback from createNativeGuestSession).
 *
 * Throws OfflineFallbackSessionError if the session exists but is the
 * offline fallback, and a generic Error if there is no session at all.
 */
export async function requireAuthenticatedServerSession(input: {
  store: SecureSessionStore;
}): Promise<AuthenticatedStoredSession> {
  const session = await input.store.read();
  if (!session?.principal) {
    throw new Error("an authenticated principal is required");
  }
  if (session.serverSession === false) {
    throw new OfflineFallbackSessionError();
  }
  // R15.39: signOut 不再全清 keychain — 改为设 signedOut=true。
  //   随后任何走 requireSession / requireAuthenticatedServerSession 的
  //   写路径都被拦下, 跟 "离线 fallback" 一样。读路径依旧可用。
  if (session.signedOut === true) {
    throw new SignedOutSessionError();
  }
  return session as AuthenticatedStoredSession;
}

// R15.39: 区分 "本地离线 fallback" (createNativeGuestSession API-downgrade
//   产生的假 session, server 端无记录) 和 "本地已登出" (用户主动登出, 但
//   refreshToken 还在 keychain 里, 可作 silent re-auth 用)。
//   两个错误名字不同, UI 可以分别提示。
export class SignedOutSessionError extends Error {
  public constructor() {
    super("user is signed out — re-authenticate to perform write operations");
    this.name = "SignedOutSessionError";
  }
}

export type StoredSession = {
	userAccountId: string;
	auth: SessionAuthTokens;
	principal?: PrincipalContext;
	// R15.34.1: 标志这个 session 是不是由 server (BeginPasswordlessAuthentication
	//   / createAnonymousSession) 真实签发。
	//   - undefined / true = 真实 server session，可以发写命令 (CreatePost,
	//     Engagement, Demand 等)
	//   - false = 本地离线 fallback (createNativeGuestSession 在 API
	//     不可达时降级生成的 fake session)，只允许读匿名路径，不能发
	//     写命令 — server 侧也拿不到有效 access token，提交必拒。
	//   旧 session (升级前写的) 默认按 true 处理 (向后兼容)。
	serverSession?: boolean;
	// R15.39: 用户主动登出 (signOut) 后, session 留在 keychain 里供
	//   silent re-auth 用, 同时设 signedOut=true + signedOutAt 锁定“本
	//   地登出”状态。这两个字段只在 "曾经是真实 server session" 才出现;
	//   离线 fallback 不会走到这里。
	//   - signedOut=true + signedOutAt: 任何写路径 (requireSession /
	//     requireAuthenticatedServerSession) 都会抛 SignedOutSessionError,
	//     UI 上面跟 "未登录" 一样表现 (但错误类不同, 能区分是不是 silent
	//     re-auth 可选)。
	//   - signedOut=undefined: 正常 server session。
	signedOut?: boolean;
	signedOutAt?: string;
};

/**
 * The native host must implement this with iOS Keychain / Android Keystore.
 * AsyncStorage, SQLite, analytics, and crash-report stores are intentionally
 * not accepted as a session driver.
 */
export interface SecureStorageDriver {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export class InvalidStoredSessionError extends Error {
  public constructor() {
    super("stored session is invalid");
    this.name = "InvalidStoredSessionError";
  }
}

export class SecureSessionStore {
  public constructor(
    private readonly driver: SecureStorageDriver,
    private readonly now: () => Date = () => new Date()
  ) {}

  public async read(): Promise<StoredSession | undefined> {
    const raw = await this.driver.getItem(SECURE_SESSION_STORAGE_KEY);
    if (raw === null) return undefined;

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      await this.driver.deleteItem(SECURE_SESSION_STORAGE_KEY);
      return undefined;
    }
    if (!isStoredSession(decoded)) {
      await this.driver.deleteItem(SECURE_SESSION_STORAGE_KEY);
      return undefined;
    }
    if (Date.parse(decoded.auth.refreshExpiresAt) <= this.now().getTime()) {
      await this.driver.deleteItem(SECURE_SESSION_STORAGE_KEY);
      return undefined;
    }
    const cloned = cloneSession(decoded);
    // R15.34.2 P0 追打: 补标记 “旧版” 离线 fallback session。
    //   升级前在 keychain 里的离线 session 没有 serverSession 字段 (看起来像真实
    //   session), 但其 accessToken 以 "offline_" 开头, sessionId 以
    //   "sess_offline_" 开头 — 可以凭此识别出它是 createNativeGuestSession
    //   API-downgrade 产生的假 session, 这里是补上 serverSession: false 标记。
    //   透出到 caller 后, requireSession 会照样拦下。
    if (cloned.serverSession === undefined && looksLikeOfflineFallback(cloned)) {
      cloned.serverSession = false;
    }
    return cloned;
  }

  public async write(session: StoredSession): Promise<void> {
    if (!isStoredSession(session) || Date.parse(session.auth.refreshExpiresAt) <= this.now().getTime()) {
      throw new InvalidStoredSessionError();
    }
    const safeSession = cloneSession(session);
    await this.driver.setItem(SECURE_SESSION_STORAGE_KEY, JSON.stringify(safeSession));
  }

  public async clear(): Promise<void> {
    await this.driver.deleteItem(SECURE_SESSION_STORAGE_KEY);
  }
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
	const candidate = value as { userAccountId?: unknown; auth?: unknown; principal?: unknown; serverSession?: unknown; signedOut?: unknown; signedOutAt?: unknown };
	if (typeof candidate.userAccountId !== "string" || candidate.userAccountId.length === 0) return false;
  if (!isSessionAuthTokens(candidate.auth)) return false;
  if (candidate.principal !== undefined && !isPrincipal(candidate.principal)) return false;
  // R15.34.1: serverSession 可选, 必须是 boolean 或 undefined.
  if (candidate.serverSession !== undefined && typeof candidate.serverSession !== "boolean") return false;
  // R15.39: signedOut / signedOutAt 可选, 必须是 boolean / ISO string 或 undefined.
  if (candidate.signedOut !== undefined && typeof candidate.signedOut !== "boolean") return false;
  if (candidate.signedOutAt !== undefined) {
    if (typeof candidate.signedOutAt !== "string" || Number.isNaN(Date.parse(candidate.signedOutAt))) return false;
  }
  return true;
}

function isSessionAuthTokens(value: unknown): value is SessionAuthTokens {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<SessionAuthTokens>;
  return (
    typeof token.sessionId === "string" &&
    token.sessionId.length > 0 &&
    typeof token.userAccountId === "string" &&
    token.userAccountId.length > 0 &&
    isPrincipal(token.principal) &&
    typeof token.accessToken === "string" &&
    token.accessToken.length > 0 &&
    typeof token.refreshToken === "string" &&
    token.refreshToken.length > 0 &&
    typeof token.accessExpiresAt === "string" &&
    Number.isFinite(Date.parse(token.accessExpiresAt)) &&
    typeof token.refreshExpiresAt === "string" &&
    Number.isFinite(Date.parse(token.refreshExpiresAt)) &&
    typeof token.rotation === "number" &&
    Number.isInteger(token.rotation) &&
    token.rotation > 0
  );
}

export function parseSessionAuthTokens(value: unknown): SessionAuthTokens | undefined {
  if (!isSessionAuthTokens(value)) return undefined;
  return {
    sessionId: value.sessionId,
    userAccountId: value.userAccountId,
    principal: value.principal,
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    accessExpiresAt: value.accessExpiresAt,
    refreshExpiresAt: value.refreshExpiresAt,
    rotation: value.rotation
  };
}

function isPrincipal(value: unknown): value is PrincipalContext {
  if (!value || typeof value !== "object") return false;
  const principal = value as Partial<PrincipalContext>;
  return (
    (principal.type === "INDIVIDUAL" || principal.type === "BUSINESS") &&
    typeof principal.id === "string" &&
    principal.id.length > 0
  );
}

function cloneSession(session: StoredSession): StoredSession {
	return {
		userAccountId: session.userAccountId,
		auth: {
      sessionId: session.auth.sessionId,
      userAccountId: session.auth.userAccountId,
      principal: { type: session.auth.principal.type, id: session.auth.principal.id },
      accessToken: session.auth.accessToken,
      refreshToken: session.auth.refreshToken,
      accessExpiresAt: session.auth.accessExpiresAt,
      refreshExpiresAt: session.auth.refreshExpiresAt,
      rotation: session.auth.rotation
    },
    ...(session.principal ? { principal: { type: session.principal.type, id: session.principal.id } } : {}),
    // R15.34.1: 保留 serverSession 标志 (false = 离线 fallback).
    //   旧 session 不写这个字段， clone 后为 undefined → 默认看作真实
    //   server session (向下兼容)。
    ...(session.serverSession !== undefined ? { serverSession: session.serverSession } : {}),
    // R15.39: signedOut / signedOutAt 同理。undefined = 正常 server session.
    ...(session.signedOut !== undefined ? { signedOut: session.signedOut } : {}),
    ...(session.signedOutAt !== undefined ? { signedOutAt: session.signedOutAt } : {})
  };
}

/** Test-only driver. Native builds must replace this with a Keychain/Keystore adapter. */
export class InMemorySecureStorageDriver implements SecureStorageDriver {
  private readonly values = new Map<string, string>();

  public async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  public async deleteItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

// R15.34.2 P0 追打: 判断一个 session 是不是 createNativeGuestSession API-downgrade
//   产生的假 session (升级前在 keychain 里没有 serverSession 字段时用)。
//   这类 session 的两个明显特征:
//     - accessToken 以 "offline_" 开头 (createNativeGuestSession 内部生成)
//     - sessionId 以 "sess_offline_" 开头
//   只要任一条件成立就判定为 offline fallback。需要保守: 误判真实 session
//   为 fallback 代价是用户需要重新登录 (轻), 漏判则是 P0 违例 (重)。
function looksLikeOfflineFallback(session: StoredSession): boolean {
  const access = session.auth?.accessToken ?? "";
  const sid = session.auth?.sessionId ?? "";
  if (typeof access === "string" && access.startsWith("offline_")) return true;
  if (typeof sid === "string" && sid.startsWith("sess_offline_")) return true;
  return false;
}
