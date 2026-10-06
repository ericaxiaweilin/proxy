import { useEffect, useState } from "react";
import { opFetch } from "../lib/api";

// OPS-SUPPLY-HEALTH-001：供给健康度。
//
// 原来这一页读的是 `{bands:[{segment,health}], activation_ladder:[{k,v,d}]}` ——
// 一个按品类的健康度百分比条加一条转化漏斗，而后端从来没有这些数（端点当时是
// NOT_CONNECTED，opFetch 直接抛错，页面根本没渲染过）。现在按「有来源才显示」重做。
//
// 这一页刻意没有的两样东西，理由在后端带上来的 notes 里，也抄在这里：
//   · 供需比：需求侧今天只有草稿、0 个正式任务，除以一个空的东西得到的比值是噪声。
//   · 转化率：激活漏斗各步（注册→建档→配窗→被下单）不是同一批人，相除没有意义，
//     所以只摆各步的原始人数。

type Supply = {
  windowDays: number;
  agents: number; agentsActive: number; agentsDraft: number; agentsNewInWindow: number;
  agentsWithBio: number; agentsWithLanguages: number;
  agentsWithAvailability: number; agentsWithOpenWindow: number;
  realNameVerified: number; realNameExpired: number; capabilityVerified: number;
  agentsWithOrders: number; ordersInWindow: number;
  demandTaskDrafts: number; demandTasks: number; cityCompanionNeeds: number;
};
type Payload = { dataSource: string; windowDays: number; supply: Supply; notes: string[]; missingNotes: string[] };

const KPI = (label: string, value: number, meta: string) => (
  <div className="kpi" key={label}>
    <div className="label">{label}</div>
    <div className="value">{value.toLocaleString()}</div>
    <div className="meta">{meta}</div>
  </div>
);

export function SupplyActivation() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    opFetch<Payload>("/v1/operator/supply-health").then(setData).catch(() => {});
  }, []);
  if (!data) return <div className="notice">加载供给健康度…</div>;

  const s = data.supply;
  const share = (part: number, of: number) => (of > 0 ? `${Math.round((part / of) * 100)}% 的 ${of.toLocaleString()} 个档案` : "没有可对照的档案");

  return (
    <>
      <div className="section-title">
        <h2>供给盘子 · 建档与时间窗</h2>
        <span>GET /v1/operator/supply-health · 近 {s.windowDays} 天</span>
      </div>
      <div className="kpi-grid">
        {KPI("服务者档案", s.agents, "supply.agent_profiles")}
        {KPI("已激活", s.agentsActive, `草稿 ${s.agentsDraft.toLocaleString()}`)}
        {KPI(`近 ${s.windowDays} 天新建档`, s.agentsNewInWindow, "created_at 在窗口内")}
        {KPI("配过时间窗", s.agentsWithAvailability, share(s.agentsWithAvailability, s.agents))}
        {KPI("现在还有未过期窗", s.agentsWithOpenWindow, "跟「配过」是两个数，别合成一个")}
        {KPI("填了简介", s.agentsWithBio, share(s.agentsWithBio, s.agents))}
        {KPI("写了语种", s.agentsWithLanguages, "languages 是非空 JSONB 数组")}
      </div>

      <div className="section-title"><h2>核验 · 按 agent_id 数</h2><span>seller_real_name_verifications · capability_verifications</span></div>
      <div className="kpi-grid">
        {KPI("实名核验通过", s.realNameVerified, "未过期 · distinct agent_id")}
        {KPI("实名核验过期", s.realNameExpired, "过期也是事实，不并进通过数")}
        {KPI("能力核验通过", s.capabilityVerified, "distinct agent_id")}
        {KPI("窗口内被下过单", s.agentsWithOrders, `窗口内 ${s.ordersInWindow.toLocaleString()} 张单 · 只对得上档案的那些`)}
      </div>

      <div className="section-title"><h2>需求侧 · 为什么这里没有供需比</h2><span>demand.task_drafts · demand.tasks · citycompanion.needs</span></div>
      <div className="kpi-grid">
        {KPI("需求草稿", s.demandTaskDrafts, "demand.task_drafts")}
        {KPI("正式任务", s.demandTasks, "demand.tasks")}
        {KPI("同城需求", s.cityCompanionNeeds, "citycompanion.needs")}
        <div className="kpi">
          <div className="label">供需比</div>
          <div className="value">不算</div>
          <div className="meta">理由见下方说明</div>
        </div>
      </div>

      {data.notes?.map((n) => <div className="notice" key={n} style={{ marginBottom: 6 }}>{n}</div>)}
      {data.missingNotes?.map((n) => <div className="notice" key={n} style={{ marginBottom: 6, opacity: 0.85 }}>{n}</div>)}
    </>
  );
}
