import { useState } from "react";
import { opCommand } from "../lib/api";

// PUBLIC-NO-LOOKUP-001：客服按编号反查。用户把订单 / 报名 / 需求 / 邀约 / 活动编号念给客服，
// 这里一次找回它指向的实体。反查会暴露订单双方账号和条款，所以：
//   - 必须写理由（哪张工单 / 为什么查）；
//   - 每次查询都在服务端留一行只追加的记录（operator.number_lookups）；
//   - 留痕写不进去，服务端就不返回数据 —— 页面会明说，不会假装查无此号。
type LookupBody = {
  number: string;
  kind: "ORDER" | "ACTIVITY_PARTICIPATION" | "OPPORTUNITY" | "ACTIVITY";
  entityId: string;
  state: string;
  entity: Record<string, unknown>;
  audit: Array<Record<string, unknown>>;
};

const KIND_LABEL: Record<LookupBody["kind"], string> = {
  ORDER: "履约订单", ACTIVITY_PARTICIPATION: "活动报名订单", OPPORTUNITY: "需求 / 邀约", ACTIVITY: "活动",
};

const ERROR_TEXT: Record<string, string> = {
  LOOKUP_REASON_REQUIRED: "写一句理由（哪张工单 / 为什么查，4–200 字），事后才对得上。",
  NUMBER_NOT_FOUND: "这个号格式正确，但系统里没有对应的实体（编号没有校验位，也可能是抄错了一位，请再和用户核对）。",
  NUMBER_AMBIGUOUS: "这个号对应了不止一个实体 —— 数据完整性事故，已留痕，请转工程处理，不要凭猜测处理工单。",
  LOOKUP_INCOMPLETE: "有的业务库暂时无法按编号查询，不能断定「查无此号」。请稍后重试或转工程。",
  LOOKUP_FAILED: "查询没有成功（后端读库失败），可以重试。",
  AUDIT_WRITE_FAILED: "留痕没有写进去，为保护用户隐私这次没有返回任何数据。请重试。",
  AUDIT_NOT_CONFIGURED: "服务端没有配置查询留痕，为保护用户隐私拒绝查询。请转工程。",
  COMMAND_NOT_IMPLEMENTED: "服务端没有启用编号反查。",
};

function explain(result: { error?: { errorCode: string; safeDetails?: Record<string, unknown> } }): string {
  const code = result.error?.errorCode ?? "";
  if (code === "NUMBER_INVALID") return "这不是公共编号（应为 21 位以上纯数字；旧的 PX-… 展示码不在此列）。";
  return ERROR_TEXT[code] ?? `没有成功（${code || "未知错误"}）`;
}

function Facts({ facts }: { facts: Record<string, unknown> }) {
  return (
    <table style={{ minWidth: 0 }}>
      <tbody>
        {Object.entries(facts).map(([key, value]) => (
          <tr key={key}>
            <td style={{ color: "#8a8190", whiteSpace: "nowrap", width: 150 }}>{key}</td>
            <td>{typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "—")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function NumberLookup() {
  const [number, setNumber] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<LookupBody | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const submit = async () => {
    setBusy(true);
    setFound(undefined);
    setProblem(undefined);
    try {
      const result = await opCommand("LookupPublicNumber", { type: "PublicNumber", id: number.replace(/\s+/g, "") || "n/a" }, { number, reason });
      if (result.outcome === "ACCEPTED" && result.operationRef) setFound(JSON.parse(result.operationRef) as LookupBody);
      else setProblem(explain(result));
    } catch (e) {
      // 401 / 403 由 App 统一弹登录 / 无权限；其余给一句人话。
      if (!(e instanceof Error && (e.message === "auth" || e.message === "forbidden"))) setProblem("请求没有成功，请重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="section-title">
        <h2>编号查询</h2>
        <span>每次查询都会留痕（谁、查了哪个号、理由）</span>
      </div>
      <form className="card" onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ maxWidth: 560, marginBottom: 12 }}>
        <input autoFocus onChange={(e) => setNumber(e.target.value)} placeholder="用户报的编号，如 100 260929 100022 000001（可带空格 / 连字符）" style={{ width: "100%", padding: 8 }} value={number} />
        <input onChange={(e) => setReason(e.target.value)} placeholder="理由 / 工单号（必填），如 ticket-4213 用户来电" style={{ width: "100%", padding: 8, marginTop: 8 }} value={reason} />
        <button disabled={busy || number.trim() === "" || reason.trim().length < 4} style={{ marginTop: 8 }} type="submit">{busy ? "查询中…" : "查询"}</button>
      </form>
      {problem ? <div className="notice" role="alert" style={{ maxWidth: 560 }}>{problem}</div> : null}
      {found ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>{KIND_LABEL[found.kind]} · {found.number}{found.state ? ` · ${found.state}` : ""}</h3>
          <Facts facts={found.entity} />
          {found.audit.length > 0 ? (
            <>
              <h3 style={{ marginTop: 14 }}>变更记录（存储层审计，只追加）</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>时间</th><th>操作者</th><th>命令</th><th>状态</th><th>平台更正理由</th></tr></thead>
                  <tbody>
                    {found.audit.map((row, i) => (
                      <tr key={i}>
                        <td>{row.recordedAt ? new Date(String(row.recordedAt)).toLocaleString() : "—"}</td>
                        <td>{String(row.actorId || "—")}</td>
                        <td>{String(row.commandType || "—")}</td>
                        <td>{row.oldState ? `${String(row.oldState)} → ${String(row.newState ?? "")}` : String(row.newState ?? "—")}</td>
                        <td>{String(row.overrideReason || "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
