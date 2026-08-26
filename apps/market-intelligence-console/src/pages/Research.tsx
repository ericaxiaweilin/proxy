import { useEffect, useState } from "react";

type Payload = { stages: Array<{ stage: string; desc: string; count: number }>; field_flow: Array<{ k: string; v: string; d: string }> };

export function Research() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => { fetch("/v1/operator/research").then((r) => r.json()).then(setData).catch(() => {}); }, []);
  if (!data) return <div className="notice">加载 Research…</div>;
  return (
    <>
      <div className="research-grid">
        {data.stages.map((s) => (
          <div key={s.stage} className="research-card"><h3>{s.stage}</h3><p>{s.desc}</p><span className={`stage ${s.stage === "Prod" ? "prod" : s.stage === "Shadow" ? "shadow" : "lab"}`}>{s.count} 实验</span></div>
        ))}
      </div>
      <div className="section-title"><h2>Field Flow</h2><span>Context Field → Gravity Field</span></div>
      <div className="field-flow">{data.field_flow.map((f) => <div key={f.k} className="field-step"><div className="k">{f.k}</div><div className="v">{f.v}</div><div className="d">{f.d}</div></div>)}</div>
    </>
  );
}
