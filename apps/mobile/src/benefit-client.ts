// Benefit client — handles benefit routing network operations:
// campaign listing, benefit claims, redemptions, and eligibility checks.
import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import { commandErrorMessage } from "./command-error-message";

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export type CampaignType =
  | "SCENE_IGNITION"
  | "CREATOR_SEED"
  | "NEW_TO_SCENE"
  | "REACTIVATION"
  | "NEWCOMER"
  | "ACTIVITY_ATTACH"
  | "ORDER_COMPLETION"
  | "CREATOR_GIFT"
  | "MERCHANT_CAMPAIGN";

export type CampaignStatus =
  | "DRAFT"
  | "REVIEW"
  | "SCHEDULED"
  | "ACTIVE"
  | "PAUSED"
  | "ENDED"
  | "EXHAUSTED"
  | "CANCELLED";

export type Campaign = {
  campaignId: string;
  type: CampaignType;
  status: CampaignStatus;
  ownerType: string;
  ownerId: string;
  sceneIds: string[];
  goal: string;
  budgetMinor: number;
  spentMinor: number;
  currency: string;
  startAt: string;
  endAt: string;
  createdAt: string;
  version: number;
};

export type BenefitKind =
  | "FREE_DRINK"
  | "FREE_MEAL"
  | "DISCOUNT_PERCENT"
  | "DISCOUNT_FIXED"
  | "GIFT"
  | "UPGRADE"
  | "VOUCHER"
  | "ACTIVITY_CREDIT";

export type BenefitDefinition = {
  benefitId: string;
  campaignId: string;
  kind: BenefitKind;
  label: string;
  description?: string;
  retailValueMinor: number;
  userPayMinor: number;
  currency: string;
  createdAt: string;
};

export type ClaimStatus =
  | "CLAIMED"
  | "RESERVED"
  | "REDEEMED"
  | "EXPIRED"
  | "VOID"
  | "RELEASED";

export type Claim = {
  claimId: string;
  offerId?: string;
  campaignId: string;
  benefitId: string;
  userId: string;
  claimToken: string;
  status: ClaimStatus;
  reservedUntil?: string;
  redeemedAt?: string;
  createdAt: string;
  version: number;
};

export type RedemptionStatus =
  | "PENDING"
  | "CONFIRMED"
  | "SETTLED"
  | "VOID"
  | "FRAUD_HOLD";

export type Redemption = {
  redemptionId: string;
  claimId: string;
  campaignId: string;
  merchantId: string;
  staffId?: string;
  userId: string;
  retailValueMinor: number;
  userPayMinor: number;
  proxySubsidyMinor: number;
  merchantContributionMinor: number;
  creatorAllocationMinor: number;
  staffRewardMinor: number;
  currency: string;
  evidenceType: string;
  evidenceRef: string;
  status: RedemptionStatus;
  idempotencyKey: string;
  redeemedAt: string;
  createdAt: string;
  version: number;
};

export type EligibilityResult = {
  eligible: boolean;
  reasonCode: string;
  offerReason?: string | null | undefined;
};

// ──────────────────────────────────────────────────────────────
// Client
// ──────────────────────────────────────────────────────────────

export type BenefitCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
};

export class BenefitError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "BenefitError";
  }
}

export class BenefitClient {
  private commandSequence = 0;

  public constructor(
    private readonly input: {
      authClient: BenefitCommandTransport;
      now?: () => Date;
    }
  ) {}

  // ── Campaign ──────────────────────────────────────────────

  public async listCampaigns(opts?: { status?: CampaignStatus }): Promise<Campaign[]> {
    const result = await this.command("ListCampaigns", { type: "Campaign", id: "list" }, opts ?? {});
    const body = this.payload(result);
    return (body.campaigns ?? []) as Campaign[];
  }

  public async getCampaign(campaignId: string): Promise<Campaign> {
    const body = this.payload(await this.command("GetCampaign", { type: "Campaign", id: campaignId }, { campaignId }));
    return body.campaign as Campaign;
  }

