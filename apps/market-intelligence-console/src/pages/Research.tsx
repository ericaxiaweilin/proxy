import { useEffect, useState } from "react";
import { opFetch, opPost } from "../lib/api";

// OPS-RESEARCH-001（2026-10-08/09）：实验 / 影子流量页。
//
// 这一页原来整页是 mock（读「阶段数组」和「field flow 链」这两个后端从来不发字段，
// 而桩只回 NOT_CONNECTED ⇒ 永远停在「未接入」）。现在后端是真的，四个口：
//   GET  /v1/operator/research                    盘点（阶段计数 + 明细 + 最近影子判定）
//   POST /v1/operator/research/experiments        注册实验（一律 DRAFT）
//   POST /v1/operator/research/experiments/stage  推阶段（DRAFT→LAB→SHADOW→PROD，可收尾）
//   POST /v1/operator/research/shadow             投一次真实快照跑影子判定
//
// 读写都要有：只做读的一半，三个写口就成了没人调用的死通道（本仓反复出现过的那种）。
//
// 有意不做（页面上写明，不让空转的机器冒充能力）：流量分桶 / 置信区间 / 自动晋级 ——
// 没有行为样本之前那些都是空转的机器。影子判定用的是与线上**同一个内核**（暴雨规则），
// 所以影子里看到的判定质量就是线上判定质量；NO_UI_CHANGE 多数是「规则没覆盖」，不是「没事」。

type Stage = "DRAFT" | "LAB" | "SHADOW" | "PROD" | "ENDED";
type Experiment = {
  experiment_id: string; name: string; hypothesis: string; surface: string;
  stage: Stage; traffic_pct: number; created_at: string; updated_at: string; version: number;
};
type ShadowEvaluation = {
  evaluation_id: string; experiment_id: string;
  snapshot: Record<string, unknown>; intent: Record<string, unknown> | null;
  no_change_reason: string; decided_at: string;
};
type Payload = {
  dataSource?: string; missing?: string;
  stage_counts?: Partial<Record<Stage, number>>;
  experiments?: Experiment[];
  recent_shadow_evals?: ShadowEvaluation[];
  notes?: string[];
};

const STAGES: Stage[] = ["DRAFT", "LAB", "SHADOW", "PROD", "ENDED"];
const STAGE_LABEL: Record<Stage, string> = {
  DRAFT: "草稿", LAB: "实验室", SHADOW: "影子", PROD: "正式", ENDED: "已收尾",
};
const STAGE_DESC: Record<Stage, string> = {
  DRAFT: "只登记了假设，没有任何流量。",
  LAB: "离线试跑，不进真实请求。",
  SHADOW: "对真实快照真的判定，结果只进库、不进 App。",
  PROD: "真实流量。今天没有自动晋级，这一步只能人工推。",
  ENDED: "已收尾，仍留在盘里（收尾不是消失）。",
};
const NEXT_STAGE: Record<Stage, Stage | undefined> = {
  DRAFT: "LAB", LAB: "SHADOW", SHADOW: "PROD", PROD: undefined, ENDED: undefined,
};
const STAGE_CLASS: Record<Stage, string> = {
  DRAFT: "lab", LAB: "lab", SHADOW: "shadow", PROD: "prod", ENDED: "",
};

const WEATHERS = ["clear", "light_rain", "heavy_rain"];
const when = (v: string | undefined): string => (v ? new Date(v).toLocaleString() : "—");

