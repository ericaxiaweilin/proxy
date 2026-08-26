import { useEffect, useState } from "react";

type EnginePayload = {
  engine: { evaluate_calls_30d: string; p99_ms: number; evidence_pass: string; active_orchestrate: string; human_value_block: string; lineage_complete: string };
  policy_resolver: { policy_version: string; guardrails: string[] };
  trace_sample: { decision_id: string; context_snapshot_id: string; chain: string[] };
};

export function Engine() {
  const [data, setData] = useState<EnginePayload | null>(null);
  useEffect(() => { fetch("/v1/operator/decision-engine").then((r) => r.json()).then(setData).catch(() => {}); }, []);
  if (!data) return <div className="notice">加载 Decision Engine…</div>;
  return (
    <>
      <div className="engine-hero"><h2>Decision Engine Runtime</h2><p>业务智能已直连在线决策引擎 · POST /v1/decisions/evaluate → Gravity → Evidence → Resource → Human Value → Eligibility</p></div>
      <div className="engine-status" style={{ marginTop: 12 }}>
        <div className="engine-mini"><div className="k">Evaluate 30D</div><div className="v">{data.engine.evaluate_calls_30d}</div></div>
        <div className="engine-mini"><div className="k">p99 Latency</div><div className="v">{data.engine.p99_ms}ms</div><div className="d">target &lt;150ms</div></div>
        <div className="engine-mini"><div className="k">Evidence PASS</div><div className="v">{data.engine.evidence_pass}</div></div>
        <div className="engine-mini"><div className="k">Active Orchestrate</div><div className="v">{data.engine.active_orchestrate}</div></div>
        <div className="engine-mini"><div className="k">Human Value Block</div><div className="v">{data.engine.human_value_block}</div></div>
        <div className="engine-mini"><div className="k">Lineage Complete</div><div className="v">{data.engine.lineage_complete}</div></div>
      </div>
      <div className="grid-2" style={{ marginTop: 12 }}>
        <div className="card"><h3>Policy Resolver · {data.policy_resolver.policy_version}</h3><div className="prov">{data.policy_resolver.guardrails.map((g) => <span key={g} className="o">{g}</span>)}</div><div className="engine-inline" style={{ marginTop: 10 }}>Guardrail 不可被 Surface Policy 绕过（§17.3/§28）</div></div>
        <div className="card"><h3>Decision Trace Sample</h3><div className="trace-v6">{data.trace_sample.chain.map((step) => <div key={step} className="step"><div className="k">step</div><div className="v">{step}</div><div className="d">{data.trace_sample.decision_id} · {data.trace_sample.context_snapshot_id}</div></div>)}</div></div>
      </div>
    </>
  );
}
