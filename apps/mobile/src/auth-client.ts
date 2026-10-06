import type { SessionAuthTokens } from "@proxy/contracts";
import { parseSessionAuthTokens, SecureSessionStore, type StoredSession } from "./secure-session";

export type TransportRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body?: string | null;
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
      deviceProofProvider?: () => Promise<{ deviceId: string; deviceCredential: string }>;
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
      if (current && current.serverSession !== false) {
        await this.send("/v1/commands/RevokeSession", {
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
      }
    } finally {
      await this.input.secureSessionStore.clear();
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
    const deviceProof = await this.input.deviceProofProvider?.();
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
        payload: {
          refreshToken: current.auth.refreshToken,
          deviceId: deviceProof?.deviceId ?? "",
          deviceCredential: deviceProof?.deviceCredential ?? ""
        }
      }
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SessionRefreshUnavailableError(response.status);
    }
    const auth = parseSessionAuthTokens(isRecord(body) ? body.auth : undefined);
    const errorCode = isRecord(body) && isRecord(body.error) && typeof body.error.errorCode === "string"
      ? body.error.errorCode
      : undefined;
    if (
      response.status === 401 ||
      response.status === 403 ||
      errorCode === "REFRESH_TOKEN_INVALID" ||
      errorCode === "REFRESH_TOKEN_ALREADY_USED" ||
      errorCode === "DEVICE_PROOF_INVALID" ||
      errorCode === "SESSION_NOT_USABLE"
    ) {
      // MOBILE-SESSION-EVICTED-RECOVERY-001（2026-10-06，用户：「模拟器已经有登陆了
      // 为什么提示还要登陆」）：这里**不删 keychain**。
      //
      // 以前删了，于是「服务端判定这条会话不可用」和「本机从来没有凭据」变成同一件事。
      // 而 app 冷启动的静默恢复通道（native-app.tsx：refresh 失败 →
      // resumeTrustedDeviceSession 用设备凭据换一条新会话）**前提就是本机还留着那条记录** ——
      // 记录被删掉，status 就成了 SIGNED_OUT，那个分支根本进不去，恢复永远不会发生，
      // 用户只能重新收一次验证码。
      //
      // 会话为什么会不可用：同一账号第 3 次登录会按 issued_at FIFO 驱逐最老的一条
      // （identity/service.go enforceMaxConcurrentSessions，MaxConcurrentSessions = 2，
      // Lotus RFC §6）。开发机上运营控制台和手机共用账号，手机就是那条「最老的」。
      // 被踢本身是设计内行为，**但被踢之后不该升级成「必须重新登录」**。
      //
      // 保留记录不会让人卡住：冷启动先试 refresh（失败）→ 再试设备凭据静默恢复；
      // 恢复不成才落到登录页 —— 而登录页正好是用户该在的地方。
      // 「用户主动退出」不受影响：signOut() 自己会 clear()，那时本机确实不该留记录。
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
