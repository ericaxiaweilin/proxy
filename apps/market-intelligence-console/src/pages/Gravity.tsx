import { useEffect, useState } from "react";
import { opFetch, opPost } from "../lib/api";

// GRAVITY-001：引力状态（spec §6-§7 / §11 / §21）。真实派生数据：worker 每小时从消息 / 浏览 / 场景到访重算。
type State = {
  userId: string; eventType: string; p30: number; p60: number; p120: number; confidence: number; evidenceCoverage: number;
  sampleEvents: number; activeWeeks: number; lastSeen: string; peakHourOfWeek: number; actionState: string; nextLikelyAt?: string;
};
type Payload = {
  modelVersion: string;
  summary: Array<{ eventType: string; actionState: string; users: number; avgP60: number; computedAt: string }>;
  top: Record<string, State[]>;
  notes: string[];
};

const EVENT_LABEL: Record<string, string> = { CHAT_ACTIVE: "聊天活跃", BROWSE_ACTIVE: "浏览活跃", SCENE_VISIT: "场景到访" };
const STATE_LABEL: Record<string, string> = {
  OBSERVE: "只观察", LEARN_ONLY: "只学习", PASSIVE: "被动参与排序", SOFT_NUDGE: "可自然靠前", ACTIVE_ORCHESTRATE: "主动撮合", BLOCKED: "屏蔽",
};
const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const peak = (h: number) => (h < 0 ? "—" : `${DAYS[Math.floor(h / 24)]} ${h % 24}:00`);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Gravity() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | undefined>(undefined);
  const load = () => opFetch<Payload>("/v1/operator/gravity").then(setData).catch(() => {});
  useEffect(() => { void load(); }, []);
  const recompute = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      const body = await opPost<{ states?: number }>("/v1/operator/gravity/recompute");
      setMsg(`已重算 ${body.states ?? 0} 条状态`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? `重算失败（${e.message}）` : "重算失败");
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <div className="notice">加载引力状态…</div>;
  const computedAt = data.summary.reduce((latest, row) => (row.computedAt > latest ? row.computedAt : latest), "");
  return (
    <>
      <div className="section-title">
        <h2>引力状态 · {data.modelVersion}</h2>
        <span>
          {computedAt ? `上次计算 ${new Date(computedAt).toLocaleString()}` : "还没算过"}
          {" · "}<button disabled={busy} onClick={() => void recompute()}>{busy ? "重算中…" : "立即重算"}</button>
          {msg ? ` · ${msg}` : ""}
        </span>
      </div>
      <div className="card">
        {data.notes.map((note) => <div key={note} className="notice" style={{ marginBottom: 6 }}>{note}</div>)}
      </div>
      <div className="section-title"><h2>决策状态分布（spec §11）</h2><span>人数 · 平均 P60</span></div>
      <div className="card">
        {data.summary.length === 0 ? <div className="notice">还没有状态：点「立即重算」</div> : data.summary.map((row) => (
          <div key={`${row.eventType}:${row.actionState}`} className="funnel-row">
            <div className="name">{EVENT_LABEL[row.eventType] ?? row.eventType} · {STATE_LABEL[row.actionState] ?? row.actionState}</div>
            <div className="num">{row.users} 人</div>
            <div className="rate">P60 {pct(row.avgP60)}</div>
          </div>
        ))}
      </div>
      {Object.entries(data.top).map(([eventType, rows]) => (
        <div key={eventType}>
          <div className="section-title"><h2>{EVENT_LABEL[eventType] ?? eventType} · 接下来最可能发生的人</h2><span>P30 / P60 / P120 · 证据 · 峰值时段（河内）</span></div>
          <div className="card">
            {rows.length === 0 ? <div className="notice">没有数据</div> : rows.map((st) => (
              <div key={st.userId} className="funnel-row">
                <div className="name">{st.userId.slice(0, 22)}</div>
                <div className="num">{pct(st.p30)} / {pct(st.p60)} / {pct(st.p120)}</div>
                <div className="rate">{STATE_LABEL[st.actionState] ?? st.actionState} · {st.activeWeeks} 周 {st.sampleEvents} 次 · 峰值 {peak(st.peakHourOfWeek)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
