// Isolated console API client — talks only to Go BFF, never to mobile store
const BASE = "";

export type ExperienceMetrics = {
  compile_count: number;
  compile_latency_p50_ms: number;
  compile_latency_p95_ms: number;
  validation_fail: number;
  capability_fallback: number;
  delta_apply_success: number;
  delta_reject: number;
  snapshot_recovery: number;
  no_ui_change: number;
};

export async function fetchExperienceMetrics(): Promise<ExperienceMetrics> {
  const r = await fetch(`${BASE}/v1/experience/metrics`);
  if (!r.ok) throw new Error(`metrics ${r.status}`);
  return r.json() as Promise<ExperienceMetrics>;
}

export async function fetchDecisionTrace(decisionId: string): Promise<unknown> {
  // placeholder — wired to future POST /v1/decisions/evaluate trace
  const r = await fetch(`${BASE}/v1/experience/surface?surface_id=home`);
  if (!r.ok) throw new Error(`surface ${r.status}`);
  return r.json();
}
