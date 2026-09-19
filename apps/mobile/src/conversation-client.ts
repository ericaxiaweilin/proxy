import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { encodeMeetupLocation, type MeetupPoint } from "./meetup-share";

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
  // UNREAD-PIPELINE-001: 未读数。缺席 = 老服务端没算，不画徽标（不把“不知道”画成 0）。
  unreadCount?: number;
};

export type ConvoSummary = {
  convo: {
    id: string;
    parentDialogId: string;
    seedMessageId: string;
    title: string;
    participantIds: string[];
    createdAt: string;
  };
  seedPreview: string;
  latestBody: string;
  latestAt: string;
  messageCount: number;
};

export class ConversationClient {
  private commandSequence = 0;

  public constructor(private readonly input: ConversationClientOptions) {}

  public get baseUrl(): string { return this.input.baseUrl; }

  public async startConversation(params: {
    originType: string;
    originId: string;
    // participantId 是既有单聊写法；建群走 participantIds（复数），
    // 见服务端 resolveStartParticipants —— 两种写法都认，合并去重。
    participantId?: string;
    participantIds?: string[];
    conversationType?: "DM" | "GROUP" | "SUPPORT";
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
    messageType?: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "LOCATION" | "SYSTEM_CONTEXT" | "STRUCTURED_SUGGESTION" | "CONTACT",
    proxyObject?: { objectType: "invitation" | "activity" | "opportunity" | "voucher" | "post" | "order"; objectId: string; snapshot: Record<string, unknown>; liveState?: Record<string, unknown> },
    convoId?: string,
    // QUOTE-REPLY-001: 引用的消息 ID（同会话）。服务端校验归属并落库 reply_to，
    // 列表透出后各端按 ID 解析引用块 —— 不再靠文字快照对。
    replyToMessageId?: string
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
      ...(proxyObject ? { proxyObject } : {}),
      ...(convoId ? { convoId } : {}),
      ...(replyToMessageId ? { replyToMessageId } : {})
    });
    return result;
  }

  public async sendProxyObject(conversationId: string, proxyObject: { objectType: "invitation" | "activity" | "opportunity" | "voucher" | "post" | "order"; objectId: string; snapshot: Record<string, unknown>; liveState?: Record<string, unknown> }, convoId?: string): Promise<Record<string, unknown>> {
    return this.sendMessage(conversationId, proxyObject.snapshot.title as string ?? "", undefined, undefined, undefined, undefined, "TEXT", proxyObject, convoId);
  }

  public async sendImageMessage(conversationId: string, mediaRef: string, caption?: string, protectionOverride?: ProtectionOverride, assistantMode?: string, convoId?: string): Promise<Record<string, unknown>> {
    return this.sendMessage(conversationId, caption?.trim() || " ", assistantMode, undefined, mediaRef, protectionOverride, "IMAGE", undefined, convoId);
  }

  public async sendVideoMessage(conversationId: string, mediaRef: string, caption?: string, protectionOverride?: ProtectionOverride, assistantMode?: string, convoId?: string): Promise<Record<string, unknown>> {
    return this.sendMessage(conversationId, caption?.trim() || " ", assistantMode, undefined, mediaRef, protectionOverride, "VIDEO", undefined, convoId);
  }

  public async sendAudioMessage(conversationId: string, mediaRef: string, protectionOverride?: ProtectionOverride, assistantMode?: string, convoId?: string): Promise<Record<string, unknown>> {
    return this.sendMessage(conversationId, "语音消息", assistantMode, undefined, mediaRef, protectionOverride, "AUDIO", undefined, convoId);
  }

  // MEETUP-SHARE-001: 好友对好友发位置。body 走 encodeMeetupLocation 可解析格式
  // （`label\nlat,lng`），messageType LOCATION。坐标非法直接抛错不发 ——
  // 绝不把 (0,0) / NaN 当真位置发出去（fail-closed，与 CHAT-PROXY-ACTIVITY-001
  // 禁 silent fallback 同口径）。
  public async sendLocationMessage(conversationId: string, point: MeetupPoint, protectionOverride?: ProtectionOverride, assistantMode?: string, convoId?: string): Promise<Record<string, unknown>> {
    const body = encodeMeetupLocation(point);
    if (!body) throw new Error("invalid location: lat must be -90..90, lng -180..180, both finite");
    return this.sendMessage(conversationId, body, assistantMode, undefined, undefined, protectionOverride, "LOCATION", undefined, convoId);
  }

  // CONTACT-CARD-001: 发名片。body 就是 `buildContactCard()` 那串 vCard ——
  // 和二维码里编的**同一串**：相机扫到的是它，对话里发出去的也是它，点开还能
  // 再画成一张码给第三个人扫。和 LOCATION 完全同一个形状（编码 → body → 渲染时解码）。
  //
  // 空串本地就抛错：服务端也会拒（CONTACT 不允许空 body），但客户端先挡一次 ——
  // 一条 body 为空的 CONTACT 在收件人那里是一个**无法解释的空白气泡**，
  // 不是「降级」，是噪音。
  public async sendContactMessage(conversationId: string, vcard: string, protectionOverride?: ProtectionOverride, assistantMode?: string, convoId?: string): Promise<Record<string, unknown>> {
    const trimmed = vcard.trim();
    if (!trimmed) throw new Error("empty contact card: refusing to send a blank bubble");
    return this.sendMessage(conversationId, trimmed, assistantMode, undefined, undefined, protectionOverride, "CONTACT", undefined, convoId);
  }

  public async listMessages(conversationId: string, convoId?: string): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ListConversationMessages", { type: "Conversation", id: conversationId }, {
      ...(convoId ? { convoId } : {}),
    });
    return result;
  }

  // Lotus v1 Convo (Message Branch)：从一条消息分叉出支线讨论。
  public async createConvo(messageId: string, title?: string): Promise<ConvoSummary["convo"]> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "CreateConvo", { type: "Message", id: messageId }, {
      messageId,
      ...(title?.trim() ? { title: title.trim() } : {}),
    });
    const convo = (typeof result.operationRef === "string" ? JSON.parse(result.operationRef) as { convo?: ConvoSummary["convo"] } : {}).convo;
    if (!convo?.id) throw new Error("create convo response malformed");
    return convo;
  }

  public async listMyConvos(): Promise<ConvoSummary[]> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ListMyConvos", { type: "ConvoCollection", id: "mine" }, {});
    const convos = (typeof result.operationRef === "string" ? JSON.parse(result.operationRef) as { convos?: ConvoSummary[] } : {}).convos;
    if (!Array.isArray(convos)) throw new Error("list convos response malformed");
    return convos;
  }

  public async listConversations(): Promise<ConversationInboxItem[]> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ListConversations", { type: "ConversationInbox", id: session.userAccountId }, {});
    // CONVO-INBOX-SWALLOW-001: 服务端 listConversations 恒走 acceptedWithPayload，
    // operationRef 一定在（空收件箱是 `{"conversations":[]}` 不是没有 ref）。所以
    // 读不出来就是**失败**，不能当空列表 —— 空列表会被渲染成「还没有对话」，
    // 用户以为自己没有会话。同文件的 listMyConvos 早已按这个口径抛错（见上）。
    if (typeof result.operationRef !== "string") throw new Error("list conversations response malformed");
    let payload: { conversations?: ConversationInboxItem[] };
    try {
      payload = JSON.parse(result.operationRef) as { conversations?: ConversationInboxItem[] };
    } catch {
      throw new Error("list conversations response malformed");
    }
    if (!Array.isArray(payload.conversations)) throw new Error("list conversations response malformed");
    return payload.conversations;
  }

  public async markMessageRead(messageId: string): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    return this.sendCommand(session, "MarkMessageRead", { type: "Message", id: messageId }, { messageId });
  }
  // UNREAD-PIPELINE-001: 打开会话标已读（dialog 级）。和单条的 MarkMessageRead
  // 不是一回事 —— 那个是阅览计数，这个清未读徽标。
  public async markDialogRead(conversationId: string): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    return this.sendCommand(session, "MarkDialogRead", { type: "Conversation", id: conversationId }, { conversationId });
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
