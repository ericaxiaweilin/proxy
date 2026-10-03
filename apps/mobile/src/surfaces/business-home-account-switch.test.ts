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
