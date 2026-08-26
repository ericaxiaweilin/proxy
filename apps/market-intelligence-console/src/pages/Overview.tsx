import { useEffect, useState } from "react";
import { fetchExperienceMetrics, type ExperienceMetrics } from "../lib/api";

export function Overview() {
  const [metrics, setMetrics] = useState<ExperienceMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchExperienceMetrics().then(setMetrics).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    const id = setInterval(() => {
      fetchExperienceMetrics().then(setMetrics).catch(() => {});
    }, 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <div className="section-title"><h2>North Star</h2><span>从流量一直看到真实履约</span></div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">MAU</div><div className="value">186K</div><div className="meta delta up">↑ 12.8%</div></div>
        <div className="kpi"><div className="label">有效意图</div><div className="value">24.8K</div><div className="meta">13.3% of MAU</div></div>
        <div className="kpi"><div className="label">成功撮合</div><div className="value">8,612</div><div className="meta delta up">↑ 9.4%</div></div>
        <div className="kpi"><div className="label">完成履约</div><div className="value">5,218</div><div className="meta">60.6% of matches</div></div>
        <div className="kpi"><div className="label">30D 复购/复用</div><div className="value">38.4%</div><div className="meta delta up">↑ 3.1pp</div></div>
        <div className="kpi"><div className="label">负反馈率</div><div className="value">1.7%</div><div className="meta delta down">↓ 0.4pp</div></div>
      </div>

      <div className="section-title"><h2>Decision Engine Runtime — Live</h2><span>GET /v1/experience/metrics · 8s 轮询</span></div>
      {error ? <div className="notice"><b>未连接到 API：</b>{error} · 本页其余为原型 mock，Runtime 卡片为真实数据。</div> : null}
      <div className="engine-status">
        <div className="engine-mini"><div className="k">Compile Count</div><div className="v">{metrics?.compile_count ?? "—"}</div><div className="d">SurfaceCompiler 调用</div></div>
        <div className="engine-mini"><div className="k">p50 / p95</div><div className="v">{metrics ? `${metrics.compile_latency_p50_ms} / ${metrics.compile_latency_p95_ms} ms` : "—"}</div><div className="d">target &lt; 200ms</div></div>
        <div className="engine-mini"><div className="k">Validation Fail</div><div className="v">{metrics?.validation_fail ?? "—"}</div><div className="d">Schema / Budget</div></div>
        <div className="engine-mini"><div className="k">Capability Fallback</div><div className="v">{metrics?.capability_fallback ?? "—"}</div><div className="d">旧端降级</div></div>
        <div className="engine-mini"><div className="k">Delta Apply / Reject</div><div className="v">{metrics ? `${metrics.delta_apply_success} / ${metrics.delta_reject}` : "—"}</div><div className="d">§13 版本守卫</div></div>
        <div className="engine-mini"><div className="k">NO_UI_CHANGE</div><div className="v">{metrics?.no_ui_change ?? "—"}</div><div className="d">合法无变化</div></div>
      </div>

      <div className="engine-inline" style={{ marginTop: 10 }}>
        <b>Runtime 已接线：</b> Go `internal/experience/runtime` → <span className="engine-link">GET /v1/experience/metrics</span> → 本控制台。原型其余漏斗/趋势仍为 mock，待接 `market-intelligence` 真实 Read Model。
      </div>
    </>
  );
}
