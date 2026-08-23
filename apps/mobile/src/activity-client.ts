// Activity 客户端：活动读模型（ListActivities）+ 感兴趣/参加命令。
// 计数服务端权威；operationRef 承载 payload（zod 校验，fail-closed）。
import type { Activity, CommandResult } from "@proxy/contracts";
import { JoinActivityPayloadSchema, ListActivitiesPayloadSchema, ToggleActivityInterestPayloadSchema } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";

export type ActivityCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
};

export type ActivityClientOptions = {
  authClient: ActivityCommandTransport;
  secureSessionStore: SecureSessionStore;
  now?: () => Date;
};

export class ActivityProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ActivityProtocolError";
  }
}

export class ActivityCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(result.error?.messageKey ?? "activity command rejected");
    this.name = "ActivityCommandRejectedError";
  }
}

export class ActivityClient {
  private commandSequence = 0;

  public constructor(private readonly input: ActivityClientOptions) {}

  public async listActivities(): Promise<Activity[]> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ListActivities", { type: "Activity", id: "local" }, {});
    return ListActivitiesPayloadSchema.parse(this.decodeOperationRef(result)).activities;
  }

  public async toggleInterest(activityId: string): Promise<{ activity: Activity; interested: boolean }> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ToggleActivityInterest", { type: "Activity", id: activityId }, { activityId });
    return ToggleActivityInterestPayloadSchema.parse(this.decodeOperationRef(result));
  }

  public async join(activityId: string): Promise<{ activity: Activity }> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "JoinActivity", { type: "Activity", id: activityId }, { activityId });
    return JoinActivityPayloadSchema.parse(this.decodeOperationRef(result));
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new ActivityProtocolError("an authenticated principal is required");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private async sendCommand(
    session: StoredSession & { principal: NonNullable<StoredSession["principal"]> },
    commandType: string,
    target: { type: string; id: string },
    payload: Record<string, unknown>
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
      authContext: { sessionId: session.auth.sessionId },
      purpose: "local_activity_hub",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new ActivityProtocolError("activity command response was malformed");
    if (result.outcome === "REJECTED") throw new ActivityCommandRejectedError(result);
    if (response.status < 200 || response.status >= 300) {
      throw new ActivityProtocolError(`unexpected activity command status: ${response.status}`);
    }
    return result;
  }

  private decodeOperationRef(result: CommandResult): unknown {
    if (!result.operationRef) throw new ActivityProtocolError("activity response missing operationRef");
    try {
      return JSON.parse(result.operationRef);
    } catch {
      throw new ActivityProtocolError("activity operationRef was not valid JSON");
    }
  }

  private nextId(prefix: string): string {
    this.commandSequence += 1;
    return `mobile_activity_${prefix}_${Date.now().toString(36)}_${this.commandSequence.toString(36)}`;
  }
}
