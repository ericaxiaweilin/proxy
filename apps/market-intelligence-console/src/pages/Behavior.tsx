import { useEffect, useState } from "react";
import { opFetch } from "../lib/api";

// OPS-REAL-001：近 30 天真实行为信号（localnet.interaction_events + engagement 表）。
// 深度浏览 = 停留 ≥ 3 秒的曝光；强正向 = 点赞 + 收藏 + 转发；弱负向 = 「减少推荐」；强负向 = 举报 + 屏蔽作者。
// 兴趣分需要标签体系（spec §3），没有就写「未接入」，不画假条形图。
type Payload = {
  windowDays: number;
  events: Record<"exposures" | "deep_view" | "zooms" | "profile_opens" | "strong_positive" | "weak_negative" | "strong_negative", number>;
  top_interests: Array<{ tag: string; score: number; confidence: number }>;
  topInterestsMissing?: string;
};

const LABELS: Array<[keyof Payload["events"], string]> = [
  ["exposures", "曝光"], ["deep_view", "深度浏览（≥3 秒）"], ["zooms", "放大查看"], ["profile_opens", "主页访问"],
  ["strong_positive", "强正向（赞 / 藏 / 转）"], ["weak_negative", "弱负向（减少推荐）"], ["strong_negative", "强负向（举报 / 屏蔽）"],
];

export function Behavior() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => { opFetch<Payload>("/v1/operator/behavior").then(setData).catch(() => {}); }, []);
  if (!data) return <div className="notice">加载行为信号…</div>;
  return (
    <>
      <div className="section-title"><h2>近 {data.windowDays} 天行为信号</h2><span>真实事件表，服务端全量保存</span></div>
      <div className="event-grid">
        {LABELS.map(([key, label]) => <div key={key} className="event"><div className="e">{label}</div><div className="n">{data.events[key].toLocaleString()}</div></div>)}
      </div>
      <div className="section-title"><h2>Top Interests</h2><span>score + confidence</span></div>
      <div className="card">
        {data.top_interests.length === 0
          ? <div className="notice">未接入：{data.topInterestsMissing ?? "没有数据源"}</div>
          : data.top_interests.map((t) => (
            <div key={t.tag} className="funnel-row"><div className="name">{t.tag}</div><div className="track"><div className="bar" style={{ width: `${Math.round(t.score * 100)}%` }} /></div><div className="num">{t.score.toFixed(2)}</div><div className="rate">{t.confidence.toFixed(2)}</div></div>
          ))}
      </div>
    </>
  );
}