export function Research() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState("");
  const load = (): void => {
    opFetch<Payload>("/v1/operator/research").then(setData).catch(() => {});
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  if (!data) return <div className="notice">加载实验 / 影子流量…</div>;
  if (data.dataSource !== "LIVE") {
    return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;
  }

  const counts = data.stage_counts ?? {};
  const rows = data.experiments ?? [];
  const evals = data.recent_shadow_evals ?? [];
  const shadowExps = rows.filter((e) => e.stage === "SHADOW");

  return (
    <>
      <div className="section-title">
        <h2>实验 / 影子流量 · Lab → Shadow → Prod</h2>
        <span>GET /v1/operator/research · 每 30 秒刷新</span>
      </div>

      <div className="research-grid">
        {STAGES.map((s) => (
          <div key={s} className="research-card">
            <h3>{STAGE_LABEL[s]} <span style={{ color: "#8a8190", fontWeight: 400 }}>{s}</span></h3>
            <p>{STAGE_DESC[s]}</p>
            <span className={`stage ${STAGE_CLASS[s]}`}>{counts[s] ?? 0} 实验</span>
          </div>
        ))}
      </div>

      {(data.notes ?? []).map((n, i) => <div key={i} className="notice" style={{ marginTop: 8 }}>{n}</div>)}

      {err ? <div style={{ color: "#d9534f", margin: "8px 0" }}>{err}</div> : null}

      <RegisterForm onDone={() => { setErr(""); load(); }} onError={setErr} />

      <div className="section-title"><h2>实验明细</h2><span>{rows.length} 条</span></div>
      {rows.length === 0 ? <div className="notice">还没有任何实验。上面注册一条，它会以 DRAFT 起步。</div> : (
        <div className="table-wrap"><table>
          <thead><tr>
            <th>实验</th><th>面</th><th>阶段</th><th className="numc">流量</th>
            <th className="numc">版本</th><th>最近更新</th><th>推阶段</th>
          </tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.experiment_id}>
              <td>
                <b>{e.name}</b>
                <div style={{ color: "#8a8190", fontSize: 11 }}>{e.experiment_id}</div>
                {e.hypothesis ? <div style={{ color: "#8a8190", fontSize: 11 }}>{e.hypothesis}</div> : null}
              </td>
              <td>{e.surface || "—"}</td>
              <td><b>{STAGE_LABEL[e.stage] ?? e.stage}</b><div style={{ color: "#8a8190", fontSize: 11 }}>{e.stage}</div></td>
              <td className="numc">{e.traffic_pct}%</td>
              <td className="numc">{e.version}</td>
              <td>{when(e.updated_at)}</td>
              <td><StageActions exp={e} onDone={() => { setErr(""); load(); }} onError={setErr} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      <ShadowForm shadowExps={shadowExps} onDone={() => { setErr(""); load(); }} onError={setErr} />

      <div className="section-title"><h2>最近的影子判定</h2><span>{evals.length} 条 · 结果只进库，不进 App</span></div>
      {evals.length === 0 ? (
        <div className="notice">
          还没有影子判定。{shadowExps.length === 0
            ? "（现在没有处于 SHADOW 阶段的实验 —— 先把一条实验推到影子。）"
            : "（有实验在影子阶段却一次都没投过 —— 那意味着引擎没在被影子验证，别把「在 SHADOW」当成「已在验证」。）"}
        </div>
      ) : (
        <div className="table-wrap"><table>
          <thead><tr><th>时间</th><th>实验</th><th>判定</th><th>快照</th></tr></thead>
          <tbody>{evals.map((ev) => (
            <tr key={ev.evaluation_id}>
              <td>{when(ev.decided_at)}</td>
              <td>{ev.experiment_id}</td>
              <td>
                {ev.intent
                  ? <b>{String(ev.intent.kind ?? "有意图")}</b>
                  : <span style={{ color: "#8a8190" }}>NO_UI_CHANGE{ev.no_change_reason ? ` · ${ev.no_change_reason}` : ""}</span>}
              </td>
              <td style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 11 }}>
                {Object.entries(ev.snapshot ?? {}).map(([k, v]) => `${k}=${String(v)}`).join(" · ") || "—"}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function StageActions({ exp, onDone, onError }: { exp: Experiment; onDone: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const next = NEXT_STAGE[exp.stage];
  const go = async (to: Stage): Promise<void> => {
    setBusy(true);
    try {
      await opPost("/v1/operator/research/experiments/stage", { experiment_id: exp.experiment_id, to });
      onDone();
    } catch {
      onError(`推阶段没成功（${exp.experiment_id} → ${to}）：这一步可能不合法，或这条实验刚被别人改过（版本冲突）。刷新后再看。`);
    } finally {
      setBusy(false);
    }
  };
  if (exp.stage === "ENDED") return <span style={{ color: "#8a8190", fontSize: 11 }}>已收尾</span>;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {next ? <button disabled={busy} onClick={() => void go(next)}>{busy ? "…" : `→ ${STAGE_LABEL[next]}`}</button> : null}
      <button disabled={busy} onClick={() => void go("ENDED")} style={{ color: "#8a8190" }}>收尾</button>
    </div>
  );
}

function RegisterForm({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [surface, setSurface] = useState("home");
  const [traffic, setTraffic] = useState("0");
  const [busy, setBusy] = useState(false);
  const ready = id.trim() !== "" && name.trim() !== "" && !busy;

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await opPost("/v1/operator/research/experiments", {
        experiment_id: id.trim(), name: name.trim(), hypothesis: hypothesis.trim(),
        surface: surface.trim() || "home", traffic_pct: Number(traffic) || 0,
      });
      setId(""); setName(""); setHypothesis(""); setTraffic("0");
      setOpen(false);
      onDone();
    } catch {
      onError("没注册上：id 可能已经存在，或字段不合法。改一下再试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", gap: 6, margin: "12px 0 0" }}>
        <button onClick={() => setOpen(!open)} style={open ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>
          {open ? "收起注册表单" : "注册实验"}
        </button>
      </div>
      {open ? (
        <div className="panel" style={{ padding: 12, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={id} onChange={(e) => setId(e.target.value)} placeholder="实验 ID（必填，唯一）" style={{ flex: 1, minWidth: 200, padding: 8 }} />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名字（必填）" style={{ flex: 1, minWidth: 180, padding: 8 }} />
            <input value={surface} onChange={(e) => setSurface(e.target.value)} placeholder="面（默认 home）" style={{ width: 140, padding: 8 }} />
            <input value={traffic} onChange={(e) => setTraffic(e.target.value)} placeholder="流量 %" style={{ width: 100, padding: 8 }} />
          </div>
          <textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="假设（选填）—— 写清楚「改了什么、预期哪个指标动」" rows={2} style={{ width: "100%", marginTop: 8 }} />
          <div style={{ marginTop: 8 }}>
            <button disabled={!ready} onClick={() => void submit()}>{busy ? "提交中…" : "注册（以 DRAFT 起步）"}</button>
            <span style={{ color: "#8a8190", marginLeft: 8, fontSize: 11 }}>
              注册只登记假设，不产生任何流量；阶段要一步步人工推。
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ShadowForm({ shadowExps, onDone, onError }: { shadowExps: Experiment[]; onDone: () => void; onError: (m: string) => void }) {
  const [expId, setExpId] = useState("");
  const [snapshotId, setSnapshotId] = useState("");
  const [weather, setWeather] = useState("heavy_rain");
  const [friction, setFriction] = useState("0.2");
  const [capacity, setCapacity] = useState("0.9");
  const [eta, setEta] = useState("40");
  const [busy, setBusy] = useState(false);
  const ready = shadowExps.length > 0 && expId !== "" && snapshotId.trim() !== "" && !busy;

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await opPost("/v1/operator/research/shadow", {
        experiment_id: expId,
        snapshot: {
          context_snapshot_id: snapshotId.trim(),
          weather,
          mobility_friction: Number(friction) || 0,
          delivery_capacity: Number(capacity) || 0,
          commute_eta: Number(eta) || 0,
        },
      });
      onDone();
    } catch {
      onError("影子判定没跑成：快照字段不合法（weather 只能是 clear / light_rain / heavy_rain，摩擦与运力在 0–1，ETA ≤ 480），或这条实验已经不在 SHADOW 阶段。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="section-title"><h2>投一次影子判定</h2><span>引擎真的跑，结果进库、不进 App</span></div>
      {shadowExps.length === 0 ? (
        <div className="notice">
          没有处于 SHADOW 阶段的实验，所以现在投不了影子。影子流量只存在于 SHADOW 阶段 ——
          DRAFT / LAB 还没上影子，PROD 已经是真流量。
        </div>
      ) : (
        <div className="panel" style={{ padding: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={expId} onChange={(e) => setExpId(e.target.value)} style={{ padding: 8, minWidth: 220 }}>
              <option value="">选择 SHADOW 阶段的实验</option>
              {shadowExps.map((e) => <option key={e.experiment_id} value={e.experiment_id}>{e.name}（{e.experiment_id}）</option>)}
            </select>
            <input value={snapshotId} onChange={(e) => setSnapshotId(e.target.value)} placeholder="ContextSnapshot ID（必填）" style={{ flex: 1, minWidth: 220, padding: 8 }} />
            <select value={weather} onChange={(e) => setWeather(e.target.value)} style={{ padding: 8 }}>
              {WEATHERS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <input value={friction} onChange={(e) => setFriction(e.target.value)} placeholder="移动摩擦 0–1" style={{ width: 150, padding: 8 }} />
            <input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="运力 0–1" style={{ width: 140, padding: 8 }} />
            <input value={eta} onChange={(e) => setEta(e.target.value)} placeholder="通勤 ETA 分钟（≤480）" style={{ width: 200, padding: 8 }} />
          </div>
          <div style={{ marginTop: 8 }}>
            <button disabled={!ready} onClick={() => void submit()}>{busy ? "判定中…" : "跑影子判定"}</button>
            <span style={{ color: "#8a8190", marginLeft: 8, fontSize: 11 }}>
              用的是与线上同一个内核（暴雨规则）—— 影子里看到的判定质量就是线上判定质量。
            </span>
          </div>
        </div>
      )}
    </>
  );
}
