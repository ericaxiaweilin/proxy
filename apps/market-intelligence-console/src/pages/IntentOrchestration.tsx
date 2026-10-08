import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";

// OPS-CONSOLE-PAGES-001（2026-10-07）：这一页原来**打不开**（`d.intent_funnel.map(...)`，
// 桩不发 intent_funnel ⇒ TypeError）。
//
// spec §6 §7 §16 说的「意图漏斗 + 引力 / 召回 / 排序 / 编排」里，今天**只有两层是真的**：
//   引力状态 —— decision.user_event_states（引力 worker 写）；
//   候选批次 —— supply.candidate_batches（撮合引擎写）。
// 编排动作（干预 / 抑制 / 排期）没有任何落库（按 orchestr / intervent / suppress /
// ignite / budget 全库查表名为 0 命中），§13 干预预算、§14 点火模型也都没实现。
// 所以这一页给的是那两层，并把缺的那一层写在说明里 —— 不画一条看起来完整的链路。
type StateRow = { state: string; people: number; avg_confidence: number; avg_evidence_coverage: number };
type Payload = {
  dataSource?: string;
  missing?: string;
  windowDays?: number;
  gravity?: {
    states: StateRow[];
    eventTypes: Array<{ event_type: string; people: number }>;
    activeOrchestrate: number;
    totalPeople: number;
    lastComputedAt: string | null;
  };
  retrieval?: {
    batches: number;
    batchesWithSupply: number;
    shortageBatches: number;
  };
  exposures?: number;
  notes?: string[];
};

export function IntentOrchestration() {
  const [d, setD] = useState<Payload | null>(null);
  useEffect(() => { opFetch("/v1/operator/intent-orchestration").then(setD).catch(() => {}); }, []);
  if (!d) return <div className="notice">加载 Intent/Orchestration…</div>;
  // 以前读 d.intent_funnel 会整页崩 —— 这里先挡住 NOT_CONNECTED。
  if (d.dataSource !== "LIVE" || !d.gravity) {
    return <div className="notice"><b>未接入：</b>{d.missing ?? "没有数据源"}</div>;
  }
  const g = d.gravity;
  const r = d.retrieval ?? { batches: 0, batchesWithSupply: 0, shortageBatches: 0 };

  return (
    <>
      <div className="section-title">
        <h2>意图编排 · 只有两层是真的</h2>
        <span>{d.windowDays ? `候选批次按近 ${d.windowDays} 天` : ""}</span>
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>引力状态（真的）</h3>
          {g.states.map((s) => (
            <div key={s.state} className="funnel-row">
              <div className="name">{s.state}</div>
              <div className="track"><div className="bar" style={{ width: g.totalPeople > 0 ? `${(s.people / g.totalPeople) * 100}%` : "0%" }} /></div>
              <div className="num">{s.people.toLocaleString()}</div>
            </div>
          ))}
          <div className="engine-inline" style={{ marginTop: 8 }}>
            置信 {(g.states[0]?.avg_confidence ?? 0).toFixed(3)} 起 · 最近重算 {g.lastComputedAt ?? "一次都没算过"}
          </div>
          <div className="engine-inline" style={{ marginTop: 6 }}>
            ACTIVE_ORCHESTRATE {g.activeOrchestrate} —— §12/§13 不自动进入主动编排，应当永远是 0。
          </div>
        </div>
        <div className="card">
          <h3>召回 / 排序（真的）</h3>
          <div className="edge-row"><span>候选批次</span><span>supply.candidate_batches</span><b>{r.batches.toLocaleString()}</b></div>
          <div className="edge-row"><span>找到供给</span><span>候选数组非空</span><b>{r.batchesWithSupply.toLocaleString()}</b></div>
          <div className="edge-row"><span>供不应求</span><span>shortage = true</span><b>{r.shortageBatches.toLocaleString()}</b></div>
          <div className="edge-row"><span>曝光</span><span>interaction_events</span><b>{(d.exposures ?? 0).toLocaleString()}</b></div>
        </div>
      </div>
      <div className="section-title"><h2>编排（没有数据）</h2><span>spec §13 §14 §16.3</span></div>
      <div className="engine-status">
        <div className="engine-mini"><div className="k">干预次数</div><div className="v">—</div><div className="d">编排动作没有落库</div></div>
        <div className="engine-mini"><div className="k">抑制人数</div><div className="v">—</div><div className="d">同上</div></div>
        <div className="engine-mini"><div className="k">干预预算</div><div className="v">—</div><div className="d">§13 未实现</div></div>
        <div className="engine-mini"><div className="k">点火档位</div><div className="v">—</div><div className="d">§14 未实现</div></div>
      </div>
      {(d.notes ?? []).map((n, i) => (
        <div className="notice" key={i} style={{ marginTop: 8 }}>{n}</div>
      ))}
    </>
  );
}
