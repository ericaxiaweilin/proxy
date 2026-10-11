import { opFetch, opPost } from "../lib/api";
import { useEffect, useState } from "react";

// OPS-CONSOLE-PAGES-001（2026-10-07）：这一页原来**打不开**（读不存在的 data.engine.*）。
// 下半部分接 spec §11 的 Decision Eligibility 状态机（decision.user_event_states，引力 worker 写）。
//
// DECISION-ENGINE-001（2026-10-11）：上半部分是干预决策引擎的调用面 —— 调用量 / 延迟 /
// 放行与拦截分布全部来自 decision.evaluations（每次判断一行）。没接留痕时 runtime 为 null，
// 显示「—」而不是 0。「试算」走 POST /v1/operator/decisions/evaluate：只判断、不发任何东西，
// 但会记一行（caller=operator_console）。
type StateRow = {
  state: string;
  people: number;
  avg_confidence: number;
  avg_evidence_coverage: number;
  avg_sample_events: number;
};
type EventRow = { event_type: string; people: number };
type ReasonCount = { step: string; reason: string; count: number };
type CallerCount = { caller: string; action: string; calls: number; allowed: number };
type Runtime = {
  windowDays: number;
  calls: number;
  calls24h: number;
  allowed: number;
  p50Micros: number | null;
  p95Micros: number | null;
  lastCallAt: string | null;
  blocks: ReasonCount[];
  byCaller: CallerCount[];
  byState: ReasonCount[];
  policyVersion: string;
};
type Payload = {
  dataSource?: string;
  missing?: string;
  runtime?: Runtime | null;
  states?: StateRow[];
  eventTypes?: EventRow[];
  totals?: {
    people: number;
    activeOrchestrate: number;
    modelVersions: string[];
    lastComputedAt: string | null;
  };
  notes?: string[];
};
type Step = { name: string; verdict: string; reason: string; detail?: string };
type Decision = { id: string; allowed: boolean; state: string; blockedStep?: string; reason?: string; steps: Step[]; latencyMicros: number; policyVersion: string };

const num = (x: number | null | undefined): string => (typeof x === "number" ? x.toLocaleString() : "—");
const ms = (us: number | null | undefined): string => (typeof us === "number" ? `${(us / 1000).toFixed(us < 10000 ? 2 : 0)} ms` : "—");
const stepLabel: Record<string, string> = {
  SAFETY: "安全 / 账号", EXPLICIT_NEGATIVE: "用户明确拒绝", INTERVENTION_BUDGET: "干预预算 §13",
  EVIDENCE_GATE: "证据门 §9", HUMAN_VALUE: "获得感 / 愤怒感 §12",
};
const verdictCls: Record<string, string> = { PASS: "badge good", BLOCK: "badge bad", SKIP: "badge" };

