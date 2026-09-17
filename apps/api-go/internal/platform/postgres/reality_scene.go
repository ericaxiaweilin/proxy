package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/realityscene"
)

type RealitySceneRepository struct{ pool *pgxpool.Pool }

func NewRealitySceneRepository(pool *pgxpool.Pool) *RealitySceneRepository {
	return &RealitySceneRepository{pool: pool}
}
func (r *RealitySceneRepository) ListUserStates(ctx context.Context, actorID string) ([]realityscene.UserState, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT scene_id,saved,planned,private_visited,visited_at FROM reality.user_scene_states WHERE actor_id=$1 ORDER BY COALESCE(visited_at,updated_at) DESC`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []realityscene.UserState{}
	for rows.Next() {
		var s realityscene.UserState
		if err := rows.Scan(&s.SceneID, &s.Saved, &s.Planned, &s.PrivateVisited, &s.VisitedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
func (r *RealitySceneRepository) SetUserState(ctx context.Context, actorID, sceneID, field string, enabled bool, now time.Time) error {
	column := map[string]string{"saved": "saved", "planned": "planned", "private_visited": "private_visited"}[field]
	if column == "" {
		return &invalidRealitySceneField{field: field}
	}
	if column == "private_visited" {
		_, err := queryerForContext(ctx, r.pool).Exec(ctx, `INSERT INTO reality.user_scene_states(actor_id,scene_id,private_visited,visited_at) VALUES($1,$2,$3,CASE WHEN $3 THEN $4::timestamptz ELSE NULL END) ON CONFLICT(actor_id,scene_id) DO UPDATE SET private_visited=EXCLUDED.private_visited,visited_at=EXCLUDED.visited_at,updated_at=$4::timestamptz`, actorID, sceneID, enabled, now.UTC())
		return err
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `INSERT INTO reality.user_scene_states(actor_id,scene_id,`+column+`) VALUES($1,$2,$3) ON CONFLICT(actor_id,scene_id) DO UPDATE SET `+column+`=EXCLUDED.`+column+`,updated_at=$4`, actorID, sceneID, enabled, now.UTC())
	return err
}

// SCENE-CHECKIN-001: 「我在这里」的三条 SQL。
//
// distanceM 为 nil 表示声明时没有位置 —— 声明照样写入，只是 distance_m 为 NULL，
// 我们不替用户断言"本人在场"。
func (r *RealitySceneRepository) CheckInScene(ctx context.Context, actorID, sceneID string, distanceM *int, now time.Time) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `INSERT INTO reality.scene_checkins(scene_id,actor_id,declared_at,expires_at,distance_m) VALUES($1,$2,$3,$4,$5) ON CONFLICT(scene_id,actor_id) DO UPDATE SET declared_at=EXCLUDED.declared_at,expires_at=EXCLUDED.expires_at,distance_m=EXCLUDED.distance_m`, sceneID, actorID, now.UTC(), now.UTC().Add(realityscene.CheckinTTL), distanceM)
	return err
}
func (r *RealitySceneRepository) CancelCheckIn(ctx context.Context, actorID, sceneID string) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `DELETE FROM reality.scene_checkins WHERE scene_id=$1 AND actor_id=$2`, sceneID, actorID)
	return err
}

// ListScenePresence 只返回**聚合数**，不返回"谁"在现场 —— 名单要等邀请/报名
// 真的存在再说。只数未过期的：过期 = 人已经走了，不算。
func (r *RealitySceneRepository) ListScenePresence(ctx context.Context, now time.Time) (map[string]int, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT scene_id, COUNT(*) FROM reality.scene_checkins WHERE expires_at > $1 GROUP BY scene_id`, now.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var sceneID string
		var n int
		if err := rows.Scan(&sceneID, &n); err != nil {
			return nil, err
		}
		out[sceneID] = n
	}
	return out, rows.Err()
}
func (r *RealitySceneRepository) ListMyCheckIns(ctx context.Context, actorID string, now time.Time) ([]string, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT scene_id FROM reality.scene_checkins WHERE actor_id=$1 AND expires_at > $2 ORDER BY declared_at DESC`, actorID, now.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var sceneID string
		if err := rows.Scan(&sceneID); err != nil {
			return nil, err
		}
		out = append(out, sceneID)
	}
	return out, rows.Err()
}

// BADGE-WALL-001: 去过的 scene id（去重，不过期过滤 —— 取消即删行）。
// 空返回 [] 不是 null。
func (r *RealitySceneRepository) ListMyCheckinHistory(ctx context.Context, actorID string) ([]string, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT DISTINCT scene_id FROM reality.scene_checkins WHERE actor_id=$1 ORDER BY scene_id`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var sceneID string
		if err := rows.Scan(&sceneID); err != nil {
			return nil, err
		}
		out = append(out, sceneID)
	}
	return out, rows.Err()
}

