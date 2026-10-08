import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";

// OPS-CONSOLE-PAGES-001（2026-10-07）：这一页原来**打不开**（读 d.safety / d.risk_scores，
// 桩不发这两个字段 ⇒ TypeError）。而且它**原来想显示的东西不该被造出来**：
// `risk_scores: [{segment, score}]` 是逐人群的 0–1 风险分 —— 仓里没有任何风险模型，
// 摆一个分数会让人以为系统在评估风险。那比没有风险分坏得多。
//
// 所以这一页没有 score 字段，给的是能被数的**证据与处置事实**：
//   - 供给侧证据（实名 / 能力核验，全量 —— 核验是状态不是事件）；
//   - 风险信号（举报 / 屏蔽），窗口内 + 全量两个口径，跟商家页 orders30d / orders30dAll
//     同一个道理：只报窗口会把「一直挂着没处置」藏起来；
//   - 处置事实（dispositions / appeals / 安全事件）。
type Payload = {
  dataSource?: string;
  missing?: string;
  windowDays?: number;
  evidence?: {
    agents: number;
    realNameVerified: number;
    realNameExpired: number;
    realNameMissing: number;
    capabilityVerified: number;
  };
  signals?: {
    reports30d: number;
    reportsAll: number;
    mutedAuthors30d: number;
    mutedAuthorsAll: number;
    postReportsAll: number;
  };
  disposition?: {
    dispositions30d: number;
    dispositionsAll: number;
    appealsAll: number;
    safetyIncidentsAll: number;
    safetyBlocksAll: number;
  };
  notes?: string[];
};

export function Trust() {
  const [d, setD] = useState<Payload | null>(null);
  useEffect(() => { opFetch("/v1/operator/trust").then(setD).catch(() => {}); }, []);
  if (!d) return <div className="notice">加载 Trust…</div>;
  // 没有库时后端回 NOT_CONNECTED。以前读 d.safety 会整页崩 —— 这里先挡住。
  if (d.dataSource !== "LIVE" || !d.evidence) {
    return <div className="notice"><b>未接入：</b>{d.missing ?? "没有数据源"}</div>;
  }
  const e = d.evidence;
  const s = d.signals ?? { reports30d: 0, reportsAll: 0, mutedAuthors30d: 0, mutedAuthorsAll: 0, postReportsAll: 0 };
  const p = d.disposition ?? { dispositions30d: 0, dispositionsAll: 0, appealsAll: 0, safetyIncidentsAll: 0, safetyBlocksAll: 0 };

  return (
    <>
      <div className="section-title">
        <h2>信任与风险 · 没有风险分</h2>
        <span>{d.windowDays ? `负向信号按近 ${d.windowDays} 天 + 全量两个口径` : ""}</span>
      </div>
      <div className="notice" style={{ marginBottom: 10 }}>
        <b>这一页没有风险分。</b>仓里没有任何风险模型 —— 摆一个 0–1 的 score 会让人以为系统在评估风险，
        那比没有风险分坏得多。下面全是能被数出来的证据与处置事实。
      </div>

      <div className="section-title"><h2>供给侧证据（全量）</h2><span>核验是状态，不是事件</span></div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">服务者</div><div className="value">{e.agents.toLocaleString()}</div><div className="meta">supply.agent_profiles</div></div>
        <div className="kpi"><div className="label">实名核验通过</div><div className="value">{e.realNameVerified.toLocaleString()}</div><div className="meta">按 agent_id 数（user_account_id 那列全空）</div></div>
        <div className="kpi"><div className="label">实名已过期</div><div className="value">{e.realNameExpired.toLocaleString()}</div><div className="meta">过期也算事实，两个数分开给</div></div>
        <div className="kpi"><div className="label">从没验过</div><div className="value">{e.realNameMissing.toLocaleString()}</div><div className="meta">一条核验记录都没有（不是过期）</div></div>
        <div className="kpi"><div className="label">能力核验</div><div className="value">{e.capabilityVerified.toLocaleString()}</div><div className="meta">supply.capability_verifications</div></div>
      </div>

      <div className="section-title"><h2>风险信号</h2><span>窗口内 / 全量</span></div>
      <div className="engine-status">
        <div className="engine-mini"><div className="k">举报（窗口）</div><div className="v">{s.reports30d.toLocaleString()}</div><div className="d">moderation.reports</div></div>
        <div className="engine-mini"><div className="k">举报（全量）</div><div className="v">{s.reportsAll.toLocaleString()}</div><div className="d">一直挂着没处置的会留在这一格</div></div>
        <div className="engine-mini"><div className="k">帖子举报（全量）</div><div className="v">{s.postReportsAll.toLocaleString()}</div><div className="d">engagement.post_reports</div></div>
        <div className="engine-mini"><div className="k">屏蔽作者</div><div className="v">{s.mutedAuthorsAll.toLocaleString()}</div><div className="d">窗口内 {s.mutedAuthors30d}</div></div>
      </div>

      <div className="section-title"><h2>处置事实</h2><span>回答「举报有没有人处理」</span></div>
      <div className="engine-status">
        <div className="engine-mini"><div className="k">处置（窗口）</div><div className="v">{p.dispositions30d.toLocaleString()}</div><div className="d">moderation.dispositions</div></div>
        <div className="engine-mini"><div className="k">处置（全量）</div><div className="v">{p.dispositionsAll.toLocaleString()}</div><div className="d">0 不等于「都处理完了」</div></div>
        <div className="engine-mini"><div className="k">申诉</div><div className="v">{p.appealsAll.toLocaleString()}</div><div className="d">moderation.appeals</div></div>
        <div className="engine-mini"><div className="k">安全事件</div><div className="v">{p.safetyIncidentsAll.toLocaleString()}</div><div className="d">safety.incidents</div></div>
        <div className="engine-mini"><div className="k">封禁</div><div className="v">{p.safetyBlocksAll.toLocaleString()}</div><div className="d">safety.blocks</div></div>
      </div>

      {(d.notes ?? []).map((n, i) => (
        <div className="notice" key={i} style={{ marginTop: 8 }}>{n}</div>
      ))}
    </>
  );
}
