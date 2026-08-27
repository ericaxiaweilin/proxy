package postgres

import (
	"encoding/json"
	"strings"
)

// shared helpers for the socialspace integration test. Kept in a separate
// file so the main test reads top-to-bottom.

// readStringSS finds a nested string value at a.b path inside a JSON
// payload. Returns "" if the path is missing.
func readStringSS(raw, parent, child string) string {
	var top map[string]any
	if err := json.Unmarshal([]byte(raw), &top); err != nil {
		return ""
	}
	p, ok := top[parent].(map[string]any)
	if !ok {
		return ""
	}
	if s, ok := p[child].(string); ok {
		return s
	}
	return ""
}

func readStatuses(raw string) []string {
	var top map[string]any
	if err := json.Unmarshal([]byte(raw), &top); err != nil {
		return nil
	}
	items, ok := top["statuses"].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, it := range items {
		if m, ok := it.(map[string]any); ok {
			if s, ok := m["id"].(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

func readCommunities(raw string) []string {
	var top map[string]any
	if err := json.Unmarshal([]byte(raw), &top); err != nil {
		return nil
	}
	items, ok := top["communities"].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, it := range items {
		if m, ok := it.(map[string]any); ok {
			if s, ok := m["id"].(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

func readCommunitiesJoined(raw string) map[string]bool {
	var top map[string]any
	if err := json.Unmarshal([]byte(raw), &top); err != nil {
		return nil
	}
	items, ok := top["communities"].([]any)
	if !ok {
		return nil
	}
	out := make(map[string]bool, len(items))
	for _, it := range items {
		if m, ok := it.(map[string]any); ok {
			if s, ok := m["id"].(string); ok {
				if j, ok := m["joined"].(bool); ok {
					out[s] = j
				}
			}
		}
	}
	return out
}

// ensure strings package is referenced (avoid unused import)
var _ = strings.HasPrefix