  // ── Claim ─────────────────────────────────────────────────

  public async claimBenefit(input: {
    campaignId: string;
    benefitId: string;
    offerId?: string;
  }): Promise<{ claimId: string; claimToken: string }> {
    const result = await this.command(
      "ClaimBenefit",
      { type: "Benefit", id: input.benefitId },
      input
    );
    const body = this.payload(result);
    return { claimId: body.claimId as string, claimToken: body.claimToken as string };
  }

  public async listClaims(opts?: { status?: ClaimStatus }): Promise<Claim[]> {
    const result = await this.command("ListClaims", { type: "Claim", id: "list" }, opts ?? {});
    const body = this.payload(result);
    return (body.claims ?? []) as Claim[];
  }

  public async getClaim(claimId: string): Promise<Claim> {
    const body = this.payload(await this.command("GetClaim", { type: "Claim", id: claimId }, { claimId }));
    return body.claim as Claim;
  }

  // ── Redeem ────────────────────────────────────────────────

  public async redeemBenefit(input: {
    claimToken: string;
    merchantId: string;
    staffId?: string | null | undefined;
    evidenceType: string;
    evidenceRef?: string;
    idempotencyKey: string;
  }): Promise<Redemption> {
    const result = await this.command(
      "RedeemBenefit",
      { type: "Redemption", id: input.idempotencyKey },
      input
    );
    const body = this.payload(result);
    return body as Redemption;
  }

  // ── Eligibility ───────────────────────────────────────────

  public async checkEligibility(input: {
    campaignId: string;
    benefitId: string;
    userCity?: string;
    sceneId?: string;
    distanceToScene?: number;
  }): Promise<EligibilityResult> {
    const result = await this.command(
      "CheckEligibility",
      { type: "Eligibility", id: input.campaignId },
      input
    );
    const body = this.payload(result);
    return {
      eligible: body.eligible as boolean,
      reasonCode: body.reasonCode as string,
      offerReason: body.offerReason as string | undefined,
    };
  }

  // ── Internal ──────────────────────────────────────────────

  private async command(commandType: string, target: { type: string; id: string }, payload: unknown): Promise<{ result: CommandResult; body: Record<string, unknown> }> {
    this.commandSequence++;
    const now = this.input.now?.() ?? new Date();
    const envelope = {
      commandId: `benefit_${Date.now()}_${this.commandSequence}`,
      commandType,
      commandVersion: 1,
      actor: { type: "INDIVIDUAL", id: "" },
      principal: { type: "INDIVIDUAL", id: "" },
      target,
      idempotencyKey: `benefit_${commandType}_${Date.now()}_${this.commandSequence}`,
      authContext: {},
      purpose: "benefit_operation",
      correlationId: `corr_${Date.now()}`,
      requestedAt: now.toISOString(),
      payload,
    };

    const response = await this.input.authClient.request("/v1/commands/" + commandType, {
      method: "POST",
      body: envelope,
    });

    const json = (await response.json()) as Record<string, unknown> | undefined;
    if (response.status < 200 || response.status >= 300) {
      const error = json?.error as Record<string, unknown> | undefined;
      throw new BenefitError(
        commandErrorMessage(error as { messageKey?: string; errorCode?: string } | undefined, `benefit command ${commandType} failed`),
        error?.errorCode as string | undefined
      );
    }

    const result = parseCommandResult(json);
    if (!result) throw new BenefitError("malformed command result");
    const body = (json?.body as Record<string, unknown>) ?? {};
    return { result, body };
  }

  private payload(response: { result: CommandResult; body: Record<string, unknown> } | undefined): Record<string, unknown> {
    if (!response) throw new BenefitError("no response");
    if (response.result.outcome === "REJECTED") {
      throw new BenefitError(commandErrorMessage(response.result.error, "command rejected"), response.result.error?.errorCode);
    }
    return response.body ?? {};
  }
}
