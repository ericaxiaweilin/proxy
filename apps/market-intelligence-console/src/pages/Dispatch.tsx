import { useEffect, useState } from "react";
import { opFetch, opPost } from "../lib/api";

// DISPATCH-LOOP-001：派单调度工作台。
//
// 这一页回答运营每天最想知道的那件事：**哪张单卡住了、卡在哪一步、为什么**。
//   · 快速模式（FAST）的需求，平台按撮合排名一次只给一个人发邀约，5 分钟没接就顺延；
//   · 候选用完就进「待人工」——这里不扩半径、不替需求方改时间（2026-10-06 定的规则）；
//   · 每一条派单都有完整流水：发给了谁、谁因为超预算 / 被拒 / 同单另一档位在等她而跳过。
// 运营能做三件事：重派（之前没空的人现在可能有空了）、点名（电话确认过的人直接发，仍不超预算）、
// 停止（需求方改主意 / 人工接管）。三件都要 MARKETPLACE 权限、必填理由、落审计。

type Candidate = { agentId: string; price: number; currency?: string };
type Run = {
  id: string; kind?: "TASK" | "MARKET"; waiting?: boolean; taskId: string; slotId: string; requesterId: string; batchId: string; budgetVnd: number;
  status: "RUNNING" | "ASSIGNED" | "EXHAUSTED" | "CANCELLED"; candidates: Candidate[] | null; cursor: number;
  currentOfferId?: string; currentAgentId?: string; currentExpiresAt?: string; assignedAgentId?: string;
  createdAt: string; updatedAt: string; version: number;
  waitingSeconds?: number; tried: number; remaining: number;
};
type Step = { runId: string; kind: string; agentId?: string; offerId?: string; actor: string; detail?: Record<string, unknown>; at: string };
type Stats = { since: string; running: number; assigned: number; exhausted: number; cancelled: number; medianMinutesToAssign: number | null };
type ListPayload = { dataSource: string; runs?: Run[]; stats?: Stats; offerTtlSeconds?: number; notes?: string[] };

const STATUS: Record<Run["status"], { label: string; color: string }> = {
  RUNNING: { label: "在派", color: "#2f7de1" },
  EXHAUSTED: { label: "待人工", color: "#d9534f" },
  ASSIGNED: { label: "已派成", color: "#2e9d5b" },
  CANCELLED: { label: "已停止", color: "#8a8190" },
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "在派 + 待人工" },
  { key: "EXHAUSTED", label: "待人工" },
  { key: "RUNNING", label: "在派" },
  { key: "ASSIGNED", label: "已派成" },
  { key: "all", label: "全部" },
];

