import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./market.tsx", import.meta.url)), "utf8");
const demandWizard = readFileSync(fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)), "utf8");
const activityWizard = readFileSync(fileURLToPath(new URL("./activity-wizard.tsx", import.meta.url)), "utf8");

describe("market workflow surface", () => {
  it("uses order lifecycle filters instead of fulfillment action buttons", () => {
    expect(source).toContain('label: "已申请"');
    expect(source).toContain('label: "已创建"');
    expect(source).toContain('label: "执行中"');
    expect(source).not.toContain('>我的 Offer<');
    expect(source).not.toContain('>打卡<');
    expect(source).not.toContain('>证据<');
  });

  it("offers real order and activity publishing entries", () => {
    expect(source).toContain(">创建订单<");
    expect(source).toContain(">创建活动<");
    expect(source).toContain("openDemandWizard");
    expect(source).toContain("openActivityPublisher");
    expect(source).toContain('visible={publishMenuOpen}');
    expect(source).toContain('setTab("OPPORTUNITY")');
    expect(source).toContain('setTab("ACTIVITY")');
    expect(source).toContain('bottomNavVisible === false ? 28 : 116');
    // 两向导都经真实 publish 通道发布（非 mock）。
    expect(demandWizard).toContain("await marketplace.publish(");
    expect(activityWizard).toContain("await activities.publish(");
  });

  it("keeps one publisher instance and retains loaded activities while refreshing", () => {
    // Pager mounts both tabs. A global wizard condition rendered a hidden
    // second copy, which duplicated draft hydration and made the tab flash.
    expect(source).toContain('demandWizardOpen && pageTab === "OPPORTUNITY"');
    expect(source).toContain('activityPublishOpen && pageTab === "ACTIVITY"');
    expect(source).not.toContain('key={`${pageTab}:${demandWizardOpen');
    expect(source).toContain('activityPhase === "LOADING" && activityItems.length === 0');
  });

  it("APPLICANT-PROFILE-001 resolves applicant ids to profile names", () => {
    // 选人工作台曾只渲染截断 ID（申请人 xxx…）—— 名单是真的，人名是缺的。
    // 现在经 ProfileClient.getProfile 解析，名字/handle 是报名人自选的公开身份。
    expect(source).toContain("profileClient.getProfile(");
    expect(source).toContain("function applicantTitle(");
    expect(source).toContain("applicantProfiles[c.applicantId]");
    // 未知保持未知：解析失败/无 profile/空名字一律回退截断 ID，不编名字。
    expect(source).toContain("申请人 ${applicantId.slice(0, 10)}");
    // 反向钉：单行解析失败不许整面报错，更不许用演示名顶替。
    expect(source).toContain("requestedApplicantIds");
    expect(source).not.toContain("热心市民");
    expect(source).not.toContain("申请人 Alice");
  });
});
