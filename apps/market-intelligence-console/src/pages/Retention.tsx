import { useEffect, useState } from "react";
import { opFetch } from "../lib/api";

// OPS-RETENTION-001：留存与复购。
//
// 原来这一页是个一行的原型残骸：它读 `d.retention`（一个 string→string 的表）和
// `d.cohorts`（画柱子用的同期群留存），而后端给的是 NOT_CONNECTED —— 于是页面永远停在
// 「加载中/空」。现在接真读模型。
//
// 这一页刻意**没有**两个东西，而且原因写在后端带上来的 notes 里：
//   · 同期群留存率：库里窗口内的下单人，在窗口之前下过单的是 0 个 —— 没有前期人群就
//     没有可比的两期，摆一个「100% 留存」不是疏忽，是编数据。
//   · 回访百分比：前一个 14 天窗口只有个位数活跃的人，任何百分比都是噪声，所以读模型
//     里根本没有 returnedRate 这个字段，这里只摆人数。
// 「30D 复购」是**同一个需求方在窗口内下过 ≥2 张单**，不是金额复购（支付没接）。

type Retention = {
  windowDays: number; orders: number; requesters: number; repeatRequesters: number;
  repeatRequesterRate: number; samePairRepeatGroups: number; agentsWithOrders: number;
  completed: number; cancelled: number; lifecycle: Record<string, number>;
  activeLast14d: number; activePrev14d: number; returnedUsers: number;
  priorWindowRequesters: number;
};
type Payload = { dataSource: string; windowDays: number; retention: Retention; notes: string[] };

const LIFECYCLE_ORDER = ["OFFERED", "CONFIRMED", "EXECUTING", "COMPLETED", "CANCELLED"];
const LIFECYCLE_LABEL: Record<string, string> = {
  OFFERED: "已报价待接受", CONFIRMED: "已确认（未开工）", EXECUTING: "进行中",
  COMPLETED: "已完成履约", CANCELLED: "已取消",
};

export function Retention() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    opFetch<Payload>("/v1/operator/retention").then(setData).catch(() => {});
  }, []);
  if (!data) return <div className="notice">加载留存与复购…</div>;

  const r = data.retention;
  const states = Object.keys(r.lifecycle ?? {}).sort(
    (a, b) => LIFECYCLE_ORDER.indexOf(a) - LIFECYCLE_ORDER.indexOf(b));
  const maxState = states.reduce((m, s) => Math.max(m, r.lifecycle[s] ?? 0), 0);

  return (
    <>
      <div className="section-title">
        <h2>复购与履约 · 只算有事实来源的</h2>
        <span>GET /v1/operator/retention · 近 {r.windowDays} 天</span>
      </div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">下单的人</div><div className="value">{r.requesters.toLocaleString()}</div><div className="meta">{r.orders.toLocaleString()} 张单</div></div>
        <div className="kpi"><div className="label">重复下单的人</div><div className="value">{r.repeatRequesters.toLocaleString()}</div><div className="meta">窗口内 ≥2 张单</div></div>
        <div className="kpi">
          <div className="label">复购率</div>
          <div className="value">{r.requesters > 0 ? `${r.repeatRequesterRate}%` : "—"}</div>
          <div className="meta">分母是窗口内下过单的人（{r.requesters.toLocaleString()}），不是全体用户</div>
        </div>
        <div className="kpi"><div className="label">回头找她</div><div className="value">{r.samePairRepeatGroups.toLocaleString()}</div><div className="meta">同一（需求方 × 服务者）≥2 单</div></div>
        <div className="kpi"><div className="label">有单的服务者</div><div className="value">{r.agentsWithOrders.toLocaleString()}</div><div className="meta">distinct agent_id</div></div>
        <div className="kpi"><div className="label">走完履约</div><div className="value">{r.completed.toLocaleString()}</div><div className="meta">COMPLETED · 取消 {r.cancelled.toLocaleString()}</div></div>
        <div className="kpi">
          <div className="label">同期群留存</div>
          <div className="value">算不出来</div>
          <div className="meta">窗口内 {r.requesters.toLocaleString()} 个下单人里，窗口前下过单的只有 {r.priorWindowRequesters.toLocaleString()} 个</div>
        </div>
        <div className="kpi">
          <div className="label">金额复购 / 客单</div>
          <div className="value">未接入</div>
          <div className="meta">支付没接，金额没有事实来源</div>
        </div>
      </div>

      <div className="section-title"><h2>订单停在哪个状态</h2><span>fulfillment.orders.lifecycle · 真实分布</span></div>
      {states.length === 0 ? <div className="notice">窗口内没有任何订单。</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>状态</th><th className="numc">单数</th><th className="numc">占比</th></tr></thead>
            <tbody>
              {states.map((s) => (
                <tr key={s}>
                  <td>{LIFECYCLE_LABEL[s] ?? s}<div style={{ color: "#8a8190", fontSize: 11 }}>{s}</div></td>
                  <td className="numc">{r.lifecycle[s].toLocaleString()}</td>
                  <td className="numc">
                    <div className="track" style={{ width: 120, display: "inline-block" }}>
                      <div className="bar" style={{ width: `${maxState > 0 ? Math.round((r.lifecycle[s] / maxState) * 100) : 0}%` }} />
                    </div>
                    {r.orders > 0 ? `${Math.round((r.lifecycle[s] / r.orders) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title"><h2>回访（只给人数）</h2><span>localnet.interaction_events · actor_id</span></div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">近 14 天活跃</div><div className="value">{r.activeLast14d.toLocaleString()}</div><div className="meta">有行为事件的独立 actor</div></div>
        <div className="kpi"><div className="label">前一个 14 天活跃</div><div className="value">{r.activePrev14d.toLocaleString()}</div><div className="meta">同一口径的前一期</div></div>
        <div className="kpi"><div className="label">两期都活跃</div><div className="value">{r.returnedUsers.toLocaleString()}</div><div className="meta">故意不给百分比 —— 理由见下方说明</div></div>
      </div>

      {data.notes?.map((n) => <div className="notice" key={n} style={{ marginBottom: 6 }}>{n}</div>)}
    </>
  );
}
