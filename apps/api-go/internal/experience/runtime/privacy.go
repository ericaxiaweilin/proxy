package runtime

import "strings"

// Privacy — §26 权限与隐私
// Surface Compiler 只能消费 Decision 已允许暴露给当前 Surface 的数据

var sensitiveFields = map[string]bool{
	"price_accept_p75": true,
	"latent_affinity":  true,
	"merchant_targeting_eligibility": true,
	"income_inference": true,
}

var forbiddenExplanationPrefixes = []string{
	"因为我们判断你收入",
	"because we infer your income",
}

// FilterSensitiveProps removes internal features before they reach UI Schema
func FilterSensitiveProps(props map[string]any) map[string]any {
	if props == nil {
		return nil
	}
	out := make(map[string]any, len(props))
	for k, v := range props {
		if sensitiveFields[k] {
			continue
		}
		if s, ok := v.(string); ok {
			lower := strings.ToLower(s)
			forbidden := false
			for _, prefix := range forbiddenExplanationPrefixes {
				if strings.HasPrefix(lower, strings.ToLower(prefix)) {
					forbidden = true
					break
				}
			}
			if forbidden {
				continue
			}
		}
		out[k] = v
	}
	return out
}

// ChannelPolicy — §27 与 Notification/Push 的关系
// 同一 Intent 投影到不同 Channel 必须重过 Intervention Policy
var channelAllowed = map[string]map[string]bool{
	"SOFT_NUDGE": {"FEED": true, "IN_APP": true, "HOME": true, "PUSH": false, "WIDGET": true},
	"PASSIVE":    {"FEED": true, "IN_APP": true, "HOME": true, "PUSH": false},
	"ACTIVE":     {"FEED": true, "IN_APP": true, "HOME": true, "PUSH": true, "WIDGET": true},
	"PUSH":       {"PUSH": true, "IN_APP": true},
	"POPUP":      {"IN_APP": true, "HOME": true},
}

func IsChannelAllowed(intervention, channel string) bool {
	if m, ok := channelAllowed[intervention]; ok {
		return m[channel]
	}
	return false
}
