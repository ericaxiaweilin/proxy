import { useState } from "react";
import { beginEmailLogin, completeEmailLogin, type OpStatus } from "../lib/api";

// OPS-REAL-001：未登录 / 非运营 → 邮箱验证码登录；未接入 → 说清楚为什么不给数，不给数字。
export function OpsGate({ status, onLoggedIn }: { status: OpStatus; onLoggedIn: () => void }) {
  if (status.kind === "notConnected") {
    return (
      <div className="content">
        <div className="notice" role="status">
          {/* 「后端还没做这件事」那句话以前是准的（那一页确实没实现），现在 NOT_CONNECTED 也承载
              策略性的拒绝：例如比率型指标在没声明数据环境的库上一律不给（OPS-DATA-ENV-001），
              那时候模块是有的、查询也跑得动。所以这里不能再替后端断言原因，只把后端给出的那句
              原样说出来 —— 原因由服务端负责写准确。 */}
          <b>这一页不给数</b>：{status.missing || "后端没有说明原因。"}
          {status.spec ? <div style={{ marginTop: 6, opacity: 0.75 }}>规格：{status.spec}</div> : null}
        </div>
      </div>
    );
  }
  return <LoginBox forbidden={status.kind === "forbidden"} onLoggedIn={onLoggedIn} />;
}

function LoginBox({ forbidden, onLoggedIn }: { forbidden: boolean; onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "没有成功"); } finally { setBusy(false); }
  };
  return (
    <div className="content">
      <div className="card" style={{ maxWidth: 420 }}>
        <h3>{forbidden ? "这个账号不是运营" : "运营登录"}</h3>
        <p className="notice" style={{ marginBottom: 12 }}>
          {forbidden
            ? "已登录，但不在运营白名单（PROXY_OPERATOR_PRINCIPALS）里。请用运营账号的邮箱重新登录，或让管理员把这个账号加进白名单。"
            : "只有运营白名单里的账号能看。用 App 同一个邮箱登录，验证码会发到邮箱。"}
        </p>
        {!challengeId ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => setChallengeId(await beginEmailLogin(email))); }}>
            <input autoFocus onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" style={{ width: "100%", padding: 8 }} type="email" value={email} />
            <button disabled={busy || !email.includes("@")} style={{ marginTop: 8 }} type="submit">{busy ? "发送中…" : "发送验证码"}</button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await completeEmailLogin(challengeId, code); onLoggedIn(); }); }}>
            <input autoFocus inputMode="numeric" onChange={(e) => setCode(e.target.value)} placeholder="邮箱里的验证码" style={{ width: "100%", padding: 8 }} value={code} />
            <button disabled={busy || code.trim().length < 4} style={{ marginTop: 8 }} type="submit">{busy ? "验证中…" : "登录"}</button>
          </form>
        )}
        {error ? <p style={{ color: "#b3261e", marginTop: 8 }}>{error}</p> : null}
      </div>
    </div>
  );
}
