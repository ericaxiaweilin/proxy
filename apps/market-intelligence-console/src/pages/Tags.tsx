import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";

// OPS-TAG-VOCAB-001（2026-10-07）：这一页原来**打不开**（读 d.kpis / d.top_tags，
// 桩不发这两个字段 ⇒ TypeError），而且标签体系本身不存在（全库 0 张 tag 表）。
//
// 所以这一页不是「标签热度榜」，给的是**已落库的标签词典盘点**：
//   - 若干个轴（供给侧 + 内容侧；帖子场景轴已于 89ea7e2f 下线），每个轴多少词、覆盖多少主体、词表受不受控；
//   - 语种轴大小写没归一（vi/VI 算两个词）—— dirty 轴，合并前别拿它做筛选；
//   - context_id 是自由文本（有「日常」也有带地址的店名），不能当标签用；
//   - activity.interests 是事件表且只有个位数行 —— 兴趣画像没有数据源。
// 没有的东西：标签关系图、兴趣分、标签治理操作 —— 那些要 tag-service 才成立。
type Term = { tag: string; type: string; count: number; unit: string };
type Axis = {
  axis: string; side: string; vocabulary: string;
  terms: number; carriers: number; universe: number; coverage: number;
};
type Payload = {
  dataSource?: string;
  missing?: string;
  kpis?: Record<string, number>;
  top_tags?: Term[];
  axes?: Axis[];
  totals?: {
    agents: number; posts: number; terms: number; termsShown: number;
    languageRawTerms: number; languageNormTerms: number;
    caseCollisions: string[] | null;
    contextPosts: number; contextIdTerms: number; interestRows: number;
  };
  notes?: string[];
  userTags?: UserTags | null;
};
type AxisStat = { axis: string; label: string; polarity: string; users: number; tags: number; avgConfidence: number; top: Array<{ value: string; users: number }> };
type UserTags = { usersWithTags: number; totalTags: number; lastComputedAt?: string; ruleVersion: string; axes: AxisStat[] };
const polarityLabel: Record<string, string> = { POSITIVE: "正向", NEGATIVE: "回避", NEUTRAL: "中性" };

const axisLabel: Record<string, string> = {
  capability: "能力", service: "服务类型", vertical: "垂类标签",
  language: "语种", scene: "帖子场景", context_type: "语境类型", context_id: "语境值",
};
const unitLabel: Record<string, string> = {
  agents: "人", services: "条服务", posts: "帖", refs: "次引用",
};
const vocabLabel: Record<string, string> = {
  controlled: "受控词表", dirty: "没归一", free_text: "自由文本",
};

// OPS-TAGS-CRASH-001：后端去掉一个字段（89ea7e2f 删了「场景未识别」计数）前端就整页抛错。
// 缺的数显示「—」，不显示 0（0 是「查过了没有」），也不让整页崩。
const num = (x: number | null | undefined): string => (typeof x === "number" ? x.toLocaleString() : "—");

