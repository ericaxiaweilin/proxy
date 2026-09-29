package aisystem

import (
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/aiboundary"
	"github.com/proxy-app/proxy-api/internal/aipersona"
)

// TestEveryRegisteredSystemHasAStableIDInTheClosedSet 双向锁死
// AllSystemIDs 与 register：少一条、多一条、写错 ID 都会红。
// 这条钉的作用是让「新增一个 AI 系统」不能只改 register 而忘了闭集
// （反之亦然）。
func TestEveryRegisteredSystemHasAStableIDInTheClosedSet(t *testing.T) {
	inRegister := map[SystemID]bool{}
	for _, s := range register {
		if s.ID == "" {
			t.Fatal("register 里有系统没有 ID")
		}
		if inRegister[s.ID] {
			t.Fatalf("register 里 %q 重复登记", s.ID)
		}
		inRegister[s.ID] = true
	}
	inClosedSet := map[SystemID]bool{}
	for _, id := range AllSystemIDs {
		if inClosedSet[id] {
			t.Fatalf("AllSystemIDs 里 %q 重复", id)
		}
		inClosedSet[id] = true
		if !inRegister[id] {
			t.Errorf("AllSystemIDs 声明了 %q，但 register 里没有这条记录", id)
		}
	}
	for id := range inRegister {
		if !inClosedSet[id] {
			t.Errorf("register 里有 %q，但 AllSystemIDs 没登记 —— 它不会被 AssessAll 覆盖", id)
		}
	}
	if len(register) == 0 {
		t.Fatal("登记册为空：Điều 10.1 要求提供方自行分级，空册等于没做")
	}
}

// TestEveryImplementedProtectionNamesItsEvidence 是「不许半截接线」的机器化。
// 一条措施写进 Implemented 就必须在 Evidence 里点名落点；
// Evidence 里也不许出现没写进 Implemented 的键（那说明声明与证据脱钩）。
func TestEveryImplementedProtectionNamesItsEvidence(t *testing.T) {
	for _, s := range register {
		for _, p := range s.Implemented {
			ev, ok := s.Evidence[p]
			if !ok || strings.TrimSpace(ev) == "" {
				t.Errorf("系统 %q 声称已实现 %q，但没有给出落点（Evidence 缺失）", s.ID, p)
			}
		}
		for p := range s.Evidence {
			if !s.has(p) {
				t.Errorf("系统 %q 的 Evidence 里有 %q，但 Implemented 里没有它 —— 证据与声明脱钩", s.ID, p)
			}
		}
	}
}

// TestEveryImplementedProtectionIsAKnownProtection 防止拼写错误让一条措施
// 静默失效（写错常量 = 要求仍在、实现却查不到，差距被虚报）。
func TestEveryImplementedProtectionIsAKnownProtection(t *testing.T) {
	known := map[Protection]bool{}
	for _, p := range AllProtections {
		known[p] = true
	}
	for _, s := range register {
		for _, p := range s.Implemented {
			if !known[p] {
				t.Errorf("系统 %q 的 Implemented 里有未知措施 %q（不在 AllProtections）", s.ID, p)
			}
		}
	}
}

// TestTierIsDerivedFromBasis 钉住「等级只能从依据推导」这条约束。
func TestTierIsDerivedFromBasis(t *testing.T) {
	cases := []struct {
		criterion Criterion
		want      Tier
	}{
		{CriterionSignificantHarm, TierHigh},
		{CriterionConfusionOrManipulation, TierMedium},
		{CriterionResidualLow, TierLow},
		{Criterion("SOMETHING_ELSE"), TierUnclassified},
		{Criterion(""), TierUnclassified},
	}
	for _, c := range cases {
		if got := c.criterion.Tier(); got != c.want {
			t.Errorf("Criterion(%q).Tier() = %q，want %q", c.criterion, got, c.want)
		}
	}
	for _, s := range register {
		if !s.Tier().IsLegalTier() {
			t.Errorf("系统 %q 推导出的等级 %q 不是法定等级（Basis=%q）", s.ID, s.Tier(), s.Basis)
		}
	}
}

