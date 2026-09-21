package api

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/compliance"
)

// R16.7-P1-G (LC-16) —— 远程法律 kill switch 的**执行路径**钉子。
//
// 为什么需要这条：`Server.enforceKillSwitch` 是唯一真正拦住命令的地方
// （`command_dispatch.go:122` 在鉴权之后、业务分发之前调用它），但它**一个测试都没有**：
//
//	grep -rn 'SERVICE_DISABLED\|enforceKillSwitch' apps/api-go --include=*.go
//	# → 只有定义本身和那一处调用点，没有任何 _test.go 引用
//
// 而 `internal/compliance` 的 13 个测试全都只测 Service 自己
// （Kill / Rearm / IsEnabled / GlobalStatus），没有一个穿过 dispatch 那一层。
// 也就是说「拨下开关 → 命令真的被 503 拦掉」这条不变量从来没有被验证过 ——
// 它今天是对的，但没有任何东西阻止它变成错的。
//
// 这条测试把 dispatch 层到 compliance 层的接线钉住，并且带**反向配重**：
// 重新武装（Rearm）之后命令必须重新放行，否则「一律拒绝」这种最省事的改法
// 会让它假绿。
func TestKillSwitchBlocksTheCommandsItsCategoriesCover(t *testing.T) {
	now := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
	repo := compliance.NewMemoryRepository(func() time.Time { return now })
	svc := compliance.NewService(repo)
	s := &Server{Compliance: svc}

	dispatch := func(commandType string) (*command.Result, int) {
		return s.enforceKillSwitch(command.Envelope{
			CommandID:   "cmd_" + commandType,
			CommandType: commandType,
		})
	}

	// 每个 category 覆盖哪些命令 —— 与 commandKillSwitchCategory 的映射一致。
	cases := []struct {
		category compliance.Category
		commands []string
	}{
		{compliance.CategoryMarketplace, []string{"CreateOrder", "SubmitPayment", "ConfirmOrder"}},
		{compliance.CategoryAIMedia, []string{"PublishAIPost", "GenerateAIContent"}},
	}

	for _, tc := range cases {
		t.Run(string(tc.category), func(t *testing.T) {
			// 未拨之前必须放行。
			for _, cmd := range tc.commands {
				if blocked, status := dispatch(cmd); blocked != nil {
					t.Fatalf("before Kill: %s must be allowed, got status=%d result=%+v", cmd, status, blocked)
				}
			}

			if _, err := svc.Kill(context.Background(), tc.category, "regulator order", "operator_1", nil); err != nil {
				t.Fatalf("Kill(%s): %v", tc.category, err)
			}

			// 拨下之后每一条都必须被 503 + SERVICE_DISABLED 拦掉。
			for _, cmd := range tc.commands {
				blocked, status := dispatch(cmd)
				if blocked == nil {
					t.Fatalf("after Kill(%s): %s must be blocked, but enforceKillSwitch allowed it", tc.category, cmd)
				}
				if status != 503 {
					t.Fatalf("after Kill(%s): %s blocked with status=%d, want 503", tc.category, cmd, status)
				}
				if blocked.Outcome != "REJECTED" || blocked.Error == nil || blocked.Error.ErrorCode != "SERVICE_DISABLED" {
					t.Fatalf("after Kill(%s): %s must be REJECTED/SERVICE_DISABLED, got %+v", tc.category, cmd, blocked)
				}
			}

			// 反向配重：重新武装之后必须重新放行。
			if err := svc.Rearm(context.Background(), tc.category, "operator_1"); err != nil {
				t.Fatalf("Rearm(%s): %v", tc.category, err)
			}
			for _, cmd := range tc.commands {
				if blocked, status := dispatch(cmd); blocked != nil {
					t.Fatalf("after Rearm(%s): %s must be allowed again, got status=%d result=%+v", tc.category, cmd, status, blocked)
				}
			}
		})
	}
}

