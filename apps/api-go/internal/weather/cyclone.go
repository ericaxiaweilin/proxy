package weather

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
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

// GDACS 读联合国 / 欧委会的灾害预警系统公开 RSS（public domain）里 eventtype=TC 且 iscurrent=true 的条目。
type GDACS struct {
	Client *http.Client
	URL    string
}

type gdacsFeed struct {
	Items []struct {
		EventType string `xml:"eventtype"`
		IsCurrent string `xml:"iscurrent"`
		Lat       string `xml:"Point>lat"`
		Lng       string `xml:"Point>long"`
	} `xml:"channel>item"`
}

func (g GDACS) Active(ctx context.Context) ([]Center, error) {
	url := g.URL
	if url == "" {
		url = "https://www.gdacs.org/xml/rss.xml"
	}
	client := g.Client
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
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

// ParseGDACS 从 RSS 里取现行热带气旋的中心。坐标缺 / 解析不了的条目跳过，不猜。
func ParseGDACS(r io.Reader) ([]Center, error) {
	raw, err := io.ReadAll(io.LimitReader(r, 8<<20))
	if err != nil {
		return nil, err
	}
	raw = bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf")) // 线上的 RSS 以 UTF-8 BOM 开头
	var feed gdacsFeed
	dec := xml.NewDecoder(bytes.NewReader(raw))
	dec.Strict = false
	if err := dec.Decode(&feed); err != nil {
		return nil, err
	}
	out := []Center{}
	for _, it := range feed.Items {
		if strings.TrimSpace(it.EventType) != "TC" || strings.TrimSpace(it.IsCurrent) != "true" {
			continue
		}
		var lat, lng float64
		if _, err := fmt.Sscanf(strings.TrimSpace(it.Lat), "%f", &lat); err != nil {
			continue
		}
		if _, err := fmt.Sscanf(strings.TrimSpace(it.Lng), "%f", &lng); err != nil {
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