// TestUnknownSystemIsUnclassifiedNotLow 是本包最重要的一条负向钉。
//
// 把「没登记」当成「低风险」正是 Điều 10.1 要防的事：低风险会带来
// 「不用报送、不用抽检、不加不必要义务」的一整套后果。所以未知必须
// 回落成 UNCLASSIFIED，且 UNCLASSIFIED 不是法定等级。
func TestUnknownSystemIsUnclassifiedNotLow(t *testing.T) {
	unknown := SystemID("NO_SUCH_SYSTEM")

	if got := TierOf(unknown); got != TierUnclassified {
		t.Fatalf("TierOf(未知) = %q，want %q —— 未知绝不能回落成低风险", got, TierUnclassified)
	}
	if TierUnclassified.IsLegalTier() {
		t.Fatal("UNCLASSIFIED 被当成了法定等级；它是「没有记录」，不是 Điều 9.1 的第三级")
	}
	if _, ok := Lookup(unknown); ok {
		t.Fatal("Lookup(未知) 返回了 found=true")
	}
}

// TestUnknownSystemAssessmentDistinguishesNotFoundFromUnhealthy
// 「查不到这个系统」和「系统存在但有问题」必须长得不一样：
// 前者 Found=false 且带 NOT_REGISTERED，后者 Found=true。
func TestUnknownSystemAssessmentDistinguishesNotFoundFromUnhealthy(t *testing.T) {
	missing := Assess(SystemID("NO_SUCH_SYSTEM"))
	if missing.Found {
		t.Fatal("未知系统的 Found 应为 false")
	}
	if missing.ReadyForUse {
		t.Fatal("未知系统不应 ReadyForUse")
	}
	if len(missing.Blockers) != 1 || missing.Blockers[0].Code != BlockerNotRegistered {
		t.Fatalf("未知系统应只报 NOT_REGISTERED 一条 blocker，实得 %+v", missing.Blockers)
	}

	known := Assess(SystemAIFaceFeatureInference)
	if !known.Found {
		t.Fatal("已登记系统的 Found 应为 true")
	}
	for _, b := range known.Blockers {
		if b.Code == BlockerNotRegistered {
			t.Fatal("已登记系统不该报 NOT_REGISTERED —— 这会和「查不到」混淆")
		}
	}
}

// TestMediumAndHighRiskCannotBeReadyWithoutMoSTNotification 是 Điều 10.3 的
// 机器化：中/高风险系统的分级结果必须在**投入使用前**报送科技部。
// 只要还有中/高风险系统没报送，它就不能被算成「可以带现状继续跑」。
//
// 这条钉今天必然在报问题（仓里没有任何报送记录）—— 那正是它要表达的
// 事实，不是测试写错了。等真去报送了，把 Notification 改成 FILED，
// 这条会自动转绿。
func TestMediumAndHighRiskCannotBeReadyWithoutMoSTNotification(t *testing.T) {
	for _, s := range register {
		tier := s.Tier()
		if tier != TierHigh && tier != TierMedium {
			continue
		}
		a := Assess(s.ID)
		if s.Notification.Status == NotificationFiled {
			continue
		}
		if a.ReadyForUse {
			t.Errorf("系统 %q 为 %s 风险且未报送 MoST，却被判为 ReadyForUse —— Điều 10.3 要求投入使用前报送", s.ID, tier)
		}
		var found bool
		for _, b := range a.Blockers {
			if b.Code == BlockerNotificationMissing {
				found = true
				if !strings.Contains(b.Law, "10.3") {
					t.Errorf("系统 %q 的报送 blocker 未引用 Điều 10.3：%q", s.ID, b.Law)
				}
			}
		}
		if !found {
			t.Errorf("系统 %q 未报送 MoST，但 blocker 里没有 PRE_USE_NOTIFICATION_MISSING", s.ID)
		}
	}
}

