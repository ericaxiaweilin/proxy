import { useEffect, useState } from "react";

type Payload = { bands: Array<{ segment: string; health: number; status: string }>; activation_ladder: Array<{ k: string; v: string; d: string }> };

export function SupplyActivation() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => { fetch("/v1/operator/supply-health").then((r) => r.json()).then(setData).catch(() => {}); }, []);
  if (!data) return <div className="notice">加载 Supply Health…</div>;
  return (
    <>
      <div className="section-title"><h2>Supply Health</h2><span>能力图谱 · 可用度 · 供给充足度</span></div>
      <div className="supply-health">
        <div className="card">
          {data.bands.map((b) => (
            <div key={b.segment} className="supply-band">
              <span>{b.segment}</span>
              <div className="healthbar"><i className={b.status === "bad" ? "bad" : b.status === "warn" ? "warn" : ""} style={{ width: `${Math.round(b.health * 100)}%` }} /></div>
              <b>{Math.round(b.health * 100)}%</b>
            </div>
          ))}
        </div>
        <div className="card"><h3>Activation Ladder</h3><div className="activation-ladder">{data.activation_ladder.map((s) => <div key={s.k} className="activation-step"><div className="k">{s.k}</div><div className="v">{s.v}</div><div className="d">{s.d}</div></div>)}</div></div>
      </div>
    </>
  );
}
