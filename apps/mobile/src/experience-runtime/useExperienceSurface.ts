import { useCallback, useEffect, useRef, useState } from "react";
import { ExperienceRuntimeClient } from "./client";
import { applyDelta, canApplyDelta } from "./delta-patcher";
import { shouldSuppress, recordChange } from "./throttle";
import type { SurfacePlan, UISchema, ExperienceIntent, ClientCapability } from "@proxy/contracts";
import type { SurfaceState } from "./delta-patcher";
import { buildClientCapability } from "./capability";

export type UseExperienceSurfaceOptions = {
  client: ExperienceRuntimeClient;
  surfaceId?: string;
  intent: ExperienceIntent;
  capability?: ClientCapability;
  pollIntervalMs?: number;
};

export type UseExperienceSurfaceResult = {
  plan: SurfacePlan | null;
  schema: UISchema | null;
  isFallback: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

// Hook — §12/§13/§15  Realtime Delta + fallback + anti-thrashing + local state guard
export function useExperienceSurface(options: UseExperienceSurfaceOptions): UseExperienceSurfaceResult {
  const { client, surfaceId = "home", intent, capability, pollIntervalMs = 30_000 } = options;
  const [plan, setPlan] = useState<SurfacePlan | null>(null);
  const [schema, setSchema] = useState<UISchema | null>(null);
  const [isFallback, setIsFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const surfaceStateRef = useRef<SurfaceState | null>(null);

  const defaultCapability = buildClientCapability({
    clientVersion: "2.7.1",
    platform: "ios",
    uiRuntimeVersion: "3.2",
    capabilities: ["stack:v3", "grid:v2", "merchant_card:v5", "delta_patch:v2"],
  });

  const cap = capability ?? defaultCapability;

  const refresh = useCallback(async () => {
    // §25 anti-thrashing: suppress if within cooldown
    if (shouldSuppress(surfaceId, intent.priority)) {
      return;
    }
    try {
      const currentVer: number | undefined = plan?.surface_version ?? undefined;
      const compileInput: { intent: ExperienceIntent; capability: ClientCapability; currentSurfaceVersion?: number } = currentVer !== undefined ? { intent, capability: cap, currentSurfaceVersion: currentVer } : { intent, capability: cap };
      const res = await client.compileSurface(compileInput);
      // success
      setPlan(res.surface_plan);
      if (res.ui_schema) setSchema(res.ui_schema);
      setIsFallback(res.surface_plan.render_mode === "FALLBACK");
      setError(null);
      // populate SurfaceState for delta patching
      surfaceStateRef.current = {
        plan: res.surface_plan,
        schema: res.ui_schema,
        localEphemeralState: surfaceStateRef.current?.localEphemeralState ?? {},
      };
      recordChange(surfaceId, intent.priority);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "NO_UI_CHANGE") {
        // §18.4 legal result — keep current surface
        setError(null);
        return;
      }
      // try snapshot fallback §18.3
      try {
        const snap = await client.fetchSurfaceSnapshot(surfaceId);
        setPlan(snap.surface_plan);
        setSchema(snap.ui_schema);
        setIsFallback(true);
        setError(null);
        surfaceStateRef.current = { plan: snap.surface_plan, schema: snap.ui_schema, localEphemeralState: surfaceStateRef.current?.localEphemeralState ?? {} };
      } catch {
        setError(msg);
        setIsFallback(true);
      }
    }
  }, [client, surfaceId, intent, cap, plan?.surface_version]);

  // initial fetch
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // poll for delta — §12 Realtime Delta
  useEffect(() => {
    if (!plan || !isFallback === false && pollIntervalMs <= 0) return;
    const id = setInterval(async () => {
      if (!surfaceStateRef.current) return;
      try {
        const delta = await client.fetchDelta(surfaceId, surfaceStateRef.current.plan.surface_version);
        if (!canApplyDelta(surfaceStateRef.current.plan.surface_version, delta)) {
          // §13 mismatch → snapshot
          const snap = await client.fetchSurfaceSnapshot(surfaceId);
          setPlan(snap.surface_plan);
          setSchema(snap.ui_schema);
          surfaceStateRef.current = { plan: snap.surface_plan, schema: snap.ui_schema, localEphemeralState: surfaceStateRef.current.localEphemeralState };
          return;
        }
        const patched = applyDelta(surfaceStateRef.current, delta);
        if (patched.ok) {
          setPlan(patched.state.plan);
          // schema refetch would happen via schema_ref; keep current for MVP
          surfaceStateRef.current = patched.state;
        } else if (patched.reason === "VERSION_MISMATCH") {
          const snap = await client.fetchSurfaceSnapshot(surfaceId);
          setPlan(snap.surface_plan);
          setSchema(snap.ui_schema);
          surfaceStateRef.current = { plan: snap.surface_plan, schema: snap.ui_schema, localEphemeralState: surfaceStateRef.current.localEphemeralState };
        }
      } catch {
        // silent — next poll will retry
      }
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [client, surfaceId, plan, pollIntervalMs, isFallback]);

  return { plan, schema, isFallback, error, refresh };
}
