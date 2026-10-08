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
//
// OPS-DATA-ENV-001（2026-10-08）把复购率从这一页拿掉了 —— 但只拿掉它。这台库里 fulfillment.orders 的
// 860 张单没有一张是生意：168 张是 Go 集成测试直接 INSERT 的（对不上任何账号），692 张出自
// scripts/*-e2e.sh（走真 API、建真账号、下真订单）。按「对得上账号」筛分母只筛得掉前一类，
// 于是筛完显示 93.8% 复购率，把 48 个循环变量说成了 48 个客户。
//
// 计数留下（「291 张单、150 张连账号都没有」在哪个库上都是事实），比率改成 nullable：
// 服务端没声明 PROXY_OPERATOR_DATA_ENV=production 就回 null，界面显示「不给数」。
// 整页 NOT_CONNECTED 是试过又改掉的做法 —— 它会把控制台里每个引用这一页的地方一起抹掉，
// 平台总览整页就是这么变空的。
type Retention = {
  windowDays: number; orders: number; requesters: number; repeatRequesters: number;
  // null = 这一轮不给比率（分母是 0，或数据环境没声明成 production）。
  // 不是 0：0 会被读成「复购率 0%」，那是一个结论，而这里的事实是「没有事实来源」。
  repeatRequesterRate: number | null;
  samePairRepeatGroups: number; agentsWithOrders: number;
  completed: number; cancelled: number; lifecycle: Record<string, number>;
  activeLast14d: number; activePrev14d: number; returnedUsers: number;
  priorWindowRequesters: number;
  // 可归因性：请求方在 identity.user_accounts 里查不到的那些**一定不是生意**；
  // 反过来不成立 —— 能追溯到账号排不掉脚本建的账号。
  ordersAttributable: number; ordersUnattributed: number;
  realRequesters: number; realRepeatRequesters: number;
};
type Payload = {
  dataSource: string; dataEnv?: string; ratesPublished?: boolean;
  windowDays: number; retention: Retention; notes: string[];
};

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
        {/* 这一组只算**请求方能追溯到账号**的订单：这台库里大量行是测试留下的（订单永不硬删），
            把它们算进分母就是在给测试数据算复购率。但要写清楚这一步排得掉什么、排不掉什么：
            脚本走的也是真 API、建的是真账号，所以「对得上账号」不等于「是真人」。全量对照数摆在
            下面的格子里，不藏。 */}
        <div className="kpi"><div className="label">下单的人（能追溯到账号）</div><div className="value">{r.realRequesters.toLocaleString()}</div><div className="meta">{r.ordersAttributable.toLocaleString()} 张单在 identity.user_accounts 里查得到请求方</div></div>
        <div className="kpi"><div className="label">重复下单的人</div><div className="value">{r.realRepeatRequesters.toLocaleString()}</div><div className="meta">窗口内 ≥2 张单</div></div>
        <div className="kpi">
          <div className="label">复购率</div>
          {/* null 是一个状态，不是一个数：显示成「不给数」而不是 0%，也不把上一轮的数留着。 */}
          <div className="value">{r.repeatRequesterRate === null ? "不给数" : `${r.repeatRequesterRate}%`}</div>
          <div className="meta">{r.repeatRequesterRate === null
            ? `缺 ${data.dataEnv ? `数据环境声明（当前 ${data.dataEnv}）` : "PROXY_OPERATOR_DATA_ENV=production"}`
            : `分母 = ${r.realRequesters.toLocaleString()} 个能追溯到账号的下单人（不是全体用户，也不是含测试行的 ${r.requesters.toLocaleString()}）`}</div>
        </div>
        <div className="kpi">
          <div className="label">查不到请求方的订单</div>
          <div className="value">{r.ordersUnattributed.toLocaleString()}</div>
          <div className="meta">账号都不存在 → 一定不是生意 · 已从上面的分母里排除</div>
        </div>
        <div className="kpi"><div className="label">回头找她</div><div className="value">{r.samePairRepeatGroups.toLocaleString()}</div><div className="meta">同一（需求方 × 服务者）≥2 单 · 全量口径含测试行</div></div>
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
