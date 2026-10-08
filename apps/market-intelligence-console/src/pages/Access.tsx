import { useEffect, useState } from "react";
import { opFetch } from "../lib/api";

// OPS-ACCESS-001：运营权限自己的可观测面。
//
// 「谁是运营、他能做什么」此前只存在于两个 env 变量里，而且 PROXY_OPERATOR_SCOPES 的
// 解析器和测试都写好了却从没被接上 —— 12 个 scope 的词汇表和 36 条门命令的 required
// scope 映射在运行时全是装饰，白名单里人人恒持全部 scope。
//
// 这一页只读：授权仍然只在 env 里改，改完重启 api。让 web 控制台能铸运营权限是一条
// 自我提权路径，得先有 MFA / JIT 才配。
type ScopeInfo = { scope: string; description: string; commands: string[] };
type PrincipalInfo = { principalId: string; scopes: string[]; narrowed: boolean; source: string };
type AuditEntry = {
  operatorId: string; principalId: string; action: string; targetKind?: string; targetId?: string;
  scope?: string; outcome: string; detail?: Record<string, unknown>; requestId?: string; actedAt: string;
};
type Payload = {
  dataSource: string;
  scopes: ScopeInfo[];
  principals: PrincipalInfo[];
  me?: { principalId: string; actorId: string; scopes: string[]; narrowed: boolean };
  // OPS-DATA-ENV-001：这台进程连的是哪一套数据，是部署声明的，不是从行里推出来的。
  dataEnv?: { variable: string; declared: string; businessRatesPublished: boolean; note: string };
  audit: {
    connected: boolean; recorded?: number; writeFailed?: number; writeFailedNote?: string;
    recent?: AuditEntry[]; recentError?: string;
  };
  notes: string[];
};

const OUTCOME_LABEL: Record<string, string> = { OK: "成功", DENIED: "被拒", ERROR: "出错" };

function ScopePills({ scopes }: { scopes: string[] }) {
  if (scopes.length === 0) {
    // 空集不是「没配」，是「明确全拒」。这两种在界面上必须长得不一样。
    return <span className="badge" style={{ background: "#fde7e7", color: "#a32020" }}>无 scope · 全拒</span>;
  }
  return <>{scopes.map((s) => <span className="pill" key={s} style={{ marginRight: 4 }}>{s}</span>)}</>;
}

