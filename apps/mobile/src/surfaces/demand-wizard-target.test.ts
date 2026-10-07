import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PublishMarketOpportunityInputSchema } from "@proxy/contracts";
import { buildDemandPublishInput, defaultSpecsFor, MOMENT_TEMPLATES } from "../demand-moments";

// DEMAND-TARGET-KEEP-001（2026-10-07，用户：「不能丢弃搭子选择」）：向导收了搭子
// （selectedPerson），界面上还写着「意向人选：X」，发布出去的却永远是公开市场 ——
// 选择被丢在半路。契约里这条一直是有的（PublishMarketOpportunityInput.targetUserId，
// OPP-TARGETED-001「选人 → 向 TA 发出邀约」：带上后服务端把机会快照成定向，只对 TA
// 和 owner 可见、只收 TA 报名），兄弟实现 market.tsx 一直在发，只有发布向导没接。
//
// 这条钉守两件事，缺一不可：
//   ① 行为：选了人 → 发布输入带上 targetUserId；没选 / 空白 → **这个键都不在**
//      （不带 = 公开发布，wire 形状与改动前逐字节相同）；
//   ② 接线：向导真的把选中的人传进去。只测 ① 的话，「向导没接线」这个 bug 照样绿 ——
//      本仓的经典形状（helper 建好了、没人调）。
describe("DEMAND-TARGET-KEEP-001 搭子选择跟着需求走", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );
  const template = MOMENT_TEMPLATES[0]!;
  const specs = { ...defaultSpecsFor(template), ratio: "2", time: "19:00", duration: "2 小时" };

  it("选了搭子：发布输入带上 targetUserId，且仍过契约校验", () => {
    const input = buildDemandPublishInput(template, specs, "agent_linh");
    expect(input.targetUserId).toBe("agent_linh");
    expect(PublishMarketOpportunityInputSchema.safeParse(input).success).toBe(true);
  });

  it("前后空白会被 trim，不把「 agent_x 」这种形状发出去", () => {
    expect(buildDemandPublishInput(template, specs, "  agent_linh  ").targetUserId).toBe("agent_linh");
  });

  it("没选人 / 空白：targetUserId **这个键都不在**（不带 = 公开市场）", () => {
    // 键缺席，而不是「键在、值是 undefined」。契约是 .optional()，两者都能过校验 ——
    // 但后者 JSON 序列化后多一个 null，wire 形状就变了。用 `in` 判，不用 `=== undefined`。
    expect("targetUserId" in buildDemandPublishInput(template, specs)).toBe(false);
    expect("targetUserId" in buildDemandPublishInput(template, specs, "")).toBe(false);
    expect("targetUserId" in buildDemandPublishInput(template, specs, "   ")).toBe(false);
  });

  it("向导接线：发布调用把选中的人传进去，不再是两参调用", () => {
    expect(wizard).toContain("buildDemandPublishInput(template, specs, targetAgent?.agentId)");
    // 反面：改动前的两参调用（选择被丢在半路）不许回来。
    // 注意这不是 ① 那种行为断言能覆盖的 —— helper 是对的，是调用点没接线。
    expect(wizard).not.toContain("buildDemandPublishInput(template, specs)");
  });

  it("定向只由「直接约」决定；点回「等接单」就是公开", () => {
    // 判据取 mode（用户最后选的接单方式），不是「曾经选过人」：选完人再点「等接单」，
    // 选的人还在 selectedPerson 里，但意图已经变回公开 —— 这时不该再发定向。
    expect(wizard).toContain('const targetAgent = mode === "direct" ? selectedPerson : undefined;');
  });

  it("界面口径跟着走：邀约 ≠ 已发布", () => {
    // 定向邀约只对一个人可见，照 market.tsx 的说法分开写；按钮文案也不能还是
    // 「发布到市场」（那是在说一件不会发生的事）。
    expect(wizard).toContain("向 ${targetAgent.name} 发出邀约");
    expect(wizard).toContain("定向 · ${targetAgent.name}");
    expect(wizard).toContain("已经向 ${targetAgent.name} 发出需求，等待 TA 确认。");
    expect(wizard).toContain('"✓ 邀约已发出"');
  });
});
