import { useEffect, useState } from "react";
import { opFetch } from "../lib/api";

// OPS-MERCHANT-001：商家管理。
//
// 原来这一页期待 `{kpis, top_merchants:[{name, impressions, orders}]}` —— 里面那个
// `impressions`（曝光）后端根本没有来源，页面上却给它留了一列。现在按「有来源才显示」
// 重做：真数（主体 / 门店 / 成员 / 菜品 / 相册 / 营业资料完整度 / 挂到门店的订单）来自
// business.* 与 fulfillment.orders；曝光、成交额、复购一律显示「未接入」并写明缺什么。
//
// 最有信息量的一行往往是「445 张订单里挂到门店的是 0」：那不是这些店没生意，是订单到
// 门店的归因还没建。只报 0 会让人停止追问，所以后端把它写成 note 带上来，这里照原样显示。
type Totals = {
  accounts: number; stores: number; storeLines: number; productRows: number;
  orders30d: number; orders30dAll: number; storesWithOrders: number; pendingRecommendations: number;
};
type MerchantRow = {
  businessId: string; name: string; status: string; createdAt: string;
  stores: number; activeStores: number; members: number; products: number; photos: number;
  orders30d: number; storesWithDescription: number; storesWithHours: number; storesWithLogo: number;
};
type Payload = {
  dataSource: string; windowDays: number; totals: Totals; merchants: MerchantRow[] | null; notes: string[];
};

const NOT_CONNECTED: Array<[string, string]> = [
  ["曝光 / 投放效果", "没有把曝光落到具体门店的链路（store_recommendations 也没有处置记录）"],
  ["成交额 gross", "支付未接入，金额没有事实来源"],
  ["30D 复购", "留存队列（cohort）未做"],
];

export function Merchant() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    opFetch<Payload>("/v1/operator/merchant").then(setData).catch(() => {});
  }, []);
  if (!data) return <div className="notice">加载商家…</div>;

  const t = data.totals;
  const completeness = (value: number, of: number) => (of === 0 ? "—" : `${Math.round((value / of) * 100)}%`);

  return (
    <>
      <div className="section-title">
        <h2>商家盘口 · 有来源的才显示</h2>
        <span>GET /v1/operator/merchant · 近 {data.windowDays} 天</span>
      </div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">经营主体</div><div className="value">{t.accounts.toLocaleString()}</div><div className="meta">business.accounts</div></div>
        <div className="kpi"><div className="label">门店</div><div className="value">{t.stores.toLocaleString()}</div><div className="meta">business.stores</div></div>
        <div className="kpi"><div className="label">配了营业资料</div><div className="value">{t.storeLines.toLocaleString()}</div><div className="meta">{completeness(t.storeLines, t.stores)} 的门店</div></div>
        <div className="kpi"><div className="label">菜品</div><div className="value">{t.productRows.toLocaleString()}</div><div className="meta">business.store_products</div></div>
        <div className="kpi">
          <div className="label">挂到门店的订单</div>
          <div className="value">{t.orders30d.toLocaleString()}</div>
          <div className="meta">全部订单 {t.orders30dAll.toLocaleString()} · {t.storesWithOrders.toLocaleString()} 家店有单</div>
        </div>
        {NOT_CONNECTED.map(([label, why]) => (
          <div className="kpi" key={label}>
            <div className="label">{label}</div>
            <div className="value">未接入</div>
            <div className="meta">缺：{why}</div>
          </div>
        ))}
      </div>

      {data.notes?.map((n) => <div className="notice" key={n} style={{ marginBottom: 6 }}>{n}</div>)}

      <div className="section-title"><h2>经营主体</h2><span>按近 {data.windowDays} 天挂到门店的订单排序 · 最多 100 行</span></div>
      {!data.merchants || data.merchants.length === 0 ? (
        <div className="notice">库里还没有经营主体。</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>主体</th><th className="numc">门店</th><th className="numc">成员</th><th className="numc">菜品</th>
                <th className="numc">相册</th><th className="numc">订单</th><th className="numc">有简介</th>
                <th className="numc">有营业时间</th><th className="numc">有店徽</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              {data.merchants.map((m) => (
                <tr key={m.businessId}>
                  <td>
                    {m.name || "（没有名字）"}
                    <div style={{ color: "#8a8190", fontSize: 11 }}>{m.businessId}</div>
                  </td>
                  <td className="numc">{m.stores}{m.activeStores !== m.stores ? ` (${m.activeStores} 活跃)` : ""}</td>
                  <td className="numc">{m.members}</td>
                  <td className="numc">{m.products}</td>
                  <td className="numc">{m.photos}</td>
                  <td className="numc">{m.orders30d}</td>
                  <td className="numc">{m.storesWithDescription}/{m.stores}</td>
                  <td className="numc">{m.storesWithHours}/{m.stores}</td>
                  <td className="numc">{m.storesWithLogo}/{m.stores}</td>
                  <td>{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="notice">
          这一页只读。要动商家本身（推荐评估、活动与券）走带 scope 的门命令
          <span className="engine-link">DecideStoreRecommendation</span> /
          <span className="engine-link">CreateCampaign</span> /
          <span className="engine-link">ActivateCampaign</span> /
          <span className="engine-link">PauseCampaign</span>（MARKETPLACE），
          每条都会落运营动作审计；这里不重复造一个没有留痕的写入口。
        </div>
      </div>
    </>
  );
}
