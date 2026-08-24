import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";

export class OutcomeClient {
  private sequence = 0;
  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  public async createSet(input: { targetId: string; templateId: string; venueId: string }): Promise<{ setId: string }> {
    const body = this.body(await this.command("CreateObservationSet", { type: "ObservationSet", id: "new" }, input as unknown as Record<string, unknown>));
    return { setId: body.setId as string ?? (body as any).id };
  }

  public async recordObservation(input: { setId: string; key: string; value: string; unit: string }): Promise<void> {
    await this.command("RecordOutcomeObservation", { type: "ObservationSet", id: input.setId }, input as unknown as Record<string, unknown>);
  }

  public async finalizeSet(setId: string): Promise<void> {
    await this.command("FinalizeObservationSet", { type: "ObservationSet", id: setId }, { setId });
  }

  public async createComparison(input: { baselineId: string; resultId: string; policyVersion: string }): Promise<{ deltaId: string; learningId: string }> {
    const body = this.body(await this.command("CreateOutcomeComparison", { type: "OutcomeDelta", id: "new" }, input as unknown as Record<string, unknown>));
    return { deltaId: body.deltaId as string, learningId: body.learningId as string };
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const next = (prefix: string) => `mobile_out_${prefix}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "outcome",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload,
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("outcome command malformed");
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey ?? result.error?.errorCode ?? "outcome rejected");
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected outcome status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    if (!result.operationRef) throw new Error("outcome missing payload");
    const value = JSON.parse(result.operationRef) as unknown;
    if (!value || typeof value !== "object") throw new Error("outcome payload malformed");
    return value as Record<string, unknown>;
  }
}
