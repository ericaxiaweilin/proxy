import { useEffect, useState } from "react";
import { opFetch, opPost } from "../lib/api";

// OPS-RESTRICT-001：账号限制。
//
// 这一页回答一件事：**哪些账号现在被限制着、限制到哪一档、是谁因为什么记上的**。
// 两档：受限（还能用大部分功能，手上订单能跑完）和封禁（只剩申诉 / 隐私请求 / 登出）。
//
// ⚠️ 封禁**不会**自动取消进行中的订单：表里把还剩几张单列出来，写着「需人工善后」，
// 免得「已封禁」被读成「事情都做完了」。解除是另一个明确动作，申诉成立不会自动解除。

type Item = {
  userId: string; level: string; reason: string; reportId?: string; actorId: string; since: string;
  inFlightOrders: number | null;
};
type Payload = { dataSource: string; restrictions?: Item[]; levels?: string[]; notes?: string[]; missing?: string };

const LEVEL: Record<string, { label: string; color: string }> = {
  RESTRICTED: { label: "受限", color: "#c9a227" }, SUSPENDED: { label: "封禁", color: "#d9534f" },
};
const dash = (v: string | undefined): string => (v && v.trim() !== "" ? v : "—");
const when = (v: string | undefined): string => (v ? new Date(v).toLocaleString() : "—");

