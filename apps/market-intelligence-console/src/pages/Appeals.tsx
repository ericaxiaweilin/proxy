import { useEffect, useState } from "react";
import { opFetch, opPost } from "../lib/api";

// OPS-APPEALS-001：申诉复核。
//
// 这一页回答一件事：**有哪些申诉欠着复核、原举报是什么理由、申诉人自己怎么说**。
// 申诉没有法定时限口径，所以不编「超时」，只给已等了多久，最老的排在最上面。
//
// ⚠️ 复核写下的结论只是**记录**：标「申诉成立」只是推翻原处置的**决定**，不会真的
// 恢复账号、也不会撤销下架（那由各自的域执行）。所以结论旁边始终写着这句话，
// 免得「申诉成立」被读成「已恢复」。

type Item = {
  appealId: string; reportId: string; reportReason: string; targetType: string; targetId: string;
  appellantAccountId: string; reason: string; state: string; createdAt: string; ageHours: number;
  decisionCount: number; lastDecision?: string; lastDecisionAt?: string;
};
type Queue = { items: Item[]; total: number; returned: number; openCount: number; includeClosed: boolean };
type Payload = { dataSource: string; appealQueue?: Queue; decisions?: string[]; enforcement?: string; missing?: string };

const REASON: Record<string, string> = {
  MINOR_SAFETY: "涉未成年人", SOLICITATION: "招嫖揽客", UNSAFE: "人身安全", SPAM: "垃圾信息", HARASSMENT: "骚扰",
  FRAUD: "欺诈", IMPERSONATION: "冒充", IP_VIOLATION: "侵权", ORDER_DISPUTE: "订单纠纷", OTHER: "其他",
};
const STATE: Record<string, { label: string; color: string }> = {
  FILED: { label: "待复核", color: "#d9534f" }, UPHELD: { label: "申诉成立", color: "#2e9d5b" },
  REJECTED: { label: "已驳回", color: "#8a8190" },
};
const DECISION: Record<string, string> = { UPHELD: "申诉成立", REJECTED: "驳回" };
const hours = (h: number): string => (h >= 48 ? `${(h / 24).toFixed(1)} 天` : `${h.toFixed(1)} 小时`);
const dash = (v: string | undefined): string => (v && v.trim() !== "" ? v : "—");

export function Appeals() {
  const [includeClosed, setIncludeClosed] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [openId, setOpenId] = useState("");
  const load = (): void => {
    opFetch<Payload>(`/v1/operator/appeals${includeClosed ? "?includeClosed=1" : ""}`).then(setData).catch(() => {});
  };
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [includeClosed]);

  if (!data) return <div className="notice">加载申诉队列…</div>;
  const q = data.appealQueue;
  if (data.dataSource !== "LIVE" || !q) return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;

  return (
    <>
      <div className="section-title"><h2>申诉复核 · 欠着多少、原举报是什么</h2><span>GET /v1/operator/appeals · 每 30 秒刷新</span></div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">待复核</div><div className="value">{q.openCount}</div><div className="meta">还没给出结论的申诉</div></div>
      </div>
      <div className="notice">复核只是<b>记录</b>：标「申诉成立」不会真的恢复账号、也不会撤销下架，只留下这个决定。</div>
      <div className="engine-inline" style={{ display: "flex", gap: 6, margin: "10px 0" }}>
        <button onClick={() => setIncludeClosed(false)} style={!includeClosed ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>待复核</button>
        <button onClick={() => setIncludeClosed(true)} style={includeClosed ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>含已复核</button>
      </div>
      {q.items.length === 0 ? <div className="notice">队列是空的。</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>原举报理由</th><th>对象</th><th>申诉人</th><th>申诉理由</th><th>状态</th><th className="numc">已等</th></tr></thead>
          <tbody>{q.items.map((it) => {
            const filed = it.state === "FILED";
            return (
            <tr key={it.appealId} onClick={() => { if (filed) setOpenId(openId === it.appealId ? "" : it.appealId); }} style={filed ? { cursor: "pointer", background: openId === it.appealId ? "rgba(47,125,225,0.08)" : undefined } : undefined}>
              <td><b>{dash(REASON[it.reportReason] ?? it.reportReason)}</b><div style={{ color: "#8a8190", fontSize: 11 }}>{dash(it.reportId)}</div></td>
              <td>{dash(it.targetType)}<div style={{ color: "#8a8190", fontSize: 11 }}>{dash(it.targetId)}</div></td>
              <td>{dash(it.appellantAccountId)}</td>
              <td><div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{dash(it.reason)}</div></td>
              <td><b style={{ color: (STATE[it.state] ?? { color: "#8a8190" }).color }}>{(STATE[it.state] ?? { label: it.state }).label}</b>{it.decisionCount > 1 ? <div style={{ color: "#8a8190", fontSize: 11 }}>第 {it.decisionCount} 次复核</div> : null}</td>
              <td className="numc">{hours(it.ageHours)}</td>
            </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {q.total > q.returned ? <div className="notice">只显示了 {q.returned} / {q.total} 条。</div> : null}
      {openId ? <Detail item={q.items.find((i) => i.appealId === openId)} onDone={() => { setOpenId(""); load(); }} /> : null}
    </>
  );
}

function Detail({ item, onDone }: { item: Item | undefined; onDone: () => void }) {
  const [decision, setDecision] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!item) return null;
  const needNote = decision === "REJECTED";
  const ready = decision !== "" && (!needNote || note.trim() !== "") && !busy;
  const submit = async (): Promise<void> => {
    setBusy(true); setErr("");
    try {
      await opPost("/v1/operator/appeals/decision", { appealId: item.appealId, decision, note: note.trim() });
      onDone();
    } catch { setErr("没记上：规则不允许这一步，或网络出错。刷新后再看队列。"); setBusy(false); }
  };
  return (
    <div className="panel" style={{ marginTop: 12, padding: 12 }}>
      <div><b>{dash(REASON[item.reportReason] ?? item.reportReason)}</b> · {dash(item.targetType)} {dash(item.targetId)}</div>
      <div style={{ color: "#8a8190", fontSize: 11, margin: "4px 0" }}>申诉人 {dash(item.appellantAccountId)} · {item.appealId}</div>
      {item.reason ? <div style={{ margin: "8px 0", padding: 8, background: "rgba(0,0,0,0.04)", borderRadius: 6 }}>申诉人写的：{item.reason}</div> : <div style={{ margin: "8px 0", color: "#8a8190" }}>申诉人没有写理由。</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
        {["UPHELD", "REJECTED"].map((d) => <button key={d} onClick={() => setDecision(d)} style={decision === d ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>{DECISION[d] ?? d}</button>)}
      </div>
      {decision !== "" ? <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={needNote ? "驳回的理由（必填）" : "备注（选填，不会发给申诉人）"} rows={2} style={{ width: "100%" }} /> : null}
      {err ? <div style={{ color: "#d9534f", margin: "6px 0" }}>{err}</div> : null}
      <button disabled={!ready} onClick={submit} style={{ marginTop: 8 }}>{busy ? "提交中…" : "记录复核"}</button>
    </div>
  );
}