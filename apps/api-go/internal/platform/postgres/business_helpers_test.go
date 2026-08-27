package postgres

import "encoding/json"

// readStringBiz finds a top-level string value at key in a JSON payload.
func readStringBiz(raw, key string) string {
	var top map[string]any
	if err := json.Unmarshal([]byte(raw), &top); err != nil {
		return ""
	}
	if s, ok := top[key].(string); ok {
		return s
	}
	return ""
}

// bizListHasID returns true if the list of business accounts in the
// payload contains the given id.
func bizListHasID(raw, id string) bool {
	var top map[string]any
	if err := json.Unmarshal([]byte(raw), &top); err != nil {
		return false
	}
	items, ok := top["accounts"].([]any)
	if !ok {
		return false
	}
	for _, it := range items {
		if m, ok := it.(map[string]any); ok {
			if s, ok := m["id"].(string); ok && s == id {
				return true
			}
		}
	}
	return false
}
