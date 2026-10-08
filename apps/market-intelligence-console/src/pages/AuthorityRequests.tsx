import { useEffect, useState } from "react";
import { opFetch, opPost } from "../lib/api";

// OPS-AUTHORITY-001：有权机关请求。
//
// 这一页回答一件事：**哪些请求还欠着答复、离受理时限还剩几小时**。时限由请求种类定
// （紧急更短），所以队列里剩余小时数最小（含负数 = 已超时）的那条就是该先办的那条。
//
// ⚠️ 两处都只是**记录**：受理时勾的四项核验（主体 / 权限 / 范围 / 合法性）是「人已经核过」
// 的确认，页面不替运营核，少勾一项服务端就不收；写下「已提供 / 已拒绝」也只留痕，
// 不会真的调取用户数据或下架内容（那由各自的域执行）。

type Item = {
  requestId: string; requestRef: string; authority: string; requestKind: string; verifiedAll: boolean;
  receivedAt: string; deadlineAt: string; state: string; hoursLeft: number | null; overdue: boolean;
  responseCount: number; lastOutcome?: string; lastRespondedAt?: string; note?: string;
};
type Queue = { items: Item[]; total: number; returned: number; openCount: number; overdueCount: number; includeClosed: boolean };
type Payload = { dataSource: string; authorityQueue?: Queue; kinds?: string[]; outcomes?: string[]; missing?: string };

const KIND: Record<string, string> = {
  USER_INFO: "调取用户信息", USER_INFO_EMERGENCY: "调取用户信息（紧急）",
  CONTENT_REMOVAL: "下架内容", CONTENT_REMOVAL_EMERGENCY: "下架内容（紧急）",
};
const OUTCOME: Record<string, string> = {
  FULFILLED: "已提供", PARTIALLY_FULFILLED: "部分提供", REFUSED: "已拒绝", NO_DATA_FOUND: "无数据",
};
const STATE: Record<string, { label: string; color: string }> = {
  OPEN: { label: "待响应", color: "#d9534f" }, RESPONDED: { label: "已响应", color: "#2e9d5b" },
};
const CHECKS: Array<[string, string]> = [
  ["verifiedSubject", "主体"], ["verifiedAuthority", "权限"], ["verifiedScope", "范围"], ["verifiedLegality", "合法性"],
];
const hrs = (h: number): string => `${Math.abs(h).toFixed(1)} 小时`;
const dash = (v: string | undefined): string => (v && v.trim() !== "" ? v : "—");
const when = (v: string | undefined): string => (v ? new Date(v).toLocaleString() : "—");

