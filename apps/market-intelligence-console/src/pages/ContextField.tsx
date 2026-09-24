import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";

type Snapshot = { context_snapshot_id: string; weather: string; mobility_friction: number; delivery_capacity: number; commute_eta: number; decision_id: string };
type Payload = { context_snapshot: Snapshot; decision: { intent: Record<string, unknown> | null; no_ui_change: string }; as_of: string };

export function ContextField() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    opFetch("/v1/operator/context-field").then(setData).catch((e: unknown) => setErr(String(e)));
  }, []);
  if (err) return <div className="notice"><b>未连接到 API</b> — {err}</div>;
  if (!data) return <div className="notice">加载 ContextSnapshot…</div>;
  const snap = data.context_snapshot;
  const intent = data.decision.intent as Record<string, unknown> | null;
  return (
    <>
      <div className="section-title"><h2>Context Field Snapshot</h2><span>{data.as_of} · versioned</span></div>
      <div className="context-vector">
        <h3>ContextSnapshot <span style={{ fontWeight: 400, opacity: 0.7 }}>{snap.context_snapshot_id}</span></h3>
        <div className="vector-row"><span>Weather</span><div className="vector-track"><i style={{ width: snap.weather === "heavy_rain" ? "82%" : "30%" }} /></div><b>{snap.weather}</b></div>
        <div className="vector-row"><span>Mobility Friction</span><div className="vector-track"><i style={{ width: `${Math.round(snap.mobility_friction * 100)}%` }} /></div><b>{snap.mobility_friction.toFixed(2)}</b></div>
        <div className="vector-row"><span>Delivery Capacity</span><div className="vector-track"><i style={{ width: `${Math.round(snap.delivery_capacity * 100)}%` }} /></div><b>{snap.delivery_capacity.toFixed(2)}</b></div>
        <div className="vector-row"><span>Commute ETA</span><div className="vector-track"><i style={{ width: `${Math.min(100, snap.commute_eta)}%` }} /></div><b>{snap.commute_eta}m</b></div>
      </div>
      <div className="section-title"><h2>Decision → Experience Intent</h2><span>Decision Engine 规则化演示（Gravity/Resource/Human Value 同构）</span></div>
      {intent ? (
        <div className="decision"><div className="head2"><b>{String(intent.type)}</b><span className="badge good">SOFT_NUDGE · {(intent.priority as number).toFixed(2)}</span></div><div className="why">Objective: {String(intent.objective)} · Decision {String(intent.decision_id)} · Expires {String(intent.expires_at)}<br />Reason: {(intent.reason_codes as string[]).join(", ")} · Allowed: {(intent.allowed_actions as string[]).join(", ")}</div></div>
      ) : (
        <div className="notice"><b>NO_UI_CHANGE</b> — {data.decision.no_ui_change}（§18.4 合法结果，不推 UI）</div>
      )}
      <div className="engine-inline" style={{ marginTop: 10 }}><b>链路：</b> ContextSnapshot → Decide() → ExperienceIntent → Orchestrator → SurfaceCompiler（Go <code>internal/experience/runtime/decision.go</code>）</div>
    </>
  );
}
