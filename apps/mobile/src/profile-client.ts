// ProfileClient — R18.x PROFILE-001 mobile half.
//
// The '编辑主页' modal in me.tsx used to write only to local
// SecureStore (Keychain / Keystore). No server command existed,
// so the new name / handle / bio / city / avatar never reached
// feeds, opportunity applicants, or any cross-device read
// model. This client sends UpdateProfile / GetProfile through
// the standard command envelope shape; the server is the
// authority.

import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";

export type ProfileWire = {
  userAccountId: string;
  name: string;
  handle: string;
  bio: string;
  city: string;
  avatarPath: string;
  version: number;
  updatedAt: string;
};

export class ProfileClient {
  private sequence = 0;
  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  public async getProfile(userAccountId?: string): Promise<ProfileWire> {
    const session = await this.requireSession();
    const result = await this.command(session, "GetProfile", userAccountId ?? session.userAccountId, {});
    const profile = (result.operationRef ? JSON.parse(result.operationRef) : {}).profile as ProfileWire | undefined;
    if (!profile?.userAccountId) throw new Error("profile response malformed");
    return profile;
  }

  public async updateProfile(input: { name: string; handle: string; bio: string; city: string; avatarPath: string }): Promise<ProfileWire> {
    const session = await this.requireSession();
    const result = await this.command(session, "UpdateProfile", session.userAccountId, {
      name: input.name,
      handle: input.handle,
      bio: input.bio,
      city: input.city,
      avatarPath: input.avatarPath,
    });
    const profile = (result.operationRef ? JSON.parse(result.operationRef) : {}).profile as ProfileWire | undefined;
    if (!profile?.userAccountId) throw new Error("profile response malformed");
    return profile;
  }

  private async command(session: StoredSession & { principal: NonNullable<StoredSession["principal"]> }, commandType: string, userAccountId: string, payload: Record<string, unknown>): Promise<CommandResult> {
    const next = (prefix: string) => `mobile_profile_${prefix}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target: { type: "Profile", id: userAccountId },
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "profile",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload: { ...payload, userAccountId },
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("profile command malformed");
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey ?? result.error?.errorCode ?? "profile rejected");
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected profile status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    if (session.serverSession === false) throw new Error("profile actions require a real sign-in");
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }
}
