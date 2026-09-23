import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";
export function Tags(){
  const [d,setD]=useState<{kpis:Record<string,number>;top_tags:Array<{tag:string;type:string;count:number}>}|null>(null);
  useEffect(()=>{opFetch("/v1/operator/tags").then(setD).catch(()=>{});},[]);
  if(!d) return <div className="notice">加载 Tags…</div>;
  return (<><div className="tag-kpis">{Object.entries(d.kpis).map(([k,v])=><div key={k} className="kpi"><div className="label">{k}</div><div className="value">{v}</div></div>)}</div><div className="tagcloud" style={{marginTop:12}}>{d.top_tags.map(t=><span key={t.tag} className={`rawtag ${t.type}`}>{t.tag} · {t.count}</span>)}</div></>);
}
