import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// MERCHANT-SIGNAL-SEED-001（2026-10-01，用户「经营脉搏 未来需求…都是空的 做数据」）
//
// 根因：business.aggregated_demand_signals / scene_supply_snapshots 有表有读有写，
// 但**真实链路里没有生产者** ⇒ resolver 永远拿 nil ⇒ 两块恒为空。
// 修法是种入静态测试数据（scripts/seed_merchant_operating_signals.sql），
// 落在 devseed 测试账号上，不碰真人商家。
//
// 但那块页面自己印着「不会用历史销售冒充附近客流，也不会生成虚假精确预测」。
// 种了测试数据就必须**自报家门**，否则那句话是在骗店主。所以这里钉住标记存在，
// 且只在 SEED_TEST 时出现 —— 真的推导接上（source=MEASURED）时它必须消失。
describe("MERCHANT-SIGNAL-SEED-001 种入的经营信号要标出是测试数据", () => {
  const src = readFileSync(fileURLToPath(new URL("./surfaces/business-home.tsx", import.meta.url)), "utf8");

  it("需求或供给任一为 SEED_TEST 就显示测试数据标记", () => {
    expect(src).toContain('operatingHome?.aggregatedDemand?.source === "SEED_TEST"');
    expect(src).toContain('operatingHome?.sceneSupply?.source === "SEED_TEST"');
    expect(src).toContain("merchant-signal-seeded");
    // 标记要说清是种进来的样例，不能只写「测试」两个字糊弄过去。
    expect(src).toContain("不是实测");
  });

  it("实测信号（MEASURED）不得被标成测试数据", () => {
    // 反向钉：不能写成 `source !== "MEASURED"` 之类的宽判据 ——
    // 那样真正的 MEASURED 信号也会被标上"测试数据"，久了就没人信这个标记了。
    expect(src).not.toMatch(/source\s*!==\s*"MEASURED"/);
  });

  it("两个信号的类型都带上了 source，否则标记永远不显示", () => {
    const client = readFileSync(fileURLToPath(new URL("./business-client.ts", import.meta.url)), "utf8");
    // 上一版我只加了 SQL 列没加类型 —— 那列就没人读，等于没有。
    // 同一个类型声明里（单行）—— 用 [^;]* 匹配不到，对象类型内部本来就带分号。
    expect(client).toMatch(/aggregatedDemand\?: \{[^\n]*source\?: string/);
    expect(client).toMatch(/sceneSupply\?: \{[^\n]*source\?: string/);
  });
});
