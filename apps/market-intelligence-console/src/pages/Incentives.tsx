import { useEffect, useState } from "react";
import { opFetch, opPost } from "../lib/api";

// INCENTIVE-001：激励规则。
//
// 这一页回答一件事：**用户做成哪件事会拿到什么奖励、这条规则现在开着还是关着、已经发出去多少**。
// 奖励只有两种：券（替用户领一份已有的福利活动）和成长值（只记账的点数）。
//
// ⚠️ 规则默认不生效：新建 / 修改完都是「未生效」，要真的发人得显式点「打开」。
// 生效中的规则不许改内容（服务端会静默忽略），所以表里只给未生效的行提供「编辑」。

type Rule = {
  id: string; label: string; trigger: string; rewardKind: string;
  campaignId?: string; benefitId?: string; points?: number;
  minAccountAgeHours: number; active: boolean; createdBy: string; createdAt: string;
};
type Row = { rule: Rule; granted: number; failed: number; pointsGranted: number };
type Payload = {
  dataSource: string; rules?: Row[]; triggers?: string[]; rewardKinds?: string[];
  maxPoints?: number; notes?: string[]; missing?: string;
};

const BENEFIT_CLAIM = "BENEFIT_CLAIM";
const GROWTH_POINTS = "GROWTH_POINTS";

const TRIGGER: Record<string, string> = {
  FIRST_POST: "首次发帖", FIRST_DEMAND: "首次发需求", FIRST_ACTIVITY: "首次参加活动",
};
const REWARD: Record<string, string> = { [BENEFIT_CLAIM]: "券", [GROWTH_POINTS]: "成长值" };

const dash = (v: string | undefined): string => (v && v.trim() !== "" ? v : "—");
const rewardText = (r: Rule): string =>
  r.rewardKind === GROWTH_POINTS ? `成长值 +${r.points ?? 0}` : `券 · ${dash(r.campaignId)} / ${dash(r.benefitId)}`;

