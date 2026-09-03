import type {
  CommandResult,
  ErrorEnvelope,
  PrincipalContext,
  SessionAuthTokens
} from "@proxy/contracts";
import { parseSessionAuthTokens, SecureSessionStore, type StoredSession } from "./secure-session";
import type { Transport, TransportRequest, TransportResponse } from "./auth-client";

export type LoginChallengeChannel = "EMAIL" | "SMS";

export type LoginClientOptions = {
  baseUrl: string;
  deviceId: string;
  deviceCredential: string;
  transport: Transport;
  secureSessionStore: SecureSessionStore;
  now?: () => Date;
};

export type RequestLoginChallengeInput = {
  loginIdentityId: string;
  channel: LoginChallengeChannel;
};

// R16.7-P0-A/B: explicit signup payload for anonymous session creation.
// Caller must have already surfaced the Terms / Privacy docs and obtained
// active user consent (checkbox), and captured a valid 18+ date of birth.
export type AnonymousSessionSignup = {
  dateOfBirth: string; // YYYY-MM-DD
  consents: { terms: boolean; privacy: boolean };
  legalDocVersion?: string; // e.g. "1.1"; defaults to "1.1" if omitted
  now?: () => Date; // injectable clock for age calculation in tests
};

export type BeginPasswordlessAuthenticationInput = {
  channel: LoginChallengeChannel;
  identifier: string;
  platform: "ANDROID" | "IOS";
};

export type CreateSessionInput = {
  userAccountId: string;
  loginIdentityId: string;
  challengeId: string;
  requestedPrincipal: PrincipalContext;
};

export class LoginCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(result.error?.messageKey ?? "login command rejected");
    this.name = "LoginCommandRejectedError";
  }
}

export class LoginProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LoginProtocolError";
  }
}

/**
 * Unsigned passwordless login boundary for the native App.
 *
 * Provider delivery and verification stay server-owned. The App only sends
 * commands, consumes safe command results, and stores a verified session in
 * the injected Keychain/Keystore-backed store.
 */
export class LoginClient {
  private commandSequence = 0;

  public constructor(private readonly input: LoginClientOptions) {}

  public async requestChallenge(input: RequestLoginChallengeInput): Promise<{ challengeId: string; result: CommandResult }> {
    const result = await this.sendCommand("RequestLoginChallenge", {
      type: "LoginChallenge",
      id: "new"
    }, {
      loginIdentityId: input.loginIdentityId,
      deviceId: this.input.deviceId,
      channel: input.channel
    });
    if (result.outcome !== "PENDING" || !result.operationRef) {
      throw new LoginProtocolError("login challenge response did not contain a pending operation");
    }
    return { challengeId: result.operationRef, result };
  }

  public async beginPasswordlessAuthentication(input: BeginPasswordlessAuthenticationInput): Promise<{ challengeId: string; result: CommandResult }> {
    const result = await this.sendCommand("BeginPasswordlessAuthentication", { type: "LoginChallenge", id: "new" }, {
      channel: input.channel,
      identifier: input.identifier,
      deviceId: this.input.deviceId,
      platform: input.platform
    });
    // DEBUG (R15.27): log full result so iPhone console shows why outcome is not PENDING.
    // eslint-disable-next-line no-console
    console.log("[proxy.login] beginPasswordlessAuthentication result:", JSON.stringify(result));
    if (result.outcome !== "PENDING" || !result.operationRef) {
      throw new LoginProtocolError("passwordless authentication response did not contain a pending operation");
    }
    return { challengeId: result.operationRef, result };
  }

