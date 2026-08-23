// Voucher client — every entitlement read and state transition uses the
// command boundary. The app never treats a voucher as stored wallet value.
import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";

export type VoucherFamily = "COFFEE" | "EXPERIENCE" | "ACTIVITY";
export type VoucherStatus = "AVAILABLE" | "REDEEMED" | "SETTLED" | "EXPIRED";

export type Voucher = {
  voucherId: string;
  family: VoucherFamily;
  displayValue: number;
  currency: "VND";
  scopeName: string;
  scopeDetail: string;
  validFrom: string;
  validUntil: string;
  redeemTimeWindow: string;
  minimumSpend: string;
  perPersonLimit: number;
  status: VoucherStatus;
  issuerLabel?: string;
  settlementValue: number;
  reservationNeeded: boolean;
  version: number;
};

export type VoucherRedemption = { redemptionId: string; dynamicCode: string; expiresAt: string; scopeName: string; status: "ACTIVE" };
export type VoucherSettlementState = { name: "REDEEMED" | "RISK_CHECK" | "SETTLEMENT"; status: string };

export type VoucherCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
};

export class VoucherProtocolError extends Error {}
export class VoucherCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) { super(result.error?.messageKey ?? "voucher command rejected"); }
}

export class VoucherClient {
  private commandSequence = 0;

  public constructor(private readonly input: { authClient: VoucherCommandTransport; secureSessionStore: SecureSessionStore; now?: () => Date }) {}

  public async list(): Promise<Voucher[]> {
    const result = await this.command("ListVouchers", { type: "VoucherWallet", id: "mine" }, {});
    const body = this.payload(result);
    if (!Array.isArray(body.vouchers)) throw new VoucherProtocolError("voucher list was malformed");
    return body.vouchers as Voucher[];
  }

  public async get(voucherId: string): Promise<Voucher> {
    const body = this.payload(await this.command("GetVoucher", { type: "Voucher", id: voucherId }, { voucherId }));
    return this.requireVoucher(body);
  }

  public async openRedemption(voucherId: string): Promise<{ voucher: Voucher; redemption: VoucherRedemption }> {
    const body = this.payload(await this.command("OpenVoucherRedemption", { type: "Voucher", id: voucherId }, { voucherId }));
    if (!body.redemption || typeof body.redemption !== "object") throw new VoucherProtocolError("redemption was malformed");
    return { voucher: this.requireVoucher(body), redemption: body.redemption as VoucherRedemption };
  }

  public async confirmRedemption(redemptionId: string): Promise<{ voucher: Voucher; receipt: Record<string, unknown> }> {
    const body = this.payload(await this.command("ConfirmVoucherRedemption", { type: "VoucherRedemption", id: redemptionId }, { redemptionId }));
    return { voucher: this.requireVoucher(body), receipt: (body.receipt ?? {}) as Record<string, unknown> };
  }

  public async settlement(voucherId: string): Promise<{ voucher: Voucher; states: VoucherSettlementState[] }> {
    const body = this.payload(await this.command("GetVoucherSettlement", { type: "Voucher", id: voucherId }, { voucherId }));
    if (!Array.isArray(body.states)) throw new VoucherProtocolError("settlement was malformed");
    return { voucher: this.requireVoucher(body), states: body.states as VoucherSettlementState[] };
  }

  public async settle(voucherId: string): Promise<{ voucher: Voucher; receipt: Record<string, unknown> }> {
    const body = this.payload(await this.command("SettleVoucher", { type: "Voucher", id: voucherId }, { voucherId }));
    return { voucher: this.requireVoucher(body), receipt: (body.receipt ?? {}) as Record<string, unknown> };
  }

  public async create(input: { family: VoucherFamily; displayValue: number; quantity: number; validFrom: string; validUntil: string; scopeName: string; scopeDetail: string; redeemTimeWindow: string; minimumSpend: string; perPersonLimit: number }): Promise<{ voucher: Voucher; issuedQuantity: number; estimatedBudget: number }> {
    const body = this.payload(await this.command("CreateVoucher", { type: "VoucherIssue", id: "new" }, input));
    const issuedQuantity = Number(body.issuedQuantity);
    const estimatedBudget = Number(body.estimatedBudget);
    if (!Number.isFinite(issuedQuantity) || !Number.isFinite(estimatedBudget)) throw new VoucherProtocolError("voucher issue was malformed");
    return { voucher: this.requireVoucher(body), issuedQuantity, estimatedBudget };
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const envelope = {
      commandId: this.nextId("command"), commandType, commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId }, principal: session.principal, target,
      idempotencyKey: this.nextId("idempotency"), authContext: { sessionId: session.auth.sessionId },
      purpose: "voucher_entitlement", correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(), payload
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new VoucherProtocolError("voucher command response was malformed");
    if (result.outcome === "REJECTED") throw new VoucherCommandRejectedError(result);
    if (response.status < 200 || response.status >= 300) throw new VoucherProtocolError(`unexpected voucher command status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new VoucherProtocolError("an authenticated principal is required");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private payload(result: CommandResult): Record<string, unknown> {
    if (!result.operationRef) throw new VoucherProtocolError("voucher response missing payload");
    try {
      const value = JSON.parse(result.operationRef) as unknown;
      if (!value || typeof value !== "object") throw new Error("not an object");
      return value as Record<string, unknown>;
    } catch { throw new VoucherProtocolError("voucher response payload was malformed"); }
  }

  private requireVoucher(body: Record<string, unknown>): Voucher {
    if (!body.voucher || typeof body.voucher !== "object") throw new VoucherProtocolError("voucher response missing voucher");
    return body.voucher as Voucher;
  }

  private nextId(prefix: string): string { this.commandSequence += 1; return `mobile_voucher_${prefix}_${Date.now().toString(36)}_${this.commandSequence.toString(36)}`; }
}
