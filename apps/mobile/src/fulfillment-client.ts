import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";

export type SlotOffer = {
  offerId: string;
  taskId: string;
  slotId: string;
  requesterId: string;
  agentId: string;
  status: string;
  expiresAt: string;
};

export type FulfillmentOrder = {
  orderId: string;
  requesterId: string;
  agentId: string;
  needId: string;
  lifecycle: "OFFERED" | "CONFIRMED" | "EXECUTING" | "COMPLETED" | "CANCELLED";
  snapshot: {
    requester: string;
    agent: string;
    serviceSku: string;
    duration: string;
    startTime: string;
    meetingContext: string;
    agreedCompensation: number;
    currency: string;
    includedScope: string;
    excludedScope: string;
    settlementMode: string;
    paymentMethodLabel: string;
  };
  createdAt: string;
  updatedAt: string;
  viewerRole: "REQUESTER" | "AGENT";
};

export class FulfillmentClient {
  private sequence = 0;
  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  public async createSlotOffer(input: { taskId: string; slotId: string; agentId: string; batchId?: string; agreedCompensation?: number }): Promise<SlotOffer> {
    const body = this.body(
      await this.command("CreateSlotOffer", { type: "Offer", id: "new" }, {
        taskId: input.taskId,
        slotId: input.slotId,
        agentId: input.agentId,
        ...(input.batchId ? { batchId: input.batchId } : {}),
        agreedCompensation: input.agreedCompensation ?? 1200000,
      }),
    );
    if (!body.offerId || typeof body.offerId !== "string") throw new Error("slot offer missing offerId");
    return body as unknown as SlotOffer;
  }

  public async acceptSlotOffer(offerId: string): Promise<{ orderId: string }> {
    const body = this.body(await this.command("AcceptSlotOffer", { type: "Offer", id: offerId }, { offerId }));
    if (!body.orderId || typeof body.orderId !== "string") throw new Error("accept missing orderId");
    return { orderId: body.orderId as string };
  }

  public async getOffer(offerId: string): Promise<SlotOffer> {
    const body = this.body(await this.command("GetOffer", { type: "Offer", id: offerId }, { offerId }));
    if (!body.offer || typeof body.offer !== "object") throw new Error("offer malformed");
    return (body.offer as unknown) as SlotOffer;
  }

  public async listAgentOffers(): Promise<SlotOffer[]> {
    const body = this.body(await this.command("ListAgentOffers", { type: "Offer", id: "list" }, {}));
    if (!Array.isArray(body.offers)) throw new Error("offers malformed");
    return body.offers as SlotOffer[];
  }

  public async listMyOrders(): Promise<FulfillmentOrder[]> {
    const body = this.body(await this.command("ListMyOrders", { type: "OrderCollection", id: "mine" }, {}));
    if (!Array.isArray(body.orders)) throw new Error("orders malformed");
    return body.orders as FulfillmentOrder[];
  }

  public async checkInOrder(orderId: string, input: { marketId: string; locationLabel: string }): Promise<void> {
    await this.command("CheckInOrder", { type: "Order", id: orderId }, input as unknown as Record<string, unknown>);
  }

  public async submitEvidence(orderId: string, input: { mediaAssetId: string; evidenceType?: string }): Promise<void> {
    await this.command("SubmitEvidence", { type: "Order", id: orderId }, input as unknown as Record<string, unknown>);
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const next = (prefix: string) => `mobile_fulfill_${prefix}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "fulfillment",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload,
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("fulfillment command malformed");
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey ?? result.error?.errorCode ?? "fulfillment rejected");
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected fulfillment status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    if (session.serverSession === false) throw new Error("fulfillment actions require a real sign-in (offline session cannot act)");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    if (!result.operationRef) throw new Error("fulfillment missing payload");
    const value = JSON.parse(result.operationRef) as unknown;
    if (!value || typeof value !== "object") throw new Error("fulfillment payload malformed");
    return value as Record<string, unknown>;
  }
}
