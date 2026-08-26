import { useEffect, useState } from "react";

type Exec = {
  budget: { max_schema_payload_bytes: number; max_delta_payload_bytes: number; max_nodes: number; max_images: number };
  throttler: { home_suppressed_at_0_82: boolean; cooldown_ms: number };
  channel_policy: { soft_nudge_push_allowed: boolean; active_push_allowed: boolean };
};

export function ExecutionRuntime() {
  const [data, setData] = useState<Exec | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/v1/operator/execution-runtime").then((r) => r.json()).then(setData).catch((e: unknown) => setErr(String(e)));
  }, []);
  if (err) return <div className="notice"><b>未连接到 API</b> — {err}</div>;
  if (!data) return <div className="notice">加载 Execution Runtime…</div>;
  return (
    <>
      <div className="section-title"><h2>Market Execution · Budget & Throttler</h2><span>§23 性能预算 · §25 防抖 · §27 通道策略</span></div>
      <div className="exec-grid">
        <div className="exec-kpi"><div className="k">Max Schema Payload</div><div className="v">{(data.budget.max_schema_payload_bytes / 1024).toFixed(0)} KB</div><div className="d">UISchema JSON 上限</div></div>
        <div className="exec-kpi"><div className="k">Max Delta Payload</div><div className="v">{(data.budget.max_delta_payload_bytes / 1024).toFixed(0)} KB</div><div className="d">Versioned Delta</div></div>
        <div className="exec-kpi"><div className="k">Max Nodes / Images</div><div className="v">{data.budget.max_nodes} / {data.budget.max_images}</div><div className="d">§9 depth/nodes/images guard</div></div>
        <div className="exec-kpi"><div className="k">Throttler Cooldown</div><div className="v">{data.throttler.cooldown_ms / 1000}s</div><div className="d">home@0.82 suppressed: {data.throttler.home_suppressed_at_0_82 ? "是" : "否"}</div></div>
      </div>
      <div className="grid-2" style={{ marginTop: 12 }}>
        <div className="card"><h3>Supply Activation</h3><div className="activation-ladder"><div className="activation-step"><div className="k">Context</div><div className="v">heavy_rain 0.72</div><div className="d">World/User/Market</div></div><div className="activation-step"><div className="k">Decision</div><div className="v">SOFT_NUDGE</div><div className="d">Human Value PASS</div></div><div className="activation-step"><div className="k">Surface</div><div className="v">PRIMITIVE</div><div className="d">budget PASS</div></div><div className="activation-step"><div className="k">Delta</div><div className="v">v184→v185</div><div className="d">local态保留</div></div></div></div>
        <div className="card">
          <h3>Channel Policy (§27)</h3>
          <div className="policy-row"><span>SOFT_NUDGE → PUSH</span><b>{data.channel_policy.soft_nudge_push_allowed ? "允许" : "禁止"}</b><span className="badge bad">FEED/HOME 可</span><span /></div>
          <div className="policy-row"><span>ACTIVE → PUSH</span><b>{data.channel_policy.active_push_allowed ? "允许" : "禁止"}</b><span className="badge good">全通道</span><span /></div>
          <div className="notice" style={{ marginTop: 10 }}>同一 Intent 按通道重过 Intervention Policy，PUSH 需显式 ACTIVE 以上。</div>
        </div>
      </div>
      <div className="section-title"><h2>Fallback Architecture (§18)</h2><span>Capability → Compiler → Realtime → Decision 四级回退</span></div>
      <div className="fallback-tree">
        <div className="fallback-node"><div className="n">Rich Composition</div><div className="d">grid:v2 + merchant_card:v5</div></div>
        <div className="fallback-node"><div className="n">Simplified</div><div className="d">旧端降级</div></div>
        <div className="fallback-node"><div className="n">Generic Card</div><div className="d">Native Fallback</div></div>
        <div className="fallback-node"><div className="n">Stable Surface</div><div className="d">当前快照</div></div>
        <div className="fallback-node"><div className="n">NO_UI_CHANGE</div><div className="d">合法无变化</div></div>
      </div>
    </>
  );
}
