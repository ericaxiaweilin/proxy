import { useEffect, useState } from "react";
import { opFetch } from "../lib/api";

// OPS-INSIGHT-001（2026-10-08）：用户洞察 —— 标签覆盖了多少人、哪个轴上什么取值最集中、
// 某个取值的人身上还带着什么。撮合读的就是这一层（tagging.Axes()），所以这一页只做盘点与下钻。
//
// 页面必须守住后端已经定死的两条规矩（insight.MinCell）：
//   - 任何少于 minCell 人的格子不出人数，只写「少于 N 人」。写成 0 是说「没人」，
//     留空是装作没这回事 —— 两者都是在拿少数人当新闻。cells 一律走 count()。
//   - 队列本身不到 minCell 人时，后端连「他们还带什么」都不给：给了就是在描述这几个人。
//     所以被抑制时这里只显示那一句，不出列表。
//
// 覆盖的分母（活跃用户）是近 30 天有过行为或下过单的人，不是全部注册账号 ——
// 从没动过的账号没有标签是事实，混进来会把覆盖率讲低。

type Cell = { value: string; users: number | null; suppressed: boolean };
type Bucket = { label: string; users: number };
type Coverage = { activeUsers: number; taggedUsers: number; avgTagsPerTaggedUser: number | null; buckets: Bucket[] };
type Segments = {
  coverage: Coverage;
  axis?: string;
  top?: Cell[];
  withAxis?: string;
  withValue?: string;
  cohort?: Cell;
  alsoHave?: Cell[];
};
type AxisMeta = { axis: string; label: string; polarity: string };
type Payload = { dataSource: string; segments?: Segments; axes?: AxisMeta[]; minCell?: number; notes?: string[]; missing?: string };

const DASH = "—";
const META = { color: "#8a8190", fontSize: 11 } as const;
// 轴的性质来自后端（tagging 的轴定义），这里只把它翻成人话；未列出的照原样摆出来（不藏）。
const POLARITY: Record<string, string> = { POSITIVE: "偏好", NEGATIVE: "回避", NEUTRAL: "事实" };
const polarity = (p: string): string => POLARITY[p] ?? p;

// alsoHave 的取值是 `轴:取值`。轴名本身不含冒号，按第一个冒号切。
const splitEntry = (v: string): { axis: string; value: string } => {
  const at = v.indexOf(":");
  return at < 0 ? { axis: "", value: v } : { axis: v.slice(0, at), value: v.slice(at + 1) };
};

