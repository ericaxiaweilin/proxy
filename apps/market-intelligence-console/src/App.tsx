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
import { Retention } from "./pages/Retention";
import { Trust } from "./pages/Trust";
import { Quality } from "./pages/Quality";

type Page = "overview" | "population" | "behavior" | "tags" | "intent" | "orchestration" | "engine" | "engineapi" | "contextfield" | "surface" | "research" | "clarification" | "supplyactivation" | "executionruntime" | "fulfillmentattr" | "merchant" | "retention" | "trust" | "quality" | "workbench" | "providers";

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
  retention: "留存与复购",
  trust: "信任与风险",
  providers: "接单权限审核",
  quality: "数据治理",
  workbench: "交叉分析工作台",
};

export function App() {
  const [page, setPageRaw] = useState<Page>("overview");
  // OPS-REAL-001：页面取数时遇到 未登录 / 非运营 / 未接入，由这里统一展示；换页清空，登录后整页重取。
  const [status, setStatus] = useState<OpStatus | undefined>(undefined);
  const [reload, setReload] = useState(0);
  const [who, setWho] = useState(() => readOpsSession()?.userAccountId);
  useEffect(() => onOpStatus(setStatus), []);
  const setPage = (next: Page): void => { setStatus(undefined); setPageRaw(next); };
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="logo">🦦</div>Proxy</div>
        <div className="navgroup">Intelligence</div>
        <div className="nav">
          {(["overview", "population", "behavior", "tags", "intent", "orchestration"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => setPage(p)}>{TITLES[p]}</button>
          ))}
        </div>
        <div className="navgroup">Decision Engine</div>
        <div className="nav">
          {(["engine", "engineapi"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => setPage(p)}>{TITLES[p]}</button>
          ))}
        </div>
        <div className="navgroup">Context & Experience</div>
        <div className="nav">
          {(["contextfield", "surface", "research"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => setPage(p)}>{TITLES[p]}</button>
          ))}
        </div>
        <div className="navgroup">Market Execution</div>
        <div className="nav">
          {(["clarification", "supplyactivation", "executionruntime", "fulfillmentattr"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => setPage(p)}>{TITLES[p]}</button>
          ))}
        </div>
        <div className="navgroup">Market</div>
        <div className="nav">
          {(["providers", "merchant", "retention", "trust"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => setPage(p)}>{TITLES[p]}</button>
          ))}
        </div>
        <div className="navgroup">Data</div>
        <div className="nav">
          {(["quality", "workbench"] as Page[]).map((p) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => setPage(p)}>{TITLES[p]}</button>
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
          {page === "retention" && <Retention />}
          {page === "trust" && <Trust />}
          {page === "providers" && <ProviderApplications />}
          {page === "quality" && <Quality />}
          {page === "workbench" && <Quality />}
          {!["overview", "contextfield", "surface", "research", "executionruntime", "engine", "engineapi", "clarification", "supplyactivation", "behavior", "fulfillmentattr", "population", "tags", "intent", "orchestration", "merchant", "retention", "trust", "quality", "workbench"].includes(page) && (
            <div className="notice">
              <b>{TITLES[page]}</b> — 已接线 19 页（v9 全量）。
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
