import { useEffect, useState } from "react";
import { opFetch, opPost } from "../lib/api";

// PROVIDER-APPLY-001：小美申请审核。审核中的排最前；通过 = 开 supply 服务者身份（ACTIVE）+ 声明能力（不是核验）；
// 拒绝必须写原因（申请人能看到）。实名只在这里出现。
type Application = {
  applicationId: string; userAccountId: string; displayName: string; realName?: string; genderAttested: boolean;
  city: string; serviceAreas: string[]; languages: string[]; capabilities: string[]; intro: string; photoAssetIds: string[];
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "WITHDRAWN"; rejectReason?: string; reviewedBy?: string; reviewedAt?: string;
  agentId?: string; source: "APP" | "BACKFILL"; createdAt: string;
};

const STATUS_LABEL: Record<Application["status"], string> = { SUBMITTED: "审核中", APPROVED: "已通过", REJECTED: "已拒绝", WITHDRAWN: "已撤回" };
const FILTERS: Array<{ id: string; label: string }> = [
  { id: "SUBMITTED", label: "审核中" }, { id: "", label: "全部" }, { id: "APPROVED", label: "已通过" }, { id: "REJECTED", label: "已拒绝" },
];

export function ProviderApplications() {
  const [filter, setFilter] = useState("SUBMITTED");
  const [apps, setApps] = useState<Application[] | null>(null);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [msg, setMsg] = useState<string | undefined>(undefined);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const load = () => opFetch<{ applications: Application[] }>(`/v1/operator/provider-applications?status=${filter}`)
    .then((body) => setApps(body.applications ?? [])).catch(() => {});
  useEffect(() => { setApps(null); void load(); }, [filter]);

  const review = async (app: Application, decision: "APPROVE" | "REJECT") => {
    const reason = (reasons[app.applicationId] ?? "").trim();
    if (decision === "REJECT" && !reason) { setMsg("拒绝要写原因 —— 申请人会看到，才知道改什么。"); return; }
    setBusy(app.applicationId);
    setMsg(undefined);
    try {
      await opPost("/v1/operator/provider-applications/review", { applicationId: app.applicationId, decision, reason });
      setMsg(`${app.displayName || app.userAccountId}：${decision === "APPROVE" ? "已通过，服务者身份已开" : "已拒绝"}`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? `操作失败（${e.message}）` : "操作失败");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <div className="section-title">
        <h2>小美申请</h2>
        <span>
          {FILTERS.map((f) => <button key={f.id || "all"} disabled={filter === f.id} onClick={() => setFilter(f.id)} style={{ marginLeft: 6 }}>{f.label}</button>)}
          {msg ? ` · ${msg}` : ""}
        </span>
      </div>
      {apps === null ? <div className="notice">加载申请…</div> : apps.length === 0 ? <div className="notice">没有{FILTERS.find((f) => f.id === filter)?.label}的申请</div> : apps.map((app) => (
        <div className="card" key={app.applicationId} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <b>{app.displayName || "（没有资料名）"}</b>{" "}
              <span style={{ color: "#8a8190" }}>{app.userAccountId} · {STATUS_LABEL[app.status]}{app.source === "BACKFILL" ? " · 存量补录" : ""}</span>
              <div style={{ marginTop: 4 }}>实名：{app.realName || "—（未填）"} · 自证女性：{app.genderAttested ? "是" : "未自证"} · 城市：{app.city || "—"}</div>
              <div>区域：{app.serviceAreas.join(" / ") || "—"} · 语言：{app.languages.join(" / ") || "—"} · 能力：{app.capabilities.join(" / ") || "—"}</div>
              <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{app.intro || "—"}</div>
              {app.status === "REJECTED" && app.rejectReason ? <div style={{ marginTop: 4, color: "#b3261e" }}>拒绝原因：{app.rejectReason}</div> : null}
              {app.reviewedAt ? <div style={{ marginTop: 4, color: "#8a8190" }}>审核：{app.reviewedBy} · {new Date(app.reviewedAt).toLocaleString()}{app.agentId ? ` · ${app.agentId}` : ""}</div> : null}
            </div>
            <div style={{ color: "#8a8190", whiteSpace: "nowrap" }}>{new Date(app.createdAt).toLocaleString()}</div>
          </div>
          {app.photoAssetIds.length > 0 ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {app.photoAssetIds.map((id) => <a href={`/v1/media/thumb/${encodeURIComponent(id)}`} key={id} rel="noreferrer" target="_blank">
              <img alt="申请照片" src={`/v1/media/thumb/${encodeURIComponent(id)}`} style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 10 }} />
            </a>)}
          </div> : null}
          {app.status === "SUBMITTED" ? <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button disabled={busy !== undefined} onClick={() => void review(app, "APPROVE")}>{busy === app.applicationId ? "处理中…" : "通过"}</button>
            <input onChange={(e) => setReasons((r) => ({ ...r, [app.applicationId]: e.target.value }))} placeholder="拒绝原因（申请人可见）" style={{ flex: 1 }} value={reasons[app.applicationId] ?? ""} />
            <button disabled={busy !== undefined} onClick={() => void review(app, "REJECT")}>拒绝</button>
          </div> : null}
        </div>
      ))}
    </>
  );
}