export function Restrictions() {
  const [data, setData] = useState<Payload | null>(null);
  const [openId, setOpenId] = useState("");
  const [showSetForm, setShowSetForm] = useState(false);
  const load = (): void => {
    opFetch<Payload>("/v1/operator/restrictions").then(setData).catch(() => {});
  };
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!data) return <div className="notice">加载生效中的账号限制…</div>;
  const rows = data.restrictions;
  if (data.dataSource !== "LIVE" || !rows) return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;

  const suspendedCount = rows.filter((it) => it.level === "SUSPENDED").length;
  const levels = data.levels && data.levels.length ? data.levels : ["RESTRICTED", "SUSPENDED"];

  return (
    <>
      <div className="section-title"><h2>账号限制 · 谁现在被限制着、限制到哪一档</h2><span>GET /v1/operator/restrictions · 每 30 秒刷新</span></div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">生效中</div><div className="value">{rows.length}</div><div className="meta">当前带着限制的账号</div></div>
        <div className="kpi"><div className="label">其中封禁</div><div className="value" style={suspendedCount ? { color: "#d9534f" } : undefined}>{suspendedCount}</div><div className="meta">只剩申诉 / 隐私请求 / 登出</div></div>
      </div>
      {(data.notes ?? []).map((n) => <div key={n} className="notice">{n}</div>)}
      <div className="engine-inline" style={{ display: "flex", gap: 6, margin: "10px 0" }}>
        <button onClick={() => setShowSetForm(!showSetForm)} style={showSetForm ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>{showSetForm ? "收起设置表单" : "设置限制"}</button>
      </div>
      {showSetForm ? <SetForm levels={levels} onDone={() => { setShowSetForm(false); load(); }} /> : null}
      {rows.length === 0 ? <div className="notice">现在没有账号被限制。</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>账号</th><th>档位</th><th>理由</th><th>关联举报</th><th>操作人</th><th>开始时间</th><th className="numc">进行中订单</th></tr></thead>
          <tbody>{rows.map((it) => (
            <tr key={it.userId} onClick={() => setOpenId(openId === it.userId ? "" : it.userId)} style={{ cursor: "pointer", background: openId === it.userId ? "rgba(47,125,225,0.08)" : undefined }}>
              <td><b>{dash(it.userId)}</b></td>
              <td><b style={{ color: (LEVEL[it.level] ?? { color: "#8a8190" }).color }}>{(LEVEL[it.level] ?? { label: it.level }).label}</b></td>
              <td><div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{dash(it.reason)}</div></td>
              <td>{dash(it.reportId)}</td>
              <td>{dash(it.actorId)}</td>
              <td>{when(it.since)}</td>
              <td className="numc">
                {it.inFlightOrders == null ? "—" : it.level === "SUSPENDED" && it.inFlightOrders > 0
                  ? <b style={{ color: "#d9534f" }}>{it.inFlightOrders} 张需人工善后</b>
                  : <span>{it.inFlightOrders}</span>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {openId ? <Detail item={rows.find((i) => i.userId === openId)} onDone={() => { setOpenId(""); load(); }} /> : null}
    </>
  );
}

function Detail({ item, onDone }: { item: Item | undefined; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!item) return null;
  const ready = reason.trim() !== "" && !busy;
  const submit = async (): Promise<void> => {
    setBusy(true); setErr("");
    try {
      await opPost("/v1/operator/restrictions/lift", { userId: item.userId, reason: reason.trim() });
      onDone();
    } catch { setErr("没记上：规则不允许这一步，或网络出错。刷新后再看。"); setBusy(false); }
  };
  return (
    <div className="panel" style={{ marginTop: 12, padding: 12 }}>
      <div><b>{dash(item.userId)}</b> · {(LEVEL[item.level] ?? { label: item.level }).label}</div>
      <div style={{ color: "#8a8190", fontSize: 11, margin: "4px 0" }}>操作人 {dash(item.actorId)} · 开始 {when(item.since)} · 关联举报 {dash(item.reportId)}</div>
      <div style={{ margin: "8px 0", padding: 8, background: "rgba(0,0,0,0.04)", borderRadius: 6 }}>理由：{item.reason}</div>
      {item.inFlightOrders != null && item.inFlightOrders > 0
        ? <div style={{ color: item.level === "SUSPENDED" ? "#d9534f" : "#8a8190", fontSize: 11, marginBottom: 8 }}>手上还有 {item.inFlightOrders} 张进行中的订单{item.level === "SUSPENDED" ? "，需要人工善后" : ""}。</div>
        : null}
      <div style={{ margin: "10px 0 6px" }}><b>解除限制</b> <span style={{ color: "#8a8190", fontSize: 11 }}>解除要写理由，同样留痕</span></div>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="解除的理由（必填）" rows={2} style={{ width: "100%" }} />
      {err ? <div style={{ color: "#d9534f", margin: "6px 0" }}>{err}</div> : null}
      <button disabled={!ready} onClick={submit} style={{ marginTop: 8 }}>{busy ? "提交中…" : "解除"}</button>
    </div>
  );
}

function SetForm({ levels, onDone }: { levels: string[]; onDone: () => void }) {
  const [userId, setUserId] = useState("");
  const [level, setLevel] = useState("");
  const [reason, setReason] = useState("");
  const [reportId, setReportId] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = userId.trim() !== "" && level !== "" && reason.trim() !== "" && !busy;
  const submit = async (): Promise<void> => {
    setBusy(true); setErr("");
    try {
      await opPost("/v1/operator/restrictions", {
        userId: userId.trim(), level, reason: reason.trim(),
        ...(reportId.trim() ? { reportId: reportId.trim() } : {}),
      });
      onDone();
    } catch { setErr("没记上：规则不允许这一步，或网络出错。刷新后再看。"); setBusy(false); }
  };
  return (
    <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="账号 ID（必填）" style={{ flex: 1, minWidth: 180, padding: 8 }} />
        <select value={level} onChange={(e) => setLevel(e.target.value)} style={{ padding: 8 }}>
          <option value="">选择档位</option>
          {levels.map((l) => <option key={l} value={l}>{(LEVEL[l] ?? { label: l }).label}</option>)}
        </select>
      </div>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="限制的理由（必填）" rows={2} style={{ width: "100%", marginTop: 8 }} />
      <input value={reportId} onChange={(e) => setReportId(e.target.value)} placeholder="关联举报编号（选填）" style={{ width: "100%", padding: 8, marginTop: 8 }} />
      {err ? <div style={{ color: "#d9534f", margin: "6px 0" }}>{err}</div> : null}
      <div style={{ marginTop: 8 }}>
        <button disabled={!ready} onClick={submit}>{busy ? "提交中…" : "记录"}</button>
        <span style={{ color: "#8a8190", marginLeft: 8, fontSize: 11 }}>限制立即生效，所有操作留痕，理由必填</span>
      </div>
    </div>
  );
}
