import type { CommandResult, TaskDraftChanges } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";

export type AuthenticatedCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
};

export type DemandClientOptions = {
  authClient: AuthenticatedCommandTransport;
  secureSessionStore: SecureSessionStore;
  now?: () => Date;
};

export class DemandCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(result.error?.messageKey ?? "demand command rejected");
    this.name = "DemandCommandRejectedError";
  }
}

export class DemandProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DemandProtocolError";
  }
}

export class DemandClient {
  private commandSequence = 0;

  public constructor(private readonly input: DemandClientOptions) {}

  public async createDraft(sourceInput: string): Promise<CommandResult> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "CreateTaskDraft", { type: "TaskDraft", id: "new" }, {
      ownerUserAccountId: session.userAccountId,
      principal: session.principal,
      sourceInput
    });
    return this.requireAcceptedAggregate(result, "TaskDraft");
  }

  public async updateDraft(draftId: string, expectedVersion: number, changes: TaskDraftChanges): Promise<CommandResult> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "UpdateTaskDraft", { type: "TaskDraft", id: draftId }, {
      expectedVersion,
      changes
    }, expectedVersion);
    return this.requireAcceptedAggregate(result, "TaskDraft");
  }

  public async previewDraft(draftId: string, expectedVersion: number): Promise<CommandResult> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "PreviewTaskDraft", { type: "TaskDraft", id: draftId }, {
      expectedVersion
    }, expectedVersion);
    return this.requireAcceptedAggregate(result, "DemandPreview");
  }

  public async publishTask(draftId: string, expectedVersion: number): Promise<CommandResult> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "PublishTask", { type: "TaskDraft", id: draftId }, {
      expectedVersion,
      online: true
    }, expectedVersion);
    if (result.outcome !== "ACCEPTED" && result.outcome !== "PENDING" && result.outcome !== "ALREADY_APPLIED") {
      throw new DemandProtocolError("publish response did not contain an actionable outcome");
    }
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new DemandProtocolError("an authenticated principal is required");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private async sendCommand(
    session: StoredSession & { principal: NonNullable<StoredSession["principal"]> },
    commandType: string,
    target: { type: string; id: string },
    payload: Record<string, unknown>,
    expectedAggregateVersion?: number
  ): Promise<CommandResult> {
    const commandId = this.nextId("command");
    const envelope = {
      commandId,
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: this.nextId("idempotency"),
      ...(expectedAggregateVersion !== undefined ? { expectedAggregateVersion } : {}),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "requester_demand_builder",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new DemandProtocolError("demand command response was malformed");
    if (result.outcome === "REJECTED") throw new DemandCommandRejectedError(result);
    if (response.status < 200 || response.status >= 300) {
      throw new DemandProtocolError(`unexpected demand command status: ${response.status}`);
    }
    return result;
  }

  private requireAcceptedAggregate(result: CommandResult, aggregateType: string): CommandResult {
    if ((result.outcome !== "ACCEPTED" && result.outcome !== "ALREADY_APPLIED") || result.aggregate?.type !== aggregateType) {
      throw new DemandProtocolError(`demand response did not contain ${aggregateType}`);
    }
    return result;
  }

  private nextId(prefix: string): string {
    this.commandSequence += 1;
    return `mobile_demand_${prefix}_${Date.now().toString(36)}_${this.commandSequence.toString(36)}`;
  }
}
