// Component Registry 的 Catalog 侧不变式：9 个组件全部登记、白名单与守卫一致；
// registry.tsx 的组件映射完整性由 typecheck 守护（createRenderer 泛型约束）。
import { describe, expect, it } from "vitest";
import { CATALOG_ACTION_IDS, CATALOG_COMPONENT_IDS, isRegisteredComponent, proxyCatalog } from "./catalog";

describe("Catalog 组件白名单（Gate C/D）", () => {
  it("首批 9 个组件全部登记", () => {
    expect(CATALOG_COMPONENT_IDS).toHaveLength(9);
    expect([...CATALOG_COMPONENT_IDS].sort()).toEqual(
      [
        "CANDIDATE_RAIL",
        "CATEGORY_ANCHOR",
        "CONTEXTUAL_QUOTE",
        "CRITICAL_QUESTION",
        "GOAL_SUMMARY",
        "INFERRED_FACTS",
        "KNOWN_FACTS",
        "TIME_LOCATION",
        "WAITING_STATUS"
      ].sort()
    );
  });

  it("isRegisteredComponent 只放行白名单", () => {
    for (const id of CATALOG_COMPONENT_IDS) expect(isRegisteredComponent(id), id).toBe(true);
    expect(isRegisteredComponent("SCRIPT_TAG")).toBe(false);
    expect(isRegisteredComponent("webview")).toBe(false);
    expect(isRegisteredComponent("")).toBe(false);
  });

  it("catalog actions 只登记 Product State 级动作", () => {
    expect([...CATALOG_ACTION_IDS].sort()).toEqual(["answer_critical_question", "select_candidate"]);
  });

  it("proxyCatalog 由 defineCatalog 成功构造", () => {
    expect(proxyCatalog).toBeDefined();
  });
});
