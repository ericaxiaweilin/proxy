package weatherwatch

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/weather"
)

type fakeSrc []Meeting

func (f fakeSrc) Upcoming(context.Context, time.Time, time.Time) ([]Meeting, error) { return f, nil }

type fakeFc struct{ cond string }

func (f fakeFc) Forecast(_ context.Context, _, _ float64) (weather.Report, error) {
	base := time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC)
	hrs := []weather.Hour{}
	for i := 0; i < 72; i++ {
		h := weather.Hour{At: base.Add(time.Duration(i) * time.Hour), Condition: weather.Clear}
		// 开始时间 2026-10-10 08:00 UTC 前后下雨
		if i >= 30 && i <= 34 {
			h.Condition = f.cond
			if f.cond != weather.Clear {
				h.PrecipProb = 90
			}
		}
		hrs = append(hrs, h)
	}
	return weather.Report{Hours: hrs}, nil
}

type rec struct{ got []string }

func (r *rec) Notify(_ context.Context, uid, mid, title, body string) error {
	r.got = append(r.got, uid+"|"+mid+"|"+body)
	return nil
}

func TestHeavyRainWarnsEveryoneWithBetterTimesAndDryDaysStaySilent(t *testing.T) {
	now := time.Date(2026, 10, 9, 8, 0, 0, 0, time.UTC)
	start := time.Date(2026, 10, 10, 8, 0, 0, 0, time.UTC) // 30h 后
	m := Meeting{ID: "a1", Title: "西湖咖啡", StartsAt: start, DurationMin: 120, Lat: 21, Lng: 105.8, People: []string{"host", "guest"}}
	out := &rec{}
	n, err := Run(context.Background(), fakeSrc{m}, fakeFc{weather.HeavyRain}, out, now)
	if err != nil || n != 2 {
		t.Fatalf("host and guest both hear about it: %d %v", n, err)
	}
	if !strings.Contains(out.got[0], "暴雨") || !strings.Contains(out.got[0], "建议和同行的人商量改到") {
		t.Fatalf("heavy rain comes with alternatives: %s", out.got[0])
	}
	out = &rec{}
	if n, _ := Run(context.Background(), fakeSrc{m}, fakeFc{weather.Clear}, out, now); n != 0 || len(out.got) != 0 {
		t.Fatalf("good weather says nothing: %d", n)
	}
	out = &rec{}
	if n, _ := Run(context.Background(), fakeSrc{m}, fakeFc{weather.Rain}, out, now); n != 2 || !strings.Contains(out.got[0], "带伞") {
		t.Fatalf("ordinary rain is just a reminder: %d %v", n, out.got)
	}
}

func TestMessageForUnknownAndOKIsEmpty(t *testing.T) {
	now := time.Now()
	if Message("x", now, weather.Advice{Level: weather.LevelOK}) != "" || Message("x", now, weather.Advice{Level: weather.LevelUnknown}) != "" {
		t.Fatal("nothing to say")
	}
}
