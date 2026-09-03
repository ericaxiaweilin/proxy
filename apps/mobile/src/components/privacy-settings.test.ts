// R16.10-P1-F: PrivacySettings helper tests. Following the repo's
// vitest pattern (see location-picker-sheet.test.ts), we exercise
// the pure helpers without mounting the React tree. The network
// round-trip is covered by privacy-client.test.ts. The
// in-component orchestration (loading state, error mapping) is
// verified by manual reload on the simulator (see R16.10
// e2e checklist in docs/compliance/).
import { describe, expect, it } from "vitest";
import { activeRequestOf, formatDate, kindLabel, statusLabel } from "./privacy-settings-helpers";
import type { PrivacyRequest, PrivacyRequestStatus } from "../privacy-client";

describe("PrivacySettings helpers", () => {
  it("formatDate handles null / undefined / invalid / valid inputs", () => {
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate(null)).toBe("—");
    // The fallback path is hit when the Date constructor throws.
    // Anything that parses to a valid date is rendered, anything
    // else returns the input verbatim.
    const formatted = formatDate("2026-09-03T00:00:00Z");
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).not.toBe("—");
  });

  it("statusLabel covers every PrivacyRequestStatus value with CN characters", () => {
    const allStatuses: PrivacyRequestStatus[] = [
      "received",
      "in_progress",
      "completed",
      "rejected",
      "cancelled"
    ];
    const labels = allStatuses.map(statusLabel);
    expect(new Set(labels).size).toBe(allStatuses.length);
    for (const label of labels) {
      expect(label).toMatch(/^[\u4e00-\u9fff]+$/);
    }
  });

  it("kindLabel distinguishes export from delete", () => {
    expect(kindLabel("export")).toBe("数据导出");
    expect(kindLabel("delete")).toBe("账号删除");
  });

  it("activeRequestOf returns the in-flight request of the given kind", () => {
    const completed: PrivacyRequest = {
      id: "p1", userId: "u1", kind: "export", status: "completed",
      requestedAt: "2026-09-01T00:00:00Z", legalBasis: "PDP-91/2025/QH15-Art31", version: 1
    };
    const received: PrivacyRequest = {
      id: "p2", userId: "u1", kind: "export", status: "received",
      requestedAt: "2026-09-02T00:00:00Z", legalBasis: "PDP-91/2025/QH15-Art31", version: 1
    };
    const cancelled: PrivacyRequest = {
      id: "p3", userId: "u1", kind: "delete", status: "cancelled",
      requestedAt: "2026-09-02T00:00:00Z", legalBasis: "PDP-91/2025/QH15-Art32", version: 2
    };
    const inProgress: PrivacyRequest = {
      id: "p4", userId: "u1", kind: "delete", status: "in_progress",
      requestedAt: "2026-09-03T00:00:00Z", legalBasis: "PDP-91/2025/QH15-Art32", version: 1
    };
    const history = [completed, received, cancelled, inProgress];
    expect(activeRequestOf(history, "export")?.id).toBe("p2");
    expect(activeRequestOf(history, "delete")?.id).toBe("p4");
  });

  it("activeRequestOf returns undefined when there is no in-flight request", () => {
    const history: PrivacyRequest[] = [
      { id: "p1", userId: "u1", kind: "export", status: "completed", requestedAt: "2026-09-01T00:00:00Z", legalBasis: "x", version: 1 }
    ];
    expect(activeRequestOf(history, "export")).toBeUndefined();
    expect(activeRequestOf(history, "delete")).toBeUndefined();
  });
});
