package incentive

import (
	"context"

	"github.com/proxy-app/proxy-api/internal/command"
)

// Commands 处理 GetMyRewards：用户看自己拿到过什么（券 + 成长值总数）。只读自己。
type Commands struct{ Store Store }

func (c *Commands) Supports(commandType string) bool { return commandType == "GetMyRewards" }

func (c *Commands) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	if e.CommandType != "GetMyRewards" {
		return command.Rejected(e, "UNSUPPORTED_COMMAND", "VALIDATION", "NEVER", "incentive.unsupported_command", nil)
	}
	if e.Actor.ID == "" {
		return command.Rejected(e, "MY_REWARDS_REQUIRES_ACTOR", "AUTHENTICATION", "AFTER_USER_ACTION", "incentive.requires_actor", nil)
	}
	if c.Store == nil {
		return command.Rejected(e, "MY_REWARDS_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "incentive.unavailable", nil)
	}
	grants, err := c.Store.GrantsOf(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "MY_REWARDS_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "incentive.unavailable", nil)
	}
	points := 0
	for i := range grants {
		points += grants[i].Points
		grants[i].UserID = ""
	}
	res := command.Accepted(e, "MyRewards", e.Actor.ID, 1, "LISTED", nil)
	res.Body = map[string]any{"growthPoints": points, "grants": grants}
	return res
}
