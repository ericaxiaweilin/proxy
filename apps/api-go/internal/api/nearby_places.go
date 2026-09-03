package api

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type nearbyPlace struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Category       string  `json:"category"`
	Latitude       float64 `json:"latitude"`
	Longitude      float64 `json:"longitude"`
	DistanceMeters int     `json:"distanceMeters"`
}

func (s *Server) searchPlaces(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_query"})
		return
	}
	lat, e1 := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lng, e2 := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if e1 != nil || e2 != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_lat_or_lng"})
		return
	}
	requestedLanguage := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("lang")))
	if requestedLanguage == "" {
		requestedLanguage = "vi"
	}
	// Query language and display language are separate. Public Photon currently
	// only accepts a small lang set; omitting lang returns OSM's local `name`
	// (Vietnamese inside Vietnam). Common Chinese category intents are normalized
	// server-side, while proper nouns still benefit from OSM multilingual aliases.
	q = normalizePlaceQuery(q, requestedLanguage)
	values := url.Values{"q": {q}, "lat": {strconv.FormatFloat(lat, 'f', 6, 64)}, "lon": {strconv.FormatFloat(lng, 'f', 6, 64)}, "limit": {"24"}}
	endpoint := "https://photon.komoot.io/api/?" + values.Encode()
	client := s.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint, nil)
	req.Header.Set("User-Agent", "Proxy-App/1.0")
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil {
			resp.Body.Close()
		}
		writeJSON(w, http.StatusOK, map[string]any{"places": []nearbyPlace{}, "source": "offline"})
		return
	}
	defer resp.Body.Close()
	var body struct {
		Features []struct {
			Geometry struct {
				Coordinates []float64 `json:"coordinates"`
			} `json:"geometry"`
			Properties struct {
				OSMID    int64  `json:"osm_id"`
				OSMType  string `json:"osm_type"`
				Name     string `json:"name"`
				Street   string `json:"street"`
				City     string `json:"city"`
				District string `json:"district"`
				Type     string `json:"type"`
			} `json:"properties"`
		} `json:"features"`
	}
	if json.NewDecoder(resp.Body).Decode(&body) != nil {
		writeJSON(w, http.StatusOK, map[string]any{"places": []nearbyPlace{}, "source": "offline"})
		return
	}
	places := []nearbyPlace{}
	for _, feature := range body.Features {
		if len(feature.Geometry.Coordinates) < 2 || strings.TrimSpace(feature.Properties.Name) == "" {
			continue
		}
		pLng, pLat := feature.Geometry.Coordinates[0], feature.Geometry.Coordinates[1]
		distance := geoDistanceMeters(lat, lng, pLat, pLng)
		if distance > 15000 {
			continue
		}
		places = append(places, nearbyPlace{ID: fmt.Sprintf("osm:%s:%d", feature.Properties.OSMType, feature.Properties.OSMID), Name: feature.Properties.Name, Category: feature.Properties.Type, Latitude: pLat, Longitude: pLng, DistanceMeters: distance})
	}
	sort.SliceStable(places, func(i, j int) bool { return places[i].DistanceMeters < places[j].DistanceMeters })
	if len(places) > 12 {
		places = places[:12]
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, map[string]any{"places": places, "source": "photon", "language": requestedLanguage})
}

func normalizePlaceQuery(query, displayLanguage string) string {
	if displayLanguage != "vi" {
		return query
	}
	aliases := map[string]string{
		"公园": "công viên", "咖啡": "cà phê", "咖啡店": "quán cà phê",
		"餐厅": "nhà hàng", "饭店": "nhà hàng", "酒吧": "quán bar",
		"市场": "chợ", "商场": "trung tâm thương mại", "博物馆": "bảo tàng",
		"景点": "điểm tham quan", "寺庙": "chùa", "酒店": "khách sạn", "水疗": "spa",
	}
	if translated, ok := aliases[strings.TrimSpace(query)]; ok {
		return translated
	}
	return query
}

