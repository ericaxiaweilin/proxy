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
// The transport is the same shape used by auth-client /
// privacy-client: a function that takes a TransportRequest and
// returns a TransportResponse. The caller wires the auth-aware
// native transport (native-clients.ts) so the client never has
// to know about access tokens.

import type { Transport, TransportRequest, TransportResponse } from "./auth-client";

export type LocationConsentKind = "PRECISE_GPS";

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
  baseUrl: string;
  transport: Transport;
}

export class LocationConsentClient {
  private readonly baseUrl: string;
  private readonly transport: Transport;

  constructor(opts: LocationConsentClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.transport = opts.transport;
  }

  // getStatus fetches the current consent for the authenticated
  // user. When the user has never granted consent, the server
  // returns status=NONE with empty timestamps.
  async getStatus(): Promise<LocationConsent> {
    const path = `${this.baseUrl}/location/consent`;
    return await this.request<LocationConsent>("GET", path);
  }

  // grant opts the user in. The durationSeconds must be one of
  // ALLOWED_DURATION_SECONDS; the server will reject other values
  // with INVALID_LOCATION_CONSENT_DURATION. A duration of 0 is
  // not allowed at the API surface (the server uses 0 to mean
  // "use the default" internally, but the mobile client must
  // pick explicitly).
  async grant(durationSeconds: number): Promise<LocationConsent> {
    if (!ALLOWED_DURATION_SECONDS.includes(durationSeconds)) {
      throw new LocationConsentError(
        "INVALID_DURATION",
        `durationSeconds must be one of ${ALLOWED_DURATION_SECONDS.join(", ")}`,
        400,
      );
    }
    const path = `${this.baseUrl}/location/consent/grant`;
    return await this.request<LocationConsent>("POST", path, {
      durationSeconds,
    });
  }

  // revoke immediately flips the active grant to REVOKED. If no
  // grant is active, the response still succeeds with
  // wasActive=false — the operation is idempotent.
  async revoke(): Promise<LocationConsentRevokeResult> {
    const path = `${this.baseUrl}/location/consent/revoke`;
    return await this.request<LocationConsentRevokeResult>("POST", path);
  }

  // history returns the full audit trail for the user, newest
  // first. Used by the privacy center card.
  async history(): Promise<{ rows: LocationConsentHistoryRow[] }> {
    const path = `${this.baseUrl}/location/consent/history`;
    return await this.request<{ rows: LocationConsentHistoryRow[] }>("GET", path);
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const req: TransportRequest = body === undefined
      ? { method, url: path, headers }
      : { method, url: path, headers, body: JSON.stringify(body) };
    const res: TransportResponse = await this.transport(req);
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
// from the same inputs the rest of the app uses (auth-aware
// transport, baseUrl). Mirrors resolvePrivacyRequestClient.
export function resolveLocationConsentClient(input: {
  baseUrl: string;
  transport: Transport;
}): LocationConsentClient {
  return new LocationConsentClient({
    baseUrl: input.baseUrl,
    transport: input.transport,
  });
}

// isActiveConsent returns true when the consent object represents
// a usable grant right now. The server runs the expiry sweep
// before responding, so the client does not need to compare
// expiresAt to the wall clock; we still double-check here so a
// stale client doesn't show "GRANTED" when the row is actually
// about to flip.
export function isActiveConsent(c: LocationConsent | null | undefined): boolean {
  if (!c) return false;
  if (c.status !== "GRANTED") return false;
  if (!c.expiresAt) return false;
  const ms = Date.parse(c.expiresAt);
  if (Number.isNaN(ms)) return false;
  return ms > Date.now();
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