export function Tags() {
  const [d, setD] = useState<Payload | null>(null);
  useEffect(() => { opFetch("/v1/operator/tags").then(setD).catch(() => {}); }, []);
  if (!d) return <div className="notice">加载 Tags…</div>;
  if (d.dataSource !== "LIVE" || !d.totals || !d.axes) {
    return <div className="notice"><b>未接入：</b>{d.missing ?? "没有数据源"}</div>;
  }
  const t = d.totals;
  const terms = d.top_tags ?? [];

  return (
    <>
      {d.userTags ? <UserTagLayer u={d.userTags} /> : null}
      <div className="section-title">
        <h2>词典盘点 · 供给侧 / 内容侧已落库的词</h2>
        <span>全量口径 —— 词典是状态，不是事件</span>
      </div>
      <div className="notice" style={{ marginBottom: 10 }}>
        这一段不是用户标签：它是今天已经落库的 {d.axes.length} 个轴，回答「哪些轴可以先当标签用、哪些得先治理」。
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="label">服务者</div><div className="value">{num(t.agents)}</div><div className="meta">supply.agent_profiles</div></div>
        <div className="kpi"><div className="label">内容</div><div className="value">{num(t.posts)}</div><div className="meta">localnet.posts</div></div>
        <div className="kpi"><div className="label">词数合计</div><div className="value">{num(t.terms)}</div><div className="meta">{d.axes.length} 个轴去重后的词</div></div>
        <div className="kpi"><div className="label">带语境标签的帖子</div><div className="value">{num(t.contextPosts)}</div><div className="meta">context_refs 非空的帖子 · 覆盖率 {(t.posts > 0 ? (t.contextPosts / t.posts) * 100 : 0).toFixed(1)}%</div></div>
      </div>

      <div className="section-title"><h2>{d.axes.length} 个轴</h2><span>词表受不受控决定能不能直接当标签用</span></div>
      <div className="engine-status">
        {d.axes.map((a) => (
          <div className="engine-mini" key={a.axis}>
            <div className="k">{axisLabel[a.axis] ?? a.axis} <span style={{ opacity: 0.55 }}>{a.side === "supply" ? "供给侧" : "内容侧"}</span></div>
            <div className="v">{a.terms} 词 · {(a.coverage * 100).toFixed(1)}%</div>
            <div className="d">{vocabLabel[a.vocabulary] ?? a.vocabulary} · {num(a.carriers)}/{num(a.universe)} 主体</div>
          </div>
        ))}
      </div>

      <div className="section-title">
        <h2>标签云</h2>
        <span>显示 {terms.length}/{t.terms} · 每个词带单位，不同轴的 count 不是同一量级</span>
      </div>
      <div className="tagcloud">
        {terms.map((x) => (
          <span key={`${x.type}:${x.tag}`} className={`rawtag ${x.type}`}>
            {x.tag} · {num(x.count)} {unitLabel[x.unit] ?? x.unit}
          </span>
        ))}
      </div>

      {((t.caseCollisions ?? []).length > 0) && (
        <div className="notice" style={{ marginTop: 10 }}>
          <b>语种没归一：</b>{(t.caseCollisions ?? []).join("、")} —— 同一个语种在库里算两个词
          （原始 {t.languageRawTerms} 个 / 归一后 {t.languageNormTerms} 个）。合并前别拿语种数做筛选。
        </div>
      )}
      {t.contextIdTerms > 0 && (
        <div className="notice" style={{ marginTop: 8 }}>
          <b>context_id 不是词典：</b>{t.contextIdTerms} 个不同的值且是自由文本（既有「日常」也有带地址的店名）。
          受控的是语境类型那一层；要拿语境当标签，得先把 context_id 收进词表。
        </div>
      )}
      {t.interestRows < 10 && (
        <div className="notice" style={{ marginTop: 8 }}>
          <b>需求侧兴趣没有数据源：</b>activity.interests 只有 {t.interestRows} 行 ——
          那是「谁对哪个活动感兴趣」的事件表，不是兴趣词典。兴趣画像今天给不了。
        </div>
      )}
      {(d.notes ?? []).map((n, i) => (
        <div className="notice" key={i} style={{ marginTop: 8 }}>{n}</div>
      ))}
    </>
  );
}

function UserTagLayer({ u }: { u: UserTags }) {
  return (
    <>
      <div className="section-title">
        <h2>用户标签 · 撮合读的就是这一层</h2>
        <span>规则 {u.ruleVersion} · 每小时按事件重算</span>
      </div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">有标签的人</div><div className="value">{num(u.usersWithTags)}</div><div className="meta">没同意过的人没有标签，这是设计</div></div>
        <div className="kpi"><div className="label">标签条数</div><div className="value">{num(u.totalTags)}</div><div className="meta">未过期的</div></div>
        <div className="kpi"><div className="label">上次重算</div><div className="value">{u.lastComputedAt ? new Date(u.lastComputedAt).toLocaleString() : "—"}</div><div className="meta">{u.lastComputedAt ? "" : "还没有任何标签"}</div></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>轴</th><th>性质</th><th className="numc">人数</th><th className="numc">条数</th><th className="numc">平均置信</th><th>最多的取值</th></tr></thead>
        <tbody>{u.axes.map((a) => (
          <tr key={a.axis}>
            <td><b>{a.label}</b><div style={{ color: "#8a8190", fontSize: 11 }}>{a.axis}</div></td>
            <td>{polarityLabel[a.polarity] ?? a.polarity}</td>
            <td className="numc">{num(a.users)}</td>
            <td className="numc">{num(a.tags)}</td>
            <td className="numc">{a.tags ? a.avgConfidence.toFixed(2) : "—"}</td>
            <td>{a.top.length ? a.top.map((v) => `${v.value}（${v.users}）`).join("、") : <span style={{ color: "#8a8190" }}>—</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}
