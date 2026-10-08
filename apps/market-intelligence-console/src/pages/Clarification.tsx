import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";

// OPS-CONSOLE-PAGES-001（2026-10-07）：这一页原来**打不开**（`data.gates.map(...)`，
// 桩不发 gates ⇒ TypeError）。
//
// 澄清门的**判定策略**（追问什么、PASS / CLARIFY / BLOCK 怎么判）确实没实现，那部分
// 继续不给数。但它的**产出**是有的：demand.task_drafts 就是澄清过程中逐步补齐的那份
// 草案（lifecycle COMMITTED = 用户确认并发布），demand.tasks 是 PublishTask 落的
// canonical 行。所以这一页给的是澄清门的漏斗，不是它的策略。
//
// 最有价值的两个数是 DraftsWithBatch / DraftsWithOrder：草案 id 有没有真的往下走。
// 本机实测两条回连都是 0 —— 那不是「转化差」，是键这一层没接上。把断链做成一个
// **数**放在页面上，谁把键接上了它会动；谁只是改了措辞，它不动。
type Payload = {
  dataSource?: string;
  missing?: string;
  windowDays?: number;
  funnel?: {
    drafts: number;
    draftsOpen: number;
    draftsCommitted: number;
    canonicalTasks: number;
    draftsWithBatch: number;
    draftsWithOrder: number;
    needs: number;
  };
  notes?: string[];
};

export function Clarification() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => { opFetch("/v1/operator/clarification-gate").then(setData).catch(() => {}); }, []);
  if (!data) return <div className="notice">加载 Clarification Gate…</div>;
  // 以前读 data.gates 会整页崩 —— 这里先挡住 NOT_CONNECTED。
  if (data.dataSource !== "LIVE" || !data.funnel) {
    return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;
  }
  const f = data.funnel;
  const rows: Array<[string, number, string]> = [
    ["澄清草案（全量）", f.drafts, "demand.task_drafts"],
    ["还在草稿", f.draftsOpen, "lifecycle ≠ COMMITTED"],
    ["已 COMMITTED", f.draftsCommitted, "用户确认并发布"],
    ["canonical task", f.canonicalTasks, "PublishTask 落的 demand.tasks"],
    ["→ 进过撮合批次", f.draftsWithBatch, "id 出现在 candidate_batches.need_id"],
    ["→ 进过订单", f.draftsWithOrder, "id 出现在 orders.need_id"],
    ["同城需求（另一条入口）", f.needs, "citycompanion.needs"],
  ];

  return (
    <>
      <div className="section-title">
        <h2>Clarification Gate · 产出漏斗</h2>
        <span>全量口径 —— demand.task_drafts 没有 created_at</span>
      </div>
      <div className="notice" style={{ marginBottom: 10 }}>
        澄清门的<b>判定策略</b>（追问什么、什么时候 PASS / CLARIFY / BLOCK）没有实现 ——
        这一页数的是它的产出，不是它的过程。
      </div>
      <div className="card">
        <h3>漏斗</h3>
        {rows.map(([stage, n, src]) => (
          <div key={stage} className="funnel-row">
            <div className="name">{stage}</div>
            <div className="track"><div className="bar" style={{ width: f.drafts > 0 ? `${Math.min(100, (n / f.drafts) * 100)}%` : "0%" }} /></div>
            <div className="num">{n.toLocaleString()}</div>
            <div className="d" style={{ marginLeft: 8 }}>{src}</div>
          </div>
        ))}
      </div>
      {(data.notes ?? []).map((n, i) => (
        <div className="notice" key={i} style={{ marginTop: 8 }}>{n}</div>
      ))}
    </>
  );
}
