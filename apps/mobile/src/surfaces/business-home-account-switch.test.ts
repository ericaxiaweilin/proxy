import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./business-home.tsx", import.meta.url), "utf8");
// 反向钉要剥注释：说明里会引用被删掉的 `accounts[0]` 作为反例。
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

// MERCHANT-ACCOUNT-SWITCH-001（2026-10-02）：一个店主可以有多家经营主体，
// 经营主页原来只读 listMyAccounts 的第一条（服务端 ORDER BY created_at DESC
// = 最新建的那家）。结果是：另一家主体上真实投好的订单永远看不到 ——
// 页面显示「0 订单」，而数据一直在库里。这不是数据没接上，是没有切换入口。
describe("MERCHANT-ACCOUNT-SWITCH-001", () => {
  it("no longer pins the whole page to the first account in the list", () => {
    expect(code).not.toContain("accounts[0]");
    expect(code).not.toContain("first.id");
  });

  it("drives every operating read off the selected account", () => {
    // 四个读接口必须全部用同一个被选中的主体 id，漏一个就是半页串店。
    for (const call of [
      'business.listStores(id)',
      'business.listMemberDirectory(id)',
      'business.listSpendDaily({ businessId: id',
      'business.getMerchantOperatingHome(id)',
    ]) {
      expect(code).toContain(call);
    }
  });

  it("shows a switcher only when the owner actually has more than one account", () => {
    expect(code).toContain("accounts.length > 1");
    expect(code).toContain("setAccountId(account.id)");
    // 多家主体时标题下必须能看到当前选中的是哪一家。
    expect(source).toContain("currentAccount?.name");
  });

  it("clears the previous account's numbers before loading the next one", () => {
    // 切店时先把上一家的经营结果清掉：A 店的订单印在 B 店标题下比空白更糟。
    const reset = code.slice(code.indexOf("const id = accountId;"), code.indexOf("await Promise.all"));
    expect(reset).toContain("setOperatingHome(undefined)");
    expect(reset).toContain("setSpendSummary({ totalOrders: 0, totalGrossMinor: 0 })");
    expect(reset).toContain("setFirstStore(undefined)");
  });
});

// MERCHANT-ACCOUNT-SWITCH-001（2026-10-03 补的第二块）：同一个 bug 的**另一半**。
//
// 上面那组只查了 business-home.tsx（HOME 页）。用户在模拟器里实际站的却是"我的"
// 那个面（merchant-me-r21-replacement.tsx）—— 那边切换器画出来了、数据也按 accountId
// 重拉了，但界面上 11 处标签还写死 `accounts?.[0]`：点第二家，芯片亮的是新主体，
// 名字/状态/头像还是第一家。钉在一个文件上的形状判据，抓不到另一个文件里同样的病。
describe("MERCHANT-ACCOUNT-SWITCH-001 「我的」面也必须跟着选中的主体走", () => {
  const meSource = readFileSync(new URL("./merchant-me-r21-replacement.tsx", import.meta.url), "utf8");
  const meCode = meSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

  it("列表第一条只许出现在 activeAccount 的兜底里，标签一律不读它", () => {
    const reads = meCode.split("\n").filter((line) => line.includes("accounts?.[0]"));
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain("const activeAccount =");
    expect(meCode).not.toContain("accounts[0]");
  });

  it("当前主体是从 activeAccountId 推出来的（不是又写死一个下标）", () => {
    expect(meCode).toContain("accounts?.find((account) => account.id === activeAccountId)");
    // 首帧 activeAccountId 还是 undefined，兜底必须是"最新那家"而不是空白。
    expect(meCode).toContain("?? accounts?.[0]");
  });

  it("换主体时先清掉上一家的读数", () => {
    const press = meCode.slice(meCode.indexOf("if (on) return;"), meCode.indexOf("void refresh(a.id)"));
    expect(press).toContain("setMembers([])");
    expect(press).toContain("setSpendTotal({ totalOrders: 0, totalGrossMinor: 0 })");
  });

  it("切换器仍然只在真有多家主体时出现", () => {
    expect(meCode).toContain("accounts.length > 1");
  });
});
