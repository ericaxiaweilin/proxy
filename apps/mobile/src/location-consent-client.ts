// R16.7-P1-J: precise-location consent client. Talks to the four
// server endpoints introduced in /v1/location/consent/* and
// projects the responses into a stable shape the UI can render.
//
// This file is pure TypeScript (no React, no react-native) so
// vitest can import it without bundling the native runtime.
// The same shape is consumed by:
//   - components/precise-location-toggle.tsx (a switch in me.tsx)
//   - hooks/useLocationConsent.ts (when one is introduced)
//
// Auth goes through SessionAuthClient (the same shape ProfileClient /
// PrivacyClient use): /v1/location/consent/* rejects anonymous calls,
// and the paths below carry the /v1 prefix the server mux expects —
// the old baseUrl+raw-fetch wiring 404'd AND 401'd on device.

import type { TransportResponse } from "./auth-client";

export type LocationConsentKind = "PRECISE_GPS" | "FUZZY_REGION";

// 服务端 location.AllKinds。顺序无关，但两张表必须同集合：多一个会 400，
// 少一个会让用户看不见自己已经授过的那一项。
export const ALL_LOCATION_CONSENT_KINDS: ReadonlyArray<LocationConsentKind> = [
  "PRECISE_GPS",
  "FUZZY_REGION",
];

// 默认 kind。老客户端（包括本文件的历史调用方 PreciseLocationCard）不带
// kind 调这三个方法，服务端把「不带」解释成 PRECISE_GPS —— 客户端保持同一
// 个默认值，两边才不会对不上。**注意：未知 kind 绝不向上取整成精确**，
// 服务端会直接拒（INVALID_LOCATION_CONSENT_KIND），客户端也不做这种猜测。
export const DEFAULT_LOCATION_CONSENT_KIND: LocationConsentKind = "PRECISE_GPS";

export type LocationConsentStatus =
  | "NONE"
  | "GRANTED"
  | "REVOKED"
  | "EXPIRED";

export interface LocationConsent {
  kind: LocationConsentKind;
  status: LocationConsentStatus;
  grantedAt?: string;
  expiresAt?: string;
  remainingSeconds: number;
  lastUsedAt?: string;
  durationSeconds: number;
}

export interface LocationConsentHistoryRow extends LocationConsent {}

export interface LocationConsentRevokeResult {
  kind: LocationConsentKind;
  status: "REVOKED";
  wasActive: boolean;
}

// AllowedDurations mirrors the server's location.AllowedDurations
// (30 minutes, 8 hours). The mobile UI must only offer these
// choices; sending any other value to the server returns 400.
export const ALLOWED_DURATION_SECONDS: ReadonlyArray<number> = [
  30 * 60,
  8 * 60 * 60,
];

export class LocationConsentError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.name = "LocationConsentError";
  }
}

export interface LocationConsentClientOptions {
  authClient: { request(path: string, init: { method: "POST" | "GET"; body?: unknown }): Promise<TransportResponse> };
}

export class LocationConsentClient {
  private readonly authClient: { request(path: string, init: { method: "POST" | "GET"; body?: unknown }): Promise<TransportResponse> };

  constructor(opts: LocationConsentClientOptions) {
    this.authClient = opts.authClient;
  }

  // getStatus fetches the current consent for the authenticated
  // user. When the user has never granted consent, the server
  // returns status=NONE with empty timestamps.
  //
  // kind defaults to PRECISE_GPS so every pre-existing caller keeps
  // its old behaviour byte for byte; the two kinds are separate
  // consents (NĐ 356/2025 Art. 6.3 forbids bundling them), so the
  // caller must say which one it is asking about.
  async getStatus(
    kind: LocationConsentKind = DEFAULT_LOCATION_CONSENT_KIND,
  ): Promise<LocationConsent> {
    // GET carries the kind as a query parameter, not a body.
    const path = `/v1/location/consent?kind=${encodeURIComponent(kind)}`;
    return await this.request<LocationConsent>("GET", path);
  }

