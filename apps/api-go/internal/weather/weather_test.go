package weather

import (
	"context"
	"errors"
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
	if a := Advise(rainy, now.Add(3*time.Hour), time.Hour, now, hanoi); a.Level != LevelCaution {
		t.Fatalf("ordinary rain is a reminder, not a block: %+v", a)
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
