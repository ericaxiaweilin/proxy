import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";

type SurfacePayload = {
  surface_id: string;
  latest_plan: Record<string, unknown> | null;
  latest_schema: { root: { type: string; children?: Array<{ type: string; props?: Record<string, unknown> }> } } | null;
  metrics: Record<string, unknown>;
  pattern_candidates: Array<{ signature: string; render_count: number; stability: number }>;
  policy_version: string;
};

export function Surface() {
  const [data, setData] = useState<SurfacePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    opFetch("/v1/operator/surface-plans?surface_id=home").then(setData).catch((e: unknown) => setErr(String(e)));
  }, []);
  if (err) return <div className="notice"><b>未连接到 API</b> — {err}</div>;
  if (!data) return <div className="notice">加载 SurfacePlan…</div>;
  const plan = data.latest_plan as Record<string, unknown> | null;
  const schema = data.latest_schema;
  return (
    <>
      <div className="section-title"><h2>Surface Composition</h2><span>{data.policy_version} · {data.surface_id}</span></div>
      <div className="grid-2">
        <div className="card">
          <h3>Latest SurfacePlan</h3>
          {plan ? (
            <>
              <div className="mini-grid">
                <div className="mini"><span>Plan ID</span><b style={{ fontSize: 10 }}>{String(plan["surface_plan_id"])}</b></div>
                <div className="mini"><span>Version</span><b>{String(plan["surface_version"])}</b></div>
                <div className="mini"><span>Render Mode</span><b style={{ fontSize: 11 }}>{String(plan["render_mode"])}</b></div>
                <div className="mini"><span>TTL</span><b>{String(plan["ttl_s"])}s</b></div>
              </div>
              <div className="api-code" style={{ marginTop: 10 }}>{JSON.stringify(plan, null, 2)}</div>
            </>
          ) : <div className="notice">无 Plan（NO_UI_CHANGE）</div>}
        </div>
        <div className="card">
          <h3>UISchema · Primitive Composition</h3>
          <div className="hint">§9 declarative tree · 受控词汇，不生成任意 HTML/JS</div>
          {schema ? (
            <>
              <div className="compose-preview">
                <div className="phone"><div className="screen">
                  {(schema.root.children ?? []).map((child, i) => (
                    <div key={i} className={`module ${child.type === "merchant_list" ? "compact" : ""}`}>
                      <b>{child.type}</b><div>{JSON.stringify(child.props ?? {})}{child.type === "merchant_list" ? " · data_ref: candidate_set_82" : ""}</div>
                    </div>
                  ))}
                </div></div>
                <div className="api-code">{JSON.stringify(schema, null, 2)}</div>
              </div>
            </>
          ) : <div className="notice">无 Schema</div>}
        </div>
      </div>
      <div className="section-title"><h2>Pattern Registry · 晋升候选</h2><span>§19 高频稳定 → Native</span></div>
      <div className="card">
        {data.pattern_candidates.length === 0 ? <div className="notice">暂无候选（需 &gt;100 次渲染且 stability &gt;0.8）</div> : (
          <table><thead><tr><th>Signature</th><th>Render Count</th><th>Stability</th></tr></thead><tbody>{data.pattern_candidates.map((p) => <tr key={p.signature}><td style={{ whiteSpace: "normal" }}>{p.signature}</td><td className="numc">{p.render_count}</td><td className="numc">{p.stability.toFixed(2)}</td></tr>)}</tbody></table>
        )}
      </div>
    </>
  );
}
