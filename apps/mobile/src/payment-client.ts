import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";

export class PaymentClient {
  private sequence = 0;
  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  public async createIntent(input: { orderId: string; agentId: string; amountMinor: number; currency?: string }): Promise<{ paymentIntentId: string }> {
    const body = this.body(await this.command("CreatePaymentIntent", { type: "Payment", id: input.orderId }, input as unknown as Record<string, unknown>));
    return { paymentIntentId: body.paymentIntentId as string };
  }

  public async confirmIntent(input: { paymentIntentId: string; providerEventId: string; amountMinor?: number; currency?: string; status: string }): Promise<void> {
    await this.command("ConfirmPaymentIntent", { type: "Payment", id: input.paymentIntentId }, input as unknown as Record<string, unknown>);
  }

  public async refund(input: { paymentIntentId: string; amountMinor: number }): Promise<void> {
    await this.command("RefundPaymentIntent", { type: "Payment", id: input.paymentIntentId }, input as unknown as Record<string, unknown>);
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const next = (prefix: string) => `mobile_pay_${prefix}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "payment",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload,
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("payment command malformed");
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey ?? result.error?.errorCode ?? "payment rejected");
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected payment status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    if (!result.operationRef) throw new Error("payment missing payload");
    const value = JSON.parse(result.operationRef) as unknown;
    if (!value || typeof value !== "object") throw new Error("payment payload malformed");
    return value as Record<string, unknown>;
  }
}
