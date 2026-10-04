package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// MERCHANT-CREATOR-PROMO-002：商家 × creator 专属码 / 调整留痕 / 发券的 Postgres 存取。

// uniqueViolationOn：撞的是不是这条唯一约束（不是随便哪条都当成同一种业务错误）。
func uniqueViolationOn(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}

const pairPromoColumns = `code, merchant_id, merchant_name, agent_id, creator_name, terms, status, mode, suggestion, note, created_at, updated_at`

func scanPairPromo(row pgx.Row) (supply.MerchantCreatorPromo, error) {
	var p supply.MerchantCreatorPromo
	var terms, suggestion []byte
	if err := row.Scan(&p.Code, &p.MerchantID, &p.MerchantName, &p.AgentID, &p.CreatorName, &terms, &p.Status, &p.Mode, &suggestion, &p.Note, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return p, err
	}
	if err := json.Unmarshal(terms, &p.Terms); err != nil {
		return p, err
	}
	if len(suggestion) > 0 {
		_ = json.Unmarshal(suggestion, &p.Suggestion) // 依据坏了不挡条款本身
	}
	return p, nil
}

func (r *SupplyRepository) SaveMerchantCreatorPromo(ctx context.Context, p supply.MerchantCreatorPromo) error {
	terms, err := json.Marshal(p.Terms)
	if err != nil {
		return err
	}
	suggestion, err := json.Marshal(p.Suggestion)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.merchant_creator_promos (`+pairPromoColumns+`, category)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		p.Code, p.MerchantID, p.MerchantName, p.AgentID, p.CreatorName, terms, p.Status, p.Mode, suggestion, p.Note, p.CreatedAt, p.UpdatedAt, p.Terms.Category,
	)
	return err
}

func (r *SupplyRepository) UpdateMerchantCreatorPromo(ctx context.Context, p supply.MerchantCreatorPromo) error {
	terms, err := json.Marshal(p.Terms)
	if err != nil {
		return err
	}
	suggestion, err := json.Marshal(p.Suggestion)
	if err != nil {
		return err
	}
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE supply.merchant_creator_promos
		SET terms=$2, status=$3, mode=$4, suggestion=$5, note=$6, updated_at=$7, category=$8
		WHERE code=$1`,
		p.Code, terms, p.Status, p.Mode, suggestion, p.Note, p.UpdatedAt, p.Terms.Category,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return supply.ErrPairPromoNotFound
	}
	return nil
}

func (r *SupplyRepository) getPairPromo(ctx context.Context, where string, args ...any) (supply.MerchantCreatorPromo, error) {
	p, err := scanPairPromo(queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+pairPromoColumns+` FROM supply.merchant_creator_promos WHERE `+where, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return supply.MerchantCreatorPromo{}, supply.ErrPairPromoNotFound
	}
	return p, err
}

func (r *SupplyRepository) GetMerchantCreatorPromo(ctx context.Context, code string) (supply.MerchantCreatorPromo, error) {
	return r.getPairPromo(ctx, `code=$1`, code)
}

func (r *SupplyRepository) GetMerchantCreatorPromoByPair(ctx context.Context, merchantID, agentID string) (supply.MerchantCreatorPromo, error) {
	return r.getPairPromo(ctx, `merchant_id=$1 AND agent_id=$2`, merchantID, agentID)
}

func (r *SupplyRepository) listPairPromos(ctx context.Context, where string, arg string) ([]supply.MerchantCreatorPromo, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT `+pairPromoColumns+` FROM supply.merchant_creator_promos WHERE `+where+` ORDER BY created_at`, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []supply.MerchantCreatorPromo{}
	for rows.Next() {
		p, err := scanPairPromo(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *SupplyRepository) ListMerchantCreatorPromosByMerchant(ctx context.Context, merchantID string) ([]supply.MerchantCreatorPromo, error) {
	return r.listPairPromos(ctx, `merchant_id=$1`, merchantID)
}

func (r *SupplyRepository) ListMerchantCreatorPromosByAgent(ctx context.Context, agentID string) ([]supply.MerchantCreatorPromo, error) {
	return r.listPairPromos(ctx, `agent_id=$1`, agentID)
}

func (r *SupplyRepository) ListMerchantCreatorPromosByCategory(ctx context.Context, category string) ([]supply.MerchantCreatorPromo, error) {
	return r.listPairPromos(ctx, `category=$1`, category)
}

func (r *SupplyRepository) SavePromoChange(ctx context.Context, c supply.PromoChange) error {
	before, err := json.Marshal(c.Before)
	if err != nil {
		return err
	}
	after, err := json.Marshal(c.After)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.promo_changes (id, code, actor_id, before, after, mode, note, changed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		c.ID, c.Code, c.ActorID, before, after, c.Mode, c.Note, c.ChangedAt,
	)
	return err
}

func (r *SupplyRepository) ListPromoChanges(ctx context.Context, code string) ([]supply.PromoChange, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, code, actor_id, before, after, mode, note, changed_at
		FROM supply.promo_changes WHERE code=$1 ORDER BY changed_at`, code)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []supply.PromoChange{}
	for rows.Next() {
		var c supply.PromoChange
		var before, after []byte
		if err := rows.Scan(&c.ID, &c.Code, &c.ActorID, &before, &after, &c.Mode, &c.Note, &c.ChangedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(before, &c.Before)
		_ = json.Unmarshal(after, &c.After)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *SupplyRepository) SavePromoIssue(ctx context.Context, i supply.PromoIssue) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.promo_issues (id, code, merchant_id, agent_id, customer_id, issued_at)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		i.ID, i.Code, i.MerchantID, i.AgentID, i.CustomerID, i.IssuedAt,
	)
	if uniqueViolationOn(err, "promo_issues_code_customer_id_key") {
		return supply.ErrPromoAlreadyIssued
	}
	return err
}

const promoIssueColumns = `id, code, merchant_id, agent_id, customer_id, issued_at`

func scanPromoIssue(row pgx.Row) (supply.PromoIssue, error) {
	var i supply.PromoIssue
	err := row.Scan(&i.ID, &i.Code, &i.MerchantID, &i.AgentID, &i.CustomerID, &i.IssuedAt)
	return i, err
}

func (r *SupplyRepository) GetPromoIssue(ctx context.Context, id string) (supply.PromoIssue, error) {
	i, err := scanPromoIssue(queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+promoIssueColumns+` FROM supply.promo_issues WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return supply.PromoIssue{}, supply.ErrPromoIssueNotFound
	}
	return i, err
}

func (r *SupplyRepository) GetPromoIssueByCustomer(ctx context.Context, code, customerID string) (supply.PromoIssue, error) {
	i, err := scanPromoIssue(queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+promoIssueColumns+` FROM supply.promo_issues WHERE code=$1 AND customer_id=$2`, code, customerID))
	if errors.Is(err, pgx.ErrNoRows) {
		return supply.PromoIssue{}, supply.ErrPromoIssueNotFound
	}
	return i, err
}

