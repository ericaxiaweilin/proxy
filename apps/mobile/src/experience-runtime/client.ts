import {
  SurfacePlanSchema,
  UISchemaSchema,
  SurfaceDeltaSchema,
  type SurfacePlan,
  type UISchema,
  type SurfaceDelta,
  type ExperienceIntent,
  type ClientCapability,
} from "@proxy/contracts";
import type { TransportResponse } from "../auth-client";
import { parseCommandResult } from "../login-client";
import type { SecureSessionStore, StoredSession } from "../secure-session";

export type RuntimeTransport = {
  request(path: string, init: { method: "GET" | "POST"; body?: unknown; headers?: Record<string,string> }): Promise<TransportResponse>;
};

export class ExperienceRuntimeError extends Error {
  constructor(message: string, public readonly causeDetail?: unknown) {
    super(message);
    this.name = "ExperienceRuntimeError";
  }
}

export type CompileSurfaceResponse = {
  surface_plan: SurfacePlan;
  ui_schema: UISchema | null;
  delta: SurfaceDelta | null;
  fallback_plan_id: string | null;
};

export class ExperienceRuntimeClient {
  private seq = 0;
  constructor(private readonly input: { transport: RuntimeTransport; secureSessionStore: SecureSessionStore; now?: () => Date }) {}

  async compileSurface(input: {
    intent: ExperienceIntent;
    capability: ClientCapability;
    currentSurfaceVersion?: number;
  }): Promise<CompileSurfaceResponse> {
    const session = await this.requireSession();
    const commandId = this.nextId("command");
    const envelope = {
      commandId,
      commandType: "CompileExperienceSurface",
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target: { type: "ExperienceSurface", id: input.intent.intent_id },
      idempotencyKey: this.nextId("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "experience_compile",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload: {
        experience_intent: {
          ...input.intent,
          expires_at: input.intent.expires_at,
        },
        client_capability: input.capability,
        ...(input.currentSurfaceVersion !== undefined ? { current_surface_version: input.currentSurfaceVersion } : {}),
      },
    };
    const response = await this.input.transport.request("/v1/commands/CompileExperienceSurface", { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new ExperienceRuntimeError("malformed compile response");
    if (result.outcome === "REJECTED") {
      // §18.2 fallback — surface fallback_plan_id in error details
      const fb = (result.error?.safeDetails as Record<string, unknown> | undefined)?.["fallback_plan_id"];
      throw new ExperienceRuntimeError(result.error?.messageKey ?? "compile_rejected", { fallbackPlanId: fb, result });
    }
    if (result.outcome === "ACCEPTED" && result.aggregate?.state === "NO_UI_CHANGE") {
      // §18.4 valid legal result
      throw new ExperienceRuntimeError("NO_UI_CHANGE", { result });
    }
    if (response.status < 200 || response.status >= 300) throw new ExperienceRuntimeError(`unexpected status ${response.status}`);
    const raw = this.decodeOperationRef(result);
    const parsed = parseCompileResponse(raw);
    if (!parsed) throw new ExperienceRuntimeError("compile response failed contract validation", raw);
    return parsed;
  }

  async fetchSurfaceSnapshot(surfaceId = "home"): Promise<{ surface_plan: SurfacePlan; ui_schema: UISchema | null; as_of: string }> {
    const response = await this.input.transport.request(`/v1/experience/surface?surface_id=${encodeURIComponent(surfaceId)}`, { method: "GET" });
    const json = await response.json() as Record<string, unknown>;
    const plan = SurfacePlanSchema.safeParse(json["surface_plan"]);
    const schema = json["ui_schema"] ? UISchemaSchema.safeParse(json["ui_schema"]) : { success: true, data: null } as const;
    if (!plan.success) throw new ExperienceRuntimeError("snapshot plan invalid", plan);
    return { surface_plan: plan.data, ui_schema: (schema as { data: unknown }).data as UISchema | null, as_of: String(json["as_of"] ?? "") };
  }

  async fetchDelta(surfaceId: string, baseVersion: number): Promise<SurfaceDelta> {
    const response = await this.input.transport.request(`/v1/experience/delta?surface_id=${encodeURIComponent(surfaceId)}&base_version=${baseVersion}`, { method: "GET" });
    const json = await response.json() as unknown;
    const parsed = SurfaceDeltaSchema.safeParse(json);
    if (!parsed.success) throw new ExperienceRuntimeError("delta invalid", parsed.error);
    return parsed.data;
  }

  // SSE helper — caller decides to use EventSource or fetch+stream
  deltaStreamUrl(surfaceId: string, baseVersion: number): string {
    return `/v1/experience/delta?surface_id=${encodeURIComponent(surfaceId)}&base_version=${baseVersion}`;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const s = await this.input.secureSessionStore.read();
    if (!s?.principal) throw new ExperienceRuntimeError("authenticated principal required");
    return s as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private decodeOperationRef(result: { operationRef?: string }): unknown {
    if (!result.operationRef) throw new ExperienceRuntimeError("missing operationRef");
    try { return JSON.parse(result.operationRef); } catch { throw new ExperienceRuntimeError("operationRef not JSON"); }
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `mobile_runtime_${prefix}_${Date.now().toString(36)}_${this.seq.toString(36)}`;
  }
}

function parseCompileResponse(raw: unknown): CompileSurfaceResponse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const plan = SurfacePlanSchema.safeParse(obj["surface_plan"]);
  if (!plan.success) return null;
  let schema: UISchema | null = null;
  if (obj["ui_schema"] !== null && obj["ui_schema"] !== undefined) {
    const s = UISchemaSchema.safeParse(obj["ui_schema"]);
    if (!s.success) return null;
    schema = s.data;
  }
  let delta: SurfaceDelta | null = null;
  if (obj["delta"] !== null && obj["delta"] !== undefined) {
    const d = SurfaceDeltaSchema.safeParse(obj["delta"]);
    if (!d.success) return null;
    delta = d.data;
  }
  return { surface_plan: plan.data, ui_schema: schema, delta, fallback_plan_id: (obj["fallback_plan_id"] as string) ?? null };
}
