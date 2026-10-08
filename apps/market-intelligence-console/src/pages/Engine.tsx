import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";

// OPS-CONSOLE-PAGES-001（2026-10-07）：这一页原来**打不开**。
//
// 它读 `data.engine.evaluate_calls_30d`，而服务端是个 NOT_CONNECTED 桩，根本不发
// engine 字段 —— 一打开就 TypeError。控制台里 trust / clarification / intent-orchestration
// 同样崩。
//
// 现在接 spec §11 的 Decision Eligibility 状态机（decision.user_event_states，由引力
// worker 写）。但页面标题里的那句话要改：引擎的**调用面**（/v1/decisions/evaluate）
// 确实没有注册路由，所以这里没有调用量 / 延迟 / 通过率；有的是「引擎把人判到哪一档、
// 证据够不够」。两件事都在页面上说清楚，别让人以为看到的是引擎吞吐。
type StateRow = {
  state: string;
  people: number;
  avg_confidence: number;
  avg_evidence_coverage: number;
  avg_sample_events: number;
};
type EventRow = { event_type: string; people: number };
type Payload = {
  dataSource?: string;
  missing?: string;
  states?: StateRow[];
  eventTypes?: EventRow[];
  totals?: {
    people: number;
    activeOrchestrate: number;
    modelVersions: string[];
    lastComputedAt: string | null;
  };
  notes?: string[];
};

export function Engine() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => { opFetch("/v1/operator/decision-engine").then(setData).catch(() => {}); }, []);
  if (!data) return <div className="notice">加载 Decision Engine…</div>;
  // 没有库 / 查询失败时后端会回 NOT_CONNECTED 或 500。别再去读 data.engine —— 那正是
  // 这一页以前崩的原因：字段不存在时 React 会整页挂掉，运营连「为什么空」都看不到。
  if (data.dataSource !== "LIVE" || !data.states) {
    return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;
  }

  return (
    <>
      <div className="engine-hero">
        <h2>Decision Eligibility · §11</h2>
        <p>
          引擎今天把每个人判在哪一档、证据够不够（decision.user_event_states，引力 worker 写）。
          <b>没有</b>调用量 / 延迟 / 通过率 —— <span className="engine-link">/v1/decisions/evaluate</span> 未注册路由，那三样不存在。
          spec §11 的原话是「不要只有 active / inactive」，所以状态分档在这里。
        </p>
      </div>

      <div className="section-title">
        <h2>状态分档</h2>
        <span>共 {(data.totals?.people ?? 0).toLocaleString()} 个（人 × 事件类型）状态</span>
      </div>
      <div className="engine-status">
        {(data.states ?? []).map((s) => (
          <div className="engine-mini" key={s.state}>
            <div className="k">{s.state}</div>
            <div className="v">{s.people.toLocaleString()}</div>
            <div className="d">
              置信 {s.avg_confidence.toFixed(3)} · 证据覆盖 {s.avg_evidence_coverage.toFixed(2)} · 样本 {s.avg_sample_events.toFixed(1)}
            </div>
          </div>
        ))}
        <div className="engine-mini">
          <div className="k">ACTIVE_ORCHESTRATE</div>
          <div className="v">{(data.totals?.activeOrchestrate ?? 0).toLocaleString()}</div>
          <div className="d">§12/§13 不自动进入主动编排 —— 这个值应当永远是 0</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 12 }}>
        <div className="card">
          <h3>按引力事件类型</h3>
          <div className="prov">
            {(data.eventTypes ?? []).map((e) => (
              <span key={e.event_type} className="o">{e.event_type} · {e.people}</span>
            ))}
          </div>
          <div className="engine-inline" style={{ marginTop: 10 }}>
            同一个人在不同事件类型上是不同行 —— 这不是人数，是「人 × 事件」状态数。
          </div>
        </div>
        <div className="card">
          <h3>模型与新鲜度</h3>
          <div className="prov">
            <span className="o">{(data.totals?.modelVersions ?? []).join(", ") || "—"}</span>
          </div>
          <div className="engine-inline" style={{ marginTop: 10 }}>
            最近一次重算：{data.totals?.lastComputedAt ?? "一次都没算过"}
          </div>
          <div className="engine-inline" style={{ marginTop: 6 }}>
            状态不是事实，是引擎在某一刻的判断 —— 没这个时间戳会把陈旧判断当当前判断。
          </div>
        </div>
      </div>

      {(data.notes ?? []).map((n, i) => (
        <div className="notice" key={i} style={{ marginTop: 8 }}>{n}</div>
      ))}
    </>
  );
}
