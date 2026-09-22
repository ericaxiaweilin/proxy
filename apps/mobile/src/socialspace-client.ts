import type { CommandResult } from "@proxy/contracts";
import { z } from "zod";
import type { AuthenticatedCommandTransport } from "./localnet-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

const StatusSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  author: z.string(),
  body: z.string(),
  location: z.string().optional(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime()
});

const CommunitySchema = z.object({
  id: z.string(),
  name: z.string(),
  desc: z.string(),
  members: z.number().int().nonnegative(),
  color: z.string(),
  flair: z.string().optional(),
  joined: z.boolean()
});

export type SocialStatus = z.infer<typeof StatusSchema>;
export type SocialCommunity = z.infer<typeof CommunitySchema>;

export class SocialSpaceProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SocialSpaceProtocolError";
  }
}

export class SocialSpaceCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(commandErrorMessage(result.error, "social space command rejected"));
    this.name = "SocialSpaceCommandRejectedError";
  }
}

export class SocialSpaceClient {
  private sequence = 0;

  public constructor(private readonly input: { authClient: AuthenticatedCommandTransport; secureSessionStore: SecureSessionStore; now?: () => Date }) {}

  public async listStatuses(): Promise<SocialStatus[]> {
    const payload = await this.command("ListStatuses", { type: "StatusFeed", id: "local" }, {});
    return z.object({ statuses: z.array(StatusSchema) }).parse(payload).statuses;
  }

  public async createStatus(input: { body: string; location?: string; expiryHours: 24 | 48; authorDisplayName?: string }): Promise<SocialStatus> {
    const payload = await this.command("CreateStatus", { type: "Status", id: "new" }, input);
    return z.object({ status: StatusSchema }).parse(payload).status;
  }

  public async listCommunities(): Promise<SocialCommunity[]> {
    const payload = await this.command("ListCommunities", { type: "CommunityHub", id: "local" }, {});
    return z.object({ communities: z.array(CommunitySchema) }).parse(payload).communities;
  }

  public async setCommunityMembership(communityId: string, joined: boolean): Promise<void> {
    await this.command("SetCommunityMembership", { type: "Community", id: communityId }, { communityId, joined });
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<unknown> {
    const session = await this.requireSession();
    const commandId = this.nextId("command");
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, {
      method: "POST",
      body: {
        commandId,
        commandType,
        commandVersion: 1,
        actor: { type: "USER", id: session.userAccountId },
        principal: session.principal,
        target,
        idempotencyKey: this.nextId("idempotency"),
        authContext: { sessionId: session.auth.sessionId },
        purpose: "social_space",
        correlationId: this.nextId("correlation"),
        requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
        payload
      }
    });
    const result = parseCommandResult(await response.json());
    if (!result) throw new SocialSpaceProtocolError("social space response was malformed");
    if (result.outcome === "REJECTED") throw new SocialSpaceCommandRejectedError(result);
    if (response.status < 200 || response.status >= 300 || !result.operationRef) {
      throw new SocialSpaceProtocolError(`unexpected social space response: ${response.status}`);
    }
    try {
      return JSON.parse(result.operationRef) as unknown;
    } catch {
      throw new SocialSpaceProtocolError("social space operationRef was not valid JSON");
    }
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new SocialSpaceProtocolError("an authenticated principal is required");
    if (session.serverSession === false) throw new SocialSpaceProtocolError("social space actions require a real sign-in (offline session cannot act)");
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private nextId(kind: string): string {
    this.sequence += 1;
    return `mobile_social_${kind}_${Date.now().toString(36)}_${this.sequence.toString(36)}`;
  }
}
