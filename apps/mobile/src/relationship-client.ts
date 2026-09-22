// RelationshipClient — R18.x FRIEND-001 mobile half.
//
// The mobile '我的 → 好友与关系' surface (FriendCrmSurface)
// was entirely hardcoded mock data: 4 fake friends, 2
// fake pending requests, fake contact / social matches,
// and every action (add / accept / ignore / block)
// mutated local React state only. This client sends the
// five relationship commands through the standard
// command-envelope shape so the server (relationship
// package) is the source of truth.

import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

export type FriendshipState = "PENDING" | "FRIEND" | "BLOCKED";

export type FriendView = {
  userId: string;
  direction: "OUTGOING" | "INCOMING" | "MUTUAL";
  state: FriendshipState;
  displayName: string;
  city: string;
  since: string;
};

export type FriendshipsPayload = {
  active: FriendView[];
  pending: FriendView[];
};

export class RelationshipClient {
  private sequence = 0;
  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  public async listMyFriendships(): Promise<FriendshipsPayload> {
    const result = await this.command("ListMyFriendships", { type: "FriendshipCollection", id: "mine" }, {});
    const body = (result.operationRef ? JSON.parse(result.operationRef) : {}) as { friendships?: FriendshipsPayload };
    if (!body.friendships) throw new Error("list friendships response malformed");
    return body.friendships;
  }

  public async sendFriendRequest(targetUserId: string): Promise<{ friendshipId: string; state: string }> {
    const result = await this.command("SendFriendRequest", { type: "Friendship", id: `to:${targetUserId}` }, { targetUserId });
    const body = (result.operationRef ? JSON.parse(result.operationRef) : {}) as { friendship?: { id: string; state: string } };
    if (!body.friendship?.id) throw new Error("send friend request response malformed");
    return { friendshipId: body.friendship.id, state: body.friendship.state };
  }

  public async acceptFriendRequest(targetUserId: string): Promise<{ state: string }> {
    const result = await this.command("AcceptFriendRequest", { type: "Friendship", id: `from:${targetUserId}` }, { targetUserId });
    const body = (result.operationRef ? JSON.parse(result.operationRef) : {}) as { friendship?: { state: string } };
    if (!body.friendship?.state) throw new Error("accept friend request response malformed");
    return { state: body.friendship.state };
  }

  public async ignoreFriendRequest(targetUserId: string): Promise<{ deleted: string }> {
    const result = await this.command("IgnoreFriendRequest", { type: "Friendship", id: `from:${targetUserId}` }, { targetUserId });
    const body = (result.operationRef ? JSON.parse(result.operationRef) : {}) as { deleted?: string };
    if (!body.deleted) throw new Error("ignore friend request response malformed");
    return { deleted: body.deleted };
  }

  public async blockFriend(targetUserId: string): Promise<{ state: string }> {
    const result = await this.command("BlockFriend", { type: "Friendship", id: `block:${targetUserId}` }, { targetUserId });
    const body = (result.operationRef ? JSON.parse(result.operationRef) : {}) as { friendship?: { state: string } };
    if (!body.friendship?.state) throw new Error("block friend response malformed");
    return { state: body.friendship.state };
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const next = (prefix: string) => `mobile_relationship_${prefix}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "relationship",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload,
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("relationship command malformed");
    if (result.outcome === "REJECTED") throw new Error(commandErrorMessage(result.error, "relationship rejected"));
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected relationship status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    if (session.serverSession === false) throw new Error("relationship actions require a real sign-in");
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }
}
