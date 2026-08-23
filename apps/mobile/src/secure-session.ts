import type { PrincipalContext, SessionAuthTokens } from "@proxy/contracts";

export const SECURE_SESSION_STORAGE_KEY = "proxy.secure.session.v1";

export type StoredSession = {
	userAccountId: string;
	auth: SessionAuthTokens;
	principal?: PrincipalContext;
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
    return cloneSession(decoded);
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
	const candidate = value as { userAccountId?: unknown; auth?: unknown; principal?: unknown };
	if (typeof candidate.userAccountId !== "string" || candidate.userAccountId.length === 0) return false;
  if (!isSessionAuthTokens(candidate.auth)) return false;
  if (candidate.principal !== undefined && !isPrincipal(candidate.principal)) return false;
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
    ...(session.principal ? { principal: { type: session.principal.type, id: session.principal.id } } : {})
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