// TestLowRiskDoesNotIncurNotificationOrAuditDuties 钉住 Điều 10.3 与
// 10.5(c) 的另一半：低风险**不**报送、也**不**抽检 —— 法律明确说
// 不要给低风险加不必要的义务。这里用一个合成系统验证推导规则本身。
func TestLowRiskDoesNotIncurNotificationOrAuditDuties(t *testing.T) {
	low := System{
		ID:           "SYNTHETIC_LOW",
		Name:         "合成低风险系统（仅用于验证推导规则）",
		Basis:        CriterionResidualLow,
		Capabilities: []Capability{CapabilityGeneratesContent},
	}
	if low.Tier() != TierLow {
		t.Fatalf("合成系统等级 = %q，want LOW", low.Tier())
	}
	required := low.Required()
	for _, p := range required {
		if p == ProtectionPreUseNotification {
			t.Error("低风险被要求报送 MoST —— Điều 10.3 只对中/高风险是义务")
		}
		if p == ProtectionSampleAudit || p == ProtectionPeriodicInspection {
			t.Errorf("低风险被要求 %q —— Điều 10.5(c) 明确不加不必要义务", p)
		}
	}
	if !containsProtection(required, ProtectionIncidentDrivenReview) {
		t.Error("低风险应要求 INCIDENT_DRIVEN_REVIEW（Điều 10.5(c)）")
	}
	// Điều 10.1 / 12 / 4 对**所有**等级成立，低风险也不例外。
	for _, p := range []Protection{
		ProtectionClassificationDossier,
		ProtectionIncidentDetectionAndRemedy,
		ProtectionSeriousIncidentReport,
		ProtectionHumanControlAndIntervention,
	} {
		if !containsProtection(required, p) {
			t.Errorf("低风险也应要求 %q（不分等级的义务）", p)
		}
	}
}

// TestCapabilitiesDriveTransparencyDuties 钉住「透明义务看能力」这一轴。
func TestCapabilitiesDriveTransparencyDuties(t *testing.T) {
	direct := System{Basis: CriterionResidualLow, Capabilities: []Capability{CapabilityDirectInteraction}}
	if !containsProtection(direct.Required(), ProtectionInteractionDisclosure) {
		t.Error("DIRECT_INTERACTION 应要求 INTERACTION_DISCLOSURE（Điều 11.1）")
	}
	generates := System{Basis: CriterionResidualLow, Capabilities: []Capability{CapabilityGeneratesContent}}
	if !containsProtection(generates.Required(), ProtectionMachineReadableMarking) {
		t.Error("GENERATES_CONTENT 应要求 MACHINE_READABLE_MARKING（Điều 11.2）")
	}
	if !containsProtection(generates.Required(), ProtectionAIContentNotice) {
		t.Error("GENERATES_CONTENT 应要求 AI_CONTENT_NOTICE（Điều 11.3）")
	}
	simulates := System{Basis: CriterionResidualLow, Capabilities: []Capability{CapabilitySimulatesRealPerson}}
	if !containsProtection(simulates.Required(), ProtectionRealPersonSimulationLabel) {
		t.Error("SIMULATES_REAL_PERSON 应要求 REAL_PERSON_SIMULATION_LABEL（Điều 11.4）")
	}
	plain := System{Basis: CriterionResidualLow}
	if containsProtection(plain.Required(), ProtectionOngoingTransparency) {
		t.Error("没有任何透明义务时不该要求 ONGOING_TRANSPARENCY")
	}
}

// TestIdentifyPersonCapabilityRequiresNghiDinh330Protection 钉住
// NĐ 330/2026 Điều 67.2(đ)：用 AI 推理结果识别个人时必须施加保护。
func TestIdentifyPersonCapabilityRequiresNghiDinh330Protection(t *testing.T) {
	s := System{Basis: CriterionSignificantHarm, Capabilities: []Capability{CapabilityIdentifiesPerson}}
	if !containsProtection(s.Required(), ProtectionIdentificationInferenceProtection) {
		t.Fatal("IDENTIFIES_PERSON 应要求 IDENTIFICATION_INFERENCE_PROTECTION（Điều 67.2(đ)）")
	}
	// 仓里真的有这样一个系统，且它今天确实缺这条措施 —— 差距必须被报出来。
	face := Assess(SystemAIFaceFeatureInference)
	if !containsProtection(face.Missing, ProtectionIdentificationInferenceProtection) {
		t.Error("面部特征推理系统今天缺 Điều 67.2(đ) 的保护措施，Missing 里必须能看到")
	}
}

// TestRightsAffectingDecisionRequiresHumanReviewRequest 钉住
// NĐ 330/2026 Điều 67.3(b)：会做出影响权利的自动决定的系统，
// 必须允许要求人工复核（7,000 万–1 亿 VND 那一档）。
func TestRightsAffectingDecisionRequiresHumanReviewRequest(t *testing.T) {
	s := System{Basis: CriterionConfusionOrManipulation, Capabilities: []Capability{CapabilityAutomatedRightsAffectingDecision}}
	if !containsProtection(s.Required(), ProtectionHumanReviewRequest) {
		t.Fatal("AUTOMATED_RIGHTS_AFFECTING_DECISION 应要求 HUMAN_REVIEW_REQUEST（Điều 67.3(b)）")
	}
}

