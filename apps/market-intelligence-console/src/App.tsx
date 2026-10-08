import { useEffect, useState } from "react";
import { OpsGate } from "./components/OpsGate";
import { clearOpsSession, onOpStatus, readOpsSession, type OpStatus } from "./lib/api";
import { Overview } from "./pages/Overview";
import { ContextField } from "./pages/ContextField";
import { Surface } from "./pages/Surface";
import { ExecutionRuntime } from "./pages/ExecutionRuntime";
import { Engine } from "./pages/Engine";
import { Clarification } from "./pages/Clarification";
import { SupplyActivation } from "./pages/SupplyActivation";
import { Behavior } from "./pages/Behavior";
import { Research } from "./pages/Research";
import { FulfillmentAttr } from "./pages/FulfillmentAttr";
import { Population } from "./pages/Population";
import { Tags } from "./pages/Tags";
import { IntentOrchestration } from "./pages/IntentOrchestration";
import { Gravity } from "./pages/Gravity";
import { ProviderApplications } from "./pages/ProviderApplications";
import { EngineAPI } from "./pages/EngineAPI";
import { Merchant } from "./pages/Merchant";
import { Matching } from "./pages/Matching";
import { Dispatch } from "./pages/Dispatch";
import { MarketBoard } from "./pages/MarketBoard";
import { StoreBoard } from "./pages/StoreBoard";
import { Retention } from "./pages/Retention";
import { Trust } from "./pages/Trust";
import { Quality } from "./pages/Quality";
import { NumberLookup } from "./pages/NumberLookup";
import { Access } from "./pages/Access";
import { Moderation } from "./pages/Moderation";
import { Appeals } from "./pages/Appeals";
import { MatchPreview } from "./pages/MatchPreview";
import { DemandGap } from "./pages/DemandGap";
import { Insights } from "./pages/Insights";

type Page = "overview" | "population" | "behavior" | "tags" | "intent" | "orchestration" | "engine" | "engineapi" | "contextfield" | "surface" | "research" | "clarification" | "supplyactivation" | "executionruntime" | "fulfillmentattr" | "merchant" | "matching" | "dispatch" | "marketboard" | "storeboard" | "retention" | "trust" | "quality" | "workbench" | "providers" | "numberlookup" | "access" | "moderation" | "appeals" | "matchpreview" | "demandgap" | "insights";

const TITLES: Record<Page, string> = {
  overview: "平台总览",
  population: "用户构成",
  behavior: "行为与兴趣",
  tags: "标签中心",
  intent: "意图与撮合",
  orchestration: "编排与调度",
  engine: "Decision Engine · 引擎总览",
  engineapi: "API / Runtime",
  contextfield: "Context / Gravity Field",
  surface: "Surface Composition",
  research: "Geometry Research",
  clarification: "Clarification Gate",
  supplyactivation: "Supply Activation",
  executionruntime: "Execution Runtime",
  fulfillmentattr: "Fulfillment Attribution",
  merchant: "商家与投放",
  matching: "撮合引擎管理",
  dispatch: "派单调度",
  marketboard: "市场发单看板",
  storeboard: "门店预约与承载",
  retention: "留存与复购",
  trust: "信任与风险",
  providers: "KYC认证审核",
  numberlookup: "编号查询",
  quality: "数据治理",
  workbench: "交叉分析工作台",
  access: "运营权限",
  moderation: "举报处置",
  appeals: "申诉复核",
  matchpreview: "撮合预览",
  demandgap: "需求缺口",
  insights: "用户洞察",
};

