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
import { commandErrorMessage } from "./command-error-message";

export type ProfileWire = {
  userAccountId: string;
  name: string;
  handle: string;
  bio: string;
  city: string;
  avatarPath: string;
  version: number;
  updatedAt: string;
  // AGENT-CLAIM-NUMBER-001: 接单编号（服务端注册时顺序分配）。缺席/0 = 未分配，
  // 客户端按无编号处理（整行隐藏）。
  claimNumber?: number | undefined;
  // HOME-RAIL-SERVER-001: server-measured location facts, present only on the
  // nearby read. Absent means "unknown", never 0 — PERSON-DISTANCE-ZERO-001
  // forbids rendering "0 m" or passing the row through a radius filter.
  latitude?: number | undefined;
  longitude?: number | undefined;
  distanceM?: number | undefined;
  // HOME-FORYOU-FREE-001：服务端算出的「这个时段有没有空」，三态。
  // undefined = 这个人没有排期，**未知**（不是"有空"，也不是"没空"）。
  freeAt?: boolean | undefined;
  freeFrom?: string | undefined;
  freeUntil?: string | undefined;
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

  // HANDLE-LOOKUP-001: resolve the person behind a handle — the landing point
  // of a scanned profile QR / invite card (a vCard carrying `X-PROXY-HANDLE`;
  // see `profile-qr.ts` for why the payload is a card and not a URL).
  //
  // The handle travels in the payload, which is the only place the server reads
  // it from; target.id carries it too so the command reads naturally, while
  // payload.userAccountId stays the REAL actor id rather than being overloaded
  // with a handle.
  public async getProfileByHandle(handle: string): Promise<ProfileWire> {
    const session = await this.requireSession();
    const result = await this.command(session, "GetProfileByHandle", session.userAccountId, { handle }, handle);
    const profile = (result.operationRef ? JSON.parse(result.operationRef) : {}).profile as ProfileWire | undefined;
    if (!profile?.userAccountId) throw new Error("profile response malformed");
    return profile;
  }

  // PROFILE-SEARCH-001: site-wide people search, behind the add-friend sheet's
  // 「搜索 Proxy」 box.
  //
  // That box used to render SEARCH_RESULTS — a hardcoded array — so every query
  // returned the same people and the input was decoration. There was no
  // server-side search at all: a profile could be read only by userAccountId
  // (yourself) or by an exact handle.
  //
  // The payload arrives in operationRef, NOT body: parseCommandResult builds a
  // CommandResult from a fixed field list and drops `body`, so a body-only
  // answer would be invisible here and the search would look like it returned
  // nothing, forever, with no error.
  public async searchProfiles(query: string, limit?: number): Promise<ProfileWire[]> {
    const session = await this.requireSession();
    const result = await this.command(session, "SearchProfiles", session.userAccountId, {
      query,
      ...(limit ? { limit } : {}),
    });
    const body = (result.operationRef ? JSON.parse(result.operationRef) : {}) as { profiles?: ProfileWire[] };
    // An empty array is a real answer — "nobody matches". Only a MISSING array
    // is malformed. Collapsing the two is how a UI ends up telling the user
    // 「搜索失败，请重试」 about a person who simply does not exist.
    if (!Array.isArray(body.profiles)) throw new Error("profile search response malformed");
    return body.profiles;
  }

  // listNearby returns profiles the SERVER measured as near the given point,
  // nearest first (HOME-RAIL-SERVER-001).
  //
  // Why the viewer passes its coordinates in: the server never tells a client
  // where other users are, so a client-side distance is impossible — and a
  // client that faked one (0 for everyone) would put every stranger "at your
  // feet", which is exactly what PERSON-DISTANCE-ZERO-001 forbids.
  //
  // Throws VIEWER_LOCATION_REQUIRED upstream as a rejection: a caller that has
  // no location gets an error rather than an empty rail, so "I have no
  // location" is never mistaken for "nobody is around".
  // FOR-YOU-CANDIDATES-001：本人真实定位写到自己的资料上（服务端只用来算距离）。
  public async updateMyLocation(location: { latitude: number; longitude: number }): Promise<void> {
    const session = await this.requireSession();
    await this.command(session, "UpdateMyLocation", session.userAccountId, { latitude: location.latitude, longitude: location.longitude });
  }

  public async listNearby(
    location: { latitude: number; longitude: number },
    options: { maxDistanceKm?: number; limit?: number; slot?: { startIso: string; endIso: string } } = {}
  ): Promise<ProfileWire[]> {
    const session = await this.requireSession();
    const result = await this.command(session, "ListNearbyProfiles", session.userAccountId, {
      latitude: location.latitude,
      longitude: location.longitude,
      ...(options.maxDistanceKm !== undefined ? { maxDistanceKm: options.maxDistanceKm } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      // HOME-FORYOU-FREE-001：把"想约的时段"一起发过去，服务端才算 free_at。
      // 不发 slot 时服务端返回 freeAt=undefined（未知），界面不能拿它当"有空"。
      ...(options.slot ? { slotStart: options.slot.startIso, slotEnd: options.slot.endIso } : {}),
    });
    const body = (result.operationRef ? JSON.parse(result.operationRef) : {}) as { profiles?: ProfileWire[] };
    if (!Array.isArray(body.profiles)) throw new Error("nearby profiles response malformed");
    return body.profiles;
  }

  private async command(session: StoredSession & { principal: NonNullable<StoredSession["principal"]> }, commandType: string, userAccountId: string, payload: Record<string, unknown>, targetId: string = userAccountId): Promise<CommandResult> {
    const next = (prefix: string) => `mobile_profile_${prefix}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target: { type: "Profile", id: targetId },
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
    if (result.outcome === "REJECTED") throw new Error(commandErrorMessage(result.error, "profile rejected"));
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
