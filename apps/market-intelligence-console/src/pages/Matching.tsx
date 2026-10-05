import { useEffect, useState } from "react";
import { opFetch, opPost } from "../lib/api";

// OPS-MATCHING-TUNABLES-001：撮合引擎管理。
//
// 这一页回答两个之前无处可查的问题：
//   ① 引擎现在**按什么口径**排「谁排在你前面」？—— 每一项的当前值、出厂默认值、
//      以及这一项上次是谁、什么时候、为什么改的。库里没有那一行就是默认值，
//      所以这里不会出现「一个没人改过却显示成已改」的假来历。
//   ② 那一次撮合**当时为什么这么排**？—— 读 supply.candidate_batches 里存着的快照
//      （连每个人的得分明细一起存的），不重算：重算出来的是今天的口径下的另一个决定，
//      不是当时那个决定。
//
// 改口径要 MARKETPLACE 权限、必填理由、落运营动作审计。生效值与库里存的不一致时
// （别的实例还没重载、或那个值已经越界）后端会把它作为 warning 带上来，这里照原样摆。

type Tunable = {
  key: string; value: number; defaultValue: number; source: string;
  min: number; max: number; description: string;
  storedValue?: number; updatedBy?: string; updatedAt?: string; version?: number;
};
type EnginePayload = {
  dataSource: string; tunables: Tunable[]; warnings: string[]; notTunableNotes: string[];
};
type TraceCandidate = {
  agentId: string; name: string; serviceType?: string; referencePrice: number; currency?: string;
  rankingReason?: string; ranking?: { reliability: number; satisfaction: number; experience: number; response: number; fit: number; total: number };
};
type TraceBatch = {
  batchId: string; needId: string; marketId: string; createdAt: string;
  shortage: boolean; shortageNote?: string; candidateCount: number; candidates: TraceCandidate[] | null;
};
type TracePayload = {
  dataSource: string;
  summary: { batches: number; oldest: string; newest: string; batchesWithRanking: number };
  batches: TraceBatch[] | null; notes: string[];
};

