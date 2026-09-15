// R16.10-P1-F: pure helpers for the PrivacySettings surface. The
// helpers are split out of privacy-settings.tsx so they can be unit
// tested under vitest without bundling react-native. The .tsx file
// re-imports them; tests import them from this file directly.
import type { PrivacyRequest, PrivacyRequestStatus } from "../privacy-client";

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("vi-VN", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function statusLabel(status: PrivacyRequestStatus): string {
  switch (status) {
    case "received":
      return "已收到";
    case "in_progress":
      return "处理中";
    case "completed":
      return "已完成";
    case "rejected":
      return "已拒绝";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

export function kindLabel(kind: PrivacyRequest["kind"]): string {
  switch (kind) {
    case "export":
      return "数据导出";
    case "delete":
      return "账号删除";
    default:
      return kind;
  }
}

// activeRequestOf returns the in-flight request of the given kind
// (status = received or in_progress). The component uses this to
// decide whether to show the "撤回" button vs the "提交" button.
export function activeRequestOf(history: PrivacyRequest[], kind: PrivacyRequest["kind"]): PrivacyRequest | undefined {
  return history.find((r) => r.kind === kind && (r.status === "received" || r.status === "in_progress"));
}

// exportCopyFileName builds the on-disk name for a saved data copy:
// proxy-data-export-20260915-135801.json. Local time, filename-safe
// (no colons, no spaces) so it survives the iOS share sheet and
// "存到文件" without renaming.
export function exportCopyFileName(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `proxy-data-export-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
}

// truncateId shortens long technical ids for list rows. The full id stays
// in the saved JSON copy — the row only needs enough to tell entries apart.
export function truncateId(id: string): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

// sessionStatusLabel maps session/device lifecycle states to user words.
// Unknown states render as-is (never blank): a state the client does not
// know is still a fact about the account.
export function sessionStatusLabel(status: string): string {
  if (status === "ACTIVE") return "在线";
  if (status === "REVOKED") return "已踢出";
  if (status === "EXPIRED") return "已过期";
  if (!status) return "未知";
  return status;
}