const vnd = (n: number): string => `${n.toLocaleString()} ₫`;
// 运营在越南：按浏览器本地时间显示（接口里存的是 UTC）。
const clock = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, "0")}`;

function stepText(s: Step): string {
  const d = s.detail ?? {};
  switch (s.kind) {
    case "STARTED": return d.kind === "MARKET"
      ? "快速发单：开始按撮合排名代选报名人"
      : `开始派单：${d.candidates ?? 0} 位候选，预算 ${vnd(Number(d.budgetVnd ?? 0))}`;
    case "WAITING_APPLICANTS": return "还没有人报名，等报名";
    case "NEW_APPLICANT": return `${s.agentId} 新报名，重新开始代选`;
    case "OWNER_TOOK_OVER": return "发单方自己选了人，平台停止代选";
    case "OFFER_SENT": return d.price ? `发邀约给 ${s.agentId}（${vnd(Number(d.price))}，5 分钟内有效）` : `代选 ${s.agentId}，等她 5 分钟内确认`;
    case "EXPIRED": return `${s.agentId} 5 分钟没接，顺延下一位`;
    case "OFFER_CANCELLED": return `给 ${s.agentId} 的邀约被撤回，顺延下一位`;
    case "ACCEPTED": return `${s.agentId} 接单了 ✓`;
    case "SKIPPED_OVER_BUDGET": return `跳过 ${s.agentId}：标价 ${vnd(Number(d.price ?? 0))} 超过预算 ${vnd(Number(d.budgetVnd ?? 0))}`;
    case "SKIPPED_NO_PRICE": return `跳过 ${s.agentId}：没有标价`;
    case "SKIPPED_SIBLING": return `跳过 ${s.agentId}：同一张需求的另一个档位正在等她 / 已经是她`;
    case "OFFER_REFUSED": return `跳过 ${s.agentId}：发邀约被规则拒绝（${String(d.code ?? "")}）`;
    case "SEND_FAILED": return `发给 ${s.agentId} 时系统出错，下一轮重试（${String(d.error ?? "")}）`;
    case "EXHAUSTED": return d.reason === "no_eligible_candidates"
      ? "批次里没有符合条件的人（同城、有空档、资格通过）→ 待人工"
      : "候选全部试过 → 待人工";
    case "OPERATOR_RETRY": return `运营 ${s.actor} 重派：${String(d.reason ?? "")}`;
    case "OPERATOR_ASSIGN": return `运营 ${s.actor} 点名 ${s.agentId}：${String(d.reason ?? "")}`;
    case "OPERATOR_CANCEL": return `运营 ${s.actor} 停止派单：${String(d.reason ?? "")}`;
    default: return s.kind;
  }
}

export function Dispatch() {
  const [filter, setFilter] = useState<string>("");
  const [data, setData] = useState<ListPayload | null>(null);
  const [openId, setOpenId] = useState<string>("");

  const load = (): void => {
    opFetch<ListPayload>(`/v1/operator/dispatch${filter ? `?status=${filter}` : ""}`).then(setData).catch(() => {});
  };
  useEffect(() => {
    load();
    // 派单每 10 秒推进一次，这一页跟着它走：「等了几分钟」不能停在打开页面那一刻。
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  if (!data) return <div className="notice">加载派单…</div>;
  if (data.dataSource !== "LIVE" && !data.runs) {
    return <>{(data.notes ?? ["自动派单没有接入"]).map((n) => <div className="notice" key={n}>{n}</div>)}</>;
  }
  const s = data.stats;
  const runs = data.runs ?? [];

  return (
    <>
      <div className="section-title">
        <h2>派单调度 · 快速模式的单现在卡在哪</h2>
        <span>GET /v1/operator/dispatch · 每 10 秒刷新</span>
      </div>
      {s ? (
        <div className="kpi-grid">
          <div className="kpi"><div className="label">在派</div><div className="value">{s.running}</div><div className="meta">正在等某一位回复</div></div>
          <div className="kpi"><div className="label">待人工</div><div className="value" style={s.exhausted ? { color: "#d9534f" } : undefined}>{s.exhausted}</div><div className="meta">候选用完 / 批次里没人</div></div>
          <div className="kpi"><div className="label">已派成</div><div className="value">{s.assigned}</div><div className="meta">近 7 天</div></div>
          <div className="kpi"><div className="label">中位成单时长</div><div className="value">{s.medianMinutesToAssign == null ? "—" : `${s.medianMinutesToAssign.toFixed(1)} 分`}</div><div className="meta">{s.medianMinutesToAssign == null ? "还没有派成的单" : "从发布到有人接"}</div></div>
          <div className="kpi"><div className="label">已停止</div><div className="value">{s.cancelled}</div><div className="meta">运营停止 / 需求方取消</div></div>
        </div>
      ) : null}

      <div className="engine-inline" style={{ display: "flex", gap: 6, margin: "10px 0" }}>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => { setFilter(f.key); setOpenId(""); }}
            style={filter === f.key ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>{f.label}</button>
        ))}
      </div>

      {runs.length === 0 ? (
        <div className="notice">
          这里现在是空的。只有需求方选了「快速」、勾了「预算内由平台替我发邀约」、并且填了每档位固定价（VND）预算的需求才会自动派单；
          其它需求仍由需求方自己从候选里挑人。
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>需求 / 档位</th><th>状态</th><th>现在</th><th className="numc">进度</th><th className="numc">预算</th><th>更新</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(openId === r.id ? "" : r.id)} style={{ cursor: "pointer", background: openId === r.id ? "rgba(47,125,225,0.08)" : undefined }}>
                  <td>{r.kind === "MARKET" ? "市场单 " : ""}{r.taskId}<div style={{ color: "#8a8190", fontSize: 11 }}>{r.kind === "MARKET" ? "快速发单 · 代选报名人" : r.slotId} · {r.id}</div></td>
                  <td><b style={{ color: STATUS[r.status].color }}>{STATUS[r.status].label}</b></td>
                  <td>
                    {r.status === "RUNNING" && r.currentAgentId
                      ? <>在等 {r.currentAgentId}{r.waitingSeconds != null ? <span style={{ color: "#8a8190" }}> · {mmss(r.waitingSeconds)} / 5:00</span> : null}</>
                      : r.status === "ASSIGNED" ? <>{r.assignedAgentId} 接了</>
                      : r.waiting ? <span style={{ color: "#8a8190" }}>等人报名</span> : <span style={{ color: "#8a8190" }}>—</span>}
                  </td>
                  <td className="numc">{r.tried} / {(r.candidates ?? []).length}</td>
                  <td className="numc">{r.kind === "MARKET" ? "发单价" : vnd(r.budgetVnd)}</td>
                  <td>{clock(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId ? <RunDetail id={openId} onChanged={load} /> : null}
    </>
  );
}

function RunDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<{ run: Run; steps: Step[] } | null>(null);
  const [reason, setReason] = useState("");
  const [pick, setPick] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const load = (): void => {
    opFetch<{ run: Run; steps: Step[] }>(`/v1/operator/dispatch/run?id=${encodeURIComponent(id)}`).then(setDetail).catch(() => {});
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!detail) return <div className="notice">加载这条派单…</div>;
  const { run, steps } = detail;
  const candidates = run.candidates ?? [];
  const chosen = candidates.find((c) => c.agentId === pick);

  async function act(action: "retry" | "cancel" | "assign"): Promise<void> {
    if (reason.trim() === "") { setResult("先写理由：会进运营动作审计，事后复盘全靠这句"); return; }
    setBusy(true); setResult("");
    try {
      await opPost("/v1/operator/dispatch/actions", {
        runId: run.id, action, reason: reason.trim(),
        ...(action === "assign" && chosen ? { agentId: chosen.agentId, price: chosen.price } : {}),
      });
      setResult("已生效并留痕。"); setReason(""); setPick("");
      load(); onChanged();
    } catch (e) {
      setResult(`没做成：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const canRetry = run.status === "EXHAUSTED" || run.status === "CANCELLED";
  const canCancel = run.status === "RUNNING" || run.status === "EXHAUSTED";
  const canAssign = run.status !== "ASSIGNED" && !run.currentOfferId;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="section-title" style={{ marginTop: 0 }}>
        <h2>{run.taskId} · {run.slotId}</h2>
        <span>{STATUS[run.status].label} · 需求方 {run.requesterId} · 预算 {vnd(run.budgetVnd)} · 批次 {run.batchId}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>流水</div>
          <div className="table-wrap">
            <table>
              <tbody>
                {steps.map((s, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap", color: "#8a8190" }}>{clock(s.at)}</td>
                    <td>{stepText(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>候选（撮合排名顺序）</div>
          {candidates.length === 0 ? <div className="notice">批次里一个人都没有：这座城市这个时段没有同城、有空档、资格通过的人。</div> : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {candidates.map((c, i) => {
                    const over = c.price > run.budgetVnd;
                    const tried = i < run.cursor;
                    return (
                      <tr key={c.agentId} style={tried ? { color: "#8a8190" } : undefined}>
                        <td style={{ width: 28 }}>{i + 1}</td>
                        <td>
                          {c.agentId}{c.agentId === run.currentAgentId ? " · 在等她" : ""}{tried && c.agentId !== run.currentAgentId ? " · 已试" : ""}
                          <div style={{ fontSize: 11, color: over ? "#d9534f" : "#8a8190" }}>{vnd(c.price)}{over ? " · 超预算，不会发" : ""}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontWeight: 700, margin: "12px 0 6px" }}>运营动作</div>
          <div className="engine-inline" style={{ display: "grid", gap: 8 }}>
            <textarea placeholder="理由（必填，会进运营动作审计）" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button disabled={busy || !canRetry} onClick={() => act("retry")} title="从排名第一位重新派（之前没空的人现在可能有空了）">重派</button>
              <button disabled={busy || !canCancel} onClick={() => act("cancel")} title="停止自动派单；已发出的那张邀约照常有效到过期">停止</button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={!canAssign}>
                <option value="">点名一位（只列不超预算的）…</option>
                {candidates.filter((c) => c.price > 0 && c.price <= run.budgetVnd).map((c) => (
                  <option key={c.agentId} value={c.agentId}>{c.agentId} · {vnd(c.price)}</option>
                ))}
              </select>
              <button disabled={busy || !canAssign || !chosen} onClick={() => act("assign")}>立刻发给她</button>
            </div>
            {!canAssign && run.currentOfferId ? <div style={{ color: "#8a8190", fontSize: 12 }}>还有一张邀约在等回复，等它被接或过期后才能点名。</div> : null}
            {result ? <div className="notice">{result}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