export function App() {
  const [page, setPageRaw] = useState<Page>("overview");
  // OPS-REAL-001：页面取数时遇到 未登录 / 非运营 / 未接入，由这里统一展示；换页清空，登录后整页重取。
  const [status, setStatus] = useState<OpStatus | undefined>(undefined);
  const [reload, setReload] = useState(0);
  // 从需求缺口页点「预览」带过来的单号；只在跳转那一次用，直接走菜单进「撮合预览」时要清空，
  // 否则表单会停在上一张单上。
  const [previewId, setPreviewId] = useState<string | undefined>(undefined);
  const [who, setWho] = useState(() => readOpsSession()?.userAccountId);
  useEffect(() => onOpStatus(setStatus), []);
  const setPage = (next: Page): void => { setStatus(undefined); setPageRaw(next); };
  const navTo = (next: Page): void => { if (next === "matchpreview") setPreviewId(undefined); setPage(next); };
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="logo">🦦</div>Proxy</div>
        {/* DISPATCH-LOOP-001：运营每天真正在用的那一页，放最上面。 */}
        <div className="navgroup">工作台</div>
        <div className="nav">
          {(["dispatch", "marketboard", "storeboard", "moderation", "appeals", "matchpreview"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => navTo(p)}>{TITLES[p]}</button>
          ))}
        </div>
        <div className="navgroup">Intelligence</div>
        <div className="nav">
          {(["overview", "population", "behavior", "tags", "intent", "orchestration", "demandgap", "insights"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => navTo(p)}>{TITLES[p]}</button>
          ))}
        </div>
        <div className="navgroup">Decision Engine</div>
        <div className="nav">
          {(["engine", "engineapi", "matching"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => navTo(p)}>{TITLES[p]}</button>
          ))}
        </div>
        <div className="navgroup">Context & Experience</div>
        <div className="nav">
          {(["contextfield", "surface", "research"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => navTo(p)}>{TITLES[p]}</button>
          ))}
        </div>
        <div className="navgroup">Market Execution</div>
        <div className="nav">
          {(["clarification", "supplyactivation", "executionruntime", "fulfillmentattr"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => navTo(p)}>{TITLES[p]}</button>
          ))}
        </div>
        <div className="navgroup">Market</div>
        <div className="nav">
          {(["providers", "numberlookup", "merchant", "retention", "trust"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => navTo(p)}>{TITLES[p]}</button>
          ))}
        </div>
        <div className="navgroup">Data</div>
        <div className="nav">
          {(["quality", "workbench"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => navTo(p)}>{TITLES[p]}</button>
          ))}
        </div>
        {/* OPS-ACCESS-001：谁能做什么，得能看见。放在最后是因为它讲的是这个控制台
            自己的权限模型，不是业务数据。 */}
        <div className="navgroup">运营权限</div>
        <div className="nav">
          {(["access"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => navTo(p)}>{TITLES[p]}</button>
          ))}
        </div>
        <div className="sidebar-foot">
          Internal only · Market Intelligence + Decision Engine<br />
          隔离文件夹：apps/market-intelligence-console<br />
          <a href="./prototype/v9_market_execution.html" style={{ color: "#aaa3ad" }}>查看 v9 静态原型 →</a>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div className="titlewrap">
            <div className="title">{TITLES[page]}</div>
            <div className="subtitle">Proxy 运营控制台 · 仅运营可见 · 没有数据源的页面显示「未接入」，不显示任何数字</div>
          </div>
          {who ? (
            <button className="ops-logout" onClick={() => { clearOpsSession(); setWho(undefined); setStatus({ kind: "auth" }); }}>
              运营 {who.slice(0, 14)}… · 退出
            </button>
          ) : null}
        </div>
        {status ? <OpsGate onLoggedIn={() => { setWho(readOpsSession()?.userAccountId); setStatus(undefined); setReload((n) => n + 1); }} status={status} /> : null}
        <div className="content" key={reload} style={status ? { display: "none" } : undefined}>
          {page === "overview" && <Overview />}
          {page === "contextfield" && <ContextField />}
          {page === "surface" && <Surface />}
          {page === "research" && <Research />}
          {page === "executionruntime" && <ExecutionRuntime />}
          {page === "engine" && <Engine />}
          {page === "engineapi" && <EngineAPI />}
          {page === "clarification" && <Clarification />}
          {page === "supplyactivation" && <SupplyActivation />}
          {page === "behavior" && <Behavior />}
          {page === "fulfillmentattr" && <FulfillmentAttr />}
          {page === "population" && <Population />}
          {page === "tags" && <Tags />}
          {/* GRAVITY-001: 「意图与撮合」= 真实引力状态；「编排与调度」仍未接入 */}
          {page === "intent" && <Gravity />}
          {page === "orchestration" && <IntentOrchestration />}
          {page === "merchant" && <Merchant />}
          {/* OPS-MATCHING-TUNABLES-001：引擎口径 + 决策留痕，改口径要 MARKETPLACE */}
          {page === "matching" && <Matching />}
          {/* DISPATCH-LOOP-001：快速模式的单卡在哪、为什么；重派 / 点名 / 停止要 MARKETPLACE */}
          {page === "dispatch" && <Dispatch />}
          {/* MARKET-FAST-001：市场发单看板 —— 快速发单一段时间内的表现（只读） */}
          {page === "marketboard" && <MarketBoard />}
          {/* STORE-ATTRIBUTION-P1：门店预约与承载 —— 哪一家店拿到了承载预约、承载快照有多新（只读） */}
          {page === "storeboard" && <StoreBoard />}
          {/* OPS-MODERATION-001：举报队列与处置（处置只记录，不执行下架 / 封号） */}
          {page === "moderation" && <Moderation />}
          {/* OPS-APPEALS-001：申诉复核（复核只记录，不真的恢复账号 / 撤销下架） */}
          {page === "appeals" && <Appeals />}
          {/* OPS-MATCH-PREVIEW-001：撮合预览 —— 这张单此刻会邀谁、为什么（只读） */}
          {page === "matchpreview" && <MatchPreview key={previewId} initialId={previewId} />}
          {/* OPS-INSIGHT-001：需求缺口（供需并排、不给比值）与用户洞察（标签分群，小格子抑制） */}
          {page === "demandgap" && <DemandGap onPreview={(id) => { setPreviewId(id); setPage("matchpreview"); }} />}
          {page === "insights" && <Insights />}
          {page === "retention" && <Retention />}
          {page === "trust" && <Trust />}
          {page === "providers" && <ProviderApplications />}
          {page === "numberlookup" && <NumberLookup />}
          {page === "access" && <Access />}
          {page === "quality" && <Quality />}
          {page === "workbench" && <Quality />}
          {!["overview", "contextfield", "surface", "research", "executionruntime", "engine", "engineapi", "clarification", "supplyactivation", "behavior", "fulfillmentattr", "population", "tags", "intent", "orchestration", "merchant", "matching", "dispatch", "marketboard", "storeboard", "retention", "trust", "quality", "workbench", "numberlookup", "access", "moderation", "appeals", "matchpreview", "demandgap", "insights"].includes(page) && (
            <div className="notice">
              <b>{TITLES[page]}</b> — 已接线 19 页（v9 全量）。
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
