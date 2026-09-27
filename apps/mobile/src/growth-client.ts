// Growth client — reads the "我的权益" tier/growth-value dashboard.
// Read-only: one command, no writes.
//
// GROWTH-REAL-SESSION-001: an earlier version of this file (and, it turns
// out, benefit-client.ts before it — see the matching fix there) built the
// envelope's actor/principal as hardcoded empty-id placeholders. The
// server's missingEnvelopeField() (internal/api/command_dispatch.go)
// rejects that outright with INVALID_COMMAND_ENVELOPE/"actor.id" before
// the command ever reaches growth.Service — confirmed live via curl and
// in the simulator, not just by reading the code. The fix is the same
// pattern fulfillment-client.ts already uses: read the real session
// (secureSessionStore.read()) and put its userAccountId/principal on the
// envelope, not a placeholder.
import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import { commandErrorMessage } from "./command-error-message";
import type { SecureSessionStore, StoredSession } from "./secure-session";

// ──────────────────────────────────────────────────────────────
// Types — mirror internal/growth.Summary's JSON shape exactly.
// ──────────────────────────────────────────────────────────────

export type TierLevel = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";

export type Tier = {
  level: TierLevel;
  name: string;
  currentPoints: number;
  nextLevelPoints?: number;
  nextLevelName?: string;
};

export type Stats = {
  completedOrders: number;
  repeatCustomers: number;
  hasSatisfactionData: boolean;
  satisfactionFullRatePercent: number;
};

export type TodayTask = { name: string; done: boolean };

export type TodayProgress = {
  completed: number;
  target: number;
  tasks: TodayTask[];
};

export type TierBenefit = {
  name: string;
  desc: string;
  icon: string;
  unlocked: boolean;
};

export type BenefitRow = {
  name: string;
  desc: string;
  value: string;
  icon: string;
};

export type Task = {
  name: string;
  reward: string;
  progress: string;
  done: boolean;
  // Client-side navigation key (e.g. "OPEN_MARKET"). Absent/empty means
  // this task is progress-only — do not render a button for it.
  actionTarget?: string;
};

export type TaskGroup = {
  label: string;
  desc: string;
  tasks: Task[];
};

export type Egg = {
  key: string;
  label: string;
  desc: string;
  unlocked: boolean;
};

export type TierCompareRow = {
  name: string;
  level: TierLevel;
  desc: string;
  perks: string;
  points: string;
  current: boolean;
};

export type GrowthSummary = {
  tier: Tier;
  stats: Stats;
  today: TodayProgress;
  tierBenefits: TierBenefit[];
  benefitsProvider: BenefitRow[];
  benefitsClient: BenefitRow[];
  taskGroups: TaskGroup[];
  eggs: Egg[];
  tierCompare: TierCompareRow[];
};

// ──────────────────────────────────────────────────────────────
// Client
// ──────────────────────────────────────────────────────────────

export type GrowthCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
};

export class GrowthError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "GrowthError";
  }
}

export class GrowthClient {
  private commandSequence = 0;

  public constructor(
    private readonly input: {
      authClient: GrowthCommandTransport;
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    }
  ) {}

  public async getMySummary(): Promise<GrowthSummary> {
    const body = this.payload(await this.command("GetMyGrowthSummary", { type: "GrowthSummary", id: "me" }, {}));
    return body.summary as GrowthSummary;
  }

  // ── Internal ──────────────────────────────────────────────

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new GrowthError("authenticated principal required");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: unknown): Promise<{ result: CommandResult; body: Record<string, unknown> }> {
    this.commandSequence++;
    const session = await this.requireSession();
    const now = this.input.now?.() ?? new Date();
    const envelope = {
      commandId: `growth_${Date.now()}_${this.commandSequence}`,
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: `growth_${commandType}_${Date.now()}_${this.commandSequence}`,
      authContext: { sessionId: session.auth.sessionId },
      purpose: "growth_summary_read",
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
      throw new GrowthError(
        commandErrorMessage(error as { messageKey?: string; errorCode?: string } | undefined, `growth command ${commandType} failed`),
        error?.errorCode as string | undefined
      );
    }

    const result = parseCommandResult(json);
    if (!result) throw new GrowthError("malformed command result");
    const body = (json?.body as Record<string, unknown>) ?? {};
    return { result, body };
  }

  private payload(response: { result: CommandResult; body: Record<string, unknown> } | undefined): Record<string, unknown> {
    if (!response) throw new GrowthError("no response");
    if (response.result.outcome === "REJECTED") {
      throw new GrowthError(commandErrorMessage(response.result.error, "command rejected"), response.result.error?.errorCode);
    }
    return response.body ?? {};
  }
}
