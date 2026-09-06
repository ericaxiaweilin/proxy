import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";

export type AuthenticatedCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<{ status: number; json: () => Promise<unknown> }>;
};

export type ConversationClientOptions = {
  authClient: AuthenticatedCommandTransport;
  secureSessionStore: SecureSessionStore;
  baseUrl: string;
  now?: () => Date;
};

export type ProtectionOverride = {
  forwardable?: boolean;
  copyable?: boolean;
  warn?: boolean;
  viewLimit?: number;
  ttlSeconds?: number;
};

export type ConversationInboxItem = {
  conversation: { conversationId: string; conversationType: string; originType: string; originId: string; state: string; participants: string[]; lastMessageAt: string };
  latestMessage?: { messageId: string; senderId: string; body?: string; messageType: string; createdAt: string; senderSnapshot?: { displayName?: string; avatarRef?: string } };
  counterpartyId?: string;
  counterpartySnapshot?: { displayName?: string; avatarRef?: string };
};

export class ConversationClient {
  private commandSequence = 0;

  public constructor(private readonly input: ConversationClientOptions) {}

  public get baseUrl(): string { return this.input.baseUrl; }

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

  public async sendMessage(
    conversationId: string,
    body: string,
    assistantMode?: string,
    temporaryUIResponseId?: string,
    mediaRef?: string,
    protectionOverride?: ProtectionOverride,
    messageType?: "TEXT" | "IMAGE" | "VIDEO" | "LOCATION" | "SYSTEM_CONTEXT" | "STRUCTURED_SUGGESTION",
    proxyObject?: { objectType: "invitation" | "activity" | "opportunity" | "voucher" | "post" | "order"; objectId: string; snapshot: Record<string, unknown>; liveState?: Record<string, unknown> }
  ): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    const isImage = Boolean(mediaRef);
    const resolvedType = messageType ?? (proxyObject ? "TEXT" : isImage ? "IMAGE" : "TEXT");
    const result = await this.sendCommand(session, "SendMessage", { type: "Conversation", id: conversationId }, {
      messageType: resolvedType,
      body: body || (isImage ? " " : ""),
      ...(mediaRef ? { mediaRef } : {}),
      ...(assistantMode ? { assistantMode } : {}),
      ...(temporaryUIResponseId ? { temporaryUIResponseId } : {}),
      ...(protectionOverride ? { protectionOverride } : {}),
      ...(proxyObject ? { proxyObject } : {})
    });
    return result;
  }

  public async sendProxyObject(conversationId: string, proxyObject: { objectType: "invitation" | "activity" | "opportunity" | "voucher" | "post" | "order"; objectId: string; snapshot: Record<string, unknown>; liveState?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return this.sendMessage(conversationId, proxyObject.snapshot.title as string ?? "", undefined, undefined, undefined, undefined, "TEXT", proxyObject);
  }

  public async sendImageMessage(conversationId: string, mediaRef: string, caption?: string, protectionOverride?: ProtectionOverride, assistantMode?: string): Promise<Record<string, unknown>> {
    return this.sendMessage(conversationId, caption?.trim() || " ", assistantMode, undefined, mediaRef, protectionOverride, "IMAGE");
  }

  public async listMessages(conversationId: string): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ListConversationMessages", { type: "Conversation", id: conversationId }, {});
    return result;
  }

  public async listConversations(): Promise<ConversationInboxItem[]> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ListConversations", { type: "ConversationInbox", id: session.userAccountId }, {});
    if (typeof result.operationRef !== "string") return [];
    try {
      const payload = JSON.parse(result.operationRef) as { conversations?: ConversationInboxItem[] };
      return Array.isArray(payload.conversations) ? payload.conversations : [];
    } catch { return []; }
  }

  public async markMessageRead(messageId: string): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    return this.sendCommand(session, "MarkMessageRead", { type: "Message", id: messageId }, { messageId });
  }
  public async deleteMessage(messageId: string): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    return this.sendCommand(session, "DeleteMessage", { type: "Message", id: messageId }, { messageId });
  }

  public async setConversationBlocked(conversationId: string, blocked: boolean): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    return this.sendCommand(session, "SetConversationBlocked", { type: "Conversation", id: conversationId }, { blocked });
  }

  public async recordScreenshot(messageId: string): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    return this.sendCommand(session, "RecordScreenshot", { type: "Message", id: messageId }, { messageId });
  }

  public async forwardMessage(sourceMessageId: string, targetConversationId: string): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    return this.sendCommand(session, "ForwardMessage", { type: "Message", id: sourceMessageId }, { sourceMessageId, targetConversationId });
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("an authenticated principal is required");
    if (session.serverSession === false) throw new Error("sending messages requires a real sign-in (offline session cannot act)");
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
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
