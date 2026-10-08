import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";

// OPS-ENGINE-API-001（2026-10-07/08）：这一页原来**打不开**（读 d.endpoints /
// d.state_lifecycle，桩不发这两个字段 ⇒ TypeError）。现在后端是真的：
//   - POST /v1/decisions/evaluate 已上线（§20 引擎判定入口，暴雨规则内核）；
//   - 引擎状态机复用引力真数据（OBSERVE / LEARN_ONLY / PASSIVE + 人数）；
//   - runtime 预算 / 通道策略是 experience/runtime 包的真实常量。
// experience 三件套（surface/delta/metrics）在跑但输入是固定快照 —— 页面写明，不冒充已接 store。
type Endpoint = { method: string; path: string; live: boolean; desc: string };
type StateRow = { state: string; people: number; avg_confidence?: number };
type Payload = {
  dataSource?: string;
  missing?: string;
  endpoints?: Endpoint[];
  state_lifecycle?: { states?: StateRow[]; totalPeople?: number; lastComputedAt?: string | null; policyVersion?: string };
  runtime?: {
    budget?: { max_schema_payload_bytes: number; max_delta_payload_bytes: number; max_nodes: number; max_images: number };
    channel_policy?: { soft_nudge_push_allowed: boolean; active_push_allowed: boolean };
  };
  notes?: string[];
};

export function EngineAPI() {
  const [d, setD] = useState<Payload | null>(null);
  useEffect(() => { opFetch("/v1/operator/engine-api").then(setD).catch(() => {}); }, []);
  if (!d) return <div className="notice">加载 Engine API…</div>;
  if (d.dataSource !== "LIVE" || !d.endpoints || !d.state_lifecycle) {
    return <div className="notice"><b>未接入：</b>{d.missing ?? "没有数据源"}</div>;
  }
  const lc = d.state_lifecycle;
  const rt = d.runtime;

  return (
    <>
      <div className="section-title">
        <h2>API / Runtime · 引擎调用面</h2>
        <span>判定内核 {lc.policyVersion ?? "—"} —— 当前只有暴雨规则</span>
      </div>
      <div className="notice" style={{ marginBottom: 10 }}>
        evaluate 已上线：POST /v1/decisions/evaluate（带认证 + 按 actor 限流）。
        ContextSnapshot 进，ExperienceIntent 或 NO_UI_CHANGE 出 —— NO_UI_CHANGE 多数时候是「规则没覆盖」，不是「没事」。
      </div>

      <div className="section-title"><h2>端点清单</h2><span>只列真实存在的</span></div>
      <div className="card">
        {(d.endpoints ?? []).map((e) => (
          <div key={e.path} className="endpoint">
            <span className="method">{e.method}</span>
            <span className="path">{e.path}</span>
            <span>{e.desc}</span>
            <span className={`badge ${e.live ? "good" : "bad"}`}>{e.live ? "LIVE" : "DOWN"}</span>
          </div>
        ))}
      </div>

      <div className="section-title"><h2>引擎状态机（§11 · 真实引力数据）</h2><span>{lc.totalPeople ?? 0} 人在档</span></div>
      <div className="engine-status">
        {(lc.states ?? []).map((s) => (
          <div className="engine-mini" key={s.state}>
            <div className="k">{s.state}</div>
            <div className="v">{s.people.toLocaleString()} 人</div>
            {s.avg_confidence != null && <div className="d">平均置信度 {s.avg_confidence.toFixed(2)}</div>}
          </div>
        ))}
        <div className="engine-mini">
          <div className="k">最近重算</div>
          <div className="v">{lc.lastComputedAt ? new Date(lc.lastComputedAt).toLocaleString() : "—"}</div>
          <div className="d">引力 worker 每小时重算一次</div>
        </div>
      </div>

      {rt && (
        <>
          <div className="section-title"><h2>Runtime 配置</h2><span>experience/runtime 包的真实常量</span></div>
          <div className="engine-status">
            <div className="engine-mini"><div className="k">Schema 预算</div><div className="v">{(rt.budget?.max_schema_payload_bytes ?? 0).toLocaleString()} B</div><div className="d">节点上限 {rt.budget?.max_nodes} · 图片上限 {rt.budget?.max_images}</div></div>
            <div className="engine-mini"><div className="k">Delta 预算</div><div className="v">{(rt.budget?.max_delta_payload_bytes ?? 0).toLocaleString()} B</div><div className="d">单次增量补丁</div></div>
            <div className="engine-mini"><div className="k">SOFT_NUDGE → PUSH</div><div className="v">{rt.channel_policy?.soft_nudge_push_allowed ? "允许" : "禁止"}</div><div className="d">通道策略</div></div>
            <div className="engine-mini"><div className="k">ACTIVE → PUSH</div><div className="v">{rt.channel_policy?.active_push_allowed ? "允许" : "禁止"}</div><div className="d">主动编排不自动进（§12/§13）</div></div>
          </div>
        </>
      )}

      {(d.notes ?? []).map((n, i) => (
        <div className="notice" key={i} style={{ marginTop: 8 }}>{n}</div>
      ))}
    </>
  );
}