  public async createAnonymousSession(platform: "ANDROID" | "IOS", signup?: AnonymousSessionSignup): Promise<StoredSession> {
    // R16.7-P0-A/B: Terms + Privacy consent and 18+ age gate (PRD v1.4
    // LC-04, LC-12, LC-15; Vietnam PDP 91/2025/QH15). Fail-closed at the
    // client: never even send the request without both consents and a
    // parseable DOB whose computed age is >= 18.
    const consent = signup?.consents;
    if (!consent || !consent.terms || !consent.privacy) {
      throw new LoginProtocolError("terms and privacy consent are required to create an account");
    }
    const dateOfBirth = signup?.dateOfBirth;
    if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      throw new LoginProtocolError("date of birth in YYYY-MM-DD is required to create an account");
    }
    const dob = new Date(`${dateOfBirth}T00:00:00.000Z`);
    if (Number.isNaN(dob.getTime())) {
      throw new LoginProtocolError("date of birth is not a valid calendar date");
    }
    const now = signup?.now ?? this.input.now ?? (() => new Date());
    const ageMs = now().getTime() - dob.getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 18) {
      throw new LoginProtocolError("age must be 18 or older to create an account");
    }
    const result = await this.sendCommand("CreateAnonymousSession", { type: "Session", id: "new" }, {
      deviceId: this.input.deviceId,
      platform,
      deviceCredential: this.input.deviceCredential,
      dateOfBirth,
      consents: { terms: consent.terms, privacy: consent.privacy },
      legalDocVersion: signup?.legalDocVersion ?? "1.1"
    });
    if (result.outcome !== "ACCEPTED") throw new LoginProtocolError("anonymous session response was not accepted");
    const auth = parseSessionAuthTokens(result.auth);
    if (!auth) throw new LoginProtocolError("anonymous session response did not contain valid auth tokens");
    const session: StoredSession = { userAccountId: auth.userAccountId, auth, principal: auth.principal };
    await this.input.secureSessionStore.write(session);
    return session;
  }

  public async authenticateWithGoogle(idToken: string, platform: "ANDROID" | "IOS"): Promise<StoredSession> {
    const result = await this.sendCommand("AuthenticateWithGoogle", { type: "Session", id: "new" }, {
      idToken,
      deviceId: this.input.deviceId,
      platform,
      deviceCredential: this.input.deviceCredential
    });
    if (result.outcome !== "ACCEPTED") throw new LoginProtocolError(result.error?.messageKey ?? "Google authentication rejected");
    const auth = parseSessionAuthTokens(result.auth);
    if (!auth) throw new LoginProtocolError("Google authentication did not return valid auth tokens");
    const session: StoredSession = { userAccountId: auth.userAccountId, auth, principal: auth.principal };
    await this.input.secureSessionStore.write(session);
    return session;
  }

  public async resumeTrustedDeviceSession(): Promise<StoredSession> {
    const result = await this.sendCommand("ResumeTrustedDeviceSession", { type: "Session", id: "new" }, {
      deviceId: this.input.deviceId,
      deviceCredential: this.input.deviceCredential
    });
    if (result.outcome !== "ACCEPTED") throw new LoginProtocolError("trusted device verification was rejected");
    const auth = parseSessionAuthTokens(result.auth);
    if (!auth) throw new LoginProtocolError("trusted device response did not contain valid auth tokens");
    const session: StoredSession = { userAccountId: auth.userAccountId, auth, principal: auth.principal };
    await this.input.secureSessionStore.write(session);
    return session;
  }

  public async verifyChallenge(challengeId: string, code: string): Promise<CommandResult> {
    const result = await this.sendCommand("VerifyLoginChallenge", {
      type: "LoginChallenge",
      id: challengeId
    }, {
      challengeId,
      code
    });
    if (result.outcome !== "ACCEPTED") {
      throw new LoginProtocolError("login verification response was not accepted");
    }
    return result;
  }

  public async createSession(input: CreateSessionInput): Promise<StoredSession> {
    const result = await this.sendCommand("CreateSession", {
      type: "Session",
      id: "new"
    }, {
      userAccountId: input.userAccountId,
      loginIdentityId: input.loginIdentityId,
      deviceId: this.input.deviceId,
      challengeId: input.challengeId,
      deviceCredential: this.input.deviceCredential,
      requestedPrincipal: input.requestedPrincipal
    });
    if (result.outcome !== "ACCEPTED") {
      throw new LoginProtocolError("session response was not accepted");
    }
    const auth = parseSessionAuthTokens(result.auth);
    if (!auth) throw new LoginProtocolError("session response did not contain valid auth tokens");

    const session: StoredSession = { userAccountId: auth.userAccountId, auth, principal: auth.principal };
    try {
      await this.input.secureSessionStore.write(session);
    } catch (error) {
      await this.input.secureSessionStore.clear().catch(() => undefined);
      throw error;
    }
    return session;
  }

  public async createSessionFromChallenge(challengeId: string): Promise<StoredSession> {
    const result = await this.sendCommand("CreateSession", { type: "Session", id: "new" }, {
      deviceId: this.input.deviceId,
      challengeId,
      deviceCredential: this.input.deviceCredential
    });
    if (result.outcome !== "ACCEPTED" || !result.aggregate?.id) throw new LoginProtocolError("session response was not accepted");
    const auth = parseSessionAuthTokens(result.auth);
    if (!auth) throw new LoginProtocolError("session response did not contain valid auth tokens");
    const session: StoredSession = { userAccountId: auth.userAccountId, auth, principal: auth.principal };
    await this.input.secureSessionStore.write(session);
    return session;
  }

  private async sendCommand(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const commandId = this.nextId("command");
    const correlationId = this.nextId("correlation");
    const envelope = {
      commandId,
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: this.input.deviceId },
      principal: { type: "INDIVIDUAL", id: this.input.deviceId },
      target,
      idempotencyKey: this.nextId("idempotency"),
      authContext: {},
      purpose: "passwordless_login",
      correlationId,
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const response = await this.input.transport({
      method: "POST",
      url: `${this.input.baseUrl}/v1/commands/${commandType}`,
      headers: {
        Accept: "application/json",
		"Content-Type": "application/json",
		...(commandType === "BeginPasswordlessAuthentication" ? await this.optionalSessionAuthorization() : {})
      },
      body: JSON.stringify(envelope)
    });
    const body = await response.json();
    const result = parseCommandResult(body);
    if (!result) throw new LoginProtocolError("login command response was malformed");
    if (result.outcome === "REJECTED") throw new LoginCommandRejectedError(result);
    if (response.status < 200 || response.status >= 300) {
      throw new LoginProtocolError(`unexpected login command status: ${response.status}`);
    }
    return result;
  }

	private async optionalSessionAuthorization(): Promise<Record<string, string>> {
		const stored = await this.input.secureSessionStore.read();
		return stored ? { Authorization: `Bearer ${stored.auth.accessToken}` } : {};
	}

  private nextId(prefix: string): string {
    this.commandSequence += 1;
    return `mobile_login_${prefix}_${Date.now().toString(36)}_${this.commandSequence.toString(36)}`;
  }
}

