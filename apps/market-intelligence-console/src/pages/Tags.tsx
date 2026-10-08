import { opFetch } from "../lib/api";
import { useEffect, useState } from "react";

// OPS-TAG-VOCAB-001（2026-10-07）：这一页原来**打不开**（读 d.kpis / d.top_tags，
// 桩不发这两个字段 ⇒ TypeError），而且标签体系本身不存在（全库 0 张 tag 表）。
//
// 所以这一页不是「标签热度榜」，给的是**已落库的标签词典盘点**：
//   - 7 个轴（4 个供给侧 + 3 个内容侧），每个轴多少词、覆盖多少主体、词表受不受控；
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
    caseCollisions: string[]; sceneUnknown: number;
    contextPosts: number; contextIdTerms: number; interestRows: number;
  };
  notes?: string[];
};

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
      <div className="section-title">
        <h2>标签中心 · 词典盘点</h2>
        <span>全量口径 —— 词典是状态，不是事件</span>
      </div>
      <div className="notice" style={{ marginBottom: 10 }}>
        <b>标签体系（tag-service）不存在</b>：没有受控词表、没有别名合并与废弃治理、没有「一个标签挂在多少东西上」的统一索引。
        下面是今天实际在当标签用的 {d.axes.length} 个轴 —— 它们是建 tag-service 时要接管的全部东西。
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="label">服务者</div><div className="value">{t.agents.toLocaleString()}</div><div className="meta">supply.agent_profiles</div></div>
        <div className="kpi"><div className="label">内容</div><div className="value">{t.posts.toLocaleString()}</div><div className="meta">localnet.posts</div></div>
        <div className="kpi"><div className="label">词数合计</div><div className="value">{t.terms.toLocaleString()}</div><div className="meta">7 个轴去重后的词</div></div>
        <div className="kpi"><div className="label">带语境标签的帖子</div><div className="value">{t.contextPosts.toLocaleString()}</div><div className="meta">context_refs 非空的帖子 · 覆盖率 {(t.posts > 0 ? (t.contextPosts / t.posts) * 100 : 0).toFixed(1)}%</div></div>
        <div className="kpi"><div className="label">场景未识别</div><div className="value">{t.sceneUnknown.toLocaleString()}</div><div className="meta">scene_type=UNKNOWN · 分类器没打上</div></div>
      </div>

      <div className="section-title"><h2>七个轴</h2><span>词表受不受控决定能不能直接当标签用</span></div>
      <div className="engine-status">
        {d.axes.map((a) => (
          <div className="engine-mini" key={a.axis}>
            <div className="k">{axisLabel[a.axis] ?? a.axis} <span style={{ opacity: 0.55 }}>{a.side === "supply" ? "供给侧" : "内容侧"}</span></div>
            <div className="v">{a.terms} 词 · {(a.coverage * 100).toFixed(1)}%</div>
            <div className="d">{vocabLabel[a.vocabulary] ?? a.vocabulary} · {a.carriers.toLocaleString()}/{a.universe.toLocaleString()} 主体</div>
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
            {x.tag} · {x.count.toLocaleString()} {unitLabel[x.unit] ?? x.unit}
          </span>
        ))}
      </div>

      {(t.caseCollisions.length > 0) && (
        <div className="notice" style={{ marginTop: 10 }}>
          <b>语种没归一：</b>{t.caseCollisions.join("、")} —— 同一个语种在库里算两个词
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
