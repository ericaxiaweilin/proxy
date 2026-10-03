package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// distanceTiers is the port of scripts/dev-distance-tiers.mjs: it gives the dev
// users real city coordinates so every radius tier in the distance filter has
// something to return.
//
// 2026-09-30 ("重启模拟器，真人推荐仍然只有 7 个推荐") had three causes, and this
// tool fixes the third one and makes the second visible:
//  1. SCENE_RECOMMEND was a local fixture, so no number of DB users grew the rail;
//  2. the default radius is 10km while every fixture distance sat inside it;
//  3. a person with no coordinates is excluded at *every* radius
//     (PERSON-DISTANCE-ZERO-001 — unknown distance must not read as "right here").
//
// The coordinates are public city-centre values, not invented ones, and distanceM
// is computed by the read model from lat/lng — nothing here writes a distance.
//
// `out` is where the report goes; feed-pipeline calls this tool with a buffer so it
// can quote the tier verdict inside its own tick output.
func distanceTiers(ctx context.Context, pool *pgxpool.Pool, out io.Writer, args []string) error {
	fmt.Fprintln(out, "=== dev distance tiers · 100 / 200 / 500 / 1000km 分层 ===")
	if !hasFlag(args, "--verify") {
		if err := seedTiers(ctx, pool, out); err != nil {
			return err
		}
	}
	return verifyTiers(ctx, pool, out)
}

type tier struct {
	name  string
	label string
	lat   float64
	lng   float64
	areas []string
}

// Tiers are picked by the *actual* distance from Hà Nội, one city per band. The
// first version used only four cities and left 100-200km and 200-500km empty, so
// switching the radius to 200km returned nothing — the self-check below caught it.
var tiers = []tier{
	{"Hà Nội", "~0", 21.0278, 105.8342, []string{"Ba Đình", "Hoàn Kiếm", "Tây Hồ"}},
	{"Hải Phòng", "~60", 20.8449, 106.6881, []string{"Hồng Bàng", "Lê Chân"}},
	{"Bắc Ninh", "~85", 21.1878, 106.0765, []string{"Bắc Ninh", "Phố Yên"}},
	{"Nam Định", "~110", 20.3528, 106.0741, []string{"Vị Xuyên", "Vị Hoàng"}},
	{"Thanh Hóa", "~190", 19.8067, 105.7781, []string{"Đông Sơn", "Sầm Sơn"}},
	{"Nghệ An", "~280", 19.2342, 104.9200, []string{"Vinh", "Cửa Lò"}},
	{"Huế", "~420", 16.4637, 107.5843, []string{"Phú Hội", "Hương Thủy"}},
	{"Đà Nẵng", "~600", 16.0544, 108.2022, []string{"Hải Châu", "Thanh Khê"}},
	{"Quy Nhơn", "~820", 13.8078, 109.2891, []string{"Hải Châu", "Ngô Mây"}},
	{"TP. Hồ Chí Minh", "~1100", 10.8231, 106.6297, []string{"Quận 1", "Quận 3", "Quận 5"}},
	{"Cần Thơ", "~1380", 10.0452, 105.7469, []string{"Ninh Kiều", "Bình Thủy"}},
	{"Biên Hòa", "~1330", 10.9764, 106.6313, []string{"Biên Hòa", "Thủ Dầu Một"}},
}

var tierLanguages = [][]string{{"vi"}, {"vi", "zh"}, {"vi", "en"}, {"vi", "zh", "en"}}

func seedTiers(ctx context.Context, pool *pgxpool.Pool, out io.Writer) error {
	rows, err := pool.Query(ctx, `
		SELECT user_account_id, name FROM identity.profiles
		 WHERE user_account_id LIKE 'devpipe_%' OR user_account_id LIKE 'user_devseed_%'
		 ORDER BY user_account_id`)
	if err != nil {
		return fmt.Errorf("list dev users: %w", err)
	}
	type devUser struct{ id, name string }
	var users []devUser
	for rows.Next() {
		var u devUser
		if err := rows.Scan(&u.id, &u.name); err != nil {
			rows.Close()
			return fmt.Errorf("scan dev user: %w", err)
		}
		users = append(users, u)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read dev users: %w", err)
	}
	if len(users) == 0 {
		return fmt.Errorf("没有 devpipe_/devseed_ 用户可铺坐标 —— 先跑 devdata feed-pipeline 或 seed_dev_shops_users")
	}

	seeded := 0
	for i, u := range users {
		selected := tiers[i%len(tiers)]
		// agent_id must derive from user_account_id, never from the list index: the
		// first version used `agent_devpipe_<i>`, so several users collapsed onto one
		// agent_id, ON CONFLICT swallowed the rest, and the read-side JOIN fanned one
		// person out to 68 rows paired with someone else's coordinates — which is how
		// 0.0km fake distances appeared.
		agentID := "agent_" + u.id

		// A person with a profile avatar uses that same asset as their first photo:
		// one fact, one source.
		var mediaAssetID *string
		if err := pool.QueryRow(ctx, `
			SELECT NULLIF(split_part(avatar_path, '/', 2), '')
			  FROM identity.profiles WHERE user_account_id = $1`, u.id).Scan(&mediaAssetID); err != nil && err != pgx.ErrNoRows {
			return fmt.Errorf("read avatar for %s: %w", u.id, err)
		}
		photos := "[]"
		if mediaAssetID != nil && *mediaAssetID != "" && *mediaAssetID != "assets" {
			encoded, err := json.Marshal([]map[string]any{{"mediaAssetId": *mediaAssetID, "sortOrder": 0}})
			if err != nil {
				return fmt.Errorf("encode avatar photo: %w", err)
			}
			photos = string(encoded)
		}
		languages, err := json.Marshal(tierLanguages[i%len(tierLanguages)])
		if err != nil {
			return fmt.Errorf("encode languages: %w", err)
		}
		areas, err := json.Marshal(selected.areas)
		if err != nil {
			return fmt.Errorf("encode service areas: %w", err)
		}

		if _, err := pool.Exec(ctx, `
			INSERT INTO supply.agent_profiles
			  (agent_id, name, bio, photos, languages, service_areas, status, created_at, updated_at, lat, lng, user_account_id)
			VALUES ($1, $2, $3, $9::jsonb, $4::jsonb, $5::jsonb, 'ACTIVE', now(), now(), $6, $7, $8)
			ON CONFLICT (agent_id) DO NOTHING`,
			agentID, fallbackName(u.name), "开发用坐标 / dev distance tier",
			string(languages), string(areas), selected.lat, selected.lng, u.id, photos); err != nil {
			return fmt.Errorf("seed coordinates for %s: %w", agentID, err)
		}
		seeded++
	}
	fmt.Fprintf(out, "  已铺 %d 个坐标（ON CONFLICT DO NOTHING，重复执行安全）\n", seeded)
	return nil
}

