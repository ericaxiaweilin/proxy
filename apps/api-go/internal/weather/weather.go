// Package weather：发布需求时的天气提示与见面时间建议（WEATHER-001）。
//
// 数据源 Open-Meteo（无需 key）。隐私：只把**约 0.1°（≈11km，城市级）**的网格坐标发给上游，
// 不带用户 id；不落库、不写日志。上游读不出来就如实说「没有天气」，不编、不当成晴天。
package weather

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"sync"
	"time"
)

// 受控的天气状态，按严重程度递增。
const (
	Clear     = "clear"
	Cloudy    = "cloudy"
	Fog       = "fog"
	Drizzle   = "drizzle"
	Rain      = "rain"
	HeavyRain = "heavy_rain"
	Storm     = "storm"
	// Typhoon：台风。不由天气码判（天气码里没有台风），由公共气象数据（GDACS 的现行热带气旋）+ 用户位置判：
	// 有现行热带气旋的中心离用户不到 TyphoonRadiusKm 就是台风。
	Typhoon = "typhoon"
)

var severity = map[string]int{Clear: 0, Cloudy: 0, Fog: 1, Drizzle: 1, Rain: 2, HeavyRain: 3, Storm: 3, Typhoon: 4}

// ConditionFromWMO 把 WMO 天气码归到上面几类。未知码按 cloudy（不夸大也不当成雨）。
func ConditionFromWMO(code int) string {
	switch {
	case code <= 1:
		return Clear
	case code <= 3:
		return Cloudy
	case code == 45 || code == 48:
		return Fog
	case code >= 51 && code <= 57:
		return Drizzle
	case code == 65 || code == 82 || code == 67:
		return HeavyRain
	case (code >= 61 && code <= 66) || (code >= 80 && code <= 81):
		return Rain
	case code >= 95:
		return Storm
	default:
		return Cloudy
	}
}

type Now struct {
	TempC     float64 `json:"tempC"`
	Condition string  `json:"condition"`
}

type Hour struct {
	At         time.Time `json:"at"`
	PrecipProb int       `json:"precipProb"` // 降水概率 %
	Condition  string    `json:"condition"`
}

type Report struct {
	Now       Now       `json:"now"`
	Hours     []Hour    `json:"hours"` // 未来约 48 小时，逐小时
	FetchedAt time.Time `json:"fetchedAt"`
}

// Provider 取一个网格点的预报。
type Provider interface {
	Fetch(ctx context.Context, lat, lng float64) (Report, error)
}

// Grid 把坐标取整到 0.1°。发给上游和做缓存键的都是它。
func Grid(lat, lng float64) (float64, float64) {
	return math.Round(lat*10) / 10, math.Round(lng*10) / 10
}

// Service 带缓存（同网格 30 分钟）。上游失败时，已有的旧缓存最多再用 3 小时，之后如实报错。
type Service struct {
	Provider Provider
	// Cyclones 给出现行热带气旋的中心；nil = 不判台风。读不到（上游挂了）也不判，不编。
	Cyclones CycloneSource
	Now      func() time.Time
	TTL      time.Duration

	mu    sync.Mutex
	cache map[[2]float64]Report

	cycMu      sync.Mutex
	cycCenters []Center
	cycAt      time.Time
}

// typhoonNear：用户这个位置附近有没有现行热带气旋（中心列表缓存 30 分钟；读不到就当没有）。
func (s *Service) typhoonNear(ctx context.Context, lat, lng float64) bool {
	if s.Cyclones == nil {
		return false
	}
	s.cycMu.Lock()
	defer s.cycMu.Unlock()
	if s.cycAt.IsZero() || s.now().Sub(s.cycAt) > 30*time.Minute {
		if centers, err := s.Cyclones.Active(ctx); err == nil {
			s.cycCenters, s.cycAt = centers, s.now()
		} else if s.cycAt.IsZero() || s.now().Sub(s.cycAt) > 3*time.Hour {
			s.cycCenters = nil
		}
	}
	return NearTyphoon(s.cycCenters, lat, lng)
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) Forecast(ctx context.Context, lat, lng float64) (Report, error) {
	rep, err := s.forecastBase(ctx, lat, lng)
	if err != nil {
		return rep, err
	}
	if s.typhoonNear(ctx, lat, lng) {
		return withTyphoon(rep, s.now()), nil
	}
	return rep, nil
}

func (s *Service) forecastBase(ctx context.Context, lat, lng float64) (Report, error) {
	glat, glng := Grid(lat, lng)
	key := [2]float64{glat, glng}
	ttl := s.TTL
	if ttl == 0 {
		ttl = 30 * time.Minute
	}
	s.mu.Lock()
	cached, ok := s.cache[key]
	s.mu.Unlock()
	if ok && s.now().Sub(cached.FetchedAt) < ttl {
		return cached, nil
	}
	rep, err := s.Provider.Fetch(ctx, glat, glng)
	if err != nil {
		if ok && s.now().Sub(cached.FetchedAt) < 3*time.Hour {
			return cached, nil
		}
		return Report{}, err
	}
	rep.FetchedAt = s.now()
	s.mu.Lock()
	if s.cache == nil {
		s.cache = map[[2]float64]Report{}
	}
	s.cache[key] = rep
	s.mu.Unlock()
	return rep, nil
}

