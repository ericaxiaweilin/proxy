import { useEffect, useState } from "react";
import { opFetch } from "../lib/api";

// STORE-ATTRIBUTION-P1：门店预约与承载 —— 哪一家门店拿到了承载预约、它自己报的承载有多满。
//
// 这一页要同时回答「有多少」和「有多少能算数」：承载预约里只有自迁移 191 起写入的
// 报名行记了 store_id，老行不回填也不会回填（事后按活动文案 / 店名猜一个门店是造事实）。
// 所以覆盖率必须和门店表一起看 —— 只看门店表会把「归因率 12%」读成「88% 的客人跑了」。
//
// 口径全部来自 storeboard（apps/api-go/internal/storeboard）：activity.participants 的
// store_id / state / joined_at，加 business.scene_supply_snapshots 的最新一条。
// 后端算不出来的是 null，这里显示「—」：把「这家店从来没上报过承载」显示成 0% 是编数据
// —— 它会让运营以为「这家店报告它现在空着」，而事实是「我们没在测这家店」。

type Coverage = { bookings: number; attributed: number; rate: number | null };
type StoreRow = {
  storeId: string; name: string; businessId: string;
  bookings: number; cancelled: number; cancelRate: number | null;
  capacityPct: number | null; forecastPct: number | null; acceptingTraffic: boolean | null;
  snapshotAt: string | null; snapshotAgeMinutes: number | null;
  peakPeople: number | null; peakActivity: string | null; peakTime: string | null; loadPct: number | null;
};
type Board = {
  coverage: Coverage;
  attributedSince: string | null;
  stores: StoreRow[];
  unclaimedScenes: number;
  capacityPeople: number;
};
type BoardPayload = { dataSource: string; windowDays: number; board?: Board; notes?: string[] };

const WINDOWS = [7, 30, 90];
const DASH = "—";
const META = { color: "#8a8190", whiteSpace: "normal" } as const;
// 快照超过这个分钟数就不再代表「现在」，页面把它标红（不是丢弃）。
const STALE_MINUTES = 60;

const pct = (v: number | null): string => (v == null ? DASH : `${(v * 100).toFixed(1)}%`);
const load = (v: number | null): string => (v == null ? DASH : `${v}%`);
// 估算承载：80% 起偏满（琥珀），100% 起满（红）。线是 2026-10-08 用户定的：一家店 90 分钟内按 50 人（≈25 对）算。
const WARN_PCT = 80;
const estimateStyle = (v: number | null): { color: string; fontWeight: number } | undefined =>
  v == null ? undefined : v >= 100 ? { color: "#d9534f", fontWeight: 800 } : v >= WARN_PCT ? { color: "#c9a227", fontWeight: 800 } : undefined;
const traffic = (v: boolean | null): string => (v == null ? DASH : v ? "是" : "否");
// 运营在越南：按浏览器本地时间显示（接口里存的是 UTC）。
const day = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function StoreBoard() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<BoardPayload | null>(null);

  useEffect(() => {
    setData(null);
    opFetch<BoardPayload>(`/v1/operator/store-board?days=${days}`).then(setData).catch(() => {});
  }, [days]);

  const board = data?.board;

  return (
    <>
      <div className="section-title">
        <h2>门店预约与承载 · 哪一家店拿到了承载预约、它现在有多满</h2>
        <span>GET /v1/operator/store-board · 报名归因只算迁移 191 之后写入的门店，老单不补</span>
      </div>

      <div className="controls">
        {WINDOWS.map((d) => (
          <button key={d} onClick={() => setDays(d)}
            style={days === d ? { fontWeight: 700, borderColor: "#2f7de1" } : undefined}>近 {d} 天</button>
        ))}
      </div>

      {!board ? (
        <div className="notice">
          {data?.notes?.length ? data.notes.join(" · ") : `加载近 ${days} 天的门店预约数据…`}
        </div>
      ) : (
        <>
          <div className="card">
            <h3>归属覆盖</h3>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              已归属到门店的预约 {board.coverage.attributed} / {board.coverage.bookings}（{pct(board.coverage.rate)}）
            </div>
            <div style={META}>
              {board.attributedSince
                ? `只统计 ${day(board.attributedSince)} 之后的预约；之前的老预约没有门店信息，也不会补`
                : "还没有一单带门店信息"}
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3>没有门店认领的场景</h3>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{board.unclaimedScenes}</div>
            <div style={META}>
              这段时间有预约、但那个场景没有任何在营门店认领 —— 这些预约进不了任何一家店
            </div>
          </div>

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>门店</th>
                  <th style={{ textAlign: "right" }}>预约</th>
                  <th style={{ textAlign: "right" }}>取消</th>
                  <th style={{ textAlign: "right" }}>取消率</th>
                  <th style={{ textAlign: "right" }}>单场最高人数</th>
                  <th style={{ textAlign: "right" }}>估算承载</th>
                  <th style={{ textAlign: "right" }}>承载</th>
                  <th style={{ textAlign: "right" }}>预测</th>
                  <th>接流量</th>
                  <th>数据新鲜度</th>
                </tr>
              </thead>
              <tbody>
                {board.stores.length === 0
                  ? <tr><td>{DASH}</td><td colSpan={9} style={META}>没有在营门店</td></tr>
                  : board.stores.map((s) => (
                    <tr key={s.storeId}>
                      <td>
                        {s.name}
                        <div style={{ color: "#8a8190", fontSize: 9 }}>{s.storeId}</div>
                      </td>
                      <td className="numc">{s.bookings}</td>
                      <td className="numc">{s.cancelled}</td>
                      <td className="numc">{pct(s.cancelRate)}</td>
                      <td className="numc">
                        {s.peakPeople == null ? DASH : s.peakPeople}
                        {s.peakActivity ? <div style={{ ...META, fontSize: 11 }}>{s.peakActivity}{s.peakTime ? ` · ${s.peakTime}` : ""}</div> : null}
                      </td>
                      <td className="numc" style={estimateStyle(s.loadPct)}>{load(s.loadPct)}</td>
                      <td className="numc">{load(s.capacityPct)}</td>
                      <td className="numc">{load(s.forecastPct)}</td>
                      <td>{traffic(s.acceptingTraffic)}</td>
                      <td style={s.snapshotAgeMinutes != null && s.snapshotAgeMinutes > STALE_MINUTES ? { color: "#d9534f", fontWeight: 800 } : undefined}>
                        {s.snapshotAgeMinutes == null ? DASH : `${s.snapshotAgeMinutes} 分钟前`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="notice" style={{ marginTop: 10 }}>
            估算承载 = 窗口内「单场活动」里该店最高的预约人数（一对 2 人）÷ {data.board?.capacityPeople ?? 50} 人：
            一家店我们不知道它什么时候真的满，一家正常咖啡店 90 分钟按 50 人（约 25 对）算，再多就吵闹拥挤、
            也和「鼓励线下一对一约」相悖；80% 起偏满，100% 起满。活动时间目前只是文字标签，还不能精确到
            90 分钟窗口，同一家店同一时段开两场会被低估。<br />
            承载 / 预测 / 接流量 / 数据新鲜度来自该店最新一条 scene_supply_snapshots 快照：
            从来没上报过的店这四列是「—」，不是 0。预约 = 窗口内 CONFIRMED 的报名行，
            取消 = 窗口内其余状态（取消 / 候补 / 爽约），取消率的分母是两者之和。
          </div>
        </>
      )}
    </>
  );
}