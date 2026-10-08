import { useEffect, useState } from "react";
import { opFetch, opPost } from "../lib/api";

// OPS-MODERATION-001：举报处置。
//
// 这一页回答一件事：**有多少举报欠着、哪条先看、谁处理过**。时限是法定的（一般 24 小时，
// 涉未成年人 / 招嫖 / 人身安全 6 小时），超时的自然排在最上面。
//
// ⚠️ 这里写下的处置是**记录**，不是执行：「内容已删除」「账号已封禁」只是把决定留痕，
// 页面不会真的下架或封号（那由各自的域执行）。所以结论栏旁边始终写着这句话，
// 免得「已处置」被读成「已生效」。

type Item = {
  reportId: string; targetType: string; targetId: string; reason: string; note?: string; state: string;
  createdAt: string; dueAt: string; ageHours: number; overdue: boolean; overdueHours: number;
  dispositionCount: number; lastAction?: string;
};
type Queue = { items: Item[]; total: number; returned: number; openCount: number; overdueCount: number };
type Payload = { dataSource: string; reportQueue?: Queue; actions?: string[]; outcomes?: string[]; enforcement?: string; missing?: string };

const REASON: Record<string, string> = {
  MINOR_SAFETY: "涉未成年人", SOLICITATION: "招嫖揽客", UNSAFE: "人身安全", SPAM: "垃圾信息", HARASSMENT: "骚扰",
  FRAUD: "欺诈", IMPERSONATION: "冒充", IP_VIOLATION: "侵权", ORDER_DISPUTE: "订单纠纷", OTHER: "其他",
};
const STATE: Record<string, { label: string; color: string }> = {
  SUBMITTED: { label: "没人碰过", color: "#d9534f" }, TRIAGED: { label: "已接手", color: "#2f7de1" },
  ESCALATED: { label: "已升级", color: "#b8860b" }, ACTIONED: { label: "已处置", color: "#2e9d5b" },
  DISMISSED: { label: "不成立", color: "#8a8190" }, REOPENED: { label: "重新打开", color: "#d9534f" },
};
const ACTION: Record<string, string> = { TRIAGE: "接手", ESCALATE: "升级", ACTION_TAKEN: "已处置", DISMISS: "判定不成立", REOPEN: "重新打开" };
const OUTCOME: Record<string, string> = {
  CONTENT_REMOVED: "内容已移除", ACCOUNT_RESTRICTED: "账号受限", ACCOUNT_SUSPENDED: "账号封禁",
  REFERRED_TO_AUTHORITY: "移交有权机关", NO_ACTION: "无需处置",
};
const hours = (h: number): string => (h >= 48 ? `${(h / 24).toFixed(1)} 天` : `${h.toFixed(1)} 小时`);

