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
		"version": 2,
		"actions": map[string]string{
			"coffee": media("seed_scene_action_extended_0_0"), "dining": media("seed_r42_v2_action_food-hunting"),
			"city-walk": media("seed_scene_action_extended_3_4"), "photo": media("seed_scene_action_extended_0_4"),
			"cycling": media("seed_r42_v2_action_cycling"), "exhibition": media("seed_scene_action_extended_2_2"),
			"shopping": media("seed_r42_v2_action_shopping"), "movie": media("seed_r42_v2_action_movie"),
			"music": media("seed_r42_v2_action_music"), "explore-store": media("seed_scene_action_extended_3_0"),
			"travel": media("seed_r42_v2_action_travel"), "sport": media("seed_r42_v2_action_sport"),
			"running": media("seed_scene_action_extended_1_1"), "sport-cycling": media("seed_scene_action_extended_1_2"),
			"badminton": media("seed_scene_action_extended_1_3"), "tennis": media("seed_scene_action_extended_1_4"),
			"yoga":                    media("seed_scene_action_extended_1_5"),
			"translation":             media("seed_scene_medical_hero_v1"),
			"registration-support":    media("seed_scene_medical_registration_v1"),
			"doctor-translation":      media("seed_scene_medical_doctor_translation_v1"),
			"examination-companion":   media("seed_scene_medical_examination_v1"),
			"pharmacy-support":        media("seed_scene_medical_pharmacy_v1"),
			"hospital-stay-companion": media("seed_scene_medical_stay_v1"),
			"checkup-companion":       media("seed_scene_medical_checkup_v1"),
		},
		"scenes": map[string]string{
			"cafe": media("seed_r42_v2_scene_cafe"), "lake": media("seed_scene_theme_0_2"),
			"old-town": media("seed_r42_v2_scene_old-town"), "night-market": media("seed_r42_v2_scene_night-market"),
			"gallery": media("seed_scene_action_extended_2_2"), "beach": media("seed_r42_v2_scene_beach"),
			"park": media("seed_r42_v2_scene_park"), "mall": media("seed_r42_v2_scene_mall"),
			"restaurant": media("seed_r42_v2_scene_restaurant"), "event": media("seed_r42_v2_scene_event"),
			"hospital": media("seed_scene_medical_hospital_v1"),
		},
		"themes": map[string]string{
			"ao-dai": media("seed_scene_aodai_oldtown"), "sunset": media("seed_scene_theme_0_1"),
			"film": media("seed_scene_action_primary_0_3"), "local": media("seed_r42_v2_theme_local"),
			"food": media("seed_scene_theme_1_0"), "art": media("seed_r42_v2_theme_art"),
			"nature": media("seed_r42_v2_theme_nature"), "night": media("seed_r42_v2_theme_night"),
			"retro": media("seed_r42_v2_theme_retro"), "vietnam": media("seed_r42_v2_theme_vietnam"),
			"medical-companion": media("seed_scene_medical_companion_v1"),
		},
		"moments": map[string]string{
			"sunset-coffee": media("seed_scene_theme_0_1"), "ao-dai-ride": media("seed_scene_aodai_oldtown"),
			"film-city-walk": media("seed_scene_action_primary_2_3"), "night-market-food": media("seed_scene_theme_1_4"),
			"gallery-coffee": media("seed_scene_action_extended_2_2"), "beach-walk": media("seed_scene_theme_1_2"),
			"local-store": media("seed_scene_action_extended_3_0"), "nature-ride": media("seed_scene_theme_1_3"),
			"hospital-translation": media("seed_scene_medical_hero_v1"),
		},
	})
}
