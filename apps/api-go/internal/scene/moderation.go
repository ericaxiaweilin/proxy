package scene

import "math"

// P1 SCENE-02/03: Scene moderation — geo dedupe, merge/split, stale
func GeoDistanceKm(lat1, lon1, lat2, lon2 float64) float64 {
	const R=6371
	dLat:=(lat2-lat1)*math.Pi/180
	dLon:=(lon2-lon1)*math.Pi/180
	a:= math.Sin(dLat/2)*math.Sin(dLat/2)+ math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2*R*math.Asin(math.Sqrt(a))
}
func IsDuplicate(lat1, lon1, lat2, lon2 float64) bool { return GeoDistanceKm(lat1,lon1,lat2,lon2) < 0.05 } // 50m 内判重
func ShouldReverify(lastVerifiedDays int) bool { return lastVerifiedDays > 90 }
