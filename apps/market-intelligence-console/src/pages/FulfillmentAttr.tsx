import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";

// OPS-ATTRIBUTION-AUDIT-001（2026-10-07）：这一页原来**打不开**（读 data.attribution，
// 桩不发这个字段 ⇒ TypeError），而且逐单归因明细今天造不出来 ——
// decision→曝光→撮合→成交的链在**键**这一层没接上。
// 所以不给明细表，给三段键审计：每段一个数，谁把键接上了数就会动。
type Payload = {
  dataSource?: string;
  missing?: string;
  windowDays?: number;
  segments?: {
    decisionToExposure?: { events: number; attributable: number };
    matchingToOrder?: { batches: number; batchesWithNeed: number; orders: number; ordersWithNeed: number; joinedKeys: number };
    outcome?: { rows: number };
  };
  notes?: string[];
};

export function FulfillmentAttr() {
  const [d, setD] = useState<Payload | null>(null);
  useEffect(() => { opFetch("/v1/operator/fulfillment-attribution").then(setD).catch(() => {}); }, []);
  if (!d) return <div className="notice">加载 Fulfillment Attribution…</div>;
  if (d.dataSource !== "LIVE" || !d.segments) {
    return <div className="notice"><b>未接入：</b>{d.missing ?? "没有数据源"}</div>;
  }
  const s = d.segments;
  const e = s.decisionToExposure ?? { events: 0, attributable: 0 };
  const m = s.matchingToOrder ?? { batches: 0, batchesWithNeed: 0, orders: 0, ordersWithNeed: 0, joinedKeys: 0 };
  const o = s.outcome ?? { rows: 0 };
  const seg = (broken: boolean) => ({ borderLeft: broken ? "3px solid #d64545" : "3px solid #2a9d5c", paddingLeft: 10 });

  return (
    <>
      <div className="section-title">
        <h2>归因链 · 键审计</h2>
        <span>不给逐单明细 —— 链在键这层没接上，明细今天造不出来</span>
      </div>
      <div className="research-grid">
        <div className="research-card">
          <h3>① 决策 → 曝光</h3>
          <p style={seg(e.attributable === 0)}>
            {e.attributable.toLocaleString()} / {e.events.toLocaleString()} 条曝光带 recommendation_request_id
          </p>
          <span className={`stage ${e.attributable === 0 ? "lab" : "prod"}`}>{e.attributable === 0 ? "断" : "通"}</span>
        </div>
        <div className="research-card">
          <h3>② 撮合 ↔ 成交</h3>
          <p style={seg(m.joinedKeys === 0)}>
            批次 {m.batches.toLocaleString()}（带 need_id {m.batchesWithNeed.toLocaleString()}）×
            订单 {m.orders.toLocaleString()}（带 need_id {m.ordersWithNeed.toLocaleString()}），
            need_id 交集 {m.joinedKeys.toLocaleString()}
          </p>
          <span className={`stage ${m.joinedKeys === 0 ? "lab" : "prod"}`}>{m.joinedKeys === 0 ? "断" : "通"}</span>
        </div>
        <div className="research-card">
          <h3>③ 结果落库</h3>
          <p style={seg(o.rows === 0)}>outcome.* 五张表共 {o.rows.toLocaleString()} 行</p>
          <span className={`stage ${o.rows === 0 ? "lab" : "prod"}`}>{o.rows === 0 ? "断" : "通"}</span>
        </div>
      </div>

      {(d.notes ?? []).map((n, i) => (
        <div className="notice" key={i} style={{ marginTop: 8 }}>{n}</div>
      ))}
    </>
  );
}