export function parseCommandResult(value: unknown): CommandResult | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.commandId !== "string" || typeof value.outcome !== "string" || typeof value.correlationId !== "string") return undefined;
  if (value.outcome !== "ACCEPTED" && value.outcome !== "REJECTED" && value.outcome !== "PENDING" && value.outcome !== "ALREADY_APPLIED") return undefined;
  if (!Array.isArray(value.eventRefs) || !value.eventRefs.every((ref) => typeof ref === "string")) return undefined;

  const result: CommandResult = {
    commandId: value.commandId,
    outcome: value.outcome,
    eventRefs: value.eventRefs,
    correlationId: value.correlationId
  };
  if (typeof value.operationRef === "string") result.operationRef = value.operationRef;
  if (isRecord(value.aggregate) && typeof value.aggregate.type === "string" && typeof value.aggregate.id === "string" && typeof value.aggregate.version === "number") {
    result.aggregate = {
      type: value.aggregate.type,
      id: value.aggregate.id,
      version: value.aggregate.version,
      ...(typeof value.aggregate.state === "string" ? { state: value.aggregate.state } : {})
    };
  }
  const auth = parseSessionAuthTokens(value.auth);
  if (auth) result.auth = auth;
  const error = parseErrorEnvelope(value.error);
  if (error) result.error = error;
  return result;
}

function parseErrorEnvelope(value: unknown): ErrorEnvelope | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.errorCode !== "string" || typeof value.category !== "string" || typeof value.retryability !== "string" || typeof value.messageKey !== "string" || typeof value.correlationId !== "string") return undefined;
  return {
    errorCode: value.errorCode,
    category: value.category as ErrorEnvelope["category"],
    retryability: value.retryability as ErrorEnvelope["retryability"],
    messageKey: value.messageKey,
    safeDetails: isRecord(value.safeDetails) ? value.safeDetails : {},
    ...(typeof value.requiredAction === "string" ? { requiredAction: value.requiredAction } : {}),
    correlationId: value.correlationId,
    ...(typeof value.supportCaseRef === "string" ? { supportCaseRef: value.supportCaseRef } : {})
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object";
}

export type { Transport, TransportRequest, TransportResponse, SessionAuthTokens };