export function AuthorityRequests() {
  const [includeClosed, setIncludeClosed] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [openId, setOpenId] = useState("");
  const [showIntake, setShowIntake] = useState(false);
  const load = (): void => {
    opFetch<Payload>(`/v1/operator/authority-requests${includeClosed ? "?includeClosed=1" : ""}`).then(setData).catch(() => {});
  };
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [includeClosed]);

  if (!data) return <div className="notice">加载有权机关请求队列…</div>;
  const q = data.authorityQueue;
  if (data.dataSource !== "LIVE" || !q) return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;

  return (
    <>
      <div className="section-title"><h2>有权机关请求 · 还欠谁一个答复</h2><span>GET /v1/operator/authority-requests · 每 30 秒刷新</span></div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">待响应</div><div className="value">{q.openCount}</div><div className="meta">还没给出答复的请求</div></div>
        <div className="kpi"><div className="label">已超时</div><div className="value" style={q.overdueCount ? { color: "#d9534f" } : undefined}>{q.overdueCount}</div><div className="meta">没在受理时限内答复</div></div>
      </div>
      <div className="notice">受理时限由请求种类决定（紧急更短），四项核验缺一不收。响应只是<b>记录</b>：选「已提供 / 已拒绝」不会真的调取数据或下架内容。</div>
      <div className="engine-inline" style={{ display: "flex", gap: 6, margin: "10px 0" }}>
        <button onClick={() => setIncludeClosed(false)} style={!includeClosed ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>待响应</button>
        <button onClick={() => setIncludeClosed(true)} style={includeClosed ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>含已响应</button>
      </div>
      <div className="engine-inline" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button onClick={() => setShowIntake(!showIntake)} style={showIntake ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>{showIntake ? "收起受理表单" : "受理新请求"}</button>
      </div>
      {showIntake ? <Intake kinds={data.kinds ?? []} onDone={() => { setShowIntake(false); load(); }} /> : null}
      {q.items.length === 0 ? <div className="notice">队列是空的。</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>编号</th><th>机关</th><th>种类</th><th>截止</th><th className="numc">剩余</th><th>状态</th></tr></thead>
          <tbody>{q.items.map((it) => {
            const isOpen = it.state === "OPEN";
            return (
            <tr key={it.requestId} onClick={() => { if (isOpen) setOpenId(openId === it.requestId ? "" : it.requestId); }} style={isOpen ? { cursor: "pointer", background: openId === it.requestId ? "rgba(47,125,225,0.08)" : undefined } : undefined}>
              <td><b>{dash(it.requestRef)}</b><div style={{ color: "#8a8190", fontSize: 11 }}>{dash(it.requestId)}</div></td>
              <td>{dash(it.authority)}</td>
              <td>{dash(KIND[it.requestKind] ?? it.requestKind)}</td>
              <td>{when(it.deadlineAt)}</td>
              <td className="numc">{!isOpen || it.hoursLeft == null ? "—" : it.hoursLeft < 0 ? <b style={{ color: "#d9534f" }}>已超时 {hrs(it.hoursLeft)}</b> : <span>{hrs(it.hoursLeft)}</span>}</td>
              <td>
                <b style={{ color: (STATE[it.state] ?? { color: "#8a8190" }).color }}>{(STATE[it.state] ?? { label: it.state }).label}</b>
                {it.lastOutcome ? <div style={{ color: "#8a8190", fontSize: 11 }}>{OUTCOME[it.lastOutcome] ?? it.lastOutcome}</div> : null}
                {!isOpen && it.overdue ? <div style={{ color: "#d9534f", fontSize: 11 }}>晚于截止</div> : null}
              </td>
            </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {q.total > q.returned ? <div className="notice">只显示了 {q.returned} / {q.total} 条。</div> : null}
      {openId ? <Detail item={q.items.find((i) => i.requestId === openId)} outcomes={data.outcomes ?? []} onDone={() => { setOpenId(""); load(); }} /> : null}
    </>
  );
}

function Detail({ item, outcomes, onDone }: { item: Item | undefined; outcomes: string[]; onDone: () => void }) {
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!item) return null;
  const ready = outcome !== "" && !busy;
  const submit = async (): Promise<void> => {
    setBusy(true); setErr("");
    try {
      await opPost("/v1/operator/authority-requests/response", { requestId: item.requestId, outcome, ...(note.trim() ? { note: note.trim() } : {}) });
      onDone();
    } catch { setErr("没记上：规则不允许这一步，或网络出错。刷新后再看队列。"); setBusy(false); }
  };
  return (
    <div className="panel" style={{ marginTop: 12, padding: 12 }}>
      <div><b>{dash(KIND[item.requestKind] ?? item.requestKind)}</b> · {dash(item.authority)}</div>
      <div style={{ color: "#8a8190", fontSize: 11, margin: "4px 0" }}>编号 {dash(item.requestRef)} · 收到 {when(item.receivedAt)} · 截止 {when(item.deadlineAt)}</div>
      {item.note ? <div style={{ margin: "8px 0", padding: 8, background: "rgba(0,0,0,0.04)", borderRadius: 6 }}>受理时写的：{item.note}</div> : <div style={{ margin: "8px 0", color: "#8a8190" }}>受理时没有写备注。</div>}
      {item.responseCount > 0 ? <div style={{ color: "#8a8190", fontSize: 11 }}>已记录 {item.responseCount} 次响应{item.lastRespondedAt ? ` · 上次 ${when(item.lastRespondedAt)}` : ""}</div> : null}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
        {outcomes.map((o) => <button key={o} onClick={() => setOutcome(o)} style={outcome === o ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>{OUTCOME[o] ?? o}</button>)}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（选填，不会发给机关）" rows={2} style={{ width: "100%" }} />
      {err ? <div style={{ color: "#d9534f", margin: "6px 0" }}>{err}</div> : null}
      <button disabled={!ready} onClick={submit} style={{ marginTop: 8 }}>{busy ? "提交中…" : "记录响应"}</button>
    </div>
  );
}

function Intake({ kinds, onDone }: { kinds: string[]; onDone: () => void }) {
  const [requestRef, setRequestRef] = useState("");
  const [authority, setAuthority] = useState("");
  const [requestKind, setRequestKind] = useState(kinds[0] ?? "");
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const allChecked = CHECKS.every(([key]) => verified[key] === true);
  const ready = allChecked && requestRef.trim() !== "" && authority.trim() !== "" && !busy;
  const submit = async (): Promise<void> => {
    setBusy(true); setErr("");
    try {
      await opPost("/v1/operator/authority-requests", {
        requestRef: requestRef.trim(), authority: authority.trim(), requestKind,
        verifiedSubject: true, verifiedAuthority: true, verifiedScope: true, verifiedLegality: true,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDone();
    } catch { setErr("没收：请求没被受理，或网络出错。刷新后再看队列。"); setBusy(false); }
  };
  return (
    <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={requestRef} onChange={(e) => setRequestRef(e.target.value)} placeholder="请求编号（必填）" style={{ flex: 1, minWidth: 180, padding: 8 }} />
        <input value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder="机关名称（必填）" style={{ flex: 1, minWidth: 180, padding: 8 }} />
        <select value={requestKind} onChange={(e) => setRequestKind(e.target.value)} style={{ padding: 8 }}>
          {kinds.map((k) => <option key={k} value={k}>{KIND[k] ?? k}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "10px 0" }}>
        {CHECKS.map(([key, label]) => (
          <label key={key} style={{ fontSize: 11, display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={verified[key] === true} onChange={(e) => setVerified({ ...verified, [key]: e.target.checked })} />
            {label}已核验
          </label>
        ))}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（选填，如文书号、承办人）" rows={2} style={{ width: "100%" }} />
      {err ? <div style={{ color: "#d9534f", margin: "6px 0" }}>{err}</div> : null}
      <div style={{ marginTop: 8 }}>
        <button disabled={!ready} onClick={submit}>{busy ? "提交中…" : "受理"}</button>
        {!allChecked ? <span style={{ color: "#8a8190", marginLeft: 8, fontSize: 11 }}>四项核验都勾上才收</span> : null}
      </div>
    </div>
  );
}