// TestRequiredIsIndependentOfImplemented 是本包的防退化钉：
// Required() 只看等级与能力，不看 Implemented。想少要一条措施，
// 只能改法律事实（等级/能力），不能靠「这条我们没做」。
func TestRequiredIsIndependentOfImplemented(t *testing.T) {
	base := System{Basis: CriterionSignificantHarm, Capabilities: []Capability{CapabilityGeneratesContent}}
	requiredBefore := base.Required()

	// 把要求里缺的全都「声称」实现掉 —— 要求集合必须一字不变。
	base.Implemented = append([]Protection(nil), requiredBefore...)
	requiredAfter := base.Required()

	if len(requiredBefore) != len(requiredAfter) {
		t.Fatalf("Implemented 变化影响了 Required：%d → %d", len(requiredBefore), len(requiredAfter))
	}
	for i := range requiredBefore {
		if requiredBefore[i] != requiredAfter[i] {
			t.Fatalf("Required 第 %d 项变了：%q → %q", i, requiredBefore[i], requiredAfter[i])
		}
	}
	// 而且声称实现之后，Missing 必须清空 —— 否则「补上了」在数据上不生效。
	if got := base.Missing(); len(got) != 0 {
		t.Fatalf("Implemented 覆盖 Required 之后 Missing 应为空，实得 %v", got)
	}
}

// TestEveryProtectionHasALawCitation 保证运维界面上的每条要求都能追到条文。
func TestEveryProtectionHasALawCitation(t *testing.T) {
	for _, p := range AllProtections {
		law := p.Law()
		if strings.TrimSpace(law) == "" || law == "Luật AI 134/2025" {
			t.Errorf("措施 %q 没有具体条文出处（Law() = %q）", p, law)
		}
	}
	for _, c := range []Criterion{CriterionSignificantHarm, CriterionConfusionOrManipulation, CriterionResidualLow} {
		if !strings.Contains(c.Law(), "9.1") {
			t.Errorf("分级依据 %q 的出处没引用 Điều 9.1：%q", c, c.Law())
		}
	}
}

// TestEveryRegisteredSystemIsCoveredByAnAIActorKindOrPersonaType 是**这道闸本身**。
//
// 它把两个闭集（aiboundary.AllAIActorKinds、aipersona.AllowedPersonaTypes）
// 全部拉进来，要求每一个成员都显式映射到一个已登记的 AI 系统。
// 于是「新增一种 AI 主体 / 人格类型」不可能绕过分级：新枚举值会让这条测试变红，
// 逼着人先去登记册里给它一个等级。
//
// 这就是 Điều 10.1「投入使用前自行分级」在代码里的落点 —— 它不拦运行时，
// 它拦的是「悄悄多出一个没分级的 AI 系统」。
func TestEveryRegisteredSystemIsCoveredByAnAIActorKindOrPersonaType(t *testing.T) {
	// aiboundary.ActorKind → 系统
	actorCoverage := map[aiboundary.ActorKind]SystemID{
		aiboundary.PlatformAI:    SystemAIPersona,
		aiboundary.UserTwin:      SystemUserTwinLikeness,
		aiboundary.UserAssistant: SystemAIContentDrafting,
	}
	for _, kind := range aiboundary.AllAIActorKinds {
		systemID, ok := actorCoverage[kind]
		if !ok {
			t.Errorf("aiboundary.ActorKind %q 没有映射到任何 AI 系统 —— 新增 AI 主体必须先登记分级", kind)
			continue
		}
		if _, found := Lookup(systemID); !found {
			t.Errorf("ActorKind %q 映射到了未登记的系统 %q", kind, systemID)
		}
		if got := TierOf(systemID); !got.IsLegalTier() {
			t.Errorf("ActorKind %q 映射的系统 %q 等级为 %q，不是法定等级", kind, systemID, got)
		}
	}

	// aipersona.PersonaType → 系统
	personaCoverage := map[aipersona.PersonaType]SystemID{
		aipersona.PersonaTypePlatformAI:    SystemAIPersona,
		aipersona.PersonaTypeCreative:      SystemAIPersona,
		aipersona.PersonaTypeUserTwin:      SystemUserTwinLikeness,
		aipersona.PersonaTypeUserAssistant: SystemAIContentDrafting,
	}
	for _, pt := range aipersona.AllowedPersonaTypes {
		systemID, ok := personaCoverage[pt]
		if !ok {
			t.Errorf("aipersona.PersonaType %q 没有映射到任何 AI 系统 —— 新增人格类型必须先登记分级", pt)
			continue
		}
		if _, found := Lookup(systemID); !found {
			t.Errorf("PersonaType %q 映射到了未登记的系统 %q", pt, systemID)
		}
	}

	// 反向：映射表里不许有已经消失的枚举值（防删了枚举留下死映射）。
	liveActorKinds := map[aiboundary.ActorKind]bool{}
	for _, k := range aiboundary.AllAIActorKinds {
		liveActorKinds[k] = true
	}
	for k := range actorCoverage {
		if !liveActorKinds[k] {
			t.Errorf("覆盖表里有已不存在的 ActorKind %q —— 请同步删除", k)
		}
	}
	livePersonaTypes := map[aipersona.PersonaType]bool{}
	for _, pt := range aipersona.AllowedPersonaTypes {
		livePersonaTypes[pt] = true
	}
	for pt := range personaCoverage {
		if !livePersonaTypes[pt] {
			t.Errorf("覆盖表里有已不存在的 PersonaType %q —— 请同步删除", pt)
		}
	}
}

