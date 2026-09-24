package activity

import (
	"encoding/json"
	"testing"
)

// R16.7-P1-I (LC-07) 的**缺口钉子** —— 为什么需要这条测试：
//
// PRD (Proxy_PRD_v1.8_R17 §2) 与 activity/service.go:78 的注释都写着同一句话：
//
//	「USER_TWIN 角色 photo 必须先有 LikenessConsent LIVE (PRD LC-07) 才会下发」
//
// 但 activity 包里除了那行注释，**没有任何 consent 判定**：
//
//	grep -rn 'HasLiveConsent\|Likeness' apps/api-go/internal/activity/   # → 只有那行注释
//
// 服务也没有注入 persona / consent 依赖（Service 只有 repository +
// participations 两个字段）。也就是说，**这句承诺今天无法被执行** ——
// 它不是「实现得不对」，是「根本没有实现」。
//
// 它今天不构成线上风险，只因为 USER_TWIN 活动压根不存在：
// AIPersonaPhoto 只在 SeedDefaults 里被写成 PLATFORM_AI 的打包资源路径
// (ai-personas/photos/ai_00X.png)，没有任何命令能写这个字段。
//
// 而 media 侧那道 LC-07 闸门（enforceAIPublishGates）**覆盖不到这里**：
// 它只管 media.media_assets 行，而 aiPersonaPhoto 是打包资源路径，
// 不是 mediaAssetId。（对比：aiAccountPhoto 走 avatarMediaAssetId，
// 是真正的 media 资产，才被那道闸门罩住。）
//
// 所以这条测试的作用是「**不许悄悄把路打通**」：一旦有人让活动能带
// USER_TWIN 的 photo，这条立刻红，逼出「先接 consent，还是先下线该字段」
// 的决定，而不是让它静默绕过合规。它**不禁止**这个功能 —— 它只要求
// 打开这个功能时，合规问题被回答过。
//
// 注意这条测试同时防**空转**：如果 AIPersonaPhoto 整个字段被丢掉
// （或种子不再写它），下面的观测断言会红 —— 而不是让循环空跑一遍
// 然后「通过」。一条从不观测到任何 photo 的检查，证明不了任何事。
func TestLC07ActivityNeverServesUserTwinPersonaPhoto(t *testing.T) {
	s := New()
	s.SeedDefaults()

	list := s.HandleContext(t.Context(), activityEnvelope("ListActivities", "viewer", ""))
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("list: %+v", list)
	}
	var body struct {
		Activities []Activity `json:"activities"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Activities) == 0 {
		t.Fatal("no activities returned — the seed is empty, so this test would pass vacuously")
	}

	// 非空转护栏：必须真的观测到至少一条带 photo 的活动。
	// 否则「没有 USER_TWIN photo」这个结论只是因为没有任何 photo。
	observedPhoto := 0
	for _, a := range body.Activities {
		if a.AIPersonaPhoto != "" {
			observedPhoto++
		}
		if a.AIActorKind == "USER_TWIN" && a.AIPersonaPhoto != "" {
			t.Fatalf(
				"activity %s serves a USER_TWIN persona photo (%q) — "+
					"LC-07 要求 USER_TWIN 的 photo 必须先有 LikenessConsent LIVE 才下发， "+
					"但 activity 服务没有任何 consent 判定，因此它无法证明自己有权下发这张图。 "+
					"要么先在服务里接上 consent 校验（HasLiveConsent），要么先不要下发这个字段 —— "+
					"不要让这条路径静默绕过合规。",
				a.ID, a.AIPersonaPhoto)
		}
	}
	if observedPhoto == 0 {
		t.Fatal(
			"观测不到任何带 aiPersonaPhoto 的活动 —— 这条 LC-07 检查是空转的。 "+
				"如果字段被有意下线，请同时删掉这条测试和 scripts/check-regression-contracts.sh 里的钉子， "+
				"不要让它以「通过」的形式假装还在守护什么。")
	}
}