export function Access() {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const load = () => opFetch<Payload>("/v1/operator/access").then(setData).catch(() => {});
  useEffect(() => { void load(); }, []);
  if (!data) return <div className="notice">加载运营权限…</div>;

  const gatedTotal = data.scopes.reduce((n, s) => n + s.commands.length, 0);
  return (
    <>
      <div className="section-title">
        <h2>我的权限</h2>
        <span><button onClick={() => void load()}>刷新</button></span>
      </div>
      <div className="card">
        {data.me ? (
          <>
            <div><b>{data.me.principalId}</b> <span style={{ color: "#8a8190" }}>actor {data.me.actorId || "—"}</span></div>
            <div style={{ marginTop: 6 }}>
              <ScopePills scopes={data.me.scopes} />
            </div>
            <div style={{ color: "#8a8190", fontSize: 12, marginTop: 6 }}>
              {data.me.narrowed
                ? "这个 principal 在 PROXY_OPERATOR_SCOPES 里被显式收窄过，只有上面这几个 scope。"
                : "这个 principal 没有在 PROXY_OPERATOR_SCOPES 里配条目 —— 按接线之前的老行为持全部 scope。"}
            </div>
          </>
        ) : <div className="notice">取不到自己的身份（会话可能刚过期）</div>}
      </div>

      <div className="section-title">
        <h2>运营白名单</h2>
        <span>{data.principals.length} 个 principal · 来源 {data.principals[0]?.source ?? "env"}</span>
      </div>
      <div className="card">
        {data.principals.length === 0 ? <div className="notice">白名单是空的 —— PROXY_OPERATOR_PRINCIPALS 未配，运营门 fail-closed，谁都进不来。</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>principal</th><th>状态</th><th>持有的 scope</th></tr></thead>
              <tbody>
                {data.principals.map((p) => (
                  <tr key={p.principalId}>
                    <td>{p.principalId}</td>
                    <td>{p.narrowed ? "已收窄" : "未收窄（全 scope）"}</td>
                    <td><ScopePills scopes={p.scopes} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="section-title">
        <h2>scope 词汇表</h2>
        <span>{data.scopes.length} 个域 · 共管住 {gatedTotal} 条特权命令</span>
      </div>
      <div className="card">
        {data.scopes.map((s) => (
          <div key={s.scope} style={{ borderBottom: "1px solid #eee9f0", padding: "8px 0" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <button onClick={() => setOpen((o) => ({ ...o, [s.scope]: !o[s.scope] }))} style={{ minWidth: 24 }}>
                {open[s.scope] ? "−" : "+"}
              </button>
              <b>{s.scope}</b>
              <span style={{ color: "#8a8190", fontSize: 12 }}>{s.commands.length} 条命令</span>
            </div>
            <div style={{ fontSize: 13, marginTop: 2 }}>{s.description || <span style={{ color: "#b3261e" }}>（这个 scope 没有说明文案）</span>}</div>
            {open[s.scope] ? (
              s.commands.length === 0
                ? <div className="notice" style={{ marginTop: 6 }}>没有任何门命令要这个 scope —— 它只由 HTTP 端点用，或者已经烂尾。</div>
                : <div style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#5c5466" }}>{s.commands.join(" · ")}</div>
            ) : null}
          </div>
        ))}
      </div>

      {/* OPS-DATA-ENV-001：这一项跟权限无关，但它决定了别的那些页给不给比率，所以必须在这里看得见。
          「声明了什么」和「据此发布了什么」要分开摆 —— 只有 production 算声明成生产，
          prod / Production 这种手误落在「不给比率」那一侧，界面上得说它被当成了什么。 */}
      <div className="section-title">
        <h2>这套读数出自哪套数据</h2>
        <span>{data.dataEnv ? `${data.dataEnv.variable} · 只读` : "加载中…"}</span>
      </div>
      {data.dataEnv ? (
        <div className="card">
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <b>数据环境</b>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
              {data.dataEnv.declared ? data.dataEnv.declared : "（未声明）"}
            </span>
            {data.dataEnv.businessRatesPublished
              ? <span className="badge" style={{ background: "#e6f4ea", color: "#1e6930" }}>比率型指标已发布</span>
              : <span className="badge" style={{ background: "#fde7e7", color: "#a32020" }}>比率型指标停用 · 只给原始计数</span>}
          </div>
          <div className="notice" style={{ marginTop: 8 }}>{data.dataEnv.note}</div>
        </div>
      ) : null}

      <div className="section-title">
        <span>
          {data.audit.connected
            ? `已接 · 本进程记了 ${data.audit.recorded ?? 0} 条${(data.audit.writeFailed ?? 0) > 0 ? ` · 写失败 ${data.audit.writeFailed} 条` : ""}`
            : "未接（没有配数据库）"}
        </span>
      </div>
      <div className="card">
        {!data.audit.connected ? (
          <div className="notice">审计没接上：operator.action_log 需要数据库。运营写操作照常执行，但没人能回答「谁在什么时候碰了什么」。</div>
        ) : (
          <>
            {(data.audit.writeFailed ?? 0) > 0 ? (
              <div className="notice" style={{ background: "#fde7e7", color: "#a32020", marginBottom: 8 }}>
                有 {data.audit.writeFailed} 条动作写不进审计。动作不会被回滚（它已经发生了），但这个缺口必须看得见。
                {data.audit.writeFailedNote ? <div style={{ marginTop: 4, opacity: 0.8 }}>{data.audit.writeFailedNote}</div> : null}
              </div>
            ) : null}
            {data.audit.recentError ? <div className="notice">审计读不出来：{data.audit.recentError}</div> : null}
            {(data.audit.recent ?? []).length === 0 && !data.audit.recentError ? (
              <div className="notice">还没有运营动作 —— 不是"干净"，是这个进程刚起、还没人写过。</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>时间</th><th>运营</th><th>动作</th><th>对象</th><th>依据 scope</th><th>结果</th></tr></thead>
                  <tbody>
                    {(data.audit.recent ?? []).map((e, i) => (
                      <tr key={`${e.actedAt}-${i}`}>
                        <td style={{ whiteSpace: "nowrap" }}>{new Date(e.actedAt).toLocaleString()}</td>
                        <td>{e.operatorId}</td>
                        <td>{e.action}</td>
                        <td>{e.targetId ? `${e.targetKind ?? ""} ${e.targetId}` : e.targetKind || "—"}</td>
                        <td>{e.scope || "—"}</td>
                        <td>{OUTCOME_LABEL[e.outcome] ?? e.outcome}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        {data.notes.map((n) => <div key={n} className="notice" style={{ marginBottom: 6 }}>{n}</div>)}
      </div>
    </>
  );
}
