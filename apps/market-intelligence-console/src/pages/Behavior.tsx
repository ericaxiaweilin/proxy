import { useEffect, useState } from "react";

type Payload = { events: Record<string, string>; top_interests: Array<{ tag: string; score: number; confidence: number }> };

export function Behavior() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => { fetch("/v1/operator/behavior").then((r) => r.json()).then(setData).catch(() => {}); }, []);
  if (!data) return <div className="notice">加载 Behavior…</div>;
  return (
    <>
      <div className="event-grid">
        <div className="event"><div className="e">有效深度浏览</div><div className="n">{data.events.deep_view}</div></div>
        <div className="event"><div className="e">强正向信号</div><div className="n">{data.events.strong_positive}</div></div>
        <div className="event"><div className="e">弱负向信号</div><div className="n">{data.events.weak_negative}</div></div>
        <div className="event"><div className="e">强负向信号</div><div className="n">{data.events.strong_negative}</div></div>
      </div>
      <div className="section-title"><h2>Top Interests</h2><span>score + confidence（不把“看过一次”误判成喜欢）</span></div>
      <div className="card">
        {data.top_interests.map((t) => (
          <div key={t.tag} className="funnel-row"><div className="name">{t.tag}</div><div className="track"><div className="bar" style={{ width: `${Math.round(t.score * 100)}%` }} /></div><div className="num">{t.score.toFixed(2)}</div><div className="rate">{t.confidence.toFixed(2)}</div></div>
        ))}
      </div>
    </>
  );
}