func fallbackName(name string) string {
	if strings.TrimSpace(name) == "" {
		return "Dev"
	}
	return name
}

// verifyTiers recomputes the bands from stored coordinates with the same haversine
// the read model uses, so the check proves the data shape rather than a written
// number.
func verifyTiers(ctx context.Context, pool *pgxpool.Pool, out io.Writer) error {
	rows, err := pool.Query(ctx, `
		SELECT a.lat, a.lng
		  FROM supply.agent_profiles a
		  JOIN identity.profiles p ON p.user_account_id = a.user_account_id
		 WHERE a.lat IS NOT NULL AND a.agent_id LIKE 'agent_devpipe_%'`)
	if err != nil {
		return fmt.Errorf("read tier rows: %w", err)
	}
	var points []coord
	for rows.Next() {
		var p coord
		if err := rows.Scan(&p.lat, &p.lng); err != nil {
			rows.Close()
			return fmt.Errorf("scan tier row: %w", err)
		}
		points = append(points, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read tier rows: %w", err)
	}

	bands := []struct {
		name    string
		upperKm float64 // < 0 means open-ended
	}{
		{"<100km", 100}, {"100-200km", 200}, {"200-500km", 500},
		{"500-1000km", 1000}, {">1000km", -1},
	}
	hanoi := coord{lat: 21.0278, lng: 105.8342}
	counts := make([]int, len(bands))
	for _, p := range points {
		km := haversineKm(hanoi, p)
		for i, band := range bands {
			if band.upperKm < 0 || km < band.upperKm {
				counts[i]++
				break
			}
		}
	}

	fmt.Fprintf(out, "\n  以河内为原点，共 %d 个有坐标的用户：\n", len(points))
	var empty []string
	for i, band := range bands {
		fmt.Fprintf(out, "    %-11s %d\n", band.name, counts[i])
		if counts[i] == 0 {
			empty = append(empty, band.name)
		}
	}

	// One coordinate per person: a JOIN fan-out (68 rows for one user was measured)
	// pairs a person with somebody else's position and yields 0.0km — the exact fake
	// data PERSON-DISTANCE-ZERO-001 exists to kill.
	var duplicates int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM (
		  SELECT user_account_id FROM supply.agent_profiles
		   WHERE lat IS NOT NULL GROUP BY user_account_id HAVING count(*) > 1) x`).Scan(&duplicates); err != nil {
		return fmt.Errorf("count duplicated coordinate owners: %w", err)
	}

	// A fan-out and an empty band are independent problems, and the Node version
	// reported both rather than stopping at the first — a single combined failure is
	// worse than two lines when the tree needs repairing.
	var failures []string
	if duplicates > 0 {
		failures = append(failures, fmt.Sprintf(
			"有 %d 个 user_account_id 挂多行 agent_profiles —— 读侧 JOIN 会扇出", duplicates))
	} else {
		fmt.Fprintln(out, "  一人一坐标：通过")
	}

	fmt.Fprintln(out, "\n  距离档位（移动端 MORE_DISTANCE_KM）：1 / 3 / 5 / 10 / 20 / 50 / 100 / 200 / 500 / 1000")
	fmt.Fprintln(out, "  切到 200km 能看到 200-500 档，切到 1000km 能看到 500-1000 与 >1000 档。")

	if len(empty) > 0 {
		failures = append(failures, fmt.Sprintf(
			"空档 %s —— 这些半径切过去会一个都筛不到", strings.Join(empty, " / ")))
	} else {
		fmt.Fprintln(out, "\n  分层完整：每一档都有内容")
	}
	if len(failures) > 0 {
		return fmt.Errorf("%s", strings.Join(failures, "; "))
	}
	return nil
}

type coord struct{ lat, lng float64 }

func haversineKm(a, b coord) float64 {
	const earthRadiusKm = 6371.0
	dLat := toRadians(b.lat - a.lat)
	dLng := toRadians(b.lng - a.lng)
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRadians(a.lat))*math.Cos(toRadians(b.lat))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusKm * math.Asin(math.Sqrt(h))
}

func toRadians(degrees float64) float64 { return degrees * math.Pi / 180 }