// OpenMeteo 是真实上游。
type OpenMeteo struct {
	Client  *http.Client
	BaseURL string
}

func (o OpenMeteo) Fetch(ctx context.Context, lat, lng float64) (Report, error) {
	base := o.BaseURL
	if base == "" {
		base = "https://api.open-meteo.com"
	}
	client := o.Client
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	url := fmt.Sprintf("%s/v1/forecast?latitude=%.1f&longitude=%.1f&current=temperature_2m,weather_code&hourly=precipitation_probability,weather_code&forecast_days=3&timeformat=unixtime&timezone=auto", base, lat, lng)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return Report{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return Report{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Report{}, fmt.Errorf("weather upstream status %d", resp.StatusCode)
	}
	var body struct {
		Current struct {
			Temp float64 `json:"temperature_2m"`
			Code int     `json:"weather_code"`
		} `json:"current"`
		Hourly struct {
			Time []int64    `json:"time"`
			Prob []*float64 `json:"precipitation_probability"`
			Code []*int     `json:"weather_code"`
		} `json:"hourly"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Report{}, err
	}
	rep := Report{Now: Now{TempC: math.Round(body.Current.Temp), Condition: ConditionFromWMO(body.Current.Code)}}
	for i, ts := range body.Hourly.Time {
		if i >= len(body.Hourly.Prob) || i >= len(body.Hourly.Code) || body.Hourly.Prob[i] == nil || body.Hourly.Code[i] == nil {
			continue // 缺的小时不补
		}
		rep.Hours = append(rep.Hours, Hour{At: time.Unix(ts, 0).UTC(), PrecipProb: int(*body.Hourly.Prob[i]), Condition: ConditionFromWMO(*body.Hourly.Code[i])})
	}
	return rep, nil
}

// 提示等级。
const (
	LevelOK      = "OK"
	LevelCaution = "CAUTION" // 可能下雨，提醒一下
	LevelWarn    = "WARN"    // 暴雨 / 雷暴，建议换时间
)

type Advice struct {
	Level string `json:"level"`
	// Condition 是见面时段里最差的那个状态；预报覆盖不到该时段时为空，等级 UNKNOWN。
	Condition   string      `json:"condition,omitempty"`
	MaxProb     int         `json:"maxPrecipProb"`
	Suggestions []time.Time `json:"suggestions"` // 更合适的开始时间（最多 3 个），按离原时间由近到远
}

const LevelUnknown = "UNKNOWN"

func windowWorst(hours []Hour, start time.Time, dur time.Duration) (sev int, cond string, prob int, covered bool) {
	end := start.Add(dur)
	cond = Clear
	for _, h := range hours {
		// 小时 h 覆盖 [h.At, h.At+1h)
		if h.At.Add(time.Hour).After(start) && h.At.Before(end) {
			covered = true
			if s := severity[h.Condition]; s > sev || (s == sev && severity[cond] < s) {
				sev, cond = s, h.Condition
			}
			if h.PrecipProb > prob {
				prob = h.PrecipProb
			}
		}
	}
	return
}

func levelOf(sev, prob int) string {
	// 只有暴雨 / 雷暴 / 台风才提示（用户：「暴雨 台风要提示 别的没事」）。普通雨不打扰。
	_ = prob
	if sev >= 3 {
		return LevelWarn
	}
	return LevelOK
}

// Advise 判断 [at, at+dur) 的天气，并在不是 OK 时给出之后 48 小时内更合适的开始时间。
// 只在 07:00–22:00（预报所在地时区由调用方传入 loc）里找，半夜不建议见面。
func Advise(rep Report, at time.Time, dur time.Duration, now time.Time, loc *time.Location) Advice {
	sev, cond, prob, covered := windowWorst(rep.Hours, at, dur)
	if !covered {
		return Advice{Level: LevelUnknown, Suggestions: []time.Time{}}
	}
	a := Advice{Level: levelOf(sev, prob), Condition: cond, MaxProb: prob, Suggestions: []time.Time{}}
	if a.Level == LevelOK {
		return a
	}
	type cand struct {
		t time.Time
		d time.Duration
	}
	var cands []cand
	from := now.Truncate(time.Hour).Add(time.Hour)
	for t := from; t.Before(now.Add(48 * time.Hour)); t = t.Add(time.Hour) {
		hr := t.In(loc).Hour()
		if hr < 7 || hr+int(dur.Hours()+0.999) > 22 {
			continue
		}
		s, _, p, ok := windowWorst(rep.Hours, t, dur)
		// 建议的时段要「干」：连普通雨 / 毛毛雨都不要（只有暴雨 / 台风才提示，但推荐时间要挑真正好的）。
		if !ok || s != 0 || levelOf(s, p) != LevelOK {
			continue
		}
		d := t.Sub(at)
		if d < 0 {
			d = -d
		}
		cands = append(cands, cand{t, d})
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].d < cands[j].d })
	// 相邻的小时不重复推荐：每个建议之间至少隔 3 小时。
	for _, c := range cands {
		ok := true
		for _, picked := range a.Suggestions {
			if diff := c.t.Sub(picked); diff < 3*time.Hour && diff > -3*time.Hour {
				ok = false
				break
			}
		}
		if ok {
			a.Suggestions = append(a.Suggestions, c.t)
		}
		if len(a.Suggestions) == 3 {
			break
		}
	}
	return a
}
