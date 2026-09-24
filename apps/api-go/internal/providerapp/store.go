package providerapp

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres 存 supply.provider_applications（migration 125）。
type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

const selectColumns = `application_id, user_account_id, display_name, real_name, photos_attested, city,
	service_areas, languages, capabilities, intro, photo_asset_ids, status, reject_reason, reviewed_by,
	reviewed_at, agent_id, source, created_at, updated_at,
	birth_year, gender, phone, phone_verified, id_type, id_front_asset, id_back_asset, selfie_asset,
	no_crime_declared, data_consent, emergency_contact, terms_version, terms_accepted`

func scanApplication(row pgx.Row) (*Application, error) {
	var a Application
	var areas, langs, caps, photos, accepted []byte
	err := row.Scan(&a.ID, &a.UserAccountID, &a.DisplayName, &a.RealName, &a.PhotosAttested, &a.City,
		&areas, &langs, &caps, &a.Intro, &photos, &a.Status, &a.RejectReason, &a.ReviewedBy,
		&a.ReviewedAt, &a.AgentID, &a.Source, &a.CreatedAt, &a.UpdatedAt,
		&a.BirthYear, &a.Gender, &a.Phone, &a.PhoneVerified, &a.IDType, &a.IDFrontAsset, &a.IDBackAsset, &a.SelfieAsset,
		&a.NoCrime, &a.DataConsent, &a.Emergency, &a.TermsVersion, &accepted)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	for _, pair := range []struct {
		raw []byte
		dst *[]string
	}{{areas, &a.ServiceAreas}, {langs, &a.Languages}, {caps, &a.Capabilities}, {photos, &a.PhotoAssetIDs}, {accepted, &a.TermsAccepted}} {
		*pair.dst = []string{}
		if len(pair.raw) > 0 {
			if err := json.Unmarshal(pair.raw, pair.dst); err != nil {
				return nil, err
			}
		}
	}
	return &a, nil
}

func (p *Postgres) Latest(ctx context.Context, userAccountID string) (*Application, error) {
	return scanApplication(p.pool.QueryRow(ctx, `SELECT `+selectColumns+` FROM supply.provider_applications
		WHERE user_account_id = $1 ORDER BY created_at DESC LIMIT 1`, userAccountID))
}

func (p *Postgres) Get(ctx context.Context, id string) (*Application, error) {
	return scanApplication(p.pool.QueryRow(ctx, `SELECT `+selectColumns+` FROM supply.provider_applications
		WHERE application_id = $1`, id))
}

func jsonList(values []string) []byte {
	if values == nil {
		values = []string{}
	}
	raw, _ := json.Marshal(values)
	return raw
}

func (p *Postgres) Insert(ctx context.Context, a Application) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO supply.provider_applications (`+selectColumns+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
			$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)`,
		a.ID, a.UserAccountID, a.DisplayName, a.RealName, a.PhotosAttested, a.City,
		jsonList(a.ServiceAreas), jsonList(a.Languages), jsonList(a.Capabilities), a.Intro, jsonList(a.PhotoAssetIDs),
		a.Status, a.RejectReason, a.ReviewedBy, a.ReviewedAt, a.AgentID, a.Source, a.CreatedAt, a.UpdatedAt,
		a.BirthYear, a.Gender, a.Phone, a.PhoneVerified, a.IDType, a.IDFrontAsset, a.IDBackAsset, a.SelfieAsset,
		a.NoCrime, a.DataConsent, a.Emergency, a.TermsVersion, jsonList(a.TermsAccepted))
	return err
}

// Update 只改审核 / 撤回会动的字段；表单内容提交后不可改（改了就重新申请）。
func (p *Postgres) Update(ctx context.Context, a Application) error {
	_, err := p.pool.Exec(ctx, `UPDATE supply.provider_applications
		SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = $5, agent_id = $6, updated_at = $7
		WHERE application_id = $1`,
		a.ID, a.Status, a.RejectReason, a.ReviewedBy, a.ReviewedAt, a.AgentID, a.UpdatedAt)
	return err
}

