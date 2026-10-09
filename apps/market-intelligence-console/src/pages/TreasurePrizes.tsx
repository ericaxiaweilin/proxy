import { useEffect, useState } from "react";
import { opFetch, opPost } from "../lib/api";

// TREASURE-002：寻宝奖品。一个奖品 = 一个咖啡店场景上的一批券（福利活动 + 福利 + 容量池一次建齐，立即生效）。
// 奖品放进新刷出的箱子：箱子带 1~2 个券位，开箱按「券位 / 剩余开箱名额」的概率抽中；
// 下单小美的同行加成在这家店奖品还有余量时必出券。每个场景同时一个生效奖品。
// 券的成本是真实的 —— 这里建的券记在平台名下（Proxy 出资）；商家出资的券等商家后台接上再做。

type Prize = {
  id: string; sceneId: string; sceneName: string; campaignId: string; benefitId: string; label: string;
  quota: number; awarded: number; status: string; createdBy: string; createdAt: string;
};
type Payload = { dataSource: string; prizes?: Prize[]; notes?: string[]; missing?: string };
type Scene = { id: string; name: string; type: string; area?: string };

const API = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? "";

export function TreasurePrizes() {
  const [data, setData] = useState<Payload | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sceneId, setSceneId] = useState("");
  const [label, setLabel] = useState("免费美式一杯");
  const [quota, setQuota] = useState("20");
  const [value, setValue] = useState("45000");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  const load = (): void => { opFetch<Payload>("/v1/operator/treasure/prizes").then(setData).catch(() => {}); };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    fetch(`${API}/v1/reality-scenes`).then((r) => r.json()).then((b: { scenes?: Scene[] }) => {
      setScenes((b.scenes ?? []).filter((s) => s.type.startsWith("咖啡")));
    }).catch(() => {});
  }, []);

  if (!data) return <div className="notice">加载寻宝奖品…</div>;
  if (data.dataSource !== "LIVE" || !data.prizes) return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;

  const active = new Set(data.prizes.filter((p) => p.status === "ACTIVE").map((p) => p.sceneId));
  const free = scenes.filter((s) => !active.has(s.id));
  const quotaN = Number(quota), valueN = Number(value), daysN = Number(days);
  const ready = sceneId !== "" && label.trim() !== "" && Number.isInteger(quotaN) && quotaN >= 1 && quotaN <= 2000 && Number.isInteger(valueN) && valueN >= 0 && Number.isInteger(daysN) && daysN >= 1 && !busy;

  const create = async (): Promise<void> => {
    setBusy(true); setErr(""); setNote("");
    try {
      await opPost("/v1/operator/treasure/prizes", { sceneId, label: label.trim(), quota: quotaN, retailValueVnd: valueN, validDays: daysN });
      setNote("奖品已生效，下一轮刷出的箱子会带券位（最多 15 分钟）。");
      setSceneId(""); load();
    } catch (e) {
      if (e instanceof Error && (e.message === "auth" || e.message === "forbidden")) { setBusy(false); return; }
      setErr(e instanceof Error && e.message ? `没建成：${e.message}` : "没建成：这个场景已有生效的奖品，或网络出错。");
    } finally { setBusy(false); }
  };
  const end = async (id: string): Promise<void> => {
    if (!window.confirm("结束后不再放进新箱子；已经领出的券不受影响。确定？")) return;
    try { await opPost("/v1/operator/treasure/prizes/end", { id }); load(); } catch { /* 登录 / 权限由 App 统一处理 */ }
  };

  return (
    <>
      <div className="section-title"><h2>寻宝奖品 · 开出咖啡券</h2><span>GET /v1/operator/treasure/prizes</span></div>
      {(data.notes ?? []).map((n) => <div key={n} className="notice">{n}</div>)}
      {note ? <div className="notice">{note}</div> : null}
      <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value)} style={{ padding: 8, minWidth: 220 }}>
            <option value="">选择咖啡店场景{free.length === 0 ? "（都已有奖品）" : ""}</option>
            {free.map((s) => <option key={s.id} value={s.id}>{s.name}{s.area ? ` · ${s.area}` : ""}</option>)}
          </select>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="券的名字" style={{ flex: 1, minWidth: 160, padding: 8 }} />
          <input value={quota} onChange={(e) => setQuota(e.target.value)} type="number" min={1} max={2000} placeholder="数量" style={{ width: 90, padding: 8 }} />
          <input value={value} onChange={(e) => setValue(e.target.value)} type="number" min={0} placeholder="零售价 ₫" style={{ width: 120, padding: 8 }} />
          <input value={days} onChange={(e) => setDays(e.target.value)} type="number" min={1} placeholder="有效天数" style={{ width: 100, padding: 8 }} />
        </div>
        {err ? <div style={{ color: "#d9534f", margin: "6px 0" }}>{err}</div> : null}
        <div style={{ marginTop: 8 }}>
          <button disabled={!ready} onClick={create}>{busy ? "提交中…" : "建立奖品并生效"}</button>
          <span style={{ color: "#8a8190", marginLeft: 8, fontSize: 11 }}>券记在平台名下（Proxy 出资）；每个场景同时一个生效奖品</span>
        </div>
      </div>
      {data.prizes.length === 0 ? <div className="notice">还没有奖品。没有奖品的场景，箱子只给成长值。</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>场景</th><th>券</th><th className="numc">已发出 / 总量</th><th>状态</th><th>建立</th><th>操作</th></tr></thead>
          <tbody>{data.prizes.map((p) => (
            <tr key={p.id}>
              <td><b>{p.sceneName}</b></td>
              <td>{p.label}</td>
              <td className="numc">{p.awarded} / {p.quota}</td>
              <td><b style={{ color: p.status === "ACTIVE" ? "#2e9d5b" : "#8a8190" }}>{p.status === "ACTIVE" ? "生效中" : "已结束"}</b></td>
              <td style={{ color: "#8a8190", fontSize: 11 }}>{p.createdAt.slice(0, 16).replace("T", " ")} · {p.createdBy}</td>
              <td>{p.status === "ACTIVE" ? <button onClick={() => end(p.id)}>结束</button> : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