export function Moderation() {
  const [includeClosed, setIncludeClosed] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [openId, setOpenId] = useState("");
  const load = (): void => {
    opFetch<Payload>(`/v1/operator/moderation${includeClosed ? "?includeClosed=1" : ""}`).then(setData).catch(() => {});
  };
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [includeClosed]);

  if (!data) return <div className="notice">加载举报队列…</div>;
  const q = data.reportQueue;
  if (data.dataSource !== "LIVE" || !q) return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;

  return (
    <>
      <div className="section-title"><h2>举报处置 · 欠着多少、哪条先看</h2><span>GET /v1/operator/moderation · 每 30 秒刷新</span></div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">待处理</div><div className="value">{q.openCount}</div><div className="meta">还没处理完的举报</div></div>
        <div className="kpi"><div className="label">已超时</div><div className="value" style={q.overdueCount ? { color: "#d9534f" } : undefined}>{q.overdueCount}</div><div className="meta">没在时限内处理完（6 / 24 小时）</div></div>
      </div>
      <div className="notice">处置只是<b>记录</b>：选「内容已移除 / 账号封禁」不会真的下架或封号，只留下决定。</div>
      <div className="engine-inline" style={{ display: "flex", gap: 6, margin: "10px 0" }}>
        <button onClick={() => setIncludeClosed(false)} style={!includeClosed ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>待处理</button>
        <button onClick={() => setIncludeClosed(true)} style={includeClosed ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>含已处理</button>
      </div>
      {q.items.length === 0 ? <div className="notice">队列是空的。</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>理由</th><th>对象</th><th>状态</th><th className="numc">已等</th><th>时限</th></tr></thead>
          <tbody>{q.items.map((it) => (
            <tr key={it.reportId} onClick={() => setOpenId(openId === it.reportId ? "" : it.reportId)} style={{ cursor: "pointer", background: openId === it.reportId ? "rgba(47,125,225,0.08)" : undefined }}>
              <td><b>{REASON[it.reason] ?? it.reason}</b><div style={{ color: "#8a8190", fontSize: 11 }}>{it.reportId}</div></td>
              <td>{it.targetType}<div style={{ color: "#8a8190", fontSize: 11 }}>{it.targetId}</div></td>
              <td><b style={{ color: (STATE[it.state] ?? { color: "#8a8190" }).color }}>{(STATE[it.state] ?? { label: it.state }).label}</b>{it.lastAction ? <div style={{ color: "#8a8190", fontSize: 11 }}>{ACTION[it.lastAction] ?? it.lastAction}</div> : null}</td>
              <td className="numc">{hours(it.ageHours)}</td>
              <td>{it.overdue ? <b style={{ color: "#d9534f" }}>超时 {hours(it.overdueHours)}</b> : <span style={{ color: "#8a8190" }}>未超时</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {q.total > q.returned ? <div className="notice">只显示了 {q.returned} / {q.total} 条。</div> : null}
      {openId ? <Detail item={q.items.find((i) => i.reportId === openId)} actions={data.actions ?? []} outcomes={data.outcomes ?? []} onDone={() => { setOpenId(""); load(); }} /> : null}
    </>
  );
}

function Detail({ item, actions, outcomes, onDone }: { item: Item | undefined; actions: string[]; outcomes: string[]; onDone: () => void }) {
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!item) return null;
  const needOutcome = action === "ACTION_TAKEN";
  const needNote = action === "DISMISS";
  const ready = action !== "" && (!needOutcome || outcome !== "") && (!needNote || note.trim() !== "") && !busy;
  const submit = async (): Promise<void> => {
    setBusy(true); setErr("");
    try {
      await opPost("/v1/operator/moderation/disposition", { reportId: item.reportId, action, ...(needOutcome ? { outcome } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      onDone();
    } catch { setErr("没记上：规则不允许这一步，或网络出错。刷新后再看队列。"); setBusy(false); }
  };
  return (
    <div className="panel" style={{ marginTop: 12, padding: 12 }}>
      <div><b>{REASON[item.reason] ?? item.reason}</b> · {item.targetType} {item.targetId}</div>
      {item.note ? <div style={{ margin: "8px 0", padding: 8, background: "rgba(0,0,0,0.04)", borderRadius: 6 }}>举报人写的：{item.note}</div> : <div style={{ margin: "8px 0", color: "#8a8190" }}>举报人没有写说明。</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
        {actions.map((a) => <button key={a} onClick={() => setAction(a)} style={action === a ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>{ACTION[a] ?? a}</button>)}
      </div>
      {needOutcome ? (
        <div style={{ margin: "8px 0" }}>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">处置了什么（必填）</option>
            {outcomes.map((o) => <option key={o} value={o}>{OUTCOME[o] ?? o}</option>)}
          </select>
          <span style={{ color: "#8a8190", marginLeft: 8 }}>只记录，不会真的执行。</span>
        </div>
      ) : null}
      {action !== "" ? <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={needNote ? "判定不成立的理由（必填）" : "备注（选填，不会发给举报人）"} rows={2} style={{ width: "100%" }} /> : null}
      {err ? <div style={{ color: "#d9534f", margin: "6px 0" }}>{err}</div> : null}
      <button disabled={!ready} onClick={submit} style={{ marginTop: 8 }}>{busy ? "提交中…" : "记录处置"}</button>
    </div>
  );
}
