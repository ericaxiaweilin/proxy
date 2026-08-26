import { useEffect, useState } from "react";
export function Population() {
  const [d, setD] = useState<{ kpis: Record<string,string>; gender: Array<{label:string;pct:number}> }|null>(null);
  useEffect(()=>{fetch("/v1/operator/population").then(r=>r.json()).then(setD).catch(()=>{});},[]);
  if(!d) return <div className="notice">加载 Population…</div>;
  return (<><div className="kpi-grid">{Object.entries(d.kpis).map(([k,v])=><div key={k} className="kpi"><div className="label">{k}</div><div className="value">{v}</div></div>)}</div><div className="card" style={{marginTop:12}}><h3>性别构成</h3>{d.gender.map(g=><div key={g.label} className="funnel-row"><span>{g.label}</span><div className="track"><div className="bar" style={{width:`${g.pct}%`}}/></div><div className="num">{g.pct}%</div></div>)}</div></>);
}
