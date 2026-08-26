import { useEffect, useState } from "react";

type Payload = { attribution: Array<{ order_id: string; decision_id: string; surface_plan_id: string; delta_id: string; outcome: string; channel: string }>; record_example: string };

export function FulfillmentAttr() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => { fetch("/v1/operator/fulfillment-attribution").then((r) => r.json()).then(setData).catch(() => {}); }, []);
  if (!data) return <div className="notice">加载 Fulfillment Attribution…</div>;
  return (
    <>
      <div className="attribution-record">{data.record_example}</div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table><thead><tr><th>Order</th><th>Decision</th><th>SurfacePlan</th><th>Delta</th><th>Outcome</th><th>Channel</th></tr></thead><tbody>{data.attribution.map((a) => <tr key={a.order_id}><td>{a.order_id}</td><td>{a.decision_id}</td><td>{a.surface_plan_id}</td><td>{a.delta_id}</td><td><span className={`badge ${a.outcome === "FULFILLED" ? "good" : "bad"}`}>{a.outcome}</span></td><td>{a.channel}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
