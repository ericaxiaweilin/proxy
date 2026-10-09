package weather

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

var hanoi = time.FixedZone("ICT", 7*3600)

func hoursFrom(start time.Time, conds map[int]string, prob map[int]int, n int) []Hour {
	out := []Hour{}
	for i := 0; i < n; i++ {
		c, ok := conds[i]
		if !ok {
			c = Clear
		}
		out = append(out, Hour{At: start.Add(time.Duration(i) * time.Hour), PrecipProb: prob[i], Condition: c})
	}
	return out
}

func TestAdviseWarnsOnStormAndSuggestsDryWindows(t *testing.T) {
	now := time.Date(2026, 10, 9, 0, 0, 0, 0, hanoi) // 周五 00:00
	rep := Report{Hours: hoursFrom(now, map[int]string{15: HeavyRain, 16: HeavyRain, 17: Storm, 18: Rain}, map[int]int{15: 90, 16: 90, 17: 95, 18: 70}, 48)}
	a := Advise(rep, now.Add(15*time.Hour), 2*time.Hour, now, hanoi) // 15:00 见面
	if a.Level != LevelWarn || a.Condition != HeavyRain {
		t.Fatalf("heavy rain at the meeting time must warn: %+v", a)
	}
	if len(a.Suggestions) == 0 {
		t.Fatal("a warning comes with better times")
	}
	for _, s := range a.Suggestions {
		if h := s.In(hanoi).Hour(); h < 7 || h > 20 {
			t.Fatalf("no suggestions in the middle of the night: %v", s)
		}
		if _, _, _, ok := windowWorst(rep.Hours, s, 2*time.Hour); !ok {
			t.Fatal("suggestion outside the forecast")
		}
		if sev, _, _, _ := windowWorst(rep.Hours, s, 2*time.Hour); sev != 0 {
			t.Fatalf("suggested a wet window: %v", s)
		}
	}
	if a.Suggestions[0].Sub(now.Add(15*time.Hour)).Abs() > 4*time.Hour {
		t.Fatalf("closest dry time first: %v", a.Suggestions)
	}
}

func TestAdviseDryMeansOKAndMissingForecastIsUnknown(t *testing.T) {
	now := time.Date(2026, 10, 9, 8, 0, 0, 0, hanoi)
	rep := Report{Hours: hoursFrom(now, nil, nil, 24)}
	if a := Advise(rep, now.Add(3*time.Hour), 2*time.Hour, now, hanoi); a.Level != LevelOK || len(a.Suggestions) != 0 {
		t.Fatalf("dry = OK, no suggestions: %+v", a)
	}
	if a := Advise(rep, now.Add(60*time.Hour), 2*time.Hour, now, hanoi); a.Level != LevelUnknown {
		t.Fatalf("beyond the forecast is unknown, not fine: %+v", a)
	}
	rainy := Report{Hours: hoursFrom(now, map[int]string{3: Rain}, map[int]int{3: 65}, 24)}
	if a := Advise(rainy, now.Add(3*time.Hour), time.Hour, now, hanoi); a.Level != LevelOK {
		t.Fatalf("ordinary rain says nothing — only heavy rain / typhoon prompt: %+v", a)
	}
}

func TestWMOCodesAndGridAndStaleCache(t *testing.T) {
	for code, want := range map[int]string{0: Clear, 3: Cloudy, 45: Fog, 53: Drizzle, 61: Rain, 65: HeavyRain, 82: HeavyRain, 95: Storm, 99: Storm} {
		if got := ConditionFromWMO(code); got != want {
			t.Fatalf("code %d -> %s want %s", code, got, want)
		}
	}
	if la, ln := Grid(21.0456, 106.1234); la != 21.0 || ln != 106.1 {
		t.Fatalf("only a ~11km grid leaves the server: %v %v", la, ln)
	}
	now := time.Now()
	calls, fail := 0, false
	svc := &Service{Now: func() time.Time { return now }, Provider: provFunc(func(float64, float64) (Report, error) {
		calls++
		if fail {
			return Report{}, errors.New("down")
		}
		return Report{Now: Now{Condition: Clear}}, nil
	})}
	for i := 0; i < 3; i++ {
		_, _ = svc.Forecast(context.Background(), 21.04, 106.12)
	}
	if calls != 1 {
		t.Fatalf("same grid is cached: %d calls", calls)
	}
	now, fail = now.Add(time.Hour), true
	if _, err := svc.Forecast(context.Background(), 21.04, 106.12); err != nil {
		t.Fatal("a fresh-enough stale cache beats failing")
	}
	now = now.Add(4 * time.Hour)
	if _, err := svc.Forecast(context.Background(), 21.04, 106.12); err == nil {
		t.Fatal("old data is not served as if current")
	}
}

type provFunc func(lat, lng float64) (Report, error)

func (f provFunc) Fetch(_ context.Context, lat, lng float64) (Report, error) { return f(lat, lng) }