// SCENE-CONTRIB-001: 社区提交。
//
// 坐标是**用户填的**，这里不做任何反查也不做核实 —— 存进去就是 PENDING +
// Source=COMMUNITY，等别人确认。反查了再存反而更危险：反查得到的地址会被当成
// "我们核实过"，而坐标本身还是用户随手点的。
// SCENE-BADGE-001: 徽章获得记录（append-only）。
func (r *RealitySceneRepository) EarnBadge(ctx context.Context, actorID string, badge realityscene.EarnedBadge) error {
	if r == nil || r.pool == nil {
		return fmt.Errorf("reality scene repository unavailable")
	}
	// 主键用「场景|徽章|时间」组合生成：同一人同一场景同秒重复打卡不产生
	// 重复行，但不同时刻的再获得仍是新证据（append-only 口径）。
	id := fmt.Sprintf("%s|%s|%s", badge.SceneID, badge.BadgeID, badge.EarnedAt)
	_, err := queryerForContext(ctx, r.pool).Exec(ctx,
		`INSERT INTO reality.scene_badges(id, badge_id, actor_id, scene_id, earned_at)
		 VALUES($1,$2,$3,$4,$5)
		 ON CONFLICT (id) DO NOTHING`,
		id, badge.BadgeID, actorID, badge.SceneID, badge.EarnedAt)
	return err
}

func (r *RealitySceneRepository) ListMyEarnedBadges(ctx context.Context, actorID string) ([]realityscene.EarnedBadge, error) {
	if r == nil || r.pool == nil {
		return []realityscene.EarnedBadge{}, fmt.Errorf("reality scene repository unavailable")
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx,
		`SELECT badge_id, scene_id, earned_at FROM reality.scene_badges
		  WHERE actor_id=$1 ORDER BY earned_at ASC`, actorID)
	if err != nil {
		return []realityscene.EarnedBadge{}, err
	}
	defer rows.Close()
	out := make([]realityscene.EarnedBadge, 0)
	for rows.Next() {
		var b realityscene.EarnedBadge
		var earned time.Time
		if err := rows.Scan(&b.BadgeID, &b.SceneID, &earned); err != nil {
			return []realityscene.EarnedBadge{}, err
		}
		b.EarnedAt = earned.Format(time.RFC3339)
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return []realityscene.EarnedBadge{}, err
	}
	return out, nil
}