func (p *Postgres) List(ctx context.Context, status string, limit int) ([]Application, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+selectColumns+` FROM supply.provider_applications
		WHERE ($1 = '' OR status = $1) ORDER BY (status = 'SUBMITTED') DESC, created_at DESC LIMIT $2`, status, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Application{}
	for rows.Next() {
		a, err := scanApplication(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// ActivateSupply 是审核通过时开服务者身份的 PG 实现（main.go 接到 Deps.Activate）。
// 这个账号已经绑了 agent_profiles（例如以前的 DRAFT）就复用那一行，否则新建 agent_<账号后缀>。
// 能力只写 declared=true；verified 不动 —— 审核通过不等于能力核验。
func (p *Postgres) ActivateSupply(ctx context.Context, a Application) (string, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var agentID string
	err = tx.QueryRow(ctx, `SELECT agent_id FROM supply.agent_profiles WHERE user_account_id = $1
		ORDER BY (status = 'ACTIVE') DESC, updated_at DESC LIMIT 1`, a.UserAccountID).Scan(&agentID)
	if errors.Is(err, pgx.ErrNoRows) {
		agentID = "agent_" + trimUserPrefix(a.UserAccountID)
	} else if err != nil {
		return "", err
	}
	photos := make([]string, 0, len(a.PhotoAssetIDs))
	for _, id := range a.PhotoAssetIDs {
		photos = append(photos, "/v1/media/thumb/"+id)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO supply.agent_profiles
		(agent_id, name, bio, photos, languages, service_areas, status, user_account_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, now(), now())
		ON CONFLICT (agent_id) DO UPDATE SET name = EXCLUDED.name, bio = EXCLUDED.bio, photos = EXCLUDED.photos,
			languages = EXCLUDED.languages, service_areas = EXCLUDED.service_areas, status = 'ACTIVE',
			user_account_id = EXCLUDED.user_account_id, updated_at = now()`,
		agentID, a.DisplayName, a.Intro, jsonList(photos), jsonList(a.Languages), jsonList(a.ServiceAreas), a.UserAccountID); err != nil {
		return "", err
	}
	for _, capability := range append(append([]string{}, a.Languages...), a.Capabilities...) {
		if _, err := tx.Exec(ctx, `INSERT INTO supply.capabilities (agent_id, capability, declared, verified, updated_at)
			VALUES ($1, $2, true, false, now())
			ON CONFLICT (agent_id, capability) DO UPDATE SET declared = true, updated_at = now()`, agentID, capability); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return agentID, nil
}

// BadPhotos 的 PG 实现：本人上传、IMAGE、非 AI 生成、存在。返回不合格的 id。
func (p *Postgres) BadPhotos(ctx context.Context, userAccountID string, assetIDs []string) ([]string, error) {
	rows, err := p.pool.Query(ctx, `SELECT media_asset_id FROM media.media_assets
		WHERE media_asset_id = ANY($1) AND owner_principal_id = $2 AND media_type = 'IMAGE'
		  AND NOT COALESCE(ai_generated, false)`, assetIDs, userAccountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ok := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ok[id] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	bad := []string{}
	for _, id := range assetIDs {
		if !ok[id] {
			bad = append(bad, id)
		}
	}
	return bad, nil
}

func trimUserPrefix(id string) string {
	if len(id) > 5 && id[:5] == "user_" {
		return id[5:]
	}
	return id
}

// ProviderStats 是「我的订单」顶部接单面板的数（ORDER-CENTER-STATS-001）：全部来自真实订单 / 举报。
// 比率在分母为 0 时是 nil（界面显示 —），不给 0% 也不给 100%。
type ProviderStats struct {
	Completed      int      `json:"completed"`
	CancelledByMe  int      `json:"cancelledByMe"`
	OnTime         int      `json:"onTime"`
	CompletionRate *float64 `json:"completionRate"`
	OnTimeRate     *float64 `json:"onTimeRate"`
	RepeatClients  int      `json:"repeatClients"`
	Complaints     int      `json:"complaints"`
	OpenComplaints int      `json:"openComplaints"`
}

// Stats：这个账号作为服务者（supply.agent_profiles.user_account_id）的履约记录。
//   - 按约完成率 = 完成 /（完成 + 服务者自己取消）—— 需求方取消不算她违约（与 MATCH-RANK-001 同口径）；
//   - 准时率 = 完成且结果里 onTime=true / 完成；
//   - 复邀客户 = 和她完成过 ≥2 单的需求方人数；
//   - 投诉 = 对她的订单的「举报这笔交易」（moderation.reports，TRANSACTION），举报人不是她本人；驳回的不算，
//     处理中 = SUBMITTED / TRIAGED / ESCALATED / REOPENED。
func (p *Postgres) Stats(ctx context.Context, userAccountID string) (ProviderStats, error) {
	var s ProviderStats
	err := p.pool.QueryRow(ctx, `
		WITH mine AS (SELECT agent_id FROM supply.agent_profiles WHERE user_account_id = $1),
		orders AS (SELECT o.* FROM fulfillment.orders o WHERE o.agent_id IN (SELECT agent_id FROM mine))
		SELECT
			(SELECT COUNT(*) FROM orders WHERE lifecycle = 'COMPLETED'),
			(SELECT COUNT(*) FROM orders o WHERE o.lifecycle = 'CANCELLED' AND EXISTS (
				SELECT 1 FROM integration.outbox_messages m
				WHERE m.aggregate_id = o.id AND m.event_type = 'OrderCancelled' AND m.payload->>'role' = 'AGENT')),
			(SELECT COUNT(*) FROM orders WHERE lifecycle = 'COMPLETED' AND COALESCE((outcome->>'onTime')::boolean, false)),
			(SELECT COUNT(*) FROM (SELECT requester_id FROM orders WHERE lifecycle = 'COMPLETED'
				GROUP BY requester_id HAVING COUNT(*) >= 2) repeaters),
			(SELECT COUNT(*) FROM moderation.reports r JOIN orders o ON o.id = r.target_id
				WHERE r.target_type = 'TRANSACTION' AND r.reporter_id <> $1 AND r.state <> 'DISMISSED'),
			(SELECT COUNT(*) FROM moderation.reports r JOIN orders o ON o.id = r.target_id
				WHERE r.target_type = 'TRANSACTION' AND r.reporter_id <> $1
				  AND r.state IN ('SUBMITTED', 'TRIAGED', 'ESCALATED', 'REOPENED'))`,
		userAccountID).Scan(&s.Completed, &s.CancelledByMe, &s.OnTime, &s.RepeatClients, &s.Complaints, &s.OpenComplaints)
	if err != nil {
		return ProviderStats{}, err
	}
	FillRates(&s)
	return s, nil
}

// FillRates 算两个比率；分母为 0 时保持 nil。
func FillRates(s *ProviderStats) {
	if ended := s.Completed + s.CancelledByMe; ended > 0 {
		v := float64(s.Completed) / float64(ended)
		s.CompletionRate = &v
	}
	if s.Completed > 0 {
		v := float64(s.OnTime) / float64(s.Completed)
		s.OnTimeRate = &v
	}
}
