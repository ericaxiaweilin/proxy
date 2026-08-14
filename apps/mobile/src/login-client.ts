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
  transport: Transport;
  secureSessionStore: SecureSessionStore;
  now?: () => Date;
};

export type RequestLoginChallengeInput = {
  loginIdentityId: string;
  channel: LoginChallengeChannel;
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
      requestedPrincipal: input.requestedPrincipal
    });
    if (result.outcome !== "ACCEPTED") {
      throw new LoginProtocolError("session response was not accepted");
    }
    const auth = parseSessionAuthTokens(result.auth);
    if (!auth) throw new LoginProtocolError("session response did not contain valid auth tokens");

		const session: StoredSession = { userAccountId: input.userAccountId, auth, principal: input.requestedPrincipal };
    try {
      await this.input.secureSessionStore.write(session);
    } catch (error) {
      await this.input.secureSessionStore.clear().catch(() => undefined);
      throw error;
    }
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
        "Content-Type": "application/json"
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