const gdacsSample = `<?xml version="1.0"?><rss xmlns:gdacs="http://www.gdacs.org" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#"><channel>
<item><gdacs:eventtype>TC</gdacs:eventtype><gdacs:iscurrent>true</gdacs:iscurrent><geo:Point><geo:lat>18.3</geo:lat><geo:long>112.6</geo:long></geo:Point></item>
<item><gdacs:eventtype>TC</gdacs:eventtype><gdacs:iscurrent>false</gdacs:iscurrent><geo:Point><geo:lat>21.0</geo:lat><geo:long>105.8</geo:long></geo:Point></item>
<item><gdacs:eventtype>EQ</gdacs:eventtype><gdacs:iscurrent>true</gdacs:iscurrent><geo:Point><geo:lat>21.0</geo:lat><geo:long>105.8</geo:long></geo:Point></item>
<item><gdacs:eventtype>TC</gdacs:eventtype><gdacs:iscurrent>true</gdacs:iscurrent><geo:Point><geo:lat>x</geo:lat><geo:long>y</geo:long></geo:Point></item>
</channel></rss>`

// 台风 = 公共气象数据（GDACS 现行热带气旋）里有一个中心离用户 500 公里以内。只认 TC、现行、坐标可解析的。
func TestTyphoonComesFromActiveCyclonesNearTheUser(t *testing.T) {
	centers, err := ParseGDACS(strings.NewReader(gdacsSample))
	if err != nil || len(centers) != 1 || centers[0].Lat != 18.3 || centers[0].Lng != 112.6 {
		t.Fatalf("only the current, parseable TC counts: %+v %v", centers, err)
	}
	if !NearTyphoon([]Center{{Lat: 18.3, Lng: 108.0}}, 16.05, 108.2) { // 岘港附近
		t.Fatal("a cyclone ~250km away is a typhoon for Da Nang")
	}
	if NearTyphoon([]Center{{Lat: 18.3, Lng: 112.6}}, 21.05, 106.07) { // 北宁，≈ 700 km
		t.Fatal("700km away is not")
	}
	if NearTyphoon(nil, 21, 106) {
		t.Fatal("no cyclones, no typhoon")
	}
}

type fakeCyclones struct {
	c   []Center
	err error
}

func (f fakeCyclones) Active(context.Context) ([]Center, error) { return f.c, f.err }

func TestServiceMarksTyphoonOnlyNearAnActiveCycloneAndNeverOnAFailedLookup(t *testing.T) {
	prov := provFunc(func(float64, float64) (Report, error) {
		return Report{Now: Now{TempC: 28, Condition: Clear}, Hours: []Hour{{At: time.Now().Add(time.Hour), Condition: Clear}}}, nil
	})
	near := &Service{Provider: prov, Cyclones: fakeCyclones{c: []Center{{Lat: 18.3, Lng: 108.0}}}}
	_, _ = near.Forecast(context.Background(), 16.05, 108.2) // 第一次触发后台刷新（不让用户请求等上游）
	time.Sleep(100 * time.Millisecond)
	rep, _ := near.Forecast(context.Background(), 16.05, 108.2)
	if rep.Now.Condition != Typhoon || rep.Hours[0].Condition != Typhoon {
		t.Fatalf("near a cyclone: %+v", rep)
	}
	far := &Service{Provider: prov, Cyclones: fakeCyclones{c: []Center{{Lat: 18.3, Lng: 112.6}}}}
	_, _ = far.Forecast(context.Background(), 21.05, 106.07)
	time.Sleep(100 * time.Millisecond)
	if rep, _ := far.Forecast(context.Background(), 21.05, 106.07); rep.Now.Condition != Clear {
		t.Fatalf("far away stays as forecast: %+v", rep)
	}
	down := &Service{Provider: prov, Cyclones: fakeCyclones{err: errors.New("down")}}
	if rep, _ := down.Forecast(context.Background(), 16.05, 108.2); rep.Now.Condition != Clear {
		t.Fatalf("a failed lookup never invents a typhoon: %+v", rep)
	}
	// 台风 = 一定提示。
	now := time.Date(2026, 10, 9, 0, 0, 0, 0, hanoi)
	rep2 := Report{Hours: hoursFrom(now, map[int]string{15: Typhoon, 16: Typhoon}, map[int]int{15: 90, 16: 90}, 48)}
	if a := Advise(rep2, now.Add(15*time.Hour), 2*time.Hour, now, hanoi); a.Level != LevelWarn || a.Condition != Typhoon {
		t.Fatalf("a typhoon at the meeting time is a warning: %+v", a)
	}
}

// 线上的 GDACS RSS 以 UTF-8 BOM 开头：带 BOM 也要能解析（实测踩过：不处理就一个气旋都读不出来）。
func TestParseGDACSAcceptsTheByteOrderMark(t *testing.T) {
	centers, err := ParseGDACS(strings.NewReader("\ufeff" + gdacsSample))
	if err != nil || len(centers) != 1 {
		t.Fatalf("BOM-prefixed feed: %+v %v", centers, err)
	}
}
