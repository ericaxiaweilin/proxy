import { useEffect, useState } from "react";
import { opFetch } from "../lib/api";

// MARKET-FAST-001：市场发单看板 —— 快速模式的市场单「一段时间内」表现如何。
//
// 派单调度那一页回答的是**现在**：哪张单卡在哪一步、为什么。这一页回答的是**一段时间内**：
// 平台代选出去的单成得了多少、成不了的时候卡在「没人报名」还是「报名的人不接」、
// 没人报名时主动邀请附近的人有没有用。
//
// 口径全部来自 dispatch.runs / dispatch.steps / marketplace.applications，一条 SQL 一组，
// 写在 apps/api-go/internal/dispatch/postgres_market_stats.go 的 MarketStats 注释里，
// 这里的文案逐条照抄，不自己重算（界面算一遍就迟早和后端对不上）。
//
// 算不出来的数后端给 null，这里显示「—」：把「没有样本」显示成 0% 是编数据，
// 它会让运营以为「快速发单一单没成」，而真相常常只是这段时间没有单跑到终态。

type Stats = {
  running: number; assigned: number; exhausted: number; cancelled: number;
  waitingForApplicants: number;
  confirmRate: number | null;
  medianMinutesToAssign: number | null;
  selections: number; expired: number; expiryRate: number | null;
  invitations: number; invitedPeople: number;
  inviteSkipped: Record<string, number>;
  invitedThenApplied: number | null; invitedThenAppliedRate: number | null;
  ownerTookOver: number;
  since: string;
};
type BoardPayload = { dataSource: string; windowDays: number; stats?: Stats; notes?: string[] };

const WINDOWS = [7, 30, 90];
const DASH = "—";
// 表格里的说明列：td 默认 nowrap，这些句子必须能折行。
const META = { color: "#8a8190", whiteSpace: "normal" } as const;

const pct = (v: number | null): string => (v == null ? DASH : `${(v * 100).toFixed(1)}%`);
const mins = (v: number | null): string => (v == null ? DASH : `${v.toFixed(1)} 分`);
const num = (v: number | null): string => (v == null ? DASH : String(v));

// 跳过的原因：后端给的是机器原因码，这里翻成运营看得懂的一句话，未列出的照原样摆出来（不藏）。
const SKIP_REASON: Record<string, string> = {
  opportunity_has_no_location: "单子没有坐标",
  nobody_suitable_nearby: "附近没有可邀请的人",
};
const skipLabel = (reason: string): string => SKIP_REASON[reason] ?? `未列出的原因（${reason}）`;

// 每个数一句定义。改后端口径时这里必须一起改，否则页面会讲一个它并不在算的故事。
const DEFINITIONS = [
  "在派 / 已派成 / 待人工 / 已停止：窗口内建的快速发单 run 按状态各有多少条。",
  "确认率 = 已派成 ÷（已派成 + 待人工 + 已停止）：跑到终态的单里成得了多少；没有跑到终态的单就是「—」。",
  "中位成单时长：每条单「第一条被接的流水时刻 − 建单时刻」的中位数（分钟），没有一条被接过就是「—」。",
  "代选超时率 = 5 分钟内没被确认而顺延的次数 ÷ 平台代选出去的次数；一次代选算一次，没代选过就是「—」。",
  "等人报名：可选的人都试过了、平台停在等人报名的单数。",
  "邀请轮数 / 被邀人数：没人报名时平台主动邀请附近合适服务者的轮数与被邀到的人次。",
  "其中后来报名的人数与比例：被邀的人里后来真的报名了这份单的人数 / 被邀人次；没邀过人就是「—」。",
  "邀请没做成的原因：按流水里的原因码分组（单子没坐标 / 附近没有可邀请的人）。",
  "发单方自己选人：发单方没等平台代选、自己动手选了人的次数。",
];

