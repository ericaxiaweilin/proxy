import { useEffect, useState } from "react";
import { fetchExperienceMetrics, opFetch, type ExperienceMetrics } from "../lib/api";

// OPS-REAL-001（2026-09-23）把 17 个 /v1/operator/* 端点里的假数字清成了
// NOT_CONNECTED，但这一页漏了：North Star 六个 KPI 连同「↑12.8%」这种假趋势是
// 写死在 JSX 里的，一个请求都不发 —— 而且它是默认落地页，**没登录也能看到**。
// 本页原来的注释自己就写着「假的健康度比没有健康度更糟：它让人停止怀疑」。
//
// OPS-NORTH-STAR-001（2026-10-07）补上后半段：那四个格子（有效意图 / 成功撮合 /
// 完成履约 / 负反馈率）原来是一个写死的常量，永远显示「未接入」，跟库里有没有数
// 没关系 —— 用户：「不存在就建 不然怎么后台运营」。现在走 /v1/operator/north-star，
// 每个格子带**口径**（这个数是什么）和**缺口**（哪一半没给、为什么）。
//
// 关键是：四个格子里有两个的「完整含义」今天给不出来（成功撮合缺成交归因、
// 完成履约缺成交额），所以它们显示的是**一半的真数 + 一句说明**，而不是一个
// 看起来完整的假数，也不是一句笼统的「未接入」。口径写在同一个响应里，
// 页面被拆散的时候数字和它的边界不会分开传播。
type Population = { kpis: Record<string, number>; windowDays: number; genderMissing?: string };
type Behavior = { events: Record<string, number>; windowDays: number; topInterestMissing?: string };
// OPS-RETENTION-001：复购这一格以前在「未接入」那一列里，现在接的是真读模型。
// OPS-DATA-ENV-001：repeatRequesterRate 是 number | null —— null 表示「这一轮不给比率」
// （数据环境没声明成生产，或分母是 0）。这一格必须跟着显示「不给数」，不能显示 0%：
// 这一页是默认落地页，一个假的百分比比空白传播得更远。
type Retention = { dataSource: string; dataEnv?: string; retention: { windowDays: number; requesters: number; repeatRequesters: number; realRequesters: number; realRepeatRequesters: number; repeatRequesterRate: number | null } };

// OPS-NORTH-STAR-001：value 为 null = 这一格不给数（分母不够 / 口径不成立），
// 此时 notes 会说清为什么。空着的格子必须是有原因的。
type NorthStarTile = {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  dataSource: string;
  definition: string;
  meta: string;
  notes?: string[] | null;
};
type NorthStar = { dataSource: string; windowDays: number; tiles: NorthStarTile[] };

const EVENT_LABEL: Record<string, string> = {
  exposures: "曝光", deep_view: "深度浏览", zooms: "放大看图", profile_opens: "打开主页",
  strong_positive: "强正向（赞/藏/转）", weak_negative: "弱负向（减少推荐）", strong_negative: "强负向（举报/屏蔽）",
};

// LIVE = 整格都是真数；PARTIAL = 有真数，但这一格想表达的完整含义缺一半
// （今天只有「成功撮合」：找到供给是真的，成交归因不是）。用词跟后端对齐。
const SOURCE_LABEL: Record<string, { text: string; cls: string }> = {
  LIVE: { text: "真数", cls: "badge good" },
  PARTIAL: { text: "只给一半", cls: "badge warn" },
  NOT_CONNECTED: { text: "未接入", cls: "badge bad" },
};

function tileValue(t: NorthStarTile): string {
  if (t.value === null || t.value === undefined) return "—";
  const n = t.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return t.unit === "%" ? `${n}%` : t.unit ? `${n} ${t.unit}` : n;
}

export function Overview() {
  const [metrics, setMetrics] = useState<ExperienceMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pop, setPop] = useState<Population | null>(null);
  const [behavior, setBehavior] = useState<Behavior | null>(null);
  const [ret, setRet] = useState<Retention | null>(null);
  const [north, setNorth] = useState<NorthStar | null>(null);

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
    opFetch<NorthStar>("/v1/operator/north-star").then(setNorth).catch(() => {});
  }, []);

  // 所有格子的说明收在一起，按格子分组。它们不是装饰 —— 没有这些句子，
  // 「成功撮合 5」会被读成生意上的撮合成功，而它其实是「引擎跑出了 5 批候选」。
  const northNotes = (north?.tiles ?? [])
    .map((t) => ({ label: t.label, notes: t.notes ?? [] }))
    .filter((g) => g.notes.length > 0);

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
        {/* OPS-RETENTION-001：口径是「同一个需求方近 30 天 ≥2 张单」。分母用**能追溯到账号**的
            下单人（realRequesters），跟上面那个百分比是同一个分母 —— 分子分母各用一个口径，
            读的人就会拿 117/196 去对 22.9%。同期群留存不在这里：库里窗口前没有可比人群，硬算就是编。 */}
        <div className="kpi">
          <div className="label">30D 复购（需求方）</div>
          <div className="value">{ret ? (ret.retention.repeatRequesterRate === null ? "不给数" : `${ret.retention.repeatRequesterRate}%`) : "—"}</div>
          <div className="meta">
            {ret ? `${ret.retention.realRepeatRequesters.toLocaleString()} / ${ret.retention.realRequesters.toLocaleString()} 个能追溯到账号的下单人 · GET /v1/operator/retention` : "GET /v1/operator/retention"}
          </div>
        </div>
        {/* OPS-NORTH-STAR-001：这四个格子以前是写死的常量。现在每个格子带口径 + 缺口，
            缺的那一半在下面的说明里写明白 —— 不编一个看起来完整的数。 */}
        {(north?.tiles ?? []).map((t) => {
          const src = SOURCE_LABEL[t.dataSource] ?? { text: t.dataSource, cls: "badge" };
          return (
            <div className="kpi" key={t.key}>
              <div className="label">
                {t.label} <span className={src.cls}>{src.text}</span>
              </div>
              <div className="value">{tileValue(t)}</div>
              <div className="meta">{t.meta}</div>
              <div className="meta" style={{ marginTop: 3 }}>{t.definition}</div>
            </div>
          );
        })}
        {north === null ? <div className="notice">加载 North Star 四个格子…</div> : null}
      </div>
      {pop?.genderMissing ? <div className="notice" style={{ marginBottom: 8 }}>{pop.genderMissing} —— 所以这里不放性别构成，不是 0，是没采集。</div> : null}
      {northNotes.map((g) => (
        <div className="notice" key={g.label} style={{ marginTop: 8 }}>
          <b>{g.label}：</b>
          {g.notes.map((n, i) => <div key={i}>{n}</div>)}
        </div>
      ))}

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
        <span className="engine-link">/v1/operator/north-star</span>、
        <span className="engine-link">/v1/experience/metrics</span> 是真实来源。
        North Star 四个格子标「只给一半」的，是「这一半有来源、另一半没有」——
        缺哪一半写在该格子的说明里，不编一个看起来完整的数。
      </div>
    </>
  );
}
