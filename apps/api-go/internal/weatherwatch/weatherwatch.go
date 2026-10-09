// Package weatherwatch：见面前一天的天气提醒（WEATHER-001）。
//
// 活动有结构化开始时间（Activity.StartsAt）和场地坐标时，在开始前约一天（18–30 小时）查那个时段的预报：
// 暴雨 / 雷暴 → 告诉发起人和报名的人，并给出更合适的时间；普通雨 → 提醒带伞。天气好或预报覆盖不到就不打扰。
// 每个人每场活动最多提醒一次（通知去重键）；读不到预报就不发，不编。
package weatherwatch

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/weather"
)

// Meeting 是一场要见面的活动。
type Meeting struct {
	ID          string
	Title       string
	StartsAt    time.Time
	DurationMin int
	Lat, Lng    float64
	People      []string // 发起人 + 已报名的人
}

type Source interface {
	// Upcoming 返回开始时间在 [from, to) 内、有场地坐标的活动。
	Upcoming(ctx context.Context, from, to time.Time) ([]Meeting, error)
}

type Forecaster interface {
	Forecast(ctx context.Context, lat, lng float64) (weather.Report, error)
}

type Notifier interface {
	// Notify 给一个人发提醒；同一 (活动, 人) 由实现按去重键保证只发一次。
	Notify(ctx context.Context, userID, meetingID, title, body string) error
}

var loc = time.FixedZone("ICT", 7*3600)

const (
	LeadMin = 18 * time.Hour
	LeadMax = 30 * time.Hour
)

// Message 把预报结论写成一句话；OK / UNKNOWN 返回空。
func Message(title string, startsAt time.Time, a weather.Advice) string {
	at := startsAt.In(loc)
	when := at.Format("15:04")
	switch a.Level {
	case weather.LevelWarn:
		cond := "暴雨"
		if a.Condition == weather.Storm {
			cond = "雷暴"
		}
		msg := fmt.Sprintf("「%s」%s 前后预报有%s", title, when, cond)
		if len(a.Suggestions) > 0 {
			opts := make([]string, 0, len(a.Suggestions))
			for _, s := range a.Suggestions {
				s = s.In(loc)
				label := s.Format("15:04")
				if s.YearDay() != at.YearDay() || s.Year() != at.Year() {
					label = s.Format("1/2 15:04")
				}
				opts = append(opts, label)
			}
			msg += "，建议和同行的人商量改到 " + strings.Join(opts, " 或 ")
		} else {
			msg += "，建议和同行的人商量另约时间"
		}
		return msg
	case weather.LevelCaution:
		return fmt.Sprintf("「%s」%s 前后可能有雨（降水概率 %d%%），出门带伞", title, when, a.MaxProb)
	}
	return ""
}

// Run 跑一轮，返回发出的提醒条数。单场活动读预报失败只跳过这一场。
func Run(ctx context.Context, src Source, fc Forecaster, out Notifier, now time.Time) (int, error) {
	meetings, err := src.Upcoming(ctx, now.Add(LeadMin), now.Add(LeadMax))
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, m := range meetings {
		rep, err := fc.Forecast(ctx, m.Lat, m.Lng)
		if err != nil {
			continue
		}
		dur := time.Duration(m.DurationMin) * time.Minute
		if dur <= 0 {
			dur = 2 * time.Hour
		}
		body := Message(m.Title, m.StartsAt, weather.Advise(rep, m.StartsAt, dur, now, loc))
		if body == "" {
			continue
		}
		for _, uid := range m.People {
			if err := out.Notify(ctx, uid, m.ID, "天气提醒", body); err != nil {
				return sent, err
			}
			sent++
		}
	}
	return sent, nil
}