export function MarketBoard() {
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<BoardPayload | null>(null);

  useEffect(() => {
    setData(null);
    opFetch<BoardPayload>(`/v1/operator/market-dispatch?days=${days}`).then(setData).catch(() => {});
  }, [days]);

  const stats = data?.stats;

  return (
    <>
      <div className="section-title">
        <h2>市场发单看板 · 快速发单在一段时间内成不成得了</h2>
        <span>GET /v1/operator/market-dispatch · 只数 kind=MARKET 的快速单</span>
      </div>

      <div className="controls">
        {WINDOWS.map((d) => (
          <button key={d} onClick={() => setDays(d)}
            style={days === d ? { background: "#fff", color: "#17131d", borderColor: "#17131d" } : undefined}>近 {d} 天</button>
        ))}
      </div>

      {!stats ? (
        <div className="notice">
          {data?.notes?.length ? data.notes.join(" · ") : `加载近 ${days} 天的市场发单数据…`}
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi"><div className="label">在派</div><div className="value">{stats.running}</div><div className="meta">正在等人报名或等人接</div></div>
            <div className="kpi"><div className="label">已派成</div><div className="value" style={{ color: "#2e9d5b" }}>{stats.assigned}</div><div className="meta">报名的人确认了</div></div>
            <div className="kpi"><div className="label">待人工</div><div className="value" style={stats.exhausted ? { color: "#d9534f" } : undefined}>{stats.exhausted}</div><div className="meta">报名的人都试过，没人接</div></div>
            <div className="kpi"><div className="label">已停止</div><div className="value">{stats.cancelled}</div><div className="meta">发单方取消 / 运营停止</div></div>
            <div className="kpi"><div className="label">确认率</div><div className="value">{pct(stats.confirmRate)}</div><div className="meta">已派成 ÷ 已到终态</div></div>
            <div className="kpi"><div className="label">中位成单时长</div><div className="value">{mins(stats.medianMinutesToAssign)}</div><div className="meta">从发单到有人确认</div></div>
            <div className="kpi"><div className="label">代选超时率</div><div className="value">{pct(stats.expiryRate)}</div><div className="meta">超时 {stats.expired} 次 / 代选 {stats.selections} 次</div></div>
            <div className="kpi"><div className="label">等人报名</div><div className="value">{stats.waitingForApplicants}</div><div className="meta">能选的都试过，在等新报名</div></div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3>邀请 · 没人报名时平台自己找人</h3>
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr>
                    <td>邀请轮数</td>
                    <td className="numc" style={{ width: 120 }}>{stats.invitations}</td>
                    <td style={META}>每轮最多邀 5 位附近合适的服务者（撮合排名顺序，不按距离）</td>
                  </tr>
                  <tr>
                    <td>被邀人数</td>
                    <td className="numc">{stats.invitedPeople}</td>
                    <td style={META}>人次：同一个人被多张单邀到会重复计（同一张单内不重复邀）</td>
                  </tr>
                  <tr>
                    <td>其中后来报名的人数</td>
                    <td className="numc">{num(stats.invitedThenApplied)}</td>
                    <td style={META}>
                      {stats.invitedThenAppliedRate == null ? "没邀过人，没有比例" : `占被邀人次 ${pct(stats.invitedThenAppliedRate)}`}
                    </td>
                  </tr>
                  <tr>
                    <td>发单方自己选人</td>
                    <td className="numc">{stats.ownerTookOver}</td>
                    <td style={META}>发单方不等平台代选、自己动手选了人，平台停手</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ fontWeight: 700, margin: "14px 0 6px" }}>邀请没做成的原因</div>
            <div className="table-wrap">
              <table>
                <tbody>
                  {Object.keys(stats.inviteSkipped).length === 0
                    ? <tr><td>{DASH}</td><td className="numc" style={{ width: 120 }}>{DASH}</td><td style={META}>这段时间没有邀请被跳过</td></tr>
                    : Object.entries(stats.inviteSkipped).map(([reason, n]) => (
                      <tr key={reason}>
                        <td>{skipLabel(reason)}</td>
                        <td className="numc">{n}</td>
                        <td style={{ color: "#8a8190", fontSize: 11 }}>{reason}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3>这些数怎么算</h3>
            <div style={{ fontSize: 10, color: "#6e6872", lineHeight: 1.7 }}>
              {DEFINITIONS.map((line) => <div key={line}>{line}</div>)}
            </div>
          </div>
        </>
      )}
    </>
  );
}