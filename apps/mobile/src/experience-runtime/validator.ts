import {
  UISchemaSchema,
  SurfacePlanSchema,
  SurfaceDeltaSchema,
  ClientCapabilitySchema,
  ACTION_REGISTRY,
  type UISchema,
  type SurfacePlan,
  type SurfaceDelta,
  type ClientCapability,
} from "@proxy/contracts";

export type ValidateSchemaResult =
  | { ok: true; schema: UISchema }
  | { ok: false; reason: string };

export function validateUISchema(raw: unknown): ValidateSchemaResult {
  const parsed = UISchemaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "SCHEMA_INVALID" };
  }
  return { ok: true, schema: parsed.data };
}

export type ValidatePlanResult =
  | { ok: true; plan: SurfacePlan }
  | { ok: false; reason: string };

export function validateSurfacePlan(raw: unknown): ValidatePlanResult {
  const parsed = SurfacePlanSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "PLAN_INVALID" };
  }
  return { ok: true, plan: parsed.data };
}

export function validateDelta(raw: unknown): { ok: true; delta: SurfaceDelta } | { ok: false; reason: string } {
  const parsed = SurfaceDeltaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "DELTA_INVALID" };
  }
  return { ok: true, delta: parsed.data };
}

export function validateCapability(raw: unknown): { ok: true; cap: ClientCapability } | { ok: false; reason: string } {
  const parsed = ClientCapabilitySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "CAPABILITY_INVALID" };
  }
  return { ok: true, cap: parsed.data };
}

// §17.2 Action allowlist
export function isActionAllowed(actionId: string): boolean {
  return actionId in ACTION_REGISTRY;
}
