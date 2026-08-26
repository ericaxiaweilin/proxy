// Delta Patcher — §12/§13/§15.1
//  Versioned Delta + local_ephemeral_state 保护
import type { SurfaceDelta, SurfacePlan, UISchema } from "@proxy/contracts";

export type SurfaceState = {
  plan: SurfacePlan;
  schema: UISchema | null;
  // §15.1 本地交互状态，不能被 Delta 粗暴覆盖
  localEphemeralState: Record<string, unknown>;
};

export type PatchResult =
  | { ok: true; state: SurfaceState }
  | { ok: false; reason: "VERSION_MISMATCH" | "DELTA_EXPIRED" | "INVALID_OP"; message: string };

export function canApplyDelta(localVersion: number, delta: SurfaceDelta): boolean {
  return localVersion === delta.base_version;
}

export function isDeltaExpired(delta: SurfaceDelta): boolean {
  if (!delta.expires_at) return false;
  return new Date(delta.expires_at).getTime() < Date.now();
}

export function applyDelta(state: SurfaceState, delta: SurfaceDelta): PatchResult {
  if (!canApplyDelta(state.plan.surface_version, delta)) {
    return { ok: false, reason: "VERSION_MISMATCH", message: `local ${state.plan.surface_version} != base ${delta.base_version}; must refetch snapshot` };
  }
  if (isDeltaExpired(delta)) {
    return { ok: false, reason: "DELTA_EXPIRED", message: "delta expired" };
  }
  for (const op of delta.operations) {
    if (!["insert", "remove", "update", "move", "replace", "show", "hide", "invalidate"].includes(op.op)) {
      return { ok: false, reason: "INVALID_OP", message: `unknown op ${op.op}` };
    }
  }

  // 产生新 plan 版本；slots 的增量合并（简化：按 slot insert/remove）
  const newSlots: Record<string, string[]> = { ...(state.plan.slots ?? {}) };
  for (const op of delta.operations) {
    if (op.op === "insert" && op.slot !== undefined && op.node !== undefined) {
      const arr = newSlots[op.slot] ?? [];
      if (!arr.includes(op.node)) newSlots[op.slot] = [...arr, op.node];
    }
    if (op.op === "remove" && op.node !== undefined) {
      for (const slot of Object.keys(newSlots)) {
        const cur = newSlots[slot];
        if (cur !== undefined) newSlots[slot] = cur.filter((n) => n !== op.node);
      }
    }
    if (op.op === "invalidate" && op.node !== undefined) {
      // invalidate → 清理对应 localEphemeralState
      delete state.localEphemeralState[op.node];
    }
  }

  const nextPlan: SurfacePlan = {
    ...state.plan,
    surface_version: delta.new_version,
    surface_plan_id: `sp_${delta.delta_id}`,
  };
  (nextPlan as unknown as Record<string, unknown>).slots = newSlots;

  // server_state 更新，localEphemeralState 保留（除非 invalidate）
  return {
    ok: true,
    state: {
      plan: nextPlan,
      schema: state.schema, // 实际渲染层会按需 fetch 新 schema_ref；此处保留引用
      localEphemeralState: { ...state.localEphemeralState },
    },
  };
}

// 乱序时回退到 full snapshot — §13 客户端规则
export function shouldFallbackToSnapshot(localVersion: number, delta: SurfaceDelta): boolean {
  return localVersion !== delta.base_version;
}
