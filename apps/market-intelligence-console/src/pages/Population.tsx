import { useEffect, useState } from "react";
import { opFetch } from "../lib/api";

// OPS-REAL-001：真实查询（identity / localnet 表），窗口近 30 天。资料里没采集性别 —— 显示「未采集」，不画 0。
type Payload = { windowDays: number; kpis: Record<string, number>; gender: Array<{ label: string; pct: number }>; genderMissing?: string };

export function Population() {
  const [d, setD] = useState<Payload | null>(null);
  useEffect(() => { opFetch<Payload>("/v1/operator/population").then(setD).catch(() => {}); }, []);
  if (!d) return <div className="notice">加载用户构成…</div>;
  return (
    <>
      <div className="kpi-grid">
        {Object.entries(d.kpis).map(([k, v]) => <div key={k} className="kpi"><div className="label">{k}</div><div className="value">{v.toLocaleString()}</div></div>)}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h3>性别构成</h3>
        {d.gender.length === 0
          ? <div className="notice">未采集：{d.genderMissing ?? "没有数据源"}</div>
          : d.gender.map((g) => <div key={g.label} className="funnel-row"><span>{g.label}</span><div className="track"><div className="bar" style={{ width: `${g.pct}%` }} /></div><div className="num">{g.pct}%</div></div>)}
      </div>
    </>
  );
}
