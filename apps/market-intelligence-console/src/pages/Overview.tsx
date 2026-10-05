import { useEffect, useState } from "react";
import { fetchExperienceMetrics, opFetch, type ExperienceMetrics } from "../lib/api";

// OPS-REAL-001（2026-09-23）把 17 个 /v1/operator/* 端点里的假数字清成了
// NOT_CONNECTED，但这一页漏了：North Star 六个 KPI 连同「↑12.8%」这种假趋势是
// 写死在 JSX 里的，一个请求都不发 —— 而且它是默认落地页，**没登录也能看到**。
// 本页原来的注释自己就写着「假的健康度比没有健康度更糟：它让人停止怀疑」。
//
// 现在：有真实来源的（用户构成、行为信号、复购、runtime 指标）走 opFetch，因此和别的
// 页面一样受运营门保护；没有来源的（有效意图 / 成功撮合 / 完成履约 / 负反馈率）
// 显示「未接入」并写明缺哪个模块，不编。
type Population = { kpis: Record<string, number>; windowDays: number; genderMissing?: string };
type Behavior = { events: Record<string, number>; windowDays: number; topInterestMissing?: string };
// OPS-RETENTION-001：复购这一格以前在「未接入」那一列里，现在接的是真读模型
type Retention = { dataSource: string; retention: { windowDays: number; requesters: number; repeatRequesters: number; repeatRequesterRate: number } };

// 这些是规格里有、后端还没有对应模块的指标。列出来是为了让「空」是有原因的，
// 不是忘了画。
const NOT_CONNECTED: Array<[string, string]> = [
  ["有效意图", "intent-service（澄清门）"],
  ["成功撮合", "撮合结果归因（outcome-service）"],
  ["完成履约", "履约结算 —— 且支付未接入，成交额没有事实来源"],
  ["负反馈率", "负反馈熔断（§10）"],
];

const EVENT_LABEL: Record<string, string> = {
  exposures: "曝光", deep_view: "深度浏览", zooms: "放大看图", profile_opens: "打开主页",
  strong_positive: "强正向（赞/藏/转）", weak_negative: "弱负向（减少推荐）", strong_negative: "强负向（举报/屏蔽）",
};

export function Overview() {
  const [metrics, setMetrics] = useState<ExperienceMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pop, setPop] = useState<Population | null>(null);
  const [behavior, setBehavior] = useState<Behavior | null>(null);
  const [ret, setRet] = useState<Retention | null>(null);

  useEffect(() => {
    fetchExperienceMetrics().then(setMetrics).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    const id = setInterval(() => {
      fetchExperienceMetrics().then(setMetrics).catch(() => {});
    }, 8000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    opFetch<Population>("/v1/operator/population").then(setPop).catch(() => {});
    opFetch<Behavior>("/v1/operator/behavior").then(setBehavior).catch(() => {});
    opFetch<Retention>("/v1/operator/retention").then(setRet).catch(() => {});
  }, []);

  return (
    <>
      <div className="section-title">
        <h2>North Star · 有来源的才显示</h2>
        <span>{pop ? `用户构成：近 ${pop.windowDays} 天口径` : "加载用户构成…"}</span>
      </div>
      <div className="kpi-grid">
        {pop ? Object.entries(pop.kpis).map(([label, value]) => (
          <div className="kpi" key={label}>
            <div className="label">{label}</div>
            <div className="value">{value.toLocaleString()}</div>
            <div className="meta">GET /v1/operator/population</div>
          </div>
        )) : <div className="notice">加载用户构成…（这一页所有数字都来自真实查询，没有来源的只显示「未接入」）</div>}
        {/* OPS-RETENTION-001：口径是「同一个需求方近 30 天 ≥2 张单」，分母是窗口内下过单的人。
            同期群留存不在这里 —— 库里窗口前没有可比人群，硬算就是编。 */}
        <div className="kpi">
          <div className="label">30D 复购（需求方）</div>
          <div className="value">{ret && ret.retention.requesters > 0 ? `${ret.retention.repeatRequesterRate}%` : "—"}</div>
          <div className="meta">
            {ret ? `${ret.retention.repeatRequesters.toLocaleString()} / ${ret.retention.requesters.toLocaleString()} 个下单的人 · GET /v1/operator/retention` : "GET /v1/operator/retention"}
          </div>
        </div>
        {NOT_CONNECTED.map(([label, missing]) => (
          <div className="kpi" key={label}>
            <div className="label">{label}</div>
            <div className="value">未接入</div>
            <div className="meta">缺：{missing}</div>
          </div>
        ))}
      </div>
      {pop?.genderMissing ? <div className="notice" style={{ marginBottom: 8 }}>{pop.genderMissing} —— 所以这里不放性别构成，不是 0，是没采集。</div> : null}

      <div className="section-title">
        <h2>行为信号</h2>
        <span>{behavior ? `近 ${behavior.windowDays} 天真实事件数` : "加载行为信号…"}</span>
      </div>
      <div className="engine-status">
        {behavior ? Object.entries(behavior.events).map(([k, v]) => (
          <div className="engine-mini" key={k}>
            <div className="k">{EVENT_LABEL[k] ?? k}</div>
            <div className="v">{v.toLocaleString()}</div>
            <div className="d">GET /v1/operator/behavior</div>
          </div>
        )) : <div className="notice">加载行为信号…</div>}
      </div>
      {behavior?.topInterestMissing ? <div className="notice" style={{ marginTop: 8 }}>{behavior.topInterestMissing}</div> : null}

      <div className="section-title"><h2>Decision Engine Runtime — Live</h2><span>GET /v1/experience/metrics · 8s 轮询</span></div>
      {error ? <div className="notice"><b>未连接到 API：</b>{error}</div> : null}
      <div className="engine-status">
        <div className="engine-mini"><div className="k">Compile Count</div><div className="v">{metrics?.compile_count ?? "—"}</div><div className="d">SurfaceCompiler 调用</div></div>
        <div className="engine-mini"><div className="k">p50 / p95</div><div className="v">{metrics ? `${metrics.compile_latency_p50_ms} / ${metrics.compile_latency_p95_ms} ms` : "—"}</div><div className="d">target &lt; 200ms</div></div>
        <div className="engine-mini"><div className="k">Validation Fail</div><div className="v">{metrics?.validation_fail ?? "—"}</div><div className="d">Schema / Budget</div></div>
        <div className="engine-mini"><div className="k">Capability Fallback</div><div className="v">{metrics?.capability_fallback ?? "—"}</div><div className="d">旧端降级</div></div>
        <div className="engine-mini"><div className="k">Delta Apply / Reject</div><div className="v">{metrics ? `${metrics.delta_apply_success} / ${metrics.delta_reject}` : "—"}</div><div className="d">§13 版本守卫</div></div>
        <div className="engine-mini"><div className="k">NO_UI_CHANGE</div><div className="v">{metrics?.no_ui_change ?? "—"}</div><div className="d">合法无变化</div></div>
      </div>

      <div className="engine-inline" style={{ marginTop: 10 }}>
        本页不再有写死的数字：<span className="engine-link">/v1/operator/population</span>、
        <span className="engine-link">/v1/operator/behavior</span>、
        <span className="engine-link">/v1/operator/retention</span>、
        <span className="engine-link">/v1/experience/metrics</span> 是真实来源；
        规格里有、后端还没做的指标一律显示「未接入」并写明缺哪个模块。
      </div>
    </>
  );
}
