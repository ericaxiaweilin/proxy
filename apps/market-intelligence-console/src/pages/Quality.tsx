import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";

// OPS-DATA-QUALITY-001（2026-10-07）：这一页原来**打不开**（读桩不发的两个假字段 ⇒
// TypeError）。给的是曝光谱系的体检报告：
// 每个谱系列的非空率（窗口内 + 全量）、谁在产生事件、时钟偏差、重复 id。
// 没有谱系图、没有修复操作 —— 谱系图要 request_id 先接上才画得出来。
type FieldCoverage = { field: string; window: string; filled: number; total: number; coverage: number };
type Dist = { value: string; count: number };
type Payload = {
  dataSource?: string;
  missing?: string;
  windowDays?: number;
  events?: { window: number; all: number; skewSecondsOver5Min: number; maxSkewSeconds: number; duplicateEventIds: number };
  lineage?: FieldCoverage[];
  candidate_source?: Dist[];
  event_source?: Dist[];
  event_types?: Dist[];
  notes?: string[];
};

const fieldLabel: Record<string, string> = {
  recommendation_request_id: "推荐请求 ID",
  impression_id: "曝光 ID",
  feed_session_id: "会话 ID",
  candidate_source: "候选通道",
  client_time: "客户端时间",
  need_id: "需求 ID",
};
const windowLabel: Record<string, string> = { window: "近30天", all: "全量" };

export function Quality() {
  const [d, setD] = useState<Payload | null>(null);
  useEffect(() => { opFetch("/v1/operator/quality").then(setD).catch(() => {}); }, []);
  if (!d) return <div className="notice">加载 Quality…</div>;
  if (d.dataSource !== "LIVE" || !d.events || !d.lineage) {
    return <div className="notice"><b>未接入：</b>{d.missing ?? "没有数据源"}</div>;
  }
  const ev = d.events;
  const byField = new Map<string, FieldCoverage[]>();
  for (const f of d.lineage) {
    const list = byField.get(f.field) ?? [];
    list.push(f);
    byField.set(f.field, list);
  }

  return (
    <>
      <div className="section-title">
        <h2>数据治理 · 曝光谱系体检</h2>
        <span>近 {ev.window.toLocaleString()} / 全量 {ev.all.toLocaleString()} 条事件</span>
      </div>
      <div className="notice" style={{ marginBottom: 10 }}>
        谱系列在表里，但写入方基本不在 —— 每一行的非空率就是治理的起点。
        没有谱系图、没有修复操作：谱系图要 request_id 先接上才画得出来。
      </div>

      <div className="section-title"><h2>谱系列覆盖</h2><span>candidate_source 的 unknown 不算值</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>谱系列</th><th>窗口内</th><th>全量</th></tr></thead>
          <tbody>
            {[...byField.entries()].map(([field, rows]) => {
              const win = rows.find((r) => r.window === "window");
              const all = rows.find((r) => r.window === "all");
              return (
                <tr key={field}>
                  <td>{fieldLabel[field] ?? field}</td>
                  <td>{win ? `${win.filled.toLocaleString()} / ${win.total.toLocaleString()}（${(win.coverage * 100).toFixed(1)}%）` : "—"}</td>
                  <td>{all ? `${all.filled.toLocaleString()} / ${all.total.toLocaleString()}（${(all.coverage * 100).toFixed(1)}%）` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="section-title"><h2>谁在产生事件</h2><span>event_source / candidate_source / event_type</span></div>
      <div className="engine-status">
        <div className="engine-mini">
          <div className="k">事件来源</div>
          {(d.event_source ?? []).map((x) => <div className="d" key={x.value}>{x.value}: {x.count.toLocaleString()}</div>)}
        </div>
        <div className="engine-mini">
          <div className="k">候选通道</div>
          {(d.candidate_source ?? []).map((x) => <div className="d" key={x.value}>{x.value}: {x.count.toLocaleString()}</div>)}
        </div>
        <div className="engine-mini">
          <div className="k">事件类型</div>
          {(d.event_types ?? []).map((x) => <div className="d" key={x.value}>{x.value}: {x.count.toLocaleString()}</div>)}
        </div>
      </div>

      <div className="section-title"><h2>其他体检项</h2></div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">重复 event_id</div><div className="value">{ev.duplicateEventIds.toLocaleString()}</div><div className="meta">行数 − 去重数；&gt;0 = 上游在重发</div></div>
        <div className="kpi"><div className="label">时钟偏差 &gt;5 分钟</div><div className="value">{ev.skewSecondsOver5Min.toLocaleString()}</div><div className="meta">最大 {Math.round(ev.maxSkewSeconds)} 秒；按客户端时间切窗口会串天</div></div>
      </div>

      {(d.notes ?? []).map((n, i) => (
        <div className="notice" key={i} style={{ marginTop: 8 }}>{n}</div>
      ))}
    </>
  );
}
