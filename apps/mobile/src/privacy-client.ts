// R16.10-P1-F: privacy request center client (Vietnam PDP 91/2025/QH15
// Art. 31/32 + PRD v1.4 LC-15). The mobile side uses this client to:
//   * GET /v1/privacy/me   — assemble a fresh data export
//   * POST /v1/privacy/export  — submit a new export request
//   * POST /v1/privacy/delete  — submit a delete request (30-day grace)
//   * POST /v1/privacy/cancel  — withdraw a delete request
//   * GET  /v1/privacy/status?requestId=...  — poll a request's status
//   * GET  /v1/privacy/requests  — list the user's full history
//
// The client is intentionally decoupled from LoginClient /
// LocalNetClient because the privacy endpoints require the user's
// access token (not just a device credential), and the mobile app
// already has a Transport abstraction (see auth-client.ts) that knows
// how to inject the Authorization header.

import type { Transport, TransportRequest, TransportResponse } from "./auth-client";

export type PrivacyRequestKind = "export" | "delete";
export type PrivacyRequestStatus =
  | "received"
  | "in_progress"
  | "completed"
  | "rejected"
  | "cancelled";

export type PrivacyRequest = {
  id: string;
  userId: string;
  kind: PrivacyRequestKind;
  status: PrivacyRequestStatus;
  requestedAt: string;
  completedAt?: string | null;
  erasedAt?: string | null;
  exportSnapshotUrl?: string;
  exportSha256?: string;
  exportRetentionUntil?: string | null;
  legalBasis: string;
  rejectionReason?: string;
  version: number;
};

export type PrivacyDataExport = {
  account: { id: string; status: string };
  consents: Array<{
    docKind: string;
    docVersion: string;
    acceptedAt: string;
    required: boolean;
  }>;
  devices: Array<{ id: string; userAccountId: string; platform: string; status: string }>;
  sessions: Array<{ id: string; userAccountId: string; deviceId: string; status: string }>;
  privacyRequests: PrivacyRequest[];
  generatedAt: string;
  legalBasis: string;
  formatVersion: string;
};

export type PrivacyExportEnvelope = {
  data: PrivacyDataExport;
  formatVersion: string;
  legalBasis: string;
  generatedAt: string;
  history: PrivacyRequest[];
};

export type PrivacyExportRequestResponse = {
  request: PrivacyRequest;
  retentionDays: number;
};

export type PrivacyDeleteRequestResponse = {
  request: PrivacyRequest;
  gracePeriodDays: number;
  erasedAt: string;
  cancelableUntil: string;
};

export type PrivacyCancelRequestResponse = {
  request: PrivacyRequest;
};

export type PrivacyListResponse = {
  requests: PrivacyRequest[];
  count: number;
};

export type PrivacyStatusResponse = {
  request: PrivacyRequest;
};

export type PrivacyErrorCode =
  | "PRIVACY_REQUEST_FORBIDDEN"
  | "PRIVACY_REQUEST_UNAVAILABLE"
  | "PRIVACY_REQUEST_NOT_FOUND"
  | "PRIVACY_REQUEST_ACTIVE"
  | "PRIVACY_REQUEST_NOT_CANCELLABLE"
  | "PRIVACY_REQUEST_WRITE_FAILED"
  | "PRIVACY_REQUEST_READ_FAILED"
  | "PRIVACY_REQUEST_INVALID";

export class PrivacyError extends Error {
  readonly status: number;
  readonly code: PrivacyErrorCode | string;
  readonly correlationId?: string | undefined;
  constructor(status: number, code: PrivacyErrorCode | string, message: string, correlationId?: string) {
    super(message);
    this.name = "PrivacyError";
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

export type PrivacyClientOptions = {
  baseUrl: string;
  transport: Transport;
  // Optional override for tests; defaults to a 30-second timeout.
  timeoutMs?: number | undefined;
};

export class PrivacyClient {
  constructor(private readonly options: PrivacyClientOptions) {}

  private url(path: string): string {
    return this.options.baseUrl.replace(/\/$/, "") + path;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const request: TransportRequest = {
      url: this.url(path),
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    };
    let response: TransportResponse;
    try {
      response = await this.options.transport(request);
    } catch (err) {
      throw new PrivacyError(0, "PRIVACY_REQUEST_UNAVAILABLE", `network error: ${(err as Error).message}`);
    }
    const json = (await response.json()) as Record<string, any> | undefined;
    if (response.status < 200 || response.status >= 300) {
      const code = (json?.error as string | undefined) ?? "PRIVACY_REQUEST_INVALID";
      const correlationId = (json?.correlationId as string | undefined) ?? undefined;
      const message = (json?.reason as string | undefined) ?? `privacy ${method} ${path} failed`;
      throw new PrivacyError(response.status, code, message, correlationId);
    }
    return json as T;
  }

  async fetchMe(): Promise<PrivacyExportEnvelope> {
    return this.call<PrivacyExportEnvelope>("GET", "/v1/privacy/me");
  }

  async requestExport(input?: { legalBasis?: string }): Promise<PrivacyExportRequestResponse> {
    return this.call<PrivacyExportRequestResponse>("POST", "/v1/privacy/export", input ?? {});
  }

  async requestDelete(input?: { reason?: string; legalBasis?: string }): Promise<PrivacyDeleteRequestResponse> {
    return this.call<PrivacyDeleteRequestResponse>("POST", "/v1/privacy/delete", input ?? {});
  }

  async cancelRequest(input: { requestId: string; reason?: string }): Promise<PrivacyCancelRequestResponse> {
    if (!input.requestId) {
      throw new PrivacyError(400, "PRIVACY_REQUEST_INVALID", "requestId is required");
    }
    return this.call<PrivacyCancelRequestResponse>("POST", "/v1/privacy/cancel", input);
  }

  async fetchStatus(requestId: string): Promise<PrivacyStatusResponse> {
    if (!requestId) {
      throw new PrivacyError(400, "PRIVACY_REQUEST_INVALID", "requestId is required");
    }
    return this.call<PrivacyStatusResponse>("GET", `/v1/privacy/status?requestId=${encodeURIComponent(requestId)}`);
  }

  async listRequests(): Promise<PrivacyListResponse> {
    return this.call<PrivacyListResponse>("GET", "/v1/privacy/requests");
  }
}

// resolvePrivacyRequestClient builds a PrivacyClient from the same
// inputs the rest of the app uses. The mobile app keeps one
// PrivacyClient instance per session because the auth context is
// captured in the transport; if the user re-authenticates, the
// caller is expected to construct a new client.
export function resolvePrivacyRequestClient(input: {
  baseUrl: string;
  transport: Transport;
  timeoutMs?: number;
}): PrivacyClient {
  return new PrivacyClient({
    baseUrl: input.baseUrl,
    transport: input.transport,
    timeoutMs: input.timeoutMs
  });
}
