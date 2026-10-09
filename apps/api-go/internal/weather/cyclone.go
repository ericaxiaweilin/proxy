package weather

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"
)

// TyphoonRadiusKm：现行热带气旋的中心离用户多近算「台风」。台风影响范围通常几百公里，取 500。
const TyphoonRadiusKm = 500.0

// Center 是一个现行热带气旋的中心位置。
type Center struct{ Lat, Lng float64 }

// CycloneSource 给出当前所有现行热带气旋的中心。
type CycloneSource interface {
	Active(ctx context.Context) ([]Center, error)
}

// GDACS 读联合国 / 欧委会灾害预警系统（GDACS，公开数据）的热带气旋事件列表：近 7 天里 iscurrent=true 的现行气旋，
// 取中心坐标。用事件列表（JSON，几 KB，几秒）而不是整份 RSS（几百 KB，慢到常常超时）。
type GDACS struct {
	Client *http.Client
	// URL 为空时按今天往前 7 天拼；测试可以直接给一个地址。
	URL string
	Now func() time.Time
}

func (g GDACS) Active(ctx context.Context) ([]Center, error) {
	url := g.URL
	if url == "" {
		now := time.Now()
		if g.Now != nil {
			now = g.Now()
		}
		url = fmt.Sprintf("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&fromDate=%s&toDate=%s&alertlevel=Green;Orange;Red",
			now.AddDate(0, 0, -7).UTC().Format("2006-01-02"), now.AddDate(0, 0, 1).UTC().Format("2006-01-02"))
	}
	client := g.Client
	if client == nil {
		client = &http.Client{Timeout: 25 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gdacs status %d", resp.StatusCode)
	}
	return ParseGDACS(resp.Body)
}

// ParseGDACS 从事件列表（GeoJSON）里取现行热带气旋的中心。iscurrent 不是 true / 坐标不是点的条目跳过，不猜。
func ParseGDACS(r io.Reader) ([]Center, error) {
	raw, err := io.ReadAll(io.LimitReader(r, 4<<20))
	if err != nil {
		return nil, err
	}
	var body struct {
		Features []struct {
			Geometry struct {
				Type        string    `json:"type"`
				Coordinates []float64 `json:"coordinates"`
			} `json:"geometry"`
			Properties struct {
				EventType string `json:"eventtype"`
				IsCurrent string `json:"iscurrent"`
			} `json:"properties"`
		} `json:"features"`
	}
	if err := json.Unmarshal(bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf")), &body); err != nil {
		return nil, err
	}
	out := []Center{}
	for _, f := range body.Features {
		if f.Properties.EventType != "TC" || f.Properties.IsCurrent != "true" || f.Geometry.Type != "Point" || len(f.Geometry.Coordinates) < 2 {
			continue
		}
		lng, lat := f.Geometry.Coordinates[0], f.Geometry.Coordinates[1]
		if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
			continue
		}
		out = append(out, Center{Lat: lat, Lng: lng})
	}
	return out, nil
}

// DistanceKm：两点球面距离（公里）。
func DistanceKm(aLat, aLng, bLat, bLng float64) float64 {
	const r = 6371.0
	rad := math.Pi / 180
	dLat, dLng := (bLat-aLat)*rad, (bLng-aLng)*rad
	h := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(aLat*rad)*math.Cos(bLat*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * r * math.Asin(math.Min(1, math.Sqrt(h)))
}

// NearTyphoon：有没有现行热带气旋的中心在用户 TyphoonRadiusKm 以内。
func NearTyphoon(centers []Center, lat, lng float64) bool {
	for _, c := range centers {
		if DistanceKm(lat, lng, c.Lat, c.Lng) <= TyphoonRadiusKm {
			return true
		}
	}
	return false
}

// withTyphoon 把「台风」写进预报：现在和未来 48 小时。台风由热带气旋的位置判，不看天气码。
func withTyphoon(rep Report, now time.Time) Report {
	rep.Now.Condition = Typhoon
	hours := make([]Hour, len(rep.Hours))
	copy(hours, rep.Hours)
	for i := range hours {
		if hours[i].At.Before(now.Add(48 * time.Hour)) {
			hours[i].Condition = Typhoon
		}
	}
	rep.Hours = hours
	return rep
}
