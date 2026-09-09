package api

import "net/http"

// publicSceneAssets is the semantic indirection between product taxonomy and
// media storage. Clients never know filenames and can receive new artwork
// without bundling photos or shipping a new binary.
func (s *Server) publicSceneAssets(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400")
	media := func(id string) string { return "/v1/media/thumb/" + id }
	writeJSON(w, http.StatusOK, map[string]any{
		"version": 1,
		"actions": map[string]string{
			"coffee": media("seed_scene_action_extended_0_0"), "dining": media("seed_scene_action_extended_0_5"),
			"city-walk": media("seed_scene_action_extended_3_4"), "photo": media("seed_scene_action_extended_0_4"),
			"cycling": media("seed_scene_action_extended_1_2"), "exhibition": media("seed_scene_action_extended_2_2"),
			"shopping": media("seed_scene_action_extended_0_2"), "movie": media("seed_scene_action_primary_1_5"),
			"music": media("seed_scene_action_extended_2_3"), "explore-store": media("seed_scene_action_extended_3_0"),
			"travel": media("seed_scene_action_extended_3_5"), "sport": media("seed_scene_action_extended_1_0"),
		},
		"scenes": map[string]string{
			"cafe": media("seed_scene_action_primary_0_0"), "lake": media("seed_scene_theme_0_2"),
			"old-town": media("seed_scene_theme_0_3"), "night-market": media("seed_scene_theme_0_4"),
			"gallery": media("seed_scene_action_extended_2_2"), "beach": media("seed_scene_theme_1_2"),
			"park": media("seed_scene_action_primary_1_1"), "mall": media("seed_scene_action_primary_0_1"),
			"restaurant": media("seed_scene_action_primary_0_4"), "event": media("seed_scene_action_primary_0_5"),
		},
		"themes": map[string]string{
			"ao-dai": media("seed_scene_aodai_oldtown"), "sunset": media("seed_scene_theme_0_1"),
			"film": media("seed_scene_action_primary_0_3"), "local": media("seed_scene_theme_2_1"),
			"food": media("seed_scene_theme_1_0"), "art": media("seed_scene_action_extended_2_2"),
			"nature": media("seed_scene_theme_1_3"), "night": media("seed_scene_theme_2_3"),
			"retro": media("seed_scene_theme_0_3"), "vietnam": media("seed_scene_theme_0_0"),
		},
		"moments": map[string]string{
			"sunset-coffee": media("seed_scene_theme_0_1"), "ao-dai-ride": media("seed_scene_aodai_oldtown"),
			"film-city-walk": media("seed_scene_action_primary_2_3"), "night-market-food": media("seed_scene_theme_1_4"),
			"gallery-coffee": media("seed_scene_action_extended_2_2"), "beach-walk": media("seed_scene_theme_1_2"),
			"local-store": media("seed_scene_action_extended_3_0"), "nature-ride": media("seed_scene_theme_1_3"),
		},
	})
}
