package postgres

import "encoding/json"

// readStringFF finds a top-level string value at key in a JSON payload.
func readStringFF(raw, key string) string {
	var top map[string]any
	if err := json.Unmarshal([]byte(raw), &top); err != nil {
		return ""
	}
	if s, ok := top[key].(string); ok {
		return s
	}
	return ""
}