func (r *SupplyRepository) listPromoIssues(ctx context.Context, column, value string) ([]supply.PromoIssue, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT `+promoIssueColumns+` FROM supply.promo_issues WHERE `+column+`=$1 ORDER BY issued_at DESC`, value)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []supply.PromoIssue{}
	for rows.Next() {
		i, err := scanPromoIssue(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (r *SupplyRepository) ListPromoIssuesByMerchant(ctx context.Context, merchantID string) ([]supply.PromoIssue, error) {
	return r.listPromoIssues(ctx, "merchant_id", merchantID)
}

func (r *SupplyRepository) ListPromoIssuesByAgent(ctx context.Context, agentID string) ([]supply.PromoIssue, error) {
	return r.listPromoIssues(ctx, "agent_id", agentID)
}

func (r *SupplyRepository) ListPromoIssuesByCustomer(ctx context.Context, customerID string) ([]supply.PromoIssue, error) {
	return r.listPromoIssues(ctx, "customer_id", customerID)
}

// MerchantStoreRepository 实现 supply.MerchantStoreLookup：商家账号名 + 本店品类。
// 品类取第一家营业中、填了品类的门店；门店没填品类但认领了现实场景的，用场景的类型
// （如「咖啡 · 动态场景」）—— 商家登录就知道自己开的什么店，不让他在专属码页面再选一遍。
type MerchantStoreRepository struct {
	pool *pgxpool.Pool
}

func NewMerchantStoreRepository(pool *pgxpool.Pool) *MerchantStoreRepository {
	return &MerchantStoreRepository{pool: pool}
}

func (r *MerchantStoreRepository) MerchantStore(ctx context.Context, merchantID string) (supply.MerchantStoreProfile, error) {
	var profile supply.MerchantStoreProfile
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT a.name,
		       COALESCE((
		         SELECT COALESCE(NULLIF(btrim(s.category), ''), sc.type, '')
		           FROM business.stores s
		           LEFT JOIN reality.scenes sc ON sc.id = s.reality_scene_id
		          WHERE s.business_id = a.id AND s.status = 'ACTIVE'
		          ORDER BY (btrim(s.category) = ''), s.created_at
		          LIMIT 1), '')
		  FROM business.accounts a
		 WHERE a.id = $1`, merchantID).Scan(&profile.Name, &profile.Category)
	if errors.Is(err, pgx.ErrNoRows) {
		return supply.MerchantStoreProfile{}, nil
	}
	return profile, err
}