  // grant opts the user in. The durationSeconds must be one of
  // ALLOWED_DURATION_SECONDS; the server will reject other values
  // with INVALID_LOCATION_CONSENT_DURATION. A duration of 0 is
  // not allowed at the API surface (the server uses 0 to mean
  // "use the default" internally, but the mobile client must
  // pick explicitly).
  async grant(
    durationSeconds: number,
    kind: LocationConsentKind = DEFAULT_LOCATION_CONSENT_KIND,
  ): Promise<LocationConsent> {
    if (!ALLOWED_DURATION_SECONDS.includes(durationSeconds)) {
      throw new LocationConsentError(
        "INVALID_DURATION",
        `durationSeconds must be one of ${ALLOWED_DURATION_SECONDS.join(", ")}`,
        400,
      );
    }
    const path = "/v1/location/consent/grant";
    return await this.request<LocationConsent>("POST", path, {
      durationSeconds,
      kind,
    });
  }

  // revoke immediately flips the active grant to REVOKED. If no
  // grant is active, the response still succeeds with
  // wasActive=false — the operation is idempotent.
  //
  // Revoking one kind never touches the other: they are separate rows.
  async revoke(
    kind: LocationConsentKind = DEFAULT_LOCATION_CONSENT_KIND,
  ): Promise<LocationConsentRevokeResult> {
    return await this.request<LocationConsentRevokeResult>(
      "POST",
      "/v1/location/consent/revoke",
      { kind },
    );
  }

  // history returns the full audit trail for the user, newest
  // first. Used by the privacy center card.
  async history(): Promise<{ rows: LocationConsentHistoryRow[] }> {
    return await this.request<{ rows: LocationConsentHistoryRow[] }>("GET", "/v1/location/consent/history");
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res: TransportResponse = await this.authClient.request(path, {
      method,
      ...(body === undefined ? {} : { body }),
    });
    return parseResponse<T>(res);
  }
}

async function parseResponse<T>(res: TransportResponse): Promise<T> {
  const raw = await res.json().catch(() => null);
  if (res.status >= 400) {
    const code =
      (raw && typeof raw === "object" && (raw as any).errorCode) ||
      (raw && typeof raw === "object" && (raw as any).error) ||
      "unknown_error";
    throw new LocationConsentError(
      String(code),
      `HTTP ${res.status}`,
      res.status,
    );
  }
  return raw as T;
}

// resolveLocationConsentClient builds a LocationConsentClient
// from the authenticated SessionAuthClient. Never a raw fetch:
// the endpoints need a Bearer token AND the /v1 prefix.
// Mirrors resolvePrivacyRequestClient.
export function resolveLocationConsentClient(input: {
  authClient: { request(path: string, init: { method: "POST" | "GET"; body?: unknown }): Promise<TransportResponse> };
}): LocationConsentClient {
  return new LocationConsentClient({
    authClient: input.authClient,
  });
}

// isActiveConsent returns true when the consent object represents
// a usable grant right now. The server runs the expiry sweep
// before responding, so the client does not need to compare
// expiresAt to the wall clock; we still double-check here so a
// stale client doesn't show "GRANTED" when the row is actually
// about to flip.
//
// `now` is a millisecond timestamp (defaults to Date.now()) so the
// helper is testable with a fixed clock; otherwise a hardcoded
// test expiresAt can drift past Date.now() and flip a passing
// case to failing on the wall clock alone. summariseConsent()
// threads its own `now` argument through here so a single
// NOW constant covers the whole "GRANTED + remaining" path.
export function isActiveConsent(
  c: LocationConsent | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!c) return false;
  if (c.status !== "GRANTED") return false;
  if (!c.expiresAt) return false;
  const ms = Date.parse(c.expiresAt);
  if (Number.isNaN(ms)) return false;
  return ms > now;
}

// formatRemaining returns a human-readable string for the
// remaining seconds, e.g. "29 分钟" or "8 小时". The function
// intentionally rounds DOWN so the UI never overpromises.
export function formatRemaining(seconds: number, locale: "vi" | "zh" = "vi"): string {
  if (seconds <= 0) return locale === "vi" ? "đã hết hạn" : "已过期";
  if (seconds < 60) return locale === "vi" ? `còn ${seconds} giây` : `剩余 ${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return locale === "vi" ? `còn ${minutes} phút` : `剩余 ${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  return locale === "vi" ? `còn ${hours} giờ` : `剩余 ${hours} 小时`;
}
