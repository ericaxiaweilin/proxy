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
