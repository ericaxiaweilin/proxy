package localnet

import "strings"

// canonicalCityKey maps any city string (中文 / 越南文 / 英文) → canonical key.
// 双端规则 (Go + TS) 严格一致 — 改这一份必须同步改
// packages/contracts/src/city-key.ts.
//
//   "河内" / "hn" / "Hanoi" / "hanoi" / "Hà Nội" → "hanoi"
//   "胡志明市" / "hcmc" / "Hồ Chí Minh" / "HCM" / "Saigon" → "hcmc"
//   "岘港" / "danang" / "Đà Nẵng" / "Da Nang" → "danang"
//   "" / 未知 → "" (调用方跳过 city filter, legacy 全量)
func canonicalCityKey(input string) string {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return ""
	}
	// 1) 直查 (中文 / 全小写别名)
	directHit, ok := cityAliasToKey[trimmed]
	if ok {
		return directHit
	}
	// 2) 全部 lowercase 后查 (英文 / 越南文)
	lowered := strings.ToLower(trimmed)
	lowerHit, ok := cityAliasToKey[lowered]
	if ok {
		return lowerHit
	}
	// 3) 剥非字母数字再查 (兼容 "Hà Nội" / "Hồ Chí Minh" / "Đà Nẵng")
	stripped := stripNonAlphaNumeric(lowered)
	if hit, ok := cityAliasToKey[stripped]; ok {
		return hit
	}
	return ""
}

func stripNonAlphaNumeric(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

var cityAliasToKey = map[string]string{
	// 河内
	"河内":  "hanoi",
	"hn":   "hanoi",
	"hanoi": "hanoi",
	"hnội":  "hanoi",
	"hn i":  "hanoi",
	"hà nội": "hanoi", // R15.22 cross-alias regression: viewer "河内" + post "Hà Nội" must match
	// 胡志明市
	"胡志明市":   "hcmc",
	"hcmc":     "hcmc",
	"hcm":      "hcmc",
	"saigon":   "hcmc",
	"hchminh":  "hcmc",
	"hchminhth": "hcmc",
	// 岘港
	"岘港":     "danang",
	"danang":  "danang",
	"dn":      "danang",
	"đànẵng":   "danang",
	"đà nẵng":   "danang",
	"danng":    "danang",
}
