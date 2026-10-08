import { useEffect, useState } from "react";
import { opFetch } from "../lib/api";

// OPS-INSIGHT-001（2026-10-08）：需求缺口 —— 一段时间里发出去的单走到哪、哪一片没人接。
//
// 口径全部来自 apps/api-go/internal/insight 的 DemandGap（SQL 写在该包注释里），
// 这里的数字不自己重算，notes 也逐条照抄后端给的。两条页面必须守住的规矩：
//   - **不给供需比**。需求和供给是两种东西，要除得先定义按哪个品类除；混在一起除出来的
//     那个数会被当成「缺多少」，而它其实什么都不代表。所以两侧只并排摆。
//   - 片区是 0.1° 网格（约 11km），不是行政区；点名邀约的私单不算「没人接」。
//
// 中位分钟后端给 null 时显示「—」：null 的意思是这段时间一条报名都没有，
// 写成 0 分等于说「一秒就有人报名」——那是编数据。

type Funnel = {
  published: number; withApplicant: number; confirmed: number; unfilled24h: number;
  medianMinutesToFirstApplicant: number | null;
};
type ThemeRow = {
  theme: string; published: number; withApplicant: number; confirmed: number;
  medianMinutesToFirstApplicant: number | null;
};
type AreaRow = { cell: string; demand: number; supply: number; noSupply: boolean; unfilled24h: number };
type UnfilledOpp = {
  id: string; theme: string; title: string; priceLabel: string;
  cell: string; matchingMode: string; createdAt: string; ageHours: number;
};
type Gap = {
  windowDays: number; funnel: Funnel; themes: ThemeRow[]; areas: AreaRow[];
  noLocation: number; directedExcluded: number; unfilled: UnfilledOpp[];
};
type Payload = { dataSource: string; demand?: Gap; notes?: string[]; missing?: string };

const WINDOWS = [7, 30, 90];
const DASH = "—";
const META = { color: "#8a8190", whiteSpace: "normal" } as const;

const mins = (v: number | null): string => (v == null ? DASH : `${v.toFixed(1)} 分`);
const hrs = (h: number): string => (h >= 48 ? `${(h / 24).toFixed(1)} 天` : `${h.toFixed(1)} 小时`);
// matchingMode 只可能是 FAST 或空（marketplace.normalizeMatchingMode），空不是「别的模式」而是没设。
const MODE: Record<string, string> = { FAST: "快速发单" };
const mode = (m: string): string => (m ? MODE[m] ?? m : DASH);

export function DemandGap() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    setData(null);
    opFetch<Payload>(`/v1/operator/demand-gap?days=${days}`).then(setData).catch(() => {});
  }, [days]);

  if (data && data.dataSource !== "LIVE") {
    return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;
  }

  const gap = data?.demand;
  const notes = data?.notes ?? [];

  return (
    <>
      <div className="section-title">
        <h2>需求缺口 · 发出去的单有没有人接</h2>
        <span>GET /v1/operator/demand-gap · 只数公开发出的单</span>
      </div>

      <div className="controls">
        {WINDOWS.map((d) => (
          <button key={d} onClick={() => setDays(d)}
            style={days === d ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>近 {d} 天</button>
        ))}
      </div>

      {notes.map((n, i) => <div className="notice" key={i} style={{ marginTop: i === 0 ? 0 : 8 }}>{n}</div>)}

      {!gap ? (
        <div className="notice" style={{ marginTop: 10 }}>加载近 {days} 天的需求缺口数据…</div>
      ) : (
        <>
          <div className="kpi-grid" style={{ marginTop: 10 }}>
            <div className="kpi"><div className="label">发出</div><div className="value">{gap.funnel.published}</div><div className="meta">窗口内公开发出的单</div></div>
            <div className="kpi"><div className="label">有人报名</div><div className="value">{gap.funnel.withApplicant}</div><div className="meta">至少有一个报名</div></div>
            <div className="kpi"><div className="label">已选定</div><div className="value" style={{ color: "#2e9d5b" }}>{gap.funnel.confirmed}</div><div className="meta">报名的人被确认了</div></div>
            <div className="kpi"><div className="label">24 小时没人理</div><div className="value" style={gap.funnel.unfilled24h ? { color: "#d9534f" } : undefined}>{gap.funnel.unfilled24h}</div><div className="meta">发出超过 24 小时、零报名</div></div>
            <div className="kpi"><div className="label">首个报名中位</div><div className="value">{mins(gap.funnel.medianMinutesToFirstApplicant)}</div><div className="meta">发出到第一个报名的中位数</div></div>
          </div>

          <div className="section-title">
            <h2>按主题</h2>
            <span>同一个主题内部比，不同主题的人数不可比</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>主题</th><th className="numc">发出</th><th className="numc">有人报名</th><th className="numc">已选定</th><th className="numc">首个报名中位</th></tr></thead>
              <tbody>
                {gap.themes.length === 0
                  ? <tr><td>{DASH}</td><td className="numc" colSpan={4} style={META}>窗口内没有公开发出的单</td></tr>
                  : gap.themes.map((t) => (
                    <tr key={t.theme}>
                      <td><b>{t.theme}</b></td>
                      <td className="numc">{t.published}</td>
                      <td className="numc">{t.withApplicant}</td>
                      <td className="numc">{t.confirmed}</td>
                      <td className="numc">{mins(t.medianMinutesToFirstApplicant)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="section-title">
            <h2>按片区</h2>
            <span>需求与供给并排给出，不给比值 · 无供给的片区排在前面</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>片区</th><th className="numc">需求</th><th className="numc">供给</th><th className="numc">24h 没人理</th></tr></thead>
              <tbody>
                {gap.areas.length === 0
                  ? <tr><td>{DASH}</td><td className="numc" colSpan={3} style={META}>窗口内没有带坐标的单，片区无从谈起</td></tr>
                  : gap.areas.map((a) => (
                    <tr key={a.cell}>
                      <td>
                        {a.cell}
                        {a.noSupply ? <span className="badge bad" style={{ marginLeft: 6 }}>无供给</span> : null}
                      </td>
                      <td className="numc">{a.demand}</td>
                      <td className="numc">{a.supply}</td>
                      <td className="numc" style={a.unfilled24h ? { color: "#d9534f" } : undefined}>{a.unfilled24h}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="section-title">
            <h2>没人接的单</h2>
            <span>发出超过 24 小时、一个报名都没有的单</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>单</th><th>主题</th><th>标题</th><th className="numc">价格</th><th>片区</th><th className="numc">已等</th><th>模式</th></tr></thead>
              <tbody>
                {gap.unfilled.length === 0
                  ? <tr><td>{DASH}</td><td colSpan={6} style={META}>窗口内没有超过 24 小时没人报名的单</td></tr>
                  : gap.unfilled.map((u) => (
                    <tr key={u.id}>
                      <td><b>{u.id}</b></td>
                      <td>{u.theme || DASH}</td>
                      <td style={META}>{u.title || DASH}</td>
                      <td className="numc">{u.priceLabel || DASH}</td>
                      <td>{u.cell || DASH}</td>
                      <td className="numc">{hrs(u.ageHours)}</td>
                      <td>{mode(u.matchingMode)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
