package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// reverseGeocode is a thin server-side proxy to Nominatim OpenStreetMap.
// The mobile LocationPickerSheet (R15.32.1.3) calls this with (lat, lng)
// after the user GPS-snaps the pin, so the picker can show a real
// street/POI/city name (e.g. "Hoàn Kiếm, Hà Nội") instead of grid
// coordinates. Going through our server gives us one log line per
// call and a place to add a small in-memory cache if Nominatim
// rate-limits us.
//
// Query params:
//   - lat, lng (required): -90..90 / -180..180
//   - zoom (optional): 1..18, default 18 (street-level)
//
// Response: { displayName, road?, poi?, source }
//   - source = "remote" if Nominatim returned a hit
//   - source = "offline" if Nominatim was unreachable or returned
//     an empty body; the mobile side falls back to its grid POI
//     lookup in that case.
//
// We do NOT do any auth — this is anonymous read traffic, like
// /v1/map/items and /v1/facet/objects.
func (s *Server) reverseGeocode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	q := r.URL.Query()
	latStr := q.Get("lat")
	lngStr := q.Get("lng")
	if latStr == "" || lngStr == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_lat_or_lng"})
		return
	}
	lat, errLat := strconv.ParseFloat(latStr, 64)
	lng, errLng := strconv.ParseFloat(lngStr, 64)
	if errLat != nil || errLng != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_lat_or_lng"})
		return
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "out_of_range"})
		return
	}
	zoom := "18"
	if z := q.Get("zoom"); z != "" {
		zoom = z
	}
	// R15.32.1.3: we proxy Photon (komoot.io) instead of Nominatim
	// because Nominatim aggressively rate-limits / IP-blocks
	// anonymous consumers from cloud IPs. Photon is a free OSM-
	// based geocoder with no auth, and returns GeoJSON Feature-
	// Collection. We translate one feature into the same
	// { displayName, road, poi, source } shape the mobile side
	// already understands.
	photonURL := fmt.Sprintf("https://photon.komoot.io/reverse?lon=%f&lat=%f", lng, lat)
	client := s.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 4 * time.Second}
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, photonURL, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "build_request_failed"})
		return
	}
	req.Header.Set("User-Agent", "Proxy-App/1.0")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		// Network / DNS / TLS — return a 200 with source=offline so
		// the mobile side can degrade to its grid-POI fallback
		// instead of showing a hard error to the user.
		writeJSON(w, http.StatusOK, map[string]any{
			"displayName": "",
			"source":      "offline",
		})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeJSON(w, http.StatusOK, map[string]any{
			"displayName": "",
			"source":      "offline",
		})
		return
	}
	var body struct {
		Features []struct {
			Properties struct {
				// Photon properties — see https://photon.komoot.io/.
				// "name" is the most specific hit (street / POI).
				// We prefer "name" for displayName, with city +
				// country as suffixes when present.
				Name        string `json:"name"`
				Street      string `json:"street"`
				City        string `json:"city"`
				State       string `json:"state"`
				District    string `json:"district"`
				Country     string `json:"country"`
				CountryCode string `json:"countrycode"`
				Type        string `json:"type"`
			} `json:"properties"`
		} `json:"features"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"displayName": "",
			"source":      "offline",
		})
		return
	}
	if len(body.Features) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"displayName": "",
			"source":      "offline",
		})
		return
	}
	first := body.Features[0]
	props := first.Properties
	// Build a human-readable displayName from Photon's parts.
	// Prefer: "Street, City" → fall back to "City, Country" →
	// "Name" alone. The mobile side picks city from the city
	// field via pickCityFromDisplayName.
	display := buildPhotonDisplayName(props)
	out := map[string]any{
		"displayName": display,
		"source":      "remote",
		"provider":    "photon",
		"version":     "wgs84-v1",
	}
	if props.Name != "" {
		// POI: only treat as POI if the type is a specific landmark
		// (not a street or city). Photon uses OSM tags; we treat
		// anything with a name as POI-eligible.
		out["poi"] = props.Name
	}
	if props.Street != "" {
		out["road"] = props.Street
	}
	if props.City != "" {
		out["city"] = props.City
	}
	// R15.32.1.5: pass through state / district too. Mobile used to
	// only read `city`, but Photon's `city` is sometimes a
	// district (e.g. "District 1" for HCMC inner wards). When
	// `state` is non-empty, the mobile side prefers
	// city ?? state as the canonical city label.
	if props.State != "" {
		out["state"] = props.State
	}
	if props.District != "" {
		out["district"] = props.District
	}
	if props.Country != "" {
		out["country"] = props.Country
	}
	if props.CountryCode != "" {
		out["countryCode"] = strings.ToUpper(props.CountryCode)
	}
	_ = zoom // reserved for future Nominatim fallback
	writeJSON(w, http.StatusOK, out)
}

// buildPhotonDisplayName assembles a single-line human-readable
// label from a Photon properties blob. Mirrors the shape Nominatim
// returns (so the mobile pickCityFromDisplayName can reuse the
// same "City, Country" detection).
func buildPhotonDisplayName(p struct {
	Name        string `json:"name"`
	Street      string `json:"street"`
	City        string `json:"city"`
	State       string `json:"state"`
	District    string `json:"district"`
	Country     string `json:"country"`
	CountryCode string `json:"countrycode"`
	Type        string `json:"type"`
}) string {
	// "Lê Thánh Tôn, Thành phố Hồ Chí Minh, Việt Nam"
	parts := []string{}
	if p.Name != "" {
		parts = append(parts, p.Name)
	}
	if p.City != "" && !containsString(parts, p.City) {
		parts = append(parts, p.City)
	}
	if p.Country != "" && !containsString(parts, p.Country) {
		parts = append(parts, p.Country)
	}
	return strings.Join(parts, ", ")
}

func containsString(s []string, want string) bool {
	for _, v := range s {
		if v == want {
			return true
		}
	}
	return false
}