export function Incentives() {
  const [data, setData] = useState<Payload | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [savedNote, setSavedNote] = useState("");
  const [busyId, setBusyId] = useState("");
  const [toggleErr, setToggleErr] = useState("");
  const load = (): void => {
    opFetch<Payload>("/v1/operator/incentives").then(setData).catch(() => {});
  };
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!data) return <div className="notice">加载激励规则…</div>;
  const rows = data.rules;
  if (data.dataSource !== "LIVE" || !rows) return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;

  const openForm = (rule: Rule | null): void => {
    setEditing(rule); setSavedNote(""); setToggleErr(""); setShowForm(true);
  };
  const toggle = async (rule: Rule, active: boolean): Promise<void> => {
    if (active && !window.confirm("打开后会开始给符合条件的人发放，确定？")) return;
    setBusyId(rule.id); setToggleErr("");
    try {
      await opPost("/v1/operator/incentives/active", { id: rule.id, active });
      load();
    } catch (e) {
      if (!(e instanceof Error && (e.message === "auth" || e.message === "forbidden"))) {
        setToggleErr("没记上：规则不允许这一步，或网络出错。刷新后再看。");
      }
    } finally { setBusyId(""); }
  };

  return (
    <>
      <div className="section-title"><h2>激励规则 · 做成哪件事发什么</h2><span>GET /v1/operator/incentives · 每 30 秒刷新</span></div>
      {(data.notes ?? []).map((n) => <div key={n} className="notice">{n}</div>)}
      <div className="engine-inline" style={{ display: "flex", gap: 6, margin: "10px 0" }}>
        <button onClick={() => { if (showForm) { setShowForm(false); setEditing(null); } else openForm(null); }}
          style={showForm ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>
          {showForm ? (editing ? "收起修改表单" : "收起新建表单") : "新建规则"}
        </button>
      </div>
      {showForm ? (
        <RuleForm
          triggers={data.triggers ?? []} rewardKinds={data.rewardKinds ?? []} maxPoints={data.maxPoints ?? 1000}
          rule={editing}
          onDone={(note) => { setShowForm(false); setEditing(null); setSavedNote(note); load(); }}
        />
      ) : null}
      {savedNote ? <div className="notice">{savedNote}</div> : null}
      {toggleErr ? <div style={{ color: "#d9534f", margin: "0 0 8px" }}>{toggleErr}</div> : null}
      {rows.length === 0 ? <div className="notice">还没有规则。</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>规则</th><th>触发</th><th>奖励</th><th>账号最小年龄</th><th>状态</th><th className="numc">已发</th><th className="numc">未通过</th><th className="numc">成长值合计</th><th>操作</th></tr></thead>
          <tbody>{rows.map((it) => {
            const r = it.rule;
            return (
              <tr key={r.id}>
                <td><b>{dash(r.label)}</b><div style={{ color: "#8a8190", fontSize: 11 }}>{dash(r.id)}</div></td>
                <td>{dash(TRIGGER[r.trigger] ?? r.trigger)}</td>
                <td>{rewardText(r)}</td>
                <td>{r.minAccountAgeHours} 小时</td>
                <td><b style={{ color: r.active ? "#2e9d5b" : "#8a8190" }}>{r.active ? "生效中" : "未生效"}</b></td>
                <td className="numc">{it.granted}</td>
                <td className="numc">{it.failed ? it.failed : "—"}</td>
                <td className="numc">{r.rewardKind === GROWTH_POINTS ? it.pointsGranted : "—"}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {r.active
                      ? <button disabled={busyId === r.id} onClick={() => toggle(r, false)}>{busyId === r.id ? "提交中…" : "关闭"}</button>
                      : <button disabled={busyId === r.id} onClick={() => toggle(r, true)}>{busyId === r.id ? "提交中…" : "打开"}</button>}
                    {!r.active ? <button disabled={busyId === r.id} onClick={() => openForm(r)}>编辑</button> : null}
                  </div>
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </>
  );
}

function RuleForm({ triggers, rewardKinds, maxPoints, rule, onDone }: {
  triggers: string[]; rewardKinds: string[]; maxPoints: number; rule: Rule | null;
  onDone: (note: string) => void;
}) {
  const [label, setLabel] = useState(rule?.label ?? "");
  const [trigger, setTrigger] = useState(rule?.trigger ?? "");
  const [rewardKind, setRewardKind] = useState(rule?.rewardKind ?? "");
  const [campaignId, setCampaignId] = useState(rule?.campaignId ?? "");
  const [benefitId, setBenefitId] = useState(rule?.benefitId ?? "");
  const [points, setPoints] = useState(String(rule?.points ?? ""));
  const [ageHours, setAgeHours] = useState(String(rule?.minAccountAgeHours ?? 24));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const pointsNum = Number(points);
  const ageNum = Number(ageHours);
  const ready = label.trim() !== "" && trigger !== "" && rewardKind !== "" && !busy
    && (rewardKind === BENEFIT_CLAIM
      ? campaignId.trim() !== "" && benefitId.trim() !== ""
      : points.trim() !== "" && Number.isInteger(pointsNum) && pointsNum >= 1 && pointsNum <= maxPoints)
    && Number.isInteger(ageNum) && ageNum >= 0;

  const submit = async (): Promise<void> => {
    setBusy(true); setErr("");
    try {
      await opPost("/v1/operator/incentives", {
        ...(rule ? { id: rule.id } : {}),
        label: label.trim(), trigger, rewardKind,
        ...(rewardKind === BENEFIT_CLAIM
          ? { campaignId: campaignId.trim(), benefitId: benefitId.trim() }
          : { points: pointsNum }),
        minAccountAgeHours: ageNum,
      });
      onDone("新建的规则默认未生效。");
    } catch (e) {
      if (e instanceof Error && (e.message === "auth" || e.message === "forbidden")) { setBusy(false); return; }
      const detail = e instanceof Error && e.message ? e.message : "";
      setErr(detail ? `没记上：规则不允许这一步，或网络出错。（${detail}）` : "没记上：规则不允许这一步，或网络出错。");
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
      {rule ? <div style={{ color: "#8a8190", fontSize: 11, marginBottom: 6 }}>修改规则 {dash(rule.id)}</div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="规则名称（必填）" style={{ flex: 1, minWidth: 180, padding: 8 }} />
        <select value={trigger} onChange={(e) => setTrigger(e.target.value)} style={{ padding: 8 }}>
          <option value="">选择触发</option>
          {triggers.map((t) => <option key={t} value={t}>{TRIGGER[t] ?? t}</option>)}
        </select>
        <select value={rewardKind} onChange={(e) => setRewardKind(e.target.value)} style={{ padding: 8 }}>
          <option value="">选择奖励</option>
          {rewardKinds.map((k) => <option key={k} value={k}>{REWARD[k] ?? k}</option>)}
        </select>
      </div>
      {rewardKind === BENEFIT_CLAIM ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <input value={campaignId} onChange={(e) => setCampaignId(e.target.value)} placeholder="福利活动编号（必填）" style={{ flex: 1, minWidth: 180, padding: 8 }} />
            <input value={benefitId} onChange={(e) => setBenefitId(e.target.value)} placeholder="福利编号（必填）" style={{ flex: 1, minWidth: 180, padding: 8 }} />
          </div>
          <div style={{ color: "#8a8190", fontSize: 11, marginTop: 6 }}>咖啡券用「免费饮品」或「券」类福利</div>
        </>
      ) : null}
      {rewardKind === GROWTH_POINTS ? (
        <div style={{ marginTop: 8 }}>
          <input value={points} onChange={(e) => setPoints(e.target.value)} type="number" min={1} max={maxPoints}
            placeholder={`成长值（1..${maxPoints}）`} style={{ minWidth: 180, padding: 8 }} />
        </div>
      ) : null}
      <div style={{ marginTop: 8 }}>
        <input value={ageHours} onChange={(e) => setAgeHours(e.target.value)} type="number" min={0}
          placeholder="账号最小年龄（小时）" style={{ minWidth: 180, padding: 8 }} />
        <span style={{ color: "#8a8190", fontSize: 11, marginLeft: 8 }}>账号满这个年龄才发，默认 24 小时</span>
      </div>
      {err ? <div style={{ color: "#d9534f", margin: "6px 0" }}>{err}</div> : null}
      <div style={{ marginTop: 8 }}>
        <button disabled={!ready} onClick={submit}>{busy ? "提交中…" : "保存"}</button>
        <span style={{ color: "#8a8190", marginLeft: 8, fontSize: 11 }}>保存后是未生效，要手动打开</span>
      </div>
    </div>
  );
}
