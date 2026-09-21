// R16.7-P1-G: legal status client. The mobile app reads
// /v1/legal/status at boot to learn which compliance
// categories the operator has disabled (GLOBAL, AI_MEDIA,
// MARKETPLACE, LOCATION_CONSENT, PAYMENTS). The server
// returns a map keyed by category; a present key means
// "this category is currently killed by the operator."
//
// Why a separate file: the kill-switch is public (no auth),
// unlike the privacy / location consent clients which need
// an access token. The transport is the same shape used by
// the rest of the app so a future server-side change can
// swap the transport without touching this file.
import type { Transport, TransportRequest, TransportResponse } from "./auth-client";

export type LegalStatusCategory =
  | "GLOBAL"
  | "AI_MEDIA"
  | "MARKETPLACE"
  | "LOCATION_CONSENT"
  | "PAYMENTS";

export interface KilledSwitch {
  category: LegalStatusCategory;
  reason: string;
  setBy: string;
  setAt: string;
  expiresAt?: string;
}

export interface LegalStatus {
  // Map of category -> KilledSwitch. Only currently-active
  // (KILLED + not expired) switches are present; a missing
  // key means the category is enabled.
  killed: Record<string, KilledSwitch>;
  // Server clock at the time the response was generated.
  // Used to render "as of HH:MM" in the banner so the user
  // knows how fresh the data is.
  checkedAt: string;
}

export class LegalStatusError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.httpStatus = httpStatus;
    this.name = "LegalStatusError";
  }
}

export interface LegalStatusClientOptions {
  baseUrl: string;
  transport: Transport;
}

export class LegalStatusClient {
  private readonly baseUrl: string;
  private readonly transport: Transport;

  constructor(opts: LegalStatusClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.transport = opts.transport;
  }

  // getStatus fetches the current legal status. The endpoint
  // is public (no auth) so the call is the same on every
  // cold boot, including before the user has logged in.
  async getStatus(): Promise<LegalStatus> {
    const req: TransportRequest = {
      method: "GET",
      url: `${this.baseUrl}/legal/status`,
      headers: { Accept: "application/json" },
    };
    const res: TransportResponse = await this.transport(req);
    const raw = await res.json().catch(() => null);
    if (res.status >= 400) {
      throw new LegalStatusError(`HTTP ${res.status}`, res.status);
    }
    return normalizeStatus(raw);
  }
}

function normalizeStatus(raw: any): LegalStatus {
  if (!raw || typeof raw !== "object") {
    return { killed: {}, checkedAt: new Date().toISOString() };
  }
  const killed: Record<string, KilledSwitch> = {};
  const rawKilled = raw.killed;
  if (rawKilled && typeof rawKilled === "object") {
    for (const [k, v] of Object.entries(rawKilled as Record<string, any>)) {
      if (v && typeof v === "object" && typeof v.category === "string") {
        killed[v.category] = {
          category: v.category as LegalStatusCategory,
          reason: String(v.reason ?? ""),
          setBy: String(v.setBy ?? ""),
          setAt: String(v.setAt ?? ""),
          ...(typeof v.expiresAt === "string" ? { expiresAt: v.expiresAt } : {}),
        };
      }
    }
  }
  return {
    killed,
    checkedAt: typeof raw.checkedAt === "string" ? raw.checkedAt : new Date().toISOString(),
  };
}

// resolveLegalStatusClient is a small constructor helper so
// the call sites match the rest of the app
// (resolvePrivacyRequestClient / resolveLocationConsentClient).
export function resolveLegalStatusClient(input: {
  baseUrl: string;
  transport: Transport;
}): LegalStatusClient {
  return new LegalStatusClient({
    baseUrl: input.baseUrl,
    transport: input.transport,
  });
}

// isCategoryKilled reports whether a specific category is
// currently in the killed map. Its only production caller is
// LegalStatusBanner. (This comment used to say "the mobile
// subpages use this to decide whether to render a 'service
// paused' card" -- no subpage does, and no such card exists
// anywhere in apps/mobile/src.)
export function isCategoryKilled(
  status: LegalStatus | null | undefined,
  category: LegalStatusCategory,
): boolean {
  if (!status) return false;
  return Boolean(status.killed[category]);
}
