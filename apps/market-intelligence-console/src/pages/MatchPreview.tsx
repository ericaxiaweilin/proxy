import { useState } from "react";
import { opFetch, OpStatusError } from "../lib/api";

// OPS-MATCH-PREVIEW-001（2026-10-08）：撮合预览 —— 一张还没人接的单，引擎此刻会按什么顺序邀谁。
//
// 候选范围与真邀请一模一样（30km 内、有接单权限、没报过名），所以这一页能用来核对与纠错；
// 它**不发邀约、不改任何状态**，notes 逐条照抄后端给的，分项也不在这里重算。
//
// 距离是 null 时写「—」而不是 0：null 的意思是这张单没带坐标、算不出距离，
// 写成 0 km 等于说「这个人就在门口」。没标签（tagCount 为 0）也不是「不合」，
// 相似度同样留「—」。

type Breakdown = {
  reliability: number; satisfaction: number; experience: number; response: number; fit: number;
  distance: number; newcomerBoost: number; loadPenalty: number; tagFit: number; total: number;
  distanceKm?: number | null;
  fulfillmentRate: number; satisfactionRate: number; hasTrackRecord: boolean;
};
type SharedTag = { axis: string; label: string; value: string; strength: number };
type Candidate = {
  rank: number; userId: string; breakdown: Breakdown;
  affinity: number; tagCount: number; sharedTags: SharedTag[];
};
type Preview = {
  opportunityId: string; reason?: string; ownerTagCount: number; tagFitWeight: number; candidates: Candidate[];
};
type Payload = { dataSource: string; preview?: Preview; notes?: string[]; missing?: string };

const DASH = "—";
const META = { color: "#8a8190", fontSize: 11 } as const;

// reason 是后端给的原因码，翻成人话；没列出的照原样摆出来（不藏、也不编）。
const REASON: Record<string, string> = {
  opportunity_has_no_location: "这张单发出时没带坐标，说不出「附近」，所以不会邀请任何人",
  nobody_suitable_nearby: "30km 内没有符合条件的人（有接单权限、没报过名）",
};

// 分项的口径来自 matching.Breakdown；负载是从总分里扣掉的，所以带减号。0 的分项不摆，免得一行全是噪音。
const parts = (b: Breakdown): string => {
  const items: Array<[string, number, boolean]> = [
    ["可靠", b.reliability, false],
    ["满意", b.satisfaction, false],
    ["经验", b.experience, false],
    ["响应", b.response, false],
    ["距离", b.distance, false],
    ["新人", b.newcomerBoost, false],
    ["负载", b.loadPenalty, true],
    ["共同兴趣", b.tagFit, false],
  ];
  return items
    .filter(([, v]) => v !== 0)
    .map(([label, v, minus]) => `${label} ${minus ? "−" : ""}${v}`)
    .join(" · ");
};

const tagName = (t: SharedTag): string => `${t.label}·${t.value}`.replace(/_/g, " ");

export function MatchPreview() {
  const [opportunityId, setOpportunityId] = useState("");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [notFound, setNotFound] = useState(false);

  const look = async (): Promise<void> => {
    const id = opportunityId.trim();
    if (id === "" || busy) return;
    setBusy(true);
    setData(null);
    setNotFound(false);
    try {
      setData(await opFetch<Payload>(`/v1/operator/match-preview?opportunityId=${encodeURIComponent(id)}&limit=10`));
    } catch (e) {
      // 401 / 403 / 未接入由 App 统一弹登录、无权限、未接入；其余（含 404）都是「这张单没找到」。
      if (!(e instanceof OpStatusError)) setNotFound(true);
    } finally {
      setBusy(false);
    }
  };

  const live: Preview | undefined = data?.dataSource === "LIVE" ? data?.preview : undefined;

  return (
    <>
      <div className="section-title">
        <h2>撮合预览 · 这张单此刻会邀谁</h2>
        <span>GET /v1/operator/match-preview · 只读：不发邀约、不改任何状态</span>
      </div>

      <form className="card" onSubmit={(e) => { e.preventDefault(); void look(); }} style={{ maxWidth: 560, marginBottom: 12 }}>
        <input
          autoFocus value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}
          placeholder="需求 / 邀约的编号，如 opp_1f3c…" style={{ width: "100%", padding: 8 }}
        />
        <button type="submit" disabled={busy || opportunityId.trim() === ""} style={{ marginTop: 8 }}>{busy ? "查询中…" : "查看"}</button>
      </form>

      {notFound ? <div className="notice" role="alert">没找到这张单，或没有读取权限</div> : null}

      {data && data.dataSource !== "LIVE" ? (
        <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>
      ) : null}

      {live ? (
        <>
          {(data?.notes ?? []).map((n, i) => <div className="notice" key={i} style={{ marginTop: i === 0 ? 0 : 8 }}>{n}</div>)}

          {live.reason && live.candidates.length === 0 ? (
            <div className="notice" style={{ marginTop: 8 }}>{REASON[live.reason] ?? live.reason}</div>
          ) : null}

          <div className="kpi-grid" style={{ marginTop: 10 }}>
            <div className="kpi"><div className="label">候选人数</div><div className="value">{live.candidates.length}</div><div className="meta">此刻在候选范围里的人</div></div>
            <div className="kpi"><div className="label">发单方标签数</div><div className="value">{live.ownerTagCount}</div><div className="meta">发单方自己身上的标签</div></div>
            <div className="kpi"><div className="label">共同兴趣权重</div><div className="value">{live.tagFitWeight}</div><div className="meta">引擎现在给共同标签的分量</div></div>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr><th>排名</th><th>用户</th><th className="numc">总分</th><th>分项</th><th className="numc">距离</th><th className="numc">相似度</th><th>共同标签</th><th className="numc">标签数</th></tr></thead>
              <tbody>
                {live.candidates.length === 0
                  ? <tr><td>{DASH}</td><td colSpan={7} style={META}>这次没有候选</td></tr>
                  : live.candidates.map((c) => (
                    <tr key={c.userId}>
                      <td><b>{c.rank}</b></td>
                      <td><span style={META}>{c.userId}</span></td>
                      <td className="numc"><b>{c.breakdown.total}</b></td>
                      <td style={META}>{parts(c.breakdown) || DASH}</td>
                      <td className="numc">{c.breakdown.distanceKm == null ? DASH : `${c.breakdown.distanceKm} km`}</td>
                      <td className="numc">{c.tagCount === 0 ? DASH : c.affinity.toFixed(2)}</td>
                      <td>
                        {c.sharedTags.length === 0
                          ? DASH
                          : c.sharedTags.slice(0, 5).map((t) => (
                            <span className="badge" key={`${t.axis}|${t.label}|${t.value}`} style={{ marginRight: 4 }}>{tagName(t)}</span>
                          ))}
                      </td>
                      <td className="numc">{c.tagCount}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
