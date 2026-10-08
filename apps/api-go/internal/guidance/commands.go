package guidance

import (
	"context"

	"github.com/proxy-app/proxy-api/internal/command"
)

// Commands 处理 GetNextSteps：登录用户读自己的下一步。只读自己（没有 userId 参数）。
type Commands struct{ Source Source }

func (c *Commands) Supports(commandType string) bool { return commandType == "GetNextSteps" }

func (c *Commands) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	switch e.CommandType {
	case "GetNextSteps":
		if e.Actor.ID == "" {
			return command.Rejected(e, "NEXT_STEPS_REQUIRES_ACTOR", "AUTHENTICATION", "AFTER_USER_ACTION", "guidance.requires_actor", nil)
		}
		if c.Source == nil {
			return command.Rejected(e, "NEXT_STEPS_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "guidance.unavailable", nil)
		}
		st, err := c.Source.LoadState(ctx, e.Actor.ID)
		if err != nil {
			return command.Rejected(e, "NEXT_STEPS_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "guidance.unavailable", nil)
		}
		steps := BuildSteps(st)
		done := 0
		for _, s := range steps {
			if s.Done {
				done++
			}
		}
		res := command.Accepted(e, "NextSteps", e.Actor.ID, 1, "LISTED", nil)
		res.Body = map[string]any{"steps": steps, "next": NextStep(steps), "doneCount": done, "total": len(steps)}
		return res
	}
	return command.Rejected(e, "UNSUPPORTED_COMMAND", "VALIDATION", "NEVER", "guidance.unsupported_command", nil)
}
