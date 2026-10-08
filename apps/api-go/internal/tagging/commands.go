package tagging

import (
	"context"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/consent"
)

// CoarseSink 是 RecordCoarseLocation 需要的存储与同意查询。
type CoarseSink interface {
	RecordCoarseCell(ctx context.Context, userID, cell string, at time.Time) error
	HasConsent(ctx context.Context, userID, purpose string) (bool, error)
	HasLocationConsent(ctx context.Context, userID string) (bool, error)
}

// Commands 处理标签层的写命令。目前只有一条：RecordCoarseLocation。
type Commands struct {
	Sink CoarseSink
	Now  func() time.Time
}

func (c *Commands) Supports(commandType string) bool { return commandType == "RecordCoarseLocation" }

func (c *Commands) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	switch e.CommandType {
	case "RecordCoarseLocation":
		return c.recordCoarseLocation(ctx, e)
	default:
		return command.Rejected(e, "UNSUPPORTED_COMMAND", "VALIDATION", "NEVER", "tagging.unsupported_command", nil)
	}
}

// recordCoarseLocation：用户的大致位置（~1km 网格）。三道闸，缺一不收：
//  1. 登录用户；
//  2. 至少一个采集类同意目的现在有效（和浏览事件同一条规则）；
//  3. 定位同意（大致区域 / 精确）现在有效。
//
// 原始经纬度只在这个函数里存在：取整成网格后立刻丢掉，不入库、不回显、不进日志。
// 任何一道闸读不出来都按「没有同意」处理并拒收（fail-closed）。
func (c *Commands) recordCoarseLocation(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.ID == "" {
		return command.Rejected(e, "COARSE_LOCATION_REQUIRES_ACTOR", "AUTHENTICATION", "AFTER_USER_ACTION", "tagging.coarse_location_requires_actor", nil)
	}
	lat, okLat := number(e.Payload, "lat")
	lng, okLng := number(e.Payload, "lng")
	if !okLat || !okLng {
		return command.Rejected(e, "INVALID_COARSE_LOCATION", "VALIDATION", "AFTER_USER_ACTION", "tagging.invalid_coarse_location", nil)
	}
	cell, ok := CoarseCell(lat, lng)
	if !ok {
		return command.Rejected(e, "INVALID_COARSE_LOCATION", "VALIDATION", "AFTER_USER_ACTION", "tagging.invalid_coarse_location", nil)
	}
	if c.Sink == nil {
		return command.Rejected(e, "COARSE_LOCATION_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "tagging.coarse_location_unavailable", nil)
	}
	captured := false
	for _, purpose := range consent.CapturePurposes() {
		active, err := c.Sink.HasConsent(ctx, e.Actor.ID, purpose)
		if err != nil {
			return command.Rejected(e, "CONSENT_STATE_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "tagging.consent_state_unavailable", nil)
		}
		if active {
			captured = true
			break
		}
	}
	if !captured {
		return command.Rejected(e, "CONSENT_REQUIRED", "COMPLIANCE", "AFTER_USER_ACTION", "tagging.consent_required", nil)
	}
	located, err := c.Sink.HasLocationConsent(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "CONSENT_STATE_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "tagging.consent_state_unavailable", nil)
	}
	if !located {
		return command.Rejected(e, "LOCATION_CONSENT_REQUIRED", "COMPLIANCE", "AFTER_USER_ACTION", "tagging.location_consent_required", nil)
	}
	now := time.Now().UTC()
	if c.Now != nil {
		now = c.Now().UTC()
	}
	if err := c.Sink.RecordCoarseCell(ctx, e.Actor.ID, cell, now); err != nil {
		return command.Rejected(e, "COARSE_LOCATION_FAILED", "INTERNAL", "SAFE_RETRY", "tagging.coarse_location_failed", nil)
	}
	return command.Accepted(e, "CoarseLocation", cell, 1, "RECORDED", nil)
}

func number(payload map[string]any, key string) (float64, bool) {
	switch v := payload[key].(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	}
	return 0, false
}