// TestSummarizeAgreesWithAssessAll 保证汇总口径与逐条体检一致。
func TestSummarizeAgreesWithAssessAll(t *testing.T) {
	all := AssessAll()
	if len(all) != len(AllSystemIDs) {
		t.Fatalf("AssessAll 返回 %d 条，AllSystemIDs 有 %d 条", len(all), len(AllSystemIDs))
	}
	sum := Summarize(all)
	if sum.Total != len(all) {
		t.Errorf("Summary.Total = %d，want %d", sum.Total, len(all))
	}
	if sum.ReadyForUse+sum.Blocked != sum.Total {
		t.Errorf("ReadyForUse(%d) + Blocked(%d) != Total(%d)", sum.ReadyForUse, sum.Blocked, sum.Total)
	}
	for _, a := range all {
		if a.ReadyForUse && len(a.Blockers) != 0 {
			t.Errorf("系统 %q ReadyForUse=true 却有 %d 条 blocker", a.ID, len(a.Blockers))
		}
		if !a.ReadyForUse && len(a.Blockers) == 0 {
			t.Errorf("系统 %q ReadyForUse=false 却没有任何 blocker —— 运维看不到原因", a.ID)
		}
	}
}

// TestEveryRegisteredSystemHasANameAndBasisNote 分级档案（Điều 10.1）
// 要有正文：一个只有结论没有理由的记录，在 Điều 10.6「申报不实」上站不住。
func TestEveryRegisteredSystemHasANameAndBasisNote(t *testing.T) {
	for _, s := range register {
		if strings.TrimSpace(s.Name) == "" {
			t.Errorf("系统 %q 没有名称", s.ID)
		}
		if len(strings.TrimSpace(s.BasisNote)) < 20 {
			t.Errorf("系统 %q 的 BasisNote 太短（%d 字符），不足以构成分级档案", s.ID, len(strings.TrimSpace(s.BasisNote)))
		}
		if len(s.Factors) == 0 {
			t.Errorf("系统 %q 没有写 Điều 9.2 的分级考量因素", s.ID)
		}
		if len(s.Capabilities) == 0 {
			t.Errorf("系统 %q 没有声明能力面 —— 没有能力面就推导不出透明义务", s.ID)
		}
	}
}

// TestNormalizeTierFailsClosed 钉住接口层的解析也 fail-closed。
func TestNormalizeTierFailsClosed(t *testing.T) {
	if got := NormalizeTier("high"); got != TierHigh {
		t.Errorf("NormalizeTier(high) = %q，want HIGH", got)
	}
	if got := NormalizeTier("  Medium "); got != TierMedium {
		t.Errorf("NormalizeTier( Medium ) = %q，want MEDIUM", got)
	}
	for _, bad := range []string{"", "UNCLASSIFIED", "bogus", "0"} {
		if got := NormalizeTier(bad); got != TierUnclassified {
			t.Errorf("NormalizeTier(%q) = %q，want UNCLASSIFIED", bad, got)
		}
	}
}

func containsProtection(list []Protection, want Protection) bool {
	for _, p := range list {
		if p == want {
			return true
		}
	}
	return false
}
