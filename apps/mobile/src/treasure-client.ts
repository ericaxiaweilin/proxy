import type { TreasureNearby, TreasureResult } from "./treasure-model";

// TREASURE-001：寻宝接口（登录）。读不到抛 TreasureError，界面显示重试；开箱失败带服务端原因码。
type Transport = { request(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<{ status: number; json(): Promise<unknown> }> };

export class TreasureError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly distanceM?: number) {
    super(code);
    this.name = "TreasureError";
  }
}

export type DeviceFix = { lat: number; lng: number; accuracy: number };

export class TreasureClient {
  constructor(private readonly auth: Transport) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: { status: number; json(): Promise<unknown> };
    try {
      res = await this.auth.request(path, { method, ...(body !== undefined ? { body } : {}) });
    } catch {
      throw new TreasureError("network", 0);
    }
    const json = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    if (res.status < 200 || res.status >= 300) {
      throw new TreasureError(typeof json?.error === "string" ? json.error : "treasure_failed", res.status, typeof json?.distanceM === "number" ? json.distanceM : undefined);
    }
    return json as T;
  }

  nearby(fix: DeviceFix): Promise<TreasureNearby> {
    return this.call("GET", `/v1/treasure/nearby?lat=${fix.lat}&lng=${fix.lng}`);
  }

  openSolo(chestId: string, fix: DeviceFix): Promise<TreasureResult> {
    return this.call("POST", "/v1/treasure/open", { kind: "SOLO", chestId, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy });
  }

  openCompanion(activityId: string, companionId: string, fix: DeviceFix): Promise<TreasureResult> {
    return this.call("POST", "/v1/treasure/open", { kind: "COMPANION", activityId, companionId, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy });
  }
}