export function Matching() {
  const [engine, setEngine] = useState<EnginePayload | null>(null);
  const [trace, setTrace] = useState<TracePayload | null>(null);
  const [pick, setPick] = useState<string>("");
  const [nextValue, setNextValue] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [result, setResult] = useState<string>("");

  const load = (): void => {
    opFetch<EnginePayload>("/v1/operator/matching").then(setEngine).catch(() => {});
    opFetch<TracePayload>("/v1/operator/matching/trace").then(setTrace).catch(() => {});
  };
  useEffect(() => {
    load();
    // 旋钮是别人也可能在动的东西：这一页要能自己变，不能靠刷新页面才发现口径已经换了。
    const id = setInterval(() => {
      opFetch<EnginePayload>("/v1/operator/matching").then(setEngine).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, []);

  if (!engine) return <div className="notice">加载撮合引擎…</div>;
  const chosen = engine.tunables.find((t) => t.key === pick);

  async function submit(): Promise<void> {
    if (!chosen || reason.trim() === "") return;
    const value = Number(nextValue);
    // 界面先挡一道，服务端那道才算真正生效的边界（两边同源：同一份定义表）。
    if (!Number.isFinite(value) || value < chosen.min || value > chosen.max) {
      setResult(`${chosen.key} 要在 ${chosen.min} 到 ${chosen.max} 之间`);
      return;
    }
    setBusy(true);
    setResult("");
    try {
      const body = await opPost<{ warnings?: string[] }>("/v1/operator/matching/tunables", {
        tunables: { [chosen.key]: value }, reason: reason.trim(),
      });
      setResult(`已生效并留痕。${(body.warnings ?? []).join("；")}`);
      setNextValue(""); setReason("");
      load();
    } catch (e) {
      // 400 = 越界或缺理由（被拒的尝试在服务端也会留一条 DENIED 审计）。
      setResult(`被拒绝：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-title">
        <h2>撮合排序口径 · 引擎正在按的这些数</h2>
        <span>GET /v1/operator/matching · 当前值 / 出厂默认 / 上次改动</span>
      </div>

      {engine.warnings?.length ? engine.warnings.map((w) => (
        <div className="notice" key={w} style={{ marginBottom: 6, borderColor: "#c9a227" }}>注意：{w}</div>
      )) : (
        <div className="notice">当前这套数没有踩到任何已知的排序不变量（权重阶梯 可靠 ≥ 满意 ≥ 经验 ≥ 响应 ≥ 适配）。</div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>旋钮</th><th className="numc">当前值</th><th className="numc">出厂默认</th><th>来源</th><th className="numc">允许区间</th><th>上次改动</th></tr>
          </thead>
          <tbody>
            {engine.tunables.map((t) => (
              <tr key={t.key}>
                <td>
                  <span className="engine-link">{t.description}</span>
                  <div style={{ color: "#8a8190", fontSize: 11 }}>{t.key}</div>
                </td>
                <td className="numc">{t.value}</td>
                <td className="numc" style={t.value === t.defaultValue ? undefined : { color: "#c9a227" }}>{t.defaultValue}</td>
                <td>{t.source === "OVERRIDE" ? `已改（库里 ${t.storedValue}）` : "默认（没人改过）"}</td>
                <td className="numc">{t.min} … {t.max}</td>
                <td>
                  {t.source === "OVERRIDE"
                    ? <>{t.updatedBy} · {t.updatedAt?.slice(0, 10)} · v{t.version}</>
                    : <span style={{ color: "#8a8190" }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title"><h2>调一项口径</h2><span>POST /v1/operator/matching/tunables · 需 MARKETPLACE · 必填理由 · 落审计</span></div>
      <div className="card">
        <div className="engine-inline" style={{ display: "grid", gap: 8 }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">选一项…</option>
            {engine.tunables.map((t) => <option key={t.key} value={t.key}>{t.description}（{t.key}）</option>)}
          </select>
          <input
            type="number" placeholder={chosen ? `当前 ${chosen.value}，允许 ${chosen.min} … ${chosen.max}` : "先选一项"}
            value={nextValue} onChange={(e) => setNextValue(e.target.value)} disabled={!chosen}
          />
          <textarea placeholder="为什么改（会进运营动作审计，事后复盘全靠这句）" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!chosen} />
          <button onClick={submit} disabled={!chosen || busy || reason.trim() === ""}>
            {busy ? "提交中…" : "改并留痕"}
          </button>
          {result ? <div className="notice">{result}</div> : null}
          <div style={{ color: "#8a8190", fontSize: 12 }}>
            改完只影响之后的撮合；已经存下来的候选批次快照不重算。多实例部署时其他实例要下次启动才加载。
          </div>
        </div>
      </div>

      {engine.notTunableNotes?.map((n) => <div className="notice" key={n} style={{ marginBottom: 6 }}>{n}</div>)}

      <div className="section-title"><h2>撮合留痕 · 当时为什么这么排</h2><span>GET /v1/operator/matching/trace · 读库里存的快照，不重算</span></div>
      {!trace ? <div className="notice">加载留痕…</div> : (
        <>
          <div className="kpi-grid">
            <div className="kpi"><div className="label">留痕次数</div><div className="value">{trace.summary.batches.toLocaleString()}</div><div className="meta">supply.candidate_batches</div></div>
            <div className="kpi"><div className="label">带得分明细的</div><div className="value">{trace.summary.batchesWithRanking.toLocaleString()}</div><div className="meta">早于 MATCH-RANK-001 的没有</div></div>
            <div className="kpi"><div className="label">最近一次</div><div className="value">{trace.summary.batches ? trace.summary.newest.slice(0, 10) : "—"}</div><div className="meta">最早 {trace.summary.batches ? trace.summary.oldest.slice(0, 10) : "—"}</div></div>
          </div>
          {trace.notes?.map((n) => <div className="notice" key={n} style={{ marginBottom: 6 }}>{n}</div>)}
          {!trace.batches || trace.batches.length === 0 ? (
            <div className="notice">这一页现在是空的。</div>
          ) : trace.batches.map((b) => (
            <div className="card" key={b.batchId} style={{ marginBottom: 10 }}>
              <div className="section-title" style={{ marginTop: 0 }}>
                <h2>{b.needId}{b.shortage ? " · 缺供给" : ""}</h2>
                <span>{b.batchId} · {b.createdAt.slice(0, 16).replace("T", " ")} · {b.marketId || "没有市场"} · {b.candidateCount} 个候选</span>
              </div>
              {b.shortageNote ? <div className="notice">{b.shortageNote}</div> : null}
              {!b.candidates || b.candidates.length === 0 ? (
                <div className="notice">这份快照读不出候选（存进来的形状不是数组）。</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>候选</th><th className="numc">报价</th><th className="numc">可靠</th><th className="numc">满意</th>
                        <th className="numc">经验</th><th className="numc">响应</th><th className="numc">适配</th><th className="numc">总分</th></tr>
                    </thead>
                    <tbody>
                      {b.candidates.map((c) => (
                        <tr key={c.agentId}>
                          <td>
                            {c.name || "（没有名字）"}
                            <div style={{ color: "#8a8190", fontSize: 11 }}>{c.agentId}{c.rankingReason ? ` · ${c.rankingReason}` : ""}</div>
                          </td>
                          <td className="numc">{c.referencePrice.toLocaleString()} {c.currency ?? ""}</td>
                          {c.ranking ? (
                            <>
                              <td className="numc">{c.ranking.reliability}</td>
                              <td className="numc">{c.ranking.satisfaction}</td>
                              <td className="numc">{c.ranking.experience}</td>
                              <td className="numc">{c.ranking.response}</td>
                              <td className="numc">{c.ranking.fit}</td>
                              <td className="numc"><b>{c.ranking.total}</b></td>
                            </>
                          ) : (
                            <td className="numc" colSpan={6}>这批存进来时还没有得分明细（MATCH-RANK-001 之前）</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </>
  );
}
