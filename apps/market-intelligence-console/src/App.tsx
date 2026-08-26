import { useState } from "react";
import { Overview } from "./pages/Overview.js";
import { ContextField } from "./pages/ContextField.js";
import { Surface } from "./pages/Surface.js";
import { ExecutionRuntime } from "./pages/ExecutionRuntime.js";
import { Engine } from "./pages/Engine.js";
import { Clarification } from "./pages/Clarification.js";
import { SupplyActivation } from "./pages/SupplyActivation.js";
import { Behavior } from "./pages/Behavior.js";
import { Research } from "./pages/Research.js";
import { FulfillmentAttr } from "./pages/FulfillmentAttr.js";
import { Population } from "./pages/Population.js";
import { Tags } from "./pages/Tags.js";
import { IntentOrchestration } from "./pages/IntentOrchestration.js";
import { EngineAPI } from "./pages/EngineAPI.js";
import { Merchant } from "./pages/Merchant.js";
import { Retention } from "./pages/Retention.js";
import { Trust } from "./pages/Trust.js";
import { Quality } from "./pages/Quality.js";

type Page = "overview" | "population" | "behavior" | "tags" | "intent" | "orchestration" | "engine" | "engineapi" | "contextfield" | "surface" | "research" | "clarification" | "supplyactivation" | "executionruntime" | "fulfillmentattr" | "merchant" | "retention" | "trust" | "quality" | "workbench";

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
  quality: "数据治理",
  workbench: "交叉分析工作台",
};

export function App() {
  const [page, setPage] = useState<Page>("overview");
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
          {(["merchant", "retention", "trust"] as Page[]).map((p) => (
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
            <div className="subtitle">Proxy Market Intelligence + Decision Engine v9 · React 控制台（接真实 /v1/experience/metrics）</div>
          </div>
        </div>
        <div className="content">
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
          {page === "intent" && <IntentOrchestration />}
          {page === "orchestration" && <IntentOrchestration />}
          {page === "merchant" && <Merchant />}
          {page === "retention" && <Retention />}
          {page === "trust" && <Trust />}
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
