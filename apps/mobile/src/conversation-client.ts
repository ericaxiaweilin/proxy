import type { SecureSessionStore, StoredSession } from "./secure-session";

export type AuthenticatedCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<{ status: number; json: () => Promise<unknown> }>;
};

export type ConversationClientOptions = {
  authClient: AuthenticatedCommandTransport;
  secureSessionStore: SecureSessionStore;
  baseUrl: string;
  now?: () => Date;
};

export class ConversationClient {
  private commandSequence = 0;

  public constructor(private readonly input: ConversationClientOptions) {}

  public async startConversation(params: {
    originType: string;
    originId: string;
    participantId: string;
    firstMessage: string;
    assistantMode?: string;
    mediaRef?: string;
  }): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "StartConversation", { type: "Conversation", id: "new" }, {
      conversationType: "DM",
      ...params
    });
    return result;
  }

  public async sendMessage(conversationId: string, body: string, assistantMode?: string, temporaryUIResponseId?: string): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "SendMessage", { type: "Conversation", id: conversationId }, {
      messageType: "TEXT",
      body,
      ...(assistantMode ? { assistantMode } : {}),
      ...(temporaryUIResponseId ? { temporaryUIResponseId } : {})
    });
    return result;
  }

  public async listMessages(conversationId: string): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ListConversationMessages", { type: "Conversation", id: conversationId }, {});
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("an authenticated principal is required");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private async sendCommand(
    session: StoredSession & { principal: NonNullable<StoredSession["principal"]> },
    commandType: string,
    target: { type: string; id: string },
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const commandId = this.nextId("command");
    const envelope = {
      commandId,
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: this.nextId("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "requester_conversation",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = await response.json() as Record<string, unknown>;
    if (!result) throw new Error("conversation command response was malformed");
    if (result.outcome === "REJECTED") throw new Error(`conversation command rejected: ${JSON.stringify(result.error)}`);
    return result;
  }

  private nextId(prefix: string): string {
    this.commandSequence += 1;
    return `mobile_conv_${prefix}_${Date.now().toString(36)}_${this.commandSequence.toString(36)}`;
  }
}
