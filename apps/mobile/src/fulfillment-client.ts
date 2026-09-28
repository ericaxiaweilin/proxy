import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

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
    // ORDER-SCENARIO-001: 消费场景（ordinary 普通消费 / assistance 城市协助 /
    // 缺省历史数据）。market 路径由机会快照带入；订单流程按它分档。
    scenario?: string | undefined;
  };
  // ORDER-SETTLE-GUARD-001：线下结算记录。每一方只确认自己那一侧。
  settlement?: {
    agreedAmount: number;
    payerConfirmed: boolean;
    payeeConfirmed: boolean;
  } | undefined;
  createdAt: string;
  updatedAt: string;
  viewerRole: "REQUESTER" | "AGENT";
};

// STORE-STATS-001：一家店的经营统计（只数 COMPLETED 归因单；空店全零，recent []）。
export type StoreOrderRecent = {
  orderId: string;
  requesterId: string;
  serviceSku: string;
  satisfaction: string;
  completedAt: string;
};

export type StoreOrderStats = {
  storeId: string;
  orderCount: number;
  fullCount: number;
  partialCount: number;
  repeatRequesters: number;
  lastOrderAt?: string;
  recent: StoreOrderRecent[];
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

  public async cancelOrder(orderId: string, reason: string): Promise<{ lifecycle: string; version: number }> {
    const body = this.body(await this.command("CancelOrder", { type: "Order", id: orderId }, { reason }));
    if (typeof body.lifecycle !== "string" || typeof body.version !== "number") throw new Error("cancel payload malformed");
    return { lifecycle: body.lifecycle as string, version: body.version as number };
  }

  // ORDER-EXEC-001: 订单执行动作之前只接了打卡/证据/取消 —— OFFERED 卡死，
  // EXECUTING 走不到 COMPLETED，COMPLETED 评不了分。下面补齐状态机缺的五块，
  // 明细页按 lifecycle 逐态出按钮。
  public async confirmCooperation(orderId: string): Promise<void> {
    await this.command("ConfirmCooperation", { type: "Order", id: orderId }, {});
  }

  public async startExecution(orderId: string): Promise<void> {
    await this.command("StartExecution", { type: "Order", id: orderId }, {});
  }

  public async recordSettlement(orderId: string, input: { agreedAmount: number; paymentMethodLabel?: string; payerConfirmed?: boolean; payeeConfirmed?: boolean }): Promise<void> {
    await this.command("RecordDirectSettlement", { type: "Order", id: orderId }, input as unknown as Record<string, unknown>);
  }

  // STORE-STATS-001：storeId 可选 —— 履约方指认「这笔单在我哪家店完成」。
  // 传了就落进那家店的经营统计（服务端校验必须是真实存在的 ACTIVE 店，否则
  // UNKNOWN_STORE 驳回）；不传 = 不归因，这一单不计入任何店的统计。
  // 注意 exactOptionalPropertyTypes：不要传 storeId: undefined，要用条件展开。
  public async recordOutcome(orderId: string, input: { onTime: boolean; scopeCompleted: boolean; objectiveNote?: string; storeId?: string }): Promise<void> {
    await this.command("RecordOutcome", { type: "Order", id: orderId }, input as unknown as Record<string, unknown>);
  }

  // STORE-STATS-001：读一家店的经营统计。失败抛 —— 调用方区分「读不出来」和「确实没有」。
  public async getStoreOrderStats(storeId: string): Promise<StoreOrderStats> {
    const body = this.body(await this.command("GetStoreOrderStats", { type: "Store", id: storeId }, { storeId }));
    const stats = body.stats as StoreOrderStats | undefined;
    if (!stats || typeof stats.orderCount !== "number" || !Array.isArray(stats.recent)) {
      throw new Error("store order stats malformed");
    }
    return stats;
  }

  public async recordSatisfaction(orderId: string, input: { resolved: "FULL" | "PARTIAL" | "NONE"; repeatIntent?: "REUSE" | "MAYBE" | "NO" }): Promise<void> {
    await this.command("RecordSatisfaction", { type: "Order", id: orderId }, input as unknown as Record<string, unknown>);
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
    if (result.outcome === "REJECTED") throw new Error(commandErrorMessage(result.error, "fulfillment rejected"));
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected fulfillment status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    if (session.serverSession === false) throw new Error("fulfillment actions require a real sign-in (offline session cannot act)");
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    if (!result.operationRef) throw new Error("fulfillment missing payload");
    const value = JSON.parse(result.operationRef) as unknown;
    if (!value || typeof value !== "object") throw new Error("fulfillment payload malformed");
    return value as Record<string, unknown>;
  }
}
