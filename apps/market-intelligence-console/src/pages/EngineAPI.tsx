import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";
export function EngineAPI(){
  const [d,setD]=useState<{endpoints:Array<{method:string;path:string;desc:string}>;state_lifecycle:Array<{s:string;d:string}>}|null>(null);
  useEffect(()=>{opFetch("/v1/operator/engine-api").then(setD).catch(()=>{});},[]);
  if(!d) return <div className="notice">加载 Engine API…</div>;
  return (<><div className="card"><h3>Endpoints</h3>{d.endpoints.map(e=><div key={e.path} className="endpoint"><span className="method">{e.method}</span><span className="path">{e.path}</span><span>{e.desc}</span></div>)}</div><div className="state-strip" style={{marginTop:12}}>{d.state_lifecycle.map(s=><div key={s.s} className="state-card"><div className="s">{s.s}</div><div className="d">{s.d}</div></div>)}</div></>);
}