export function Insights() {
  const [axis, setAxis] = useState("");
  const [withAxis, setWithAxis] = useState("");
  const [withValue, setWithValue] = useState("");
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    setData(null);
    const q: string[] = [];
    if (axis) q.push(`axis=${encodeURIComponent(axis)}`);
    if (withAxis && withValue) {
      q.push(`withAxis=${encodeURIComponent(withAxis)}`);
      q.push(`withValue=${encodeURIComponent(withValue)}`);
    }
    opFetch<Payload>(`/v1/operator/insights${q.length ? `?${q.join("&")}` : ""}`).then(setData).catch(() => {});
  }, [axis, withAxis, withValue]);

  if (!data) return <div className="notice">加载用户洞察…</div>;
  if (data.dataSource !== "LIVE" || !data.segments) {
    return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;
  }

  const seg = data.segments;
  const cov = seg.coverage;
  const minCell = data.minCell ?? 5;
  const axes = data.axes ?? [];
  const labelOf = (a: string): string => axes.find((x) => x.axis === a)?.label ?? a;
  // 被抑制的格子只说被抑制，不出人数。
  const count = (c: Cell): string => (c.suppressed ? `少于 ${minCell} 人` : c.users == null ? DASH : String(c.users));
  const notes = data.notes ?? [];
  const peak = Math.max(1, ...cov.buckets.map((b) => b.users));

  return (
    <>
      <div className="section-title">
        <h2>用户洞察 · 标签覆盖了多少人、什么取值最集中</h2>
        <span>GET /v1/operator/insights · 少于 {minCell} 人的格子不出人数</span>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="label">活跃用户</div><div className="value">{cov.activeUsers.toLocaleString()}</div><div className="meta">近 30 天有过行为或下过单</div></div>
        <div className="kpi"><div className="label">有标签的人</div><div className="value">{cov.taggedUsers.toLocaleString()}</div><div className="meta">没同意浏览的人没有标签，这是设计</div></div>
        <div className="kpi"><div className="label">平均标签数</div><div className="value">{cov.avgTagsPerTaggedUser == null ? DASH : cov.avgTagsPerTaggedUser.toFixed(1)}</div><div className="meta">有标签的人人均未过期标签</div></div>
      </div>

      {notes.map((n, i) => <div className="notice" key={i} style={{ marginTop: i === 0 ? 10 : 8 }}>{n}</div>)}

      <div className="section-title">
        <h2>标签条数分布</h2>
        <span>有标签的人身上有几个标签（未过期的）</span>
      </div>
      {cov.buckets.length === 0 ? (
        <div className="notice">没有可分桶的数据。</div>
      ) : (
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cov.buckets.length}, minmax(0,1fr))`, gap: 12 }}>
            {cov.buckets.map((b) => (
              <div key={b.label}>
                <div style={{ fontSize: 10, color: "#8a8190" }}>{b.label} 个标签</div>
                <div className="track" style={{ margin: "6px 0 4px" }}><div className="bar" style={{ width: `${(b.users / peak) * 100}%` }} /></div>
                <div style={{ fontSize: 12, fontWeight: 850 }}>{b.users.toLocaleString()} 人</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section-title">
        <h2>选一个轴</h2>
        <span>轴与性质由后端的标签词表给出 · 偏好 / 回避 / 事实</span>
      </div>
      <div className="controls">
        {axes.map((a) => (
          <button key={a.axis}
            onClick={() => { setAxis(axis === a.axis ? "" : a.axis); setWithAxis(""); setWithValue(""); }}
            style={axis === a.axis ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>
            {a.label}
          </button>
        ))}
      </div>

      {!axis ? null : (
        <>
          <div className="section-title">
            <h2>{labelOf(axis)} · 最多的取值</h2>
            <span>点一行看这一群人身上还带着什么</span>
          </div>
          <div className="notice" style={{ marginBottom: 10 }}>
            轴性质：{polarity(axes.find((a) => a.axis === axis)?.polarity ?? "")} · 轴标识 {axis}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>取值</th><th className="numc">人数</th></tr></thead>
              <tbody>
                {(seg.top ?? []).length === 0
                  ? <tr><td>{DASH}</td><td className="numc" style={META}>这个轴上还没有任何标签</td></tr>
                  : (seg.top ?? []).map((c) => (
                    <tr key={c.value} onClick={() => {
                        const same = withAxis === axis && withValue === c.value;
                        setWithAxis(same ? "" : axis);
                        setWithValue(same ? "" : c.value);
                      }}
                      style={{ cursor: "pointer", background: withAxis === axis && withValue === c.value ? "rgba(47,125,225,0.08)" : undefined }}>
                      <td><b>{c.value}</b></td>
                      <td className="numc" style={c.suppressed ? { color: "#8a8190", fontWeight: 500 } : undefined}>{count(c)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!seg.cohort ? null : (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>这一群人 · {labelOf(seg.withAxis ?? "")} = {seg.cohort.value}</h3>
          {seg.cohort.suppressed ? (
            <div className="notice">少于 {minCell} 人。</div>
          ) : (
            <>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{count(seg.cohort)}</div>
              <div style={META}>同一条标签上的人，去重后的人数</div>
            </>
          )}
          {seg.cohort.suppressed ? null : (
            (seg.alsoHave ?? []).length === 0
              ? <div className="notice" style={{ marginTop: 10 }}>除这一条标签之外，他们身上没有别的未过期标签。</div>
              : (
                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table>
                    <thead><tr><th>也带着</th><th className="numc">人数</th></tr></thead>
                    <tbody>
                      {(seg.alsoHave ?? []).map((c) => {
                        const e = splitEntry(c.value);
                        return (
                          <tr key={c.value}>
                            <td><b>{e.value}</b><div style={META}>{labelOf(e.axis)}{e.axis ? ` · ${e.axis}` : ""}</div></td>
                            <td className="numc" style={c.suppressed ? { color: "#8a8190", fontWeight: 500 } : undefined}>{count(c)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
          )}
          <div style={{ marginTop: 10 }}>
            <button onClick={() => { setWithAxis(""); setWithValue(""); }}>取消选择</button>
          </div>
        </div>
      )}
    </>
  );
}