func (r *RealitySceneRepository) ProposeScene(ctx context.Context, p realityscene.Proposal, now time.Time) error {
	if p.Best == "" {
		p.Best = "以现场公告为准"
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `INSERT INTO reality.scene_proposals(id,proposed_by,name,area,type,category,address,latitude,longitude,description,best,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING',$12) ON CONFLICT(id) DO NOTHING`, p.ID, p.ProposedBy, p.Name, p.Area, p.Type, p.Category, p.Address, p.Latitude, p.Longitude, p.Description, p.Best, now.UTC())
	return err
}
func (r *RealitySceneRepository) ConfirmSceneProposal(ctx context.Context, proposalID, actorID string, now time.Time) (int, error) {
	q := queryerForContext(ctx, r.pool)
	var proposedBy string
	var status string
	if err := q.QueryRow(ctx, `SELECT proposed_by, status FROM reality.scene_proposals WHERE id=$1`, proposalID).Scan(&proposedBy, &status); err != nil {
		return 0, err
	}
	// 提交者不能给自己背书 —— 在这里挡住，不是写进去再靠查询过滤。
	if proposedBy == actorID {
		return 0, fmt.Errorf("cannot confirm own proposal %s", proposalID)
	}
	if _, err := q.Exec(ctx, `INSERT INTO reality.scene_proposal_confirmations(proposal_id,actor_id,created_at) VALUES($1,$2,$3) ON CONFLICT(proposal_id,actor_id) DO NOTHING`, proposalID, actorID, now.UTC()); err != nil {
		return 0, err
	}
	var count int
	if err := q.QueryRow(ctx, `SELECT COUNT(*) FROM reality.scene_proposal_confirmations WHERE proposal_id=$1`, proposalID).Scan(&count); err != nil {
		return 0, err
	}
	if count >= realityscene.ProposalConfirmationsNeeded && status != "APPROVED" {
		if _, err := q.Exec(ctx, `UPDATE reality.scene_proposals SET status='APPROVED', decided_at=$2 WHERE id=$1`, proposalID, now.UTC()); err != nil {
			return 0, err
		}
	}
	return count, nil
}
func (r *RealitySceneRepository) ListProposals(ctx context.Context, actorID string) ([]realityscene.Proposal, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT p.id,p.proposed_by,p.name,p.area,p.type,p.category,p.address,p.latitude,p.longitude,p.description,p.best,p.status, COUNT(c.actor_id) AS confirmations, EXISTS(SELECT 1 FROM reality.scene_proposal_confirmations x WHERE x.proposal_id=p.id AND x.actor_id=$1) AS confirmed FROM reality.scene_proposals p LEFT JOIN reality.scene_proposal_confirmations c ON c.proposal_id=p.id GROUP BY p.id ORDER BY p.created_at DESC`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []realityscene.Proposal{}
	for rows.Next() {
		var p realityscene.Proposal
		var proposedBy string
		if err := rows.Scan(&p.ID, &proposedBy, &p.Name, &p.Area, &p.Type, &p.Category, &p.Address, &p.Latitude, &p.Longitude, &p.Description, &p.Best, &p.Status, &p.Confirmations, &p.Confirmed); err != nil {
			return nil, err
		}
		p.Own = proposedBy == actorID
		p.Source = realityscene.SourceCommunity
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListApprovedCommunityScenes 只返回确认数够了的提案。它们以 Source=COMMUNITY
// 进目录 —— 少了这个标记，用户就分不清哪些坐标是查过的、哪些是别人随手点的。
func (r *RealitySceneRepository) ListApprovedCommunityScenes(ctx context.Context) ([]realityscene.Scene, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT id,name,area,type,category,address,latitude,longitude,description,best FROM reality.scene_proposals WHERE status='APPROVED' ORDER BY decided_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []realityscene.Scene{}
	for rows.Next() {
		var s realityscene.Scene
		if err := rows.Scan(&s.ID, &s.Name, &s.Area, &s.Type, &s.Category, &s.Address, &s.Latitude, &s.Longitude, &s.Description, &s.Best); err != nil {
			return nil, err
		}
		s.Source = realityscene.SourceCommunity
		// 社区场景不参与"正在开放"的判断：我们不知道它的开放时间。
		s.Active = false
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *RealitySceneRepository) ListScenes(ctx context.Context) ([]realityscene.Scene, error) {
	return r.listScenes(ctx, "", nil)
}

func (r *RealitySceneRepository) ListNearbyScenes(ctx context.Context, lat, lng, radiusKM float64, limit int) ([]realityscene.Scene, error) {
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 || radiusKM <= 0 || radiusKM > 100 || limit < 1 || limit > 100 {
		return nil, fmt.Errorf("invalid nearby scene query")
	}
	return r.listScenes(ctx, `WHERE distance_m <= $3 ORDER BY recommendation_score DESC, distance_m ASC LIMIT $4`, []any{lat, lng, radiusKM * 1000, limit})
}

func (r *RealitySceneRepository) listScenes(ctx context.Context, suffix string, args []any) ([]realityscene.Scene, error) {
	// SCENE-ADDRESS-001: address 与 area 是两个字段，都要选出来 —— 少了
	// address，接口就退回"只有区名"，地图 marker 上的街道信息会整个消失。
	//
	// SCENE-REAL-COUNTS-001: saved/visited/planned 三个计数从
	// reality.user_scene_states **真聚合**出来。
	//
	// SCENE-NO-FABRICATED-001: quality / posts / creators / activities /
	// invites 五列已由 095 迁移 DROP 掉。posts/creators/activities/invites
	// 是写死的常数（没有任何真实来源 —— 全仓没有 post↔scene 的关联），
	// quality 是手写的质量分。它们拿去算"推荐度"等于用编的数字排序。
	// 现在 ranking 只剩真实信号：用户行为计数 + 距离，与内存版
	// recommendationScore() 完全一致。
	query := `WITH ranked AS (SELECT id,name,area,type,category,address,latitude,longitude,best,active,description, CASE WHEN $1::double precision IS NULL THEN 0 ELSE 6371000*2*asin(sqrt(power(sin(radians(latitude-$1)/2),2)+cos(radians($1))*cos(radians(latitude))*power(sin(radians(longitude-$2)/2),2))) END AS distance_m FROM reality.scenes WHERE status='ACTIVE'), tally AS (SELECT scene_id, COUNT(*) FILTER (WHERE saved) AS saved_count, COUNT(*) FILTER (WHERE private_visited) AS visited_count, COUNT(*) FILTER (WHERE planned) AS planned_count FROM reality.user_scene_states GROUP BY scene_id) SELECT id,name,area,type,category,address,latitude,longitude,best,active,description,distance_m,COALESCE(tally.saved_count,0),COALESCE(tally.visited_count,0),COALESCE(tally.planned_count,0),(ln(1+COALESCE(tally.saved_count,0)+2*COALESCE(tally.visited_count,0)+2*COALESCE(tally.planned_count,0))*8 - distance_m/1000*2.5) AS recommendation_score FROM ranked LEFT JOIN tally ON tally.scene_id = ranked.id ` + suffix
	if args == nil {
		args = []any{nil, nil}
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []realityscene.Scene{}
	for rows.Next() {
		var s realityscene.Scene
		if err := rows.Scan(&s.ID, &s.Name, &s.Area, &s.Type, &s.Category, &s.Address, &s.Latitude, &s.Longitude, &s.Best, &s.Active, &s.Description, &s.DistanceMeters, &s.SavedCount, &s.VisitedCount, &s.PlannedCount, &s.RecommendationScore); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

type invalidRealitySceneField struct{ field string }

func (e *invalidRealitySceneField) Error() string { return "invalid reality scene field: " + e.field }
