import type { SessionAuthTokens } from "@proxy/contracts";
import { parseSessionAuthTokens, SecureSessionStore, type StoredSession } from "./secure-session";

export type TransportRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export type TransportResponse = {
  status: number;
  json(): Promise<unknown>;
};

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export class SessionExpiredError extends Error {
  public constructor() {
    super("session expired");
    this.name = "SessionExpiredError";
  }
}

export class SessionRefreshUnavailableError extends Error {
  public constructor(public readonly status?: number) {
    super("session refresh temporarily unavailable");
    this.name = "SessionRefreshUnavailableError";
  }
}

export class SessionAuthClient {
  private refreshInFlight: Promise<SessionAuthTokens> | undefined;
  private commandSequence = 0;

  public constructor(
    private readonly input: {
      baseUrl: string;
      secureSessionStore: SecureSessionStore;
      transport: Transport;
      now?: () => Date;
      refreshSkewMs?: number;
    }
  ) {}

  public async getAccessToken(): Promise<string | undefined> {
    // R15.22 fix: keychain 读失败 (expo-secure-store entitlement 缺失) 不该抦住
    // 匿名读路径. server 端 requiresAuthentication 不会拒 ListMarketOpportunities
    // / ListActivities, 返 undefined 代表"未登入, 不带 bearer".
    let session: Awaited<ReturnType<typeof this.input.secureSessionStore.read>>;
    try {
      session = await this.input.secureSessionStore.read();
    } catch {
      return undefined;
    }
    if (!session) return undefined;
    const now = (this.input.now ?? (() => new Date()))().getTime();
    const skew = this.input.refreshSkewMs ?? 30_000;
    if (Date.parse(session.auth.accessExpiresAt) > now + skew) return session.auth.accessToken;
    try {
      const tokens = await this.refresh();
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof SessionExpiredError) return undefined;
      throw error;
    }
  }

  public async refresh(): Promise<SessionAuthTokens> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const operation = this.performRefresh();
    this.refreshInFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.refreshInFlight === operation) this.refreshInFlight = undefined;
    }
  }

  public async request(path: string, init: { method: TransportRequest["method"]; body?: unknown } = { method: "GET" }): Promise<TransportResponse> {
    const firstToken = await this.getAccessToken();
    const first = await this.send(path, init, firstToken);
    if (first.status !== 401) return first;

    let refreshed: SessionAuthTokens;
    try {
      refreshed = await this.refresh();
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      throw error;
    }
    const retry = await this.send(path, init, refreshed.accessToken);
    if (retry.status === 401) {
      await this.input.secureSessionStore.clear();
      throw new SessionExpiredError();
    }
    return retry;
  }

  /**
   * Public read transport. It deliberately never reads, refreshes, or sends a
   * stored session token. A stale/expired/offline guest session must not be
   * able to prevent anonymous users from reading public server data.
   */
  public async requestPublic(path: string, init: { method: TransportRequest["method"]; body?: unknown } = { method: "GET" }): Promise<TransportResponse> {
    return this.send(path, init);
  }

  public async signOut(): Promise<void> {
    let current: StoredSession | undefined;
    try {
      current = await this.input.secureSessionStore.read();
    } catch {
      current = undefined;
    }
    // R15.39: signOut 改为 "soft sign out" — 留 session 在 keychain 里
    //   (refreshToken 还在), 加 signedOut=true + signedOutAt 锁定状态。
    //   这样下次用户点 “继续” 可以走 silent re-auth (用 refreshToken
    //   拿新 accessToken, 不用走 OTP)。
    //   服务器侧 RevokeSession 还是发 (best effort) — 但即使失败,
    //   客户端也不会困在 "signed-in" UI 里 (有 signedOut gate)。
    if (current) {
      // Best-effort server revoke, but don't block on it.
      void this.send("/v1/commands/RevokeSession", {
        method: "POST",
        body: {
          commandId: this.nextCommandId("signout"),
          commandType: "RevokeSession",
          commandVersion: 1,
          actor: { type: "USER", id: current.userAccountId },
          principal: current.principal ?? current.auth.principal,
          target: { type: "Session", id: current.auth.sessionId },
          idempotencyKey: this.nextCommandId("idem"),
          authContext: { sessionId: current.auth.sessionId },
          purpose: "user_sign_out",
          correlationId: this.nextCommandId("corr"),
          requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
          payload: { reason: "USER_LOGOUT" }
        }
      }, current.auth.accessToken).catch(() => undefined);

      // 本地清 accessToken + 锁定状态, 写回 keychain。
      // 不调用 clear() — refreshToken 要保留, silent re-auth 要用。
      const nowIso = new Date((this.input.now ?? (() => new Date()))()).toISOString();
      const signedOutSession: StoredSession = {
        ...current,
        auth: {
          ...current.auth,
          // accessToken 置为 “revoked” — 不能用 valid 格式绕过 isSessionAuthTokens
          //   (accessToken 要求非空)。这个 placeholder 不会走任何 server 命令
          //   — 任何走 authClient 的调用都会因为 isValidAccessToken 失败而转去
          //   refreshToken 路径, 而 refreshToken 路径才能被 silent re-auth 复用。
          // refreshToken 不动, 留给 silent re-auth。
          accessToken: "revoked"
        },
        signedOut: true,
        signedOutAt: nowIso
      };
      try {
        await this.input.secureSessionStore.write(signedOutSession);
      } catch {
        // 如果 keychain 写入失败 (e.g. refreshToken 过期), 最后手段是
        // 真正清掉, 避免后面 restoreNativeShell 又拿这个失效的 session 走
        // restore 逻辑。
        await this.input.secureSessionStore.clear().catch(() => undefined);
      }
    } else {
      // 本来就没有 session (双重 signOut / 升级迁移), 确保 keychain 干净。
      await this.input.secureSessionStore.clear().catch(() => undefined);
    }
  }

  private async send(path: string, init: { method: TransportRequest["method"]; body?: unknown }, accessToken?: string): Promise<TransportResponse> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return this.input.transport({
      method: init.method,
      url: `${this.input.baseUrl}${path}`,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
    });
  }

  private async performRefresh(): Promise<SessionAuthTokens> {
    // R15.22 fix: 同 getAccessToken — keychain 读失败 看作“session 过期”, 不抦 caller.
    let current: Awaited<ReturnType<typeof this.input.secureSessionStore.read>>;
    try {
      current = await this.input.secureSessionStore.read();
    } catch {
      throw new SessionExpiredError();
    }
    if (!current) throw new SessionExpiredError();
    const response = await this.send("/v1/commands/RefreshSession", {
      method: "POST",
      body: {
        commandId: this.nextCommandId("refresh"),
        commandType: "RefreshSession",
        commandVersion: 1,
        actor: { type: "USER", id: "session_refresh" },
        principal: { type: "INDIVIDUAL", id: "session_refresh" },
        target: { type: "Session", id: current.auth.sessionId },
        idempotencyKey: this.nextCommandId("idem"),
        authContext: {},
        purpose: "session_refresh",
        correlationId: this.nextCommandId("corr"),
        requestedAt: new Date((this.input.now ?? (() => new Date()))()).toISOString(),
        payload: { refreshToken: current.auth.refreshToken }
      }
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SessionRefreshUnavailableError(response.status);
    }
    const auth = parseSessionAuthTokens(isRecord(body) ? body.auth : undefined);
    if (response.status === 401 || response.status === 403) {
      await this.input.secureSessionStore.clear();
      throw new SessionExpiredError();
    }
	if (response.status < 200 || response.status >= 300 || !auth) {
		// 429/5xx/proxy HTML/protocol drift are availability failures, not proof
		// that the refresh token is invalid. Preserve Keychain and retry later.
		throw new SessionRefreshUnavailableError(response.status);
	}
		const updated: StoredSession = {
			userAccountId: current.userAccountId,
			auth,
      ...(current.principal ? { principal: current.principal } : {})
    };
    try {
      await this.input.secureSessionStore.write(updated);
    } catch (error) {
      await this.input.secureSessionStore.clear();
      throw error;
    }
    return auth;
  }

  private nextCommandId(prefix: string): string {
    this.commandSequence += 1;
    return `mobile_${prefix}_${Date.now().toString(36)}_${this.commandSequence.toString(36)}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
