import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";
export function IntentOrchestration(){
  const [d,setD]=useState<{intent_funnel:Array<{stage:string;count:string}>;orchestration:Array<{step:string;desc:string}>}|null>(null);
  useEffect(()=>{opFetch("/v1/operator/intent-orchestration").then(setD).catch(()=>{});},[]);
  if(!d) return <div className="notice">加载 Intent/Orchestration…</div>;
  return (<div className="grid-2"><div className="card"><h3>Intent Funnel</h3>{d.intent_funnel.map(f=><div key={f.stage} className="funnel-row"><div className="name">{f.stage}</div><div className="track"><div className="bar" style={{width:"68%"}}/></div><div className="num">{f.count}</div></div>)}</div><div className="card"><h3>Orchestration</h3>{d.orchestration.map(s=><div key={s.step} className="edge-row"><span>{s.step}</span><span>{s.desc}</span><b>—</b></div>)}</div></div>);
}
