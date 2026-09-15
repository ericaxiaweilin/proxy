// SessionClient — DEVICE-LIST-001 mobile half.
//
// The Settings → 安全 → 设备管理 card used to end with "设备列表尚未接入" —
// an honest placeholder for a read that did not exist. The server already
// enforced the promise next to it (max 2 concurrent sessions, auto-evict the
// oldest) and RevokeSession already refuses other people's sessions, but the
// app had no way to SEE the two slots. This client sends ListMySessions /
// RevokeSession through the standard command envelope shape.
//
// Like ProfileClient.searchProfiles, the list payload arrives in operationRef,
// NOT body: parseCommandResult drops `body`, so a body-only answer would be
// invisible here and the list would look empty forever, with no error.

import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";

export type SessionWire = {
  id: string;
  platform: string;
  status: string;
  issuedAt: string;
  expiresAt: string;
  current: boolean;
};

export class SessionClient {
  private sequence = 0;
  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  // List every session of the caller, newest-issued last. An empty array is a
  // real answer ("no other sessions") — only a MISSING array is malformed.
  public async listMySessions(): Promise<SessionWire[]> {
    const session = await this.requireSession();
    const result = await this.command(session, "ListMySessions", "mine", {});
    const body = (result.operationRef ? JSON.parse(result.operationRef) : {}) as { sessions?: SessionWire[] };
    if (!Array.isArray(body.sessions)) throw new Error("session list response malformed");
    return body.sessions;
  }

  // Revoke one session by id. The server enforces ownership
  // (session.UserAccountID must equal the actor), so a tampered id fails
  // closed there — the client does not pre-check, it surfaces the refusal.
  // Revoking the current session is a logout: the caller (Settings card)
  // hides that button instead of offering a self-kick.
  public async revokeSession(sessionId: string): Promise<void> {
    const session = await this.requireSession();
    await this.command(session, "RevokeSession", sessionId, { reason: "USER_REVOKED_DEVICE" });
  }

  private async command(session: StoredSession & { principal: NonNullable<StoredSession["principal"]> }, commandType: string, targetId: string, payload: Record<string, unknown>): Promise<CommandResult> {
    const next = (prefix: string) => `mobile_session_${prefix}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target: { type: "Session", id: targetId },
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "session",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload: { ...payload, userAccountId: session.userAccountId },
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("session command malformed");
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey ?? result.error?.errorCode ?? "session rejected");
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected session status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    if (session.serverSession === false) throw new Error("session actions require a real sign-in");
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }
}
