// §25 Anti-Thrashing — mobile side guard to prevent Delta jitter
export type ThrottleState = {
  lastChangeTime: number;
  lastPriority: number;
  interactionLockUntil: number;
};

const store = new Map<string, ThrottleState>();
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_PRIORITY_MARGIN = 0.08;

export function shouldSuppress(surfaceId: string, newPriority: number, now = Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS, margin = DEFAULT_PRIORITY_MARGIN): boolean {
  const state = store.get(surfaceId);
  if (!state) return false;
  if (now < state.interactionLockUntil) return true;
  if (now - state.lastChangeTime < cooldownMs && newPriority - state.lastPriority < margin) return true;
  return false;
}

export function recordChange(surfaceId: string, priority: number, now = Date.now()): void {
  const prev = store.get(surfaceId);
  store.set(surfaceId, {
    lastChangeTime: now,
    lastPriority: priority,
    interactionLockUntil: prev?.interactionLockUntil ?? 0,
  });
}

export function lockInteraction(surfaceId: string, durationMs: number, now = Date.now()): void {
  const prev = store.get(surfaceId) ?? { lastChangeTime: 0, lastPriority: 0, interactionLockUntil: 0 };
  store.set(surfaceId, { ...prev, interactionLockUntil: now + durationMs });
}

export function clearThrottleForTest(): void {
  store.clear();
}