// 反向配重之二：不在这两个 category 里的命令，拨下 MARKETPLACE / AI_MEDIA
// 都不该受影响 —— 否则这个闸门会变成「一拨就全站停」。
func TestKillSwitchLeavesUnrelatedCommandsAlone(t *testing.T) {
	now := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
	svc := compliance.NewService(compliance.NewMemoryRepository(func() time.Time { return now }))
	s := &Server{Compliance: svc}

	if _, err := svc.Kill(context.Background(), compliance.CategoryMarketplace, "regulator order", "operator_1", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Kill(context.Background(), compliance.CategoryAIMedia, "regulator order", "operator_1", nil); err != nil {
		t.Fatal(err)
	}

	for _, cmd := range []string{"ToggleActivityInterest", "JoinActivity", "SendMessage", "CreatePost"} {
		if blocked, status := s.enforceKillSwitch(command.Envelope{CommandID: "cmd_" + cmd, CommandType: cmd}); blocked != nil {
			t.Fatalf("%s is not in any kill-switch category and must stay allowed, got status=%d result=%+v", cmd, status, blocked)
		}
	}
}

// LC-16 (2026-09-21) —— 「可拨的类别」和「真的会拦的类别」必须是同一个集合。
//
// 这条钉子的由来：AllowedCategories 有 5 个类别，但 commandKillSwitchCategory
// 只给 2 个类别接上了执行点。运营拨下 GLOBAL / LOCATION_CONSENT / PAYMENTS 时，
// HTTP 返回 201、审计表写一行、然后没有任何命令被拦 —— 一条假的合规记录，
// 比「没有这个开关」更糟。
//
// 这里断言的是结构不变量：EnforceableCategories 里的每一个类别，都必须至少
// 有一条命令映射到它。反向（有没有命令映射到一个没被声明为 enforceable 的
// 类别）由门禁里的静态钉负责，因为那个方向需要看到 commandKillSwitchCategory
// 的整个函数体，而 Go 测试做不到。
func TestEveryEnforceableCategoryHasAnEnforcementPoint(t *testing.T) {
	// 探针命令集：commandKillSwitchCategory 认识的命令。
	// 它不是「全部命令」—— 全仓没有命令类型注册表（dispatch 是各域
	// service.go 里的 switch），所以这里只能探已知的；漏掉的命令由
	// 门禁静态钉兜底。
	probes := []string{
		"CreateOrder", "SubmitPayment", "ConfirmOrder",
		"PublishAIPost", "GenerateAIContent",
	}

	reached := map[string][]string{}
	for _, cmd := range probes {
		if cat := commandKillSwitchCategory(cmd); cat != "" {
			reached[cat] = append(reached[cat], cmd)
		}
	}

	for _, c := range compliance.EnforceableCategories {
		if len(reached[string(c)]) == 0 {
			t.Errorf("compliance.EnforceableCategories lists %s, but no command maps to it in commandKillSwitchCategory -- arming it would block nothing", c)
		}
	}

	// 反向配重：能被拨的类别不能比声明的多。否则 EnforceableCategories 少声明了
	// 一个「真的会拦」的类别，operator 的响应会把一个有效的开关报成 enforced=false。
	for cat := range reached {
		if !compliance.IsEnforceable(compliance.Category(cat)) {
			t.Errorf("commandKillSwitchCategory maps commands to %s, but compliance.EnforceableCategories does not list it -- the operator response would report enforced=false for a switch that does block commands", cat)
		}
	}
}

// LC-16 (2026-09-21) —— 拨一个没有执行点的类别，响应体必须自报「不拦任何东西」。
//
// 我们刻意**不**拒绝这种调用（宣布事件、留审计记录是合理用途，见
// operatorKillSwitchKill 的注释），所以「运营以为关掉了」这个风险只能靠
// 响应体自己说清楚来消除。这条测试钉的就是那句自报。
func TestUnenforcedCategoryIsReportedAsUnenforced(t *testing.T) {
	for _, c := range compliance.AllowedCategories {
		raw := killSwitchResponse(&compliance.KillSwitch{
			ID:       "ks_" + string(c),
			Category: c,
			Status:   compliance.StatusKilled,
			Reason:   "regulator order",
			SetBy:    "operator_1",
			SetAt:    time.Now().UTC(),
		})
		got, ok := raw["enforced"].(bool)
		if !ok {
			t.Fatalf("%s: killSwitchResponse must carry an explicit bool \"enforced\" field, got %#v", c, raw["enforced"])
		}
		if want := compliance.IsEnforceable(c); got != want {
			t.Errorf("%s: enforced=%v, want %v", c, got, want)
		}
	}

	// 反向配重：上面那圈在「一律报 false」时也会绿，所以必须确认至少有一个
	// 类别真的报 true —— 否则这个字段是写死的 false，而不是从
	// EnforceableCategories 推出来的。
	anyEnforced := false
	for _, c := range compliance.AllowedCategories {
		if v, _ := killSwitchResponse(&compliance.KillSwitch{Category: c})["enforced"].(bool); v {
			anyEnforced = true
		}
	}
	if !anyEnforced {
		t.Error("no category reports enforced=true -- the field is hardcoded false, not derived from compliance.EnforceableCategories")
	}
}
