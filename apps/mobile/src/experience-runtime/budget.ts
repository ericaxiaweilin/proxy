// §23 性能预算 — mobile 侧镜像
import type { UISchema, SurfaceDelta } from "@proxy/contracts";
import { getSchemaStats } from "@proxy/contracts";

export const DEFAULT_BUDGET = {
  maxSchemaPayloadBytes: 16 * 1024,
  maxDeltaPayloadBytes: 4 * 1024,
  maxNodes: 80,
  maxImages: 12,
};

export function checkSchemaBudget(schema: UISchema, budget = DEFAULT_BUDGET): { ok: true } | { ok: false; reason: string } {
  const bytes = JSON.stringify(schema).length;
  if (bytes > budget.maxSchemaPayloadBytes) return { ok: false, reason: `schema payload ${bytes} > ${budget.maxSchemaPayloadBytes}` };
  const stats = getSchemaStats(schema);
  if (stats.nodes > budget.maxNodes) return { ok: false, reason: `nodes ${stats.nodes} > ${budget.maxNodes}` };
  if (stats.images > budget.maxImages) return { ok: false, reason: `images ${stats.images} > ${budget.maxImages}` };
  return { ok: true };
}

export function checkDeltaBudget(delta: SurfaceDelta, budget = DEFAULT_BUDGET): { ok: true } | { ok: false; reason: string } {
  const bytes = JSON.stringify(delta).length;
  if (bytes > budget.maxDeltaPayloadBytes) return { ok: false, reason: `delta payload ${bytes} > ${budget.maxDeltaPayloadBytes}` };
  return { ok: true };
}