function Lab() {
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("NUDGE");
  const [eventType, setEventType] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Decision | null>(null);
  const [err, setErr] = useState("");
  const run = async (): Promise<void> => {
    if (!userId.trim() || busy) return;
    setBusy(true); setErr(""); setRes(null);
    try {
      setRes(await opPost<Decision>("/v1/operator/decisions/evaluate", { userId: userId.trim(), action, eventType }));
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h3>试算</h3>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="用户 id，如 user_…" style={{ flex: "1 1 220px", padding: 6 }} />
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="NUDGE">NUDGE 主动提醒</option>
          <option value="FEED_CARD">FEED_CARD 自然靠前</option>
        </select>
        <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
          <option value="">生命周期（不基于预测）</option>
          <option value="CHAT_ACTIVE">CHAT_ACTIVE</option>
          <option value="BROWSE_ACTIVE">BROWSE_ACTIVE</option>
          <option value="SCENE_VISIT">SCENE_VISIT</option>
        </select>
        <button type="submit" disabled={busy || !userId.trim()}>{busy ? "判断中…" : "判断"}</button>
      </form>
      {err ? <div className="notice" role="alert" style={{ marginTop: 8 }}>{err}</div> : null}
      {res ? (
        <div style={{ marginTop: 10 }}>
          <div className="engine-inline">
            结论 <b>{res.allowed ? "放行" : "不做"}</b> · 状态 {res.state}
            {res.blockedStep ? ` · 卡在 ${stepLabel[res.blockedStep] ?? res.blockedStep}（${res.reason}）` : ""} · {ms(res.latencyMicros)} · {res.policyVersion}
          </div>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>步骤</th><th>结论</th><th>原因码</th><th>依据</th></tr></thead>
              <tbody>
                {res.steps.map((s) => (
                  <tr key={s.name}>
                    <td>{stepLabel[s.name] ?? s.name}</td>
                    <td><span className={verdictCls[s.verdict] ?? "badge"}>{s.verdict}</span></td>
                    <td>{s.reason}</td>
                    <td>{s.detail ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RuntimeBlock({ rt }: { rt: Runtime | null | undefined }) {
  const r = rt ?? null;
  const blocked = r ? r.calls - r.allowed : null;
  return (
    <>
      <div className="section-title">
        <h2>引擎调用 · 近 {r?.windowDays ?? 30} 天</h2>
        <span>decision.evaluations · {r?.policyVersion ?? "—"}</span>
      </div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">调用</div><div className="value">{num(r?.calls)}</div><div className="meta">近 24h {num(r?.calls24h)}</div></div>
        <div className="kpi"><div className="label">放行</div><div className="value">{num(r?.allowed)}</div><div className="meta">不做 {num(blocked)}</div></div>
        <div className="kpi"><div className="label">p50</div><div className="value">{ms(r?.p50Micros)}</div><div className="meta">单次判断耗时</div></div>
        <div className="kpi"><div className="label">p95</div><div className="value">{ms(r?.p95Micros)}</div><div className="meta">单次判断耗时</div></div>
        <div className="kpi"><div className="label">最近一次</div><div className="value" style={{ fontSize: 13 }}>{r?.lastCallAt ? new Date(r.lastCallAt).toLocaleString() : "—"}</div><div className="meta">&nbsp;</div></div>
      </div>
      <div className="grid-2" style={{ marginTop: 12 }}>
        <div className="card">
          <h3>拦在哪一步</h3>
          {r && r.blocks.length > 0 ? (
            <div className="prov">
              {r.blocks.map((b) => <span key={b.step + b.reason} className="o">{stepLabel[b.step] ?? b.step} · {b.reason} · {num(b.count)}</span>)}
            </div>
          ) : <div className="engine-inline">—</div>}
        </div>
        <div className="card">
          <h3>谁在调用</h3>
          {r && r.byCaller.length > 0 ? (
            <div className="prov">
              {r.byCaller.map((c) => <span key={c.caller + c.action} className="o">{c.caller} · {c.action} · {num(c.allowed)}/{num(c.calls)} 放行</span>)}
            </div>
          ) : <div className="engine-inline">—</div>}
        </div>
      </div>
    </>
  );
}

export function Engine() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => { opFetch("/v1/operator/decision-engine").then(setData).catch(() => {}); }, []);
  if (!data) return <div className="notice">加载 Decision Engine…</div>;
  // 没有库 / 查询失败时后端会回 NOT_CONNECTED 或 500。别再去读 data.engine —— 那正是
  // 这一页以前崩的原因：字段不存在时 React 会整页挂掉，运营连「为什么空」都看不到。
  if (data.dataSource !== "LIVE" || !data.states) {
    return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;
  }

  return (
    <>
      <div className="engine-hero">
        <h2>干预决策引擎</h2>
        <p>
          安全 → 用户明确拒绝 → 干预预算（每人每天 1 次）→ 证据门 → 获得感 / 愤怒感（§12 未实现，跳过）。
          第一个拦下来的步骤决定结论；永远不给 ACTIVE_ORCHESTRATE。
        </p>
      </div>

      <RuntimeBlock rt={data.runtime} />
      <div style={{ marginTop: 12 }}><Lab /></div>

      <div className="section-title">
        <h2>状态分档 · §11</h2>
        <span>共 {num(data.totals?.people)} 个（人 × 事件类型）状态</span>
      </div>
      <div className="engine-status">
        {(data.states ?? []).map((s) => (
          <div className="engine-mini" key={s.state}>
            <div className="k">{s.state}</div>
            <div className="v">{num(s.people)}</div>
            <div className="d">
              置信 {s.avg_confidence.toFixed(3)} · 证据覆盖 {s.avg_evidence_coverage.toFixed(2)} · 样本 {s.avg_sample_events.toFixed(1)}
            </div>
          </div>
        ))}
        <div className="engine-mini">
          <div className="k">ACTIVE_ORCHESTRATE</div>
          <div className="v">{num(data.totals?.activeOrchestrate)}</div>
          <div className="d">§12/§13 不自动进入主动编排 —— 这个值应当永远是 0</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 12 }}>
        <div className="card">
          <h3>按引力事件类型</h3>
          <div className="prov">
            {(data.eventTypes ?? []).map((e) => (
              <span key={e.event_type} className="o">{e.event_type} · {e.people}</span>
            ))}
          </div>
          <div className="engine-inline" style={{ marginTop: 10 }}>
            同一个人在不同事件类型上是不同行 —— 这不是人数，是「人 × 事件」状态数。
          </div>
        </div>
        <div className="card">
          <h3>模型与新鲜度</h3>
          <div className="prov">
            <span className="o">{(data.totals?.modelVersions ?? []).join(", ") || "—"}</span>
          </div>
          <div className="engine-inline" style={{ marginTop: 10 }}>
            最近一次重算：{data.totals?.lastComputedAt ?? "一次都没算过"}
          </div>
        </div>
      </div>

      {(data.notes ?? []).map((n, i) => (
        <div className="notice" key={i} style={{ marginTop: 8 }}>{n}</div>
      ))}
    </>
  );
}
