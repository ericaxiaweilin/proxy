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
    const session = await this.input.secureSessionStore.read();
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

  public async signOut(): Promise<void> {
    await this.input.secureSessionStore.clear();
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
    const current = await this.input.secureSessionStore.read();
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
    const body = await response.json();
    const auth = parseSessionAuthTokens(isRecord(body) ? body.auth : undefined);
    if (response.status < 200 || response.status >= 300 || !auth) {
      await this.input.secureSessionStore.clear();
      throw new SessionExpiredError();
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
