import { useEffect, useState } from "react";
import { opFetch, OpStatusError } from "../lib/api";

// OPS-PROVIDER-PROFILE-001（2026-10-08）：小美画像 —— 供给侧这一半。
//
// 列表给的是「她这个人」的底分（撮合分里不含任何一张单的报价与距离）与身上的标签数；
// 标签内容只在单个服务方的画像里给，打开会留审计。所以这一页只盘点与下钻：
// 不发邀约、不改状态、不在这里重算任何分数 —— 分项照抄后端给的 breakdown。
//
// 没完成过单的人分数来自先验，不是她表现差：hasTrackRecord 为 false 时那句话必须跟着分数一起出现，
// 不然一个 0 单的新人会被读成一个表现差的老手。没标签（tagCount 为 0）也不是「不合」。

type Breakdown = {
  reliability: number; satisfaction: number; experience: number; response: number;
  newcomerBoost: number; loadPenalty: number; total: number;
  fulfillmentRate: number; satisfactionRate: number; hasTrackRecord: boolean;
};
type Provider = {
  rank: number; userId: string; name: string; handle: string; city: string;
  services: string[]; score: number; completed: number; tagCount: number; breakdown: Breakdown;
};
type ListPayload = { dataSource: string; providers?: Provider[]; notes?: string[]; missing?: string };

type Tag = {
  axis: string; value: string; strength: number; confidence: number;
  source: string; evidenceCount: number;
};
type Dimension = { axis: string; label: string; polarity: string; tags: Tag[] };
type Profile = { tagCount: number; axisCount: number; summary: string; dimensions: Dimension[] };
type ProfilePayload = { dataSource: string; result?: { provider: Provider; profile: Profile }; missing?: string };

const DASH = "—";
const META = { color: "#8a8190", fontSize: 11 } as const;
const dash = (v: string | undefined): string => (v && v.trim() !== "" ? v : DASH);

// 极性与来源是后端给定的枚举（tagging），这里只翻成人话；没列出的照原样摆出来（不藏、也不编）。
const POLARITY: Record<string, string> = { POSITIVE: "正向", NEGATIVE: "回避", NEUTRAL: "中性" };
const SOURCE: Record<string, string> = { EXPLICIT: "主动", BEHAVIOR: "行为", MIXED: "混合" };

// 负载是从总分里扣掉的，所以带减号；0 的分项不摆，免得一行全是噪音。
const parts = (b: Breakdown): string => {
  const items: Array<[string, number, boolean]> = [
    ["可靠", b.reliability, false],
    ["满意", b.satisfaction, false],
    ["经验", b.experience, false],
    ["响应", b.response, false],
    ["新人", b.newcomerBoost, false],
    ["负载", b.loadPenalty, true],
  ];
  return items
    .filter(([, v]) => v !== 0)
    .map(([label, v, minus]) => `${label} ${minus ? "−" : ""}${v}`)
    .join(" · ");
};

// 名字给运营看：name → handle → userId，一个都没有就是「—」。
const displayName = (p: Provider): string => dash([p.name, p.handle].find((v) => (v ?? "").trim() !== "") ?? p.userId);
const tagName = (value: string): string => value.replace(/_/g, " ");

export function Providers() {
  const [data, setData] = useState<ListPayload | null>(null);
  const [selected, setSelected] = useState("");
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    opFetch<ListPayload>("/v1/operator/providers?limit=50").then(setData).catch(() => {});
  }, []);

  const pick = async (userId: string): Promise<void> => {
    // 再点同一行就收起画像。
    if (userId === selected) { setSelected(""); setProfile(null); setNotFound(false); return; }
    setSelected(userId);
    setProfile(null);
    setNotFound(false);
    try {
      setProfile(await opFetch<ProfilePayload>(`/v1/operator/providers/profile?userId=${encodeURIComponent(userId)}`));
    } catch (e) {
      // 401 / 403 / 未接入由 App 统一弹登录、无权限、未接入；其余（含 404）都是「这个人没找到」。
      if (!(e instanceof OpStatusError)) setNotFound(true);
    }
  };

  if (!data) return <div className="notice">加载小美画像…</div>;
  if (data.dataSource !== "LIVE" || !data.providers) {
    return <div className="notice"><b>未接入：</b>{data.missing ?? "没有数据源"}</div>;
  }

  const providers = data.providers;
  const notes = data.notes ?? [];
  const detail = profile?.dataSource === "LIVE" ? profile?.result : undefined;

  return (
    <>
      <div className="section-title">
        <h2>小美画像 · 撮合底分与标签画像</h2>
        <span>GET /v1/operator/providers · 只读：看单人画像会留审计</span>
      </div>

      {notes.map((n, i) => <div className="notice" key={i} style={{ marginTop: i === 0 ? 0 : 8 }}>{n}</div>)}

      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>排名</th><th>名字</th><th>城市</th><th>服务</th><th className="numc">撮合底分</th><th className="numc">完成单数</th><th className="numc">标签数</th></tr></thead>
          <tbody>
            {providers.length === 0
              ? <tr><td>{DASH}</td><td colSpan={6} style={META}>还没有服务方</td></tr>
              : providers.map((p) => (
                <tr key={p.userId} onClick={() => { void pick(p.userId); }}
                  style={{ cursor: "pointer", background: selected === p.userId ? "rgba(47,125,225,0.08)" : undefined }}>
                  <td><b>{p.rank}</b></td>
                  <td><b>{displayName(p)}</b><div style={META}>{dash(p.userId)}</div></td>
                  <td>{dash(p.city)}</td>
                  <td>{p.services.length === 0 ? DASH : p.services.join("、")}</td>
                  <td className="numc"><b>{p.score}</b></td>
                  <td className="numc">{p.completed}</td>
                  <td className="numc">{p.tagCount}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {notFound ? <div className="notice" role="alert" style={{ marginTop: 12 }}>没找到这位服务方，或没有读取权限</div> : null}

      {detail ? (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>{displayName(detail.provider)}</h3>
          <div>
            <b>撮合底分 {detail.provider.score}</b>
            <span style={META}> · {parts(detail.provider.breakdown) || DASH} · 完成单数 {detail.provider.completed}</span>
          </div>
          {detail.provider.breakdown.hasTrackRecord ? null : (
            <div style={{ ...META, marginTop: 4 }}>还没有完成过的单，分数来自先验</div>
          )}
          <div style={META}>{detail.provider.userId}</div>

          {detail.profile.summary ? <div style={{ margin: "10px 0" }}>{detail.profile.summary}</div> : null}

          {detail.profile.tagCount === 0 ? (
            <div className="notice" style={{ marginTop: 10 }}>还没有标签（没同意浏览、也没有主动行为）</div>
          ) : (
            detail.profile.dimensions.map((d) => (
              <div key={d.axis} style={{ marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <b>{dash(d.label)}</b>
                  <span className="badge">{POLARITY[d.polarity] ?? d.polarity}</span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {d.tags.length === 0
                    ? <span style={META}>这个轴上没有标签</span>
                    : d.tags.map((t) => (
                      <span className="badge" key={`${t.axis}|${t.value}`}>
                        {tagName(t.value)}
                        <span style={{ ...META, marginLeft: 6 }}>{t.strength.toFixed(2)}</span>
                        <span style={{ ...META, marginLeft: 4 }}>{SOURCE[t.source] ?? t.source}</span>
                      </span>
                    ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </>
  );
}