// nearbyPlaces is global and coordinate-driven. Administrative names are labels,
// never query keys, so renamed Vietnamese provinces do not invalidate discovery.
func (s *Server) nearbyPlaces(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	lat, e1 := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lng, e2 := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if e1 != nil || e2 != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_lat_or_lng"})
		return
	}
	radius := 15000
	if raw := r.URL.Query().Get("radius"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 1000 && parsed <= 30000 {
			radius = parsed
		}
	}
	query := fmt.Sprintf(`[out:json][timeout:12];(nwr(around:%d,%.6f,%.6f)[name][tourism~"attraction|museum|gallery|viewpoint|zoo|theme_park"];nwr(around:%d,%.6f,%.6f)[name][leisure~"park|nature_reserve"];nwr(around:%d,%.6f,%.6f)[name][amenity~"arts_centre|theatre|marketplace"];);out center tags 40;`, radius, lat, lng, radius, lat, lng, radius, lat, lng)
	endpoint := "https://overpass-api.de/api/interpreter?data=" + url.QueryEscape(query)
	client := s.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 14 * time.Second}
	}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint, nil)
	req.Header.Set("User-Agent", "Proxy-App/1.0")
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil {
			resp.Body.Close()
		}
		writeJSON(w, http.StatusOK, map[string]any{"places": []nearbyPlace{}, "source": "offline"})
		return
	}
	defer resp.Body.Close()
	var body struct {
		Elements []struct {
			Type   string  `json:"type"`
			ID     int64   `json:"id"`
			Lat    float64 `json:"lat"`
			Lon    float64 `json:"lon"`
			Center *struct {
				Lat float64 `json:"lat"`
				Lon float64 `json:"lon"`
			} `json:"center"`
			Tags map[string]string `json:"tags"`
		} `json:"elements"`
	}
	if json.NewDecoder(resp.Body).Decode(&body) != nil {
		writeJSON(w, http.StatusOK, map[string]any{"places": []nearbyPlace{}, "source": "offline"})
		return
	}
	places := make([]nearbyPlace, 0, len(body.Elements))
	seen := map[string]bool{}
	for _, item := range body.Elements {
		name := strings.TrimSpace(item.Tags["name"])
		if name == "" || seen[strings.ToLower(name)] {
			continue
		}
		pLat, pLng := item.Lat, item.Lon
		if item.Center != nil {
			pLat, pLng = item.Center.Lat, item.Center.Lon
		}
		if pLat == 0 && pLng == 0 {
			continue
		}
		seen[strings.ToLower(name)] = true
		category := item.Tags["tourism"]
		if category == "" {
			category = item.Tags["leisure"]
		}
		if category == "" {
			category = item.Tags["amenity"]
		}
		places = append(places, nearbyPlace{ID: fmt.Sprintf("osm:%s:%d", item.Type, item.ID), Name: name, Category: category, Latitude: pLat, Longitude: pLng, DistanceMeters: geoDistanceMeters(lat, lng, pLat, pLng)})
	}
	sort.SliceStable(places, func(i, j int) bool { return places[i].DistanceMeters < places[j].DistanceMeters })
	if len(places) > 12 {
		places = places[:12]
	}
	w.Header().Set("Cache-Control", "public, max-age=900")
	writeJSON(w, http.StatusOK, map[string]any{"places": places, "source": "openstreetmap", "radiusMeters": radius})
}

func geoDistanceMeters(aLat, aLng, bLat, bLng float64) int {
	const earth = 6371000.0
	p1, p2 := aLat*math.Pi/180, bLat*math.Pi/180
	dp, dl := (bLat-aLat)*math.Pi/180, (bLng-aLng)*math.Pi/180
	x := math.Sin(dp/2)*math.Sin(dp/2) + math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)
	return int(earth * 2 * math.Atan2(math.Sqrt(x), math.Sqrt(1-x)))
}
