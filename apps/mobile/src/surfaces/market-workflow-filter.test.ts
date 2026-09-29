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

describe("ACTIVITY-CREATE-FORM-001 ten-block progressive create form", () => {
  // 原型 deepseek_html_20260928_34cc3e 全量移植：分类→名称→人数→日期→时间→
  // 时长→地点→报名→费用→说明 + 进度条 + 场景列表/地图双选 + 成功页。
  it("gates publish on category, name and a catalog scene", () => {
    // 无 sceneId 的活动在场景页不可见 —— 门禁必须卡 placeId，不许只认手输文字。
    expect(activityWizard).toContain("canPublishForm(form)");
    expect(activityWizard).toContain("placeValid");
    expect(activityWizard).toContain('t("needPlaceScene")');
    expect(activityWizard).toContain("formProgress");
    expect(activityWizard).toContain("progressFill");
    expect(activityWizard).toContain("await activities.publish(");
  });

  it("picks scenes from the real catalog on list and the home full-page map", () => {
    expect(activityWizard).toContain("loadSceneSpots(fetch, localApiBaseUrl)");
    expect(activityWizard).toContain('setSheet("list")');
    expect(activityWizard).toContain('setSheet("map")');
    expect(activityWizard).toContain("t(\"confirmMapPick\")");
    // 地图不自绘：全页直接复用 home 的 RealitySceneMapSurface，选中经 onPickScene 回来。
    // 向导里地图顶满：无圆角卡片（flatMap），首页保持卡片原样。
    expect(activityWizard).toContain("RealitySceneMapSurface");
    expect(activityWizard).toContain("onPickScene");
    expect(activityWizard).toContain("flatMap");
    expect(activityWizard).not.toContain("from \"react-native-maps\"");
    expect(activityWizard).not.toContain("<Marker");
    // 全页拉满：容器正好顶满（屏高 − 顶部安全区），多了会滚，少了留空边；
    // market 头部 + tabs 让位，三处 content padding 清零。
    expect(activityWizard).toContain("windowHeight - insets.top)");
    expect(source).toContain("wizardMapOpen ? null : (");
    expect(source).toContain("wizardMapOpen && styles.contentMapPick");
    // 全页地图期间藏底栏（底栏只有一级模块有）：壳级状态，跟 hotScenesOpen 同模式。
    // 不能走滚动显隐通道 —— 它的“回顶部就显示”会把全页态翻回来。
    expect(activityWizard).toContain("onMapPickOpenChange?.(true)");
    expect(source).toContain("setWizardMapOpen(open)");
    // 列表距离拿不到就不印。
    expect(activityWizard).toContain("sceneDistanceMeters(origin, spot)");
  });

  it("maps the range and fee to the server shape without inventing fields", () => {
    expect(activityWizard).toContain("capacityOfRange(form.peopleMax)");
    expect(activityWizard).toContain("composeActivityTime(");
    expect(activityWizard).toContain("buildActivityPublishInput(");
    // 成功页不许写"已通知附近用户"（推送行为未知），用市场同款已进入市场文案。
    expect(activityWizard).toContain('t("publishedSub")');
    expect(activityWizard).not.toContain("已通知附近");
  });

  it("keeps the prototype people rail (dual slider + pills), not steppers", () => {
    // ACTIVITY-CREATE-FORM-001：字体任务只许动字体。人数交互必须跟原型一致 ——
    // 双滑杆（导轨/填充/双拇指/刻度）+ pills 快选，步进器不得回来。
    expect(activityWizard).toContain("sliderFill");
    expect(activityWizard).toContain("sliderThumb");
    expect(activityWizard).toContain("sliderScale");
    expect(activityWizard).toContain("PEOPLE_PRESETS");
    expect(activityWizard).toContain('"50+"');
    expect(activityWizard).toContain('t("peopleMin")');
    expect(activityWizard).toContain('t("peopleMax")');
    expect(activityWizard).not.toContain("stepPeople");
    expect(activityWizard).not.toContain("stepRow");
    // 滑杆横拖不得触发外层模块翻页：落指即接管（抢在 pager 原生滚动前），
    // 让位只看方向 —— 纵向交给表单滚动，横向拒绝 pager。
    expect(activityWizard).toContain("onPanResponderTerminationRequest");
    expect(activityWizard).toContain("peopleDragDir");
    expect(activityWizard).toContain("locationX");
  });

  it("uses the home map logo for the place map button, not an emoji", () => {
    // MAP-FOOTPRINT-LOGO-001：地点行地图按钮跟首页场景地图入口同款 mapFold。
    expect(activityWizard).toContain('name="mapFold"');
    expect(activityWizard).not.toContain("🗺");
  });

  it("saves real local drafts, never a fake toast", () => {
    expect(activityWizard).toContain("SecureStore.setItemAsync(DRAFT_KEY");
    expect(activityWizard).toContain("decodeDraft(");
    expect(activityWizard).toContain('t("draftSaved")');
    expect(activityWizard).not.toContain("toast(");
  });
});
