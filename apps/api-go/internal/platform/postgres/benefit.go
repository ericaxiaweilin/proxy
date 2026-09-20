package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/benefit"
)

// BenefitRepository persists the Benefit Routing Network aggregates
// (Campaign, BenefitDefinition, CapacityPool, Allocation, Offer, Claim,
// Redemption, Settlement, Reward, AttributionEdge, CampaignAudience,
// CampaignEvent) in PostgreSQL.
//
// Schema source of truth: apps/api-go/migrations/063_benefit_routing_network.sql.
// benefit.MemoryRepository remains the test fixture; this adapter is the
// production binding wired in cmd/api/main.go when DATABASE_URL is set.
//
// Conventions (matching scene.go / business.go):
//   - queryerForContext(ctx, r.pool) automatically joins an in-flight
//     transaction when one is attached to the context.
//   - JSONB columns are marshalled to []byte; the pgx driver stores them
//     as JSONB with no extra conversion.
//   - Native Postgres enum columns (campaign_type, campaign_status, ...)
//     need an explicit "$N::schema.type" cast on bind parameters — unlike
//     JSONB/text, Postgres has no implicit assignment cast from an
//     extended-protocol text parameter to a user-defined enum.
//   - Not-found reads return the same sentinel errors as MemoryRepository
//     so the service layer's behavior does not depend on which Repository
//     implementation is wired in.
type BenefitRepository struct {
	pool *pgxpool.Pool
}

func NewBenefitRepository(pool *pgxpool.Pool) *BenefitRepository {
	return &BenefitRepository{pool: pool}
}

// ── Campaign ─────────────────────────────────────────────────────

func (r *BenefitRepository) CreateCampaign(ctx context.Context, c *benefit.Campaign) error {
	sceneIDs := c.SceneIDs
	if sceneIDs == nil {
		sceneIDs = []string{}
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO benefit.campaigns (
			campaign_id, campaign_type, status, owner_type, owner_id, scene_ids, goal,
			budget_minor, spent_minor, currency, start_at, end_at, created_at, updated_at, version
		) VALUES ($1,$2::benefit.campaign_type,$3::benefit.campaign_status,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		c.ID, string(c.Type), string(c.Status), c.OwnerType, c.OwnerID, sceneIDs, c.Goal,
		c.BudgetMinor, c.SpentMinor, c.Currency, c.StartAt, c.EndAt, c.CreatedAt, c.UpdatedAt, c.Version)
	return err
}

const campaignColumns = `campaign_id, campaign_type, status, owner_type, owner_id, scene_ids, goal,
	budget_minor, spent_minor, currency, start_at, end_at, created_at, updated_at, version`

func scanCampaign(row pgx.Row) (*benefit.Campaign, error) {
	var c benefit.Campaign
	var typ, status string
	err := row.Scan(&c.ID, &typ, &status, &c.OwnerType, &c.OwnerID, &c.SceneIDs, &c.Goal,
		&c.BudgetMinor, &c.SpentMinor, &c.Currency, &c.StartAt, &c.EndAt, &c.CreatedAt, &c.UpdatedAt, &c.Version)
	if err != nil {
		return nil, err
	}
	c.Type, c.Status = benefit.CampaignType(typ), benefit.CampaignStatus(status)
	return &c, nil
}

func (r *BenefitRepository) GetCampaign(ctx context.Context, id string) (*benefit.Campaign, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+campaignColumns+` FROM benefit.campaigns WHERE campaign_id=$1`, id)
	c, err := scanCampaign(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, benefit.ErrCampaignNotFound
	}
	return c, err
}

func (r *BenefitRepository) ListCampaigns(ctx context.Context, opts benefit.ListCampaignOpts) ([]benefit.Campaign, error) {
	query := `SELECT ` + campaignColumns + ` FROM benefit.campaigns WHERE 1=1`
	args := []any{}
	if opts.Status != nil {
		args = append(args, string(*opts.Status))
		query += fmt.Sprintf(" AND status=$%d::benefit.campaign_status", len(args))
	}
	if opts.OwnerType != nil {
		args = append(args, *opts.OwnerType)
		query += fmt.Sprintf(" AND owner_type=$%d", len(args))
	}
	if opts.OwnerID != nil {
		args = append(args, *opts.OwnerID)
		query += fmt.Sprintf(" AND owner_id=$%d", len(args))
	}
	query += " ORDER BY created_at DESC"
	if opts.Limit > 0 {
		args = append(args, opts.Limit)
		query += fmt.Sprintf(" LIMIT $%d", len(args))
	}
	if opts.Offset > 0 {
		args = append(args, opts.Offset)
		query += fmt.Sprintf(" OFFSET $%d", len(args))
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []benefit.Campaign{}
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *c)
	}
	return result, rows.Err()
}

func (r *BenefitRepository) UpdateCampaign(ctx context.Context, c *benefit.Campaign) error {
	sceneIDs := c.SceneIDs
	if sceneIDs == nil {
		sceneIDs = []string{}
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE benefit.campaigns SET
			campaign_type=$2::benefit.campaign_type, status=$3::benefit.campaign_status, owner_type=$4, owner_id=$5,
			scene_ids=$6, goal=$7, budget_minor=$8, spent_minor=$9, currency=$10,
			start_at=$11, end_at=$12, updated_at=$13, version=$14
		WHERE campaign_id=$1`,
		c.ID, string(c.Type), string(c.Status), c.OwnerType, c.OwnerID, sceneIDs, c.Goal,
		c.BudgetMinor, c.SpentMinor, c.Currency, c.StartAt, c.EndAt, c.UpdatedAt, c.Version)
	return err
}

func (r *BenefitRepository) UpdateCampaignStatus(ctx context.Context, id string, status benefit.CampaignStatus, version int) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE benefit.campaigns SET status=$1::benefit.campaign_status, version=version+1, updated_at=now()
		WHERE campaign_id=$2 AND version=$3`, string(status), id, version)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		if _, getErr := r.GetCampaign(ctx, id); errors.Is(getErr, benefit.ErrCampaignNotFound) {
			return benefit.ErrCampaignNotFound
		}
		return benefit.ErrVersionConflict
	}
	return nil
}

// ── BenefitDefinition ────────────────────────────────────────────

func (r *BenefitRepository) CreateBenefitDefinition(ctx context.Context, b *benefit.BenefitDefinition) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO benefit.definitions (
			benefit_id, campaign_id, benefit_kind, label, description,
			retail_value_minor, user_pay_minor, currency, terms_version, created_at
		) VALUES ($1,$2,$3::benefit.benefit_kind,$4,$5,$6,$7,$8,$9,$10)`,
		b.ID, b.CampaignID, string(b.Kind), b.Label, b.Description,
		b.RetailValueMinor, b.UserPayMinor, b.Currency, b.TermsVersion, b.CreatedAt)
	return err
}

const definitionColumns = `benefit_id, campaign_id, benefit_kind, label, COALESCE(description,''),
	retail_value_minor, user_pay_minor, currency, COALESCE(terms_version,''), created_at`

func scanDefinition(row pgx.Row) (*benefit.BenefitDefinition, error) {
	var b benefit.BenefitDefinition
	var kind string
	err := row.Scan(&b.ID, &b.CampaignID, &kind, &b.Label, &b.Description,
		&b.RetailValueMinor, &b.UserPayMinor, &b.Currency, &b.TermsVersion, &b.CreatedAt)
	if err != nil {
		return nil, err
	}
	b.Kind = benefit.BenefitKind(kind)
	return &b, nil
}

func (r *BenefitRepository) GetBenefitDefinition(ctx context.Context, id string) (*benefit.BenefitDefinition, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+definitionColumns+` FROM benefit.definitions WHERE benefit_id=$1`, id)
	b, err := scanDefinition(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, benefit.ErrCampaignNotFound
	}
	return b, err
}

func (r *BenefitRepository) ListBenefitDefinitionsByCampaign(ctx context.Context, campaignID string) ([]benefit.BenefitDefinition, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT `+definitionColumns+` FROM benefit.definitions WHERE campaign_id=$1 ORDER BY created_at`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []benefit.BenefitDefinition{}
	for rows.Next() {
		b, err := scanDefinition(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *b)
	}
	return result, rows.Err()
}

// ── CapacityPool ──────────────────────────────────────────────────

func (r *BenefitRepository) UpsertCapacityPool(ctx context.Context, p *benefit.CapacityPool) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO benefit.capacity_pools (
			pool_id, campaign_id, total_capacity, daily_capacity, timeslot_capacity,
			claimed, reserved, redeemed, date, created_at, updated_at, version
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12)
		ON CONFLICT (campaign_id, date) DO UPDATE SET
			pool_id=EXCLUDED.pool_id, total_capacity=EXCLUDED.total_capacity,
			daily_capacity=EXCLUDED.daily_capacity, timeslot_capacity=EXCLUDED.timeslot_capacity,
			claimed=EXCLUDED.claimed, reserved=EXCLUDED.reserved, redeemed=EXCLUDED.redeemed,
			updated_at=EXCLUDED.updated_at, version=EXCLUDED.version`,
		p.ID, p.CampaignID, p.TotalCapacity, p.DailyCapacity, p.TimeslotCapacity,
		p.Claimed, p.Reserved, p.Redeemed, p.Date, p.CreatedAt, p.UpdatedAt, p.Version)
	return err
}

const capacityPoolColumns = `pool_id, campaign_id, total_capacity, daily_capacity, timeslot_capacity,
	claimed, reserved, redeemed, to_char(date, 'YYYY-MM-DD'), created_at, updated_at, version`

func scanCapacityPool(row pgx.Row) (*benefit.CapacityPool, error) {
	var p benefit.CapacityPool
	var date *string
	err := row.Scan(&p.ID, &p.CampaignID, &p.TotalCapacity, &p.DailyCapacity, &p.TimeslotCapacity,
		&p.Claimed, &p.Reserved, &p.Redeemed, &date, &p.CreatedAt, &p.UpdatedAt, &p.Version)
	if err != nil {
		return nil, err
	}
	p.Date = date
	return &p, nil
}

func (r *BenefitRepository) GetCapacityPool(ctx context.Context, campaignID string, date *string) (*benefit.CapacityPool, error) {
	var row pgx.Row
	if date != nil {
		row = queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+capacityPoolColumns+` FROM benefit.capacity_pools WHERE campaign_id=$1 AND date=$2::date`, campaignID, *date)
	} else {
		row = queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+capacityPoolColumns+` FROM benefit.capacity_pools WHERE campaign_id=$1 AND date IS NULL`, campaignID)
	}
	p, err := scanCapacityPool(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, benefit.ErrCampaignNotFound
	}
	return p, err
}

func (r *BenefitRepository) IncrementCapacity(ctx context.Context, campaignID string, date *string, claimed, reserved, redeemed int) error {
	var err error
	if date != nil {
		_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
			UPDATE benefit.capacity_pools SET claimed=claimed+$1, reserved=reserved+$2, redeemed=redeemed+$3, updated_at=now(), version=version+1
			WHERE campaign_id=$4 AND date=$5::date`, claimed, reserved, redeemed, campaignID, *date)
	} else {
		_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
			UPDATE benefit.capacity_pools SET claimed=claimed+$1, reserved=reserved+$2, redeemed=redeemed+$3, updated_at=now(), version=version+1
			WHERE campaign_id=$4 AND date IS NULL`, claimed, reserved, redeemed, campaignID)
	}
	return err
}

// ── Allocation ────────────────────────────────────────────────────

func (r *BenefitRepository) CreateAllocation(ctx context.Context, a *benefit.Allocation) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO benefit.allocations (
			allocation_id, campaign_id, benefit_id, distributor_type, distributor_id,
			quota, distributed, consumed, created_at, updated_at, version
		) VALUES ($1,$2,$3,$4::benefit.distributor_type,$5,$6,$7,$8,$9,$10,$11)`,
		a.ID, a.CampaignID, a.BenefitID, string(a.DistributorType), a.DistributorID,
		a.Quota, a.Distributed, a.Consumed, a.CreatedAt, a.UpdatedAt, a.Version)
	return err
}

const allocationColumns = `allocation_id, campaign_id, benefit_id, distributor_type, distributor_id,
	quota, distributed, consumed, created_at, updated_at, version`

func scanAllocation(row pgx.Row) (*benefit.Allocation, error) {
	var a benefit.Allocation
	var distType string
	err := row.Scan(&a.ID, &a.CampaignID, &a.BenefitID, &distType, &a.DistributorID,
		&a.Quota, &a.Distributed, &a.Consumed, &a.CreatedAt, &a.UpdatedAt, &a.Version)
	if err != nil {
		return nil, err
	}
	a.DistributorType = benefit.DistributorType(distType)
	return &a, nil
}

func (r *BenefitRepository) GetAllocation(ctx context.Context, id string) (*benefit.Allocation, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+allocationColumns+` FROM benefit.allocations WHERE allocation_id=$1`, id)
	a, err := scanAllocation(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, benefit.ErrAllocationNotFound
	}
	return a, err
}

func (r *BenefitRepository) ListAllocationsByDistributor(ctx context.Context, distType benefit.DistributorType, distID string) ([]benefit.Allocation, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT `+allocationColumns+` FROM benefit.allocations WHERE distributor_type=$1::benefit.distributor_type AND distributor_id=$2 ORDER BY created_at DESC`,
		string(distType), distID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []benefit.Allocation{}
	for rows.Next() {
		a, err := scanAllocation(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *a)
	}
	return result, rows.Err()
}

func (r *BenefitRepository) ListAllocationsByCampaign(ctx context.Context, campaignID string) ([]benefit.Allocation, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT `+allocationColumns+` FROM benefit.allocations WHERE campaign_id=$1 ORDER BY created_at DESC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []benefit.Allocation{}
	for rows.Next() {
		a, err := scanAllocation(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *a)
	}
	return result, rows.Err()
}

func (r *BenefitRepository) IncrementAllocation(ctx context.Context, id string, distributed, consumed int) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE benefit.allocations SET distributed=distributed+$1, consumed=consumed+$2, updated_at=now(), version=version+1
		WHERE allocation_id=$3`, distributed, consumed, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return benefit.ErrAllocationNotFound
	}
	return nil
}

// ── Offer ─────────────────────────────────────────────────────────

func (r *BenefitRepository) CreateOffer(ctx context.Context, o *benefit.Offer) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO benefit.offers (
			offer_id, campaign_id, benefit_id, user_id, context_type, context_id,
			reason_code, status, offered_at, expires_at, claimed_at, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		o.ID, o.CampaignID, o.BenefitID, o.UserID, o.ContextType, o.ContextID,
		o.ReasonCode, string(o.Status), o.OfferedAt, o.ExpiresAt, o.ClaimedAt, o.CreatedAt)
	return err
}

const offerColumns = `offer_id, campaign_id, benefit_id, user_id, COALESCE(context_type,''), COALESCE(context_id,''),
	COALESCE(reason_code,''), status, offered_at, expires_at, claimed_at, created_at`

func scanOffer(row pgx.Row) (*benefit.Offer, error) {
	var o benefit.Offer
	var status string
	err := row.Scan(&o.ID, &o.CampaignID, &o.BenefitID, &o.UserID, &o.ContextType, &o.ContextID,
		&o.ReasonCode, &status, &o.OfferedAt, &o.ExpiresAt, &o.ClaimedAt, &o.CreatedAt)
	if err != nil {
		return nil, err
	}
	o.Status = benefit.OfferStatus(status)
	return &o, nil
}

func (r *BenefitRepository) GetOffer(ctx context.Context, id string) (*benefit.Offer, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+offerColumns+` FROM benefit.offers WHERE offer_id=$1`, id)
	o, err := scanOffer(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, benefit.ErrOfferNotFound
	}
	return o, err
}

func (r *BenefitRepository) ListOffersByUser(ctx context.Context, userID string, status *benefit.OfferStatus) ([]benefit.Offer, error) {
	query := `SELECT ` + offerColumns + ` FROM benefit.offers WHERE user_id=$1`
	args := []any{userID}
	if status != nil {
		args = append(args, string(*status))
		query += fmt.Sprintf(" AND status=$%d", len(args))
	}
	query += " ORDER BY offered_at DESC"
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []benefit.Offer{}
	for rows.Next() {
		o, err := scanOffer(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *o)
	}
	return result, rows.Err()
}

func (r *BenefitRepository) UpdateOfferStatus(ctx context.Context, id string, status benefit.OfferStatus) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE benefit.offers SET status=$1, claimed_at=CASE WHEN $1='CLAIMED' THEN now() ELSE claimed_at END WHERE offer_id=$2`,
		string(status), id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return benefit.ErrOfferNotFound
	}
	return nil
}

// ── Claim ─────────────────────────────────────────────────────────

func (r *BenefitRepository) CreateClaim(ctx context.Context, c *benefit.Claim) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO benefit.claims (
			claim_id, offer_id, campaign_id, benefit_id, user_id, claim_token, status,
			reserved_until, redeemed_at, created_at, updated_at, version
		) VALUES ($1,$2,$3,$4,$5,$6,$7::benefit.claim_status,$8,$9,$10,$11,$12)`,
		c.ID, nullableString(c.OfferID), c.CampaignID, c.BenefitID, c.UserID, c.ClaimToken, string(c.Status),
		c.ReservedUntil, c.RedeemedAt, c.CreatedAt, c.UpdatedAt, c.Version)
	return err
}

const claimColumns = `claim_id, COALESCE(offer_id,''), campaign_id, benefit_id, user_id, claim_token, status,
	reserved_until, redeemed_at, created_at, updated_at, version`

func scanClaim(row pgx.Row) (*benefit.Claim, error) {
	var c benefit.Claim
	var status string
	err := row.Scan(&c.ID, &c.OfferID, &c.CampaignID, &c.BenefitID, &c.UserID, &c.ClaimToken, &status,
		&c.ReservedUntil, &c.RedeemedAt, &c.CreatedAt, &c.UpdatedAt, &c.Version)
	if err != nil {
		return nil, err
	}
	c.Status = benefit.ClaimStatus(status)
	return &c, nil
}

func (r *BenefitRepository) GetClaim(ctx context.Context, id string) (*benefit.Claim, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+claimColumns+` FROM benefit.claims WHERE claim_id=$1`, id)
	c, err := scanClaim(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, benefit.ErrClaimNotFound
	}
	return c, err
}

func (r *BenefitRepository) GetClaimByToken(ctx context.Context, token string) (*benefit.Claim, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+claimColumns+` FROM benefit.claims WHERE claim_token=$1`, token)
	c, err := scanClaim(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, benefit.ErrClaimTokenInvalid
	}
	return c, err
}

func (r *BenefitRepository) ListClaimsByUser(ctx context.Context, userID string, status *benefit.ClaimStatus) ([]benefit.Claim, error) {
	query := `SELECT ` + claimColumns + ` FROM benefit.claims WHERE user_id=$1`
	args := []any{userID}
	if status != nil {
		args = append(args, string(*status))
		query += fmt.Sprintf(" AND status=$%d::benefit.claim_status", len(args))
	}
	query += " ORDER BY created_at DESC"
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []benefit.Claim{}
	for rows.Next() {
		c, err := scanClaim(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *c)
	}
	return result, rows.Err()
}

func (r *BenefitRepository) UpdateClaimStatus(ctx context.Context, id string, status benefit.ClaimStatus, version int) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE benefit.claims SET status=$1::benefit.claim_status, version=version+1, updated_at=now(),
			redeemed_at=CASE WHEN $1='REDEEMED' THEN now() ELSE redeemed_at END
		WHERE claim_id=$2 AND version=$3`, string(status), id, version)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		if _, getErr := r.GetClaim(ctx, id); errors.Is(getErr, benefit.ErrClaimNotFound) {
			return benefit.ErrClaimNotFound
		}
		return benefit.ErrVersionConflict
	}
	return nil
}

// ── Redemption ────────────────────────────────────────────────────

func (r *BenefitRepository) CreateRedemption(ctx context.Context, red *benefit.Redemption) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO benefit.redemptions (
			redemption_id, claim_id, campaign_id, merchant_id, staff_id, user_id,
			retail_value_minor, user_pay_minor, proxy_subsidy_minor, merchant_contribution_minor,
			creator_allocation_minor, staff_reward_minor, currency, evidence_type, evidence_ref,
			status, idempotency_key, redeemed_at, settled_at, created_at, version
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::benefit.redemption_status,$17,$18,$19,$20,$21)`,
		red.ID, red.ClaimID, red.CampaignID, red.MerchantID, nullableString(red.StaffID), red.UserID,
		red.RetailValueMinor, red.UserPayMinor, red.ProxySubsidyMinor, red.MerchantContribMinor,
		red.CreatorAllocMinor, red.StaffRewardMinor, red.Currency, nullableString(red.EvidenceType), nullableString(red.EvidenceRef),
		string(red.Status), red.IdempotencyKey, red.RedeemedAt, red.SettledAt, red.CreatedAt, red.Version)
	return err
}

const redemptionColumns = `redemption_id, claim_id, campaign_id, merchant_id, COALESCE(staff_id,''), user_id,
	retail_value_minor, user_pay_minor, proxy_subsidy_minor, merchant_contribution_minor,
	creator_allocation_minor, staff_reward_minor, currency, COALESCE(evidence_type,''), COALESCE(evidence_ref,''),
	status, idempotency_key, redeemed_at, settled_at, created_at, version`

func scanRedemption(row pgx.Row) (*benefit.Redemption, error) {
	var red benefit.Redemption
	var status string
	err := row.Scan(&red.ID, &red.ClaimID, &red.CampaignID, &red.MerchantID, &red.StaffID, &red.UserID,
		&red.RetailValueMinor, &red.UserPayMinor, &red.ProxySubsidyMinor, &red.MerchantContribMinor,
		&red.CreatorAllocMinor, &red.StaffRewardMinor, &red.Currency, &red.EvidenceType, &red.EvidenceRef,
		&status, &red.IdempotencyKey, &red.RedeemedAt, &red.SettledAt, &red.CreatedAt, &red.Version)
	if err != nil {
		return nil, err
	}
	red.Status = benefit.RedemptionStatus(status)
	return &red, nil
}

func (r *BenefitRepository) GetRedemption(ctx context.Context, id string) (*benefit.Redemption, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+redemptionColumns+` FROM benefit.redemptions WHERE redemption_id=$1`, id)
	red, err := scanRedemption(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, benefit.ErrRedemptionNotFound
	}
	return red, err
}

func (r *BenefitRepository) GetRedemptionByIdempotency(ctx context.Context, key string) (*benefit.Redemption, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+redemptionColumns+` FROM benefit.redemptions WHERE idempotency_key=$1`, key)
	red, err := scanRedemption(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, benefit.ErrRedemptionNotFound
	}
	return red, err
}

func (r *BenefitRepository) ListRedemptionsByCampaign(ctx context.Context, campaignID string) ([]benefit.Redemption, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT `+redemptionColumns+` FROM benefit.redemptions WHERE campaign_id=$1 ORDER BY created_at DESC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []benefit.Redemption{}
	for rows.Next() {
		red, err := scanRedemption(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *red)
	}
	return result, rows.Err()
}

func (r *BenefitRepository) UpdateRedemptionStatus(ctx context.Context, id string, status benefit.RedemptionStatus, version int) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE benefit.redemptions SET status=$1::benefit.redemption_status, version=version+1,
			settled_at=CASE WHEN $1='SETTLED' THEN now() ELSE settled_at END
		WHERE redemption_id=$2 AND version=$3`, string(status), id, version)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		if _, getErr := r.GetRedemption(ctx, id); errors.Is(getErr, benefit.ErrRedemptionNotFound) {
			return benefit.ErrRedemptionNotFound
		}
		return benefit.ErrVersionConflict
	}
	return nil
}

// ── Settlement ────────────────────────────────────────────────────

func (r *BenefitRepository) CreateSettlement(ctx context.Context, s *benefit.Settlement) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO benefit.settlements (
			settlement_id, redemption_id, campaign_id, actor_type, actor_id, amount_minor, currency, settled_at, created_at
		) VALUES ($1,$2,$3,$4::benefit.settlement_actor,$5,$6,$7,$8,$9)`,
		s.ID, s.RedemptionID, s.CampaignID, string(s.ActorType), s.ActorID, s.AmountMinor, s.Currency, s.SettledAt, s.CreatedAt)
	return err
}

const settlementColumns = `settlement_id, redemption_id, campaign_id, actor_type, actor_id, amount_minor, currency, settled_at, created_at`

func scanSettlement(row pgx.Row) (*benefit.Settlement, error) {
	var s benefit.Settlement
	var actorType string
	err := row.Scan(&s.ID, &s.RedemptionID, &s.CampaignID, &actorType, &s.ActorID, &s.AmountMinor, &s.Currency, &s.SettledAt, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	s.ActorType = benefit.SettlementActor(actorType)
	return &s, nil
}

func (r *BenefitRepository) ListSettlementsByRedemption(ctx context.Context, redemptionID string) ([]benefit.Settlement, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT `+settlementColumns+` FROM benefit.settlements WHERE redemption_id=$1 ORDER BY created_at`, redemptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []benefit.Settlement{}
	for rows.Next() {
		s, err := scanSettlement(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *s)
	}
	return result, rows.Err()
}

func (r *BenefitRepository) ListSettlementsByCampaign(ctx context.Context, campaignID string) ([]benefit.Settlement, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT `+settlementColumns+` FROM benefit.settlements WHERE campaign_id=$1 ORDER BY created_at`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []benefit.Settlement{}
	for rows.Next() {
		s, err := scanSettlement(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *s)
	}
	return result, rows.Err()
}

// ── Reward ────────────────────────────────────────────────────────

func (r *BenefitRepository) CreateReward(ctx context.Context, rew *benefit.Reward) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO benefit.rewards (
			reward_id, campaign_id, redemption_id, reward_type, beneficiary_type, beneficiary_id,
			amount_minor, currency, status, cap_ref, created_at, settled_at, version
		) VALUES ($1,$2,$3,$4::benefit.reward_type,$5,$6,$7,$8,$9::benefit.reward_status,$10,$11,$12,$13)`,
		rew.ID, rew.CampaignID, nullableString(rew.RedemptionID), string(rew.RewardType), rew.BeneficiaryType, rew.BeneficiaryID,
		rew.AmountMinor, rew.Currency, string(rew.Status), nullableString(rew.CapRef), rew.CreatedAt, rew.SettledAt, rew.Version)
	return err
}

const rewardColumns = `reward_id, campaign_id, COALESCE(redemption_id,''), reward_type, beneficiary_type, beneficiary_id,
	amount_minor, currency, status, COALESCE(cap_ref,''), created_at, settled_at, version`

func scanReward(row pgx.Row) (*benefit.Reward, error) {
	var rew benefit.Reward
	var rewardType, status string
	err := row.Scan(&rew.ID, &rew.CampaignID, &rew.RedemptionID, &rewardType, &rew.BeneficiaryType, &rew.BeneficiaryID,
		&rew.AmountMinor, &rew.Currency, &status, &rew.CapRef, &rew.CreatedAt, &rew.SettledAt, &rew.Version)
	if err != nil {
		return nil, err
	}
	rew.RewardType, rew.Status = benefit.RewardType(rewardType), benefit.RewardStatus(status)
	return &rew, nil
}

func (r *BenefitRepository) GetReward(ctx context.Context, id string) (*benefit.Reward, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+rewardColumns+` FROM benefit.rewards WHERE reward_id=$1`, id)
	rew, err := scanReward(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, benefit.ErrCampaignNotFound
	}
	return rew, err
}

func (r *BenefitRepository) ListRewardsByBeneficiary(ctx context.Context, beneficiaryType, beneficiaryID string) ([]benefit.Reward, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT `+rewardColumns+` FROM benefit.rewards WHERE beneficiary_type=$1 AND beneficiary_id=$2 ORDER BY created_at DESC`, beneficiaryType, beneficiaryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []benefit.Reward{}
	for rows.Next() {
		rew, err := scanReward(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *rew)
	}
	return result, rows.Err()
}

func (r *BenefitRepository) UpdateRewardStatus(ctx context.Context, id string, status benefit.RewardStatus, version int) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE benefit.rewards SET status=$1::benefit.reward_status, version=version+1,
			settled_at=CASE WHEN $1='SETTLED' THEN now() ELSE settled_at END
		WHERE reward_id=$2 AND version=$3`, string(status), id, version)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		if _, getErr := r.GetReward(ctx, id); errors.Is(getErr, benefit.ErrCampaignNotFound) {
			return benefit.ErrCampaignNotFound
		}
		return benefit.ErrVersionConflict
	}
	return nil
}

// ── AttributionEdge ───────────────────────────────────────────────

func (r *BenefitRepository) CreateAttributionEdge(ctx context.Context, e *benefit.AttributionEdge) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO benefit.attribution_edges (
			edge_id, source_type, source_id, target_user_id, campaign_id, redemption_id,
			scene_id, attribution_level, evidence_level, created_at, version
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::benefit.attribution_level,$9,$10,$11)`,
		e.ID, e.SourceType, e.SourceID, e.TargetUserID, e.CampaignID, nullableString(e.RedemptionID),
		nullableString(e.SceneID), string(e.AttributionLevel), e.EvidenceLevel, e.CreatedAt, e.Version)
	return err
}

const attributionColumns = `edge_id, source_type, source_id, target_user_id, campaign_id, COALESCE(redemption_id,''),
	COALESCE(scene_id,''), attribution_level, evidence_level, created_at, version`

func scanAttributionEdge(row pgx.Row) (*benefit.AttributionEdge, error) {
	var e benefit.AttributionEdge
	var level string
	err := row.Scan(&e.ID, &e.SourceType, &e.SourceID, &e.TargetUserID, &e.CampaignID, &e.RedemptionID,
		&e.SceneID, &level, &e.EvidenceLevel, &e.CreatedAt, &e.Version)
	if err != nil {
		return nil, err
	}
	e.AttributionLevel = benefit.AttributionLevel(level)
	return &e, nil
}

func (r *BenefitRepository) ListAttributionByUser(ctx context.Context, userID string) ([]benefit.AttributionEdge, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT `+attributionColumns+` FROM benefit.attribution_edges WHERE target_user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []benefit.AttributionEdge{}
	for rows.Next() {
		e, err := scanAttributionEdge(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *e)
	}
	return result, rows.Err()
}

func (r *BenefitRepository) ListAttributionByCampaign(ctx context.Context, campaignID string) ([]benefit.AttributionEdge, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT `+attributionColumns+` FROM benefit.attribution_edges WHERE campaign_id=$1 ORDER BY created_at DESC`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []benefit.AttributionEdge{}
	for rows.Next() {
		e, err := scanAttributionEdge(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *e)
	}
	return result, rows.Err()
}

// ── CampaignAudience ──────────────────────────────────────────────

func (r *BenefitRepository) UpsertCampaignAudience(ctx context.Context, a *benefit.CampaignAudience) error {
	rulesJSON, err := json.Marshal(a.EligibilityRules)
	if err != nil {
		return err
	}
	var predsJSON []byte
	if a.LifecyclePreds != nil {
		if predsJSON, err = json.Marshal(a.LifecyclePreds); err != nil {
			return err
		}
	}
	allowlist, geo := a.SourceAllowlist, a.GeoCities
	if allowlist == nil {
		allowlist = []string{}
	}
	if geo == nil {
		geo = []string{}
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO benefit.campaign_audiences (
			campaign_id, eligibility_rules, source_allowlist, geo_cities, lifecycle_preds, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (campaign_id) DO UPDATE SET
			eligibility_rules=EXCLUDED.eligibility_rules, source_allowlist=EXCLUDED.source_allowlist,
			geo_cities=EXCLUDED.geo_cities, lifecycle_preds=EXCLUDED.lifecycle_preds, updated_at=EXCLUDED.updated_at`,
		a.CampaignID, rulesJSON, allowlist, geo, predsJSON, a.CreatedAt, a.UpdatedAt)
	return err
}

func (r *BenefitRepository) GetCampaignAudience(ctx context.Context, campaignID string) (*benefit.CampaignAudience, error) {
	var a benefit.CampaignAudience
	var rulesJSON, predsJSON []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT campaign_id, eligibility_rules, COALESCE(source_allowlist,'{}'), COALESCE(geo_cities,'{}'), lifecycle_preds, created_at, updated_at
		FROM benefit.campaign_audiences WHERE campaign_id=$1`, campaignID).Scan(
		&a.CampaignID, &rulesJSON, &a.SourceAllowlist, &a.GeoCities, &predsJSON, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, benefit.ErrCampaignNotFound
	}
	if err != nil {
		return nil, err
	}
	if len(rulesJSON) > 0 {
		if err := json.Unmarshal(rulesJSON, &a.EligibilityRules); err != nil {
			return nil, err
		}
	}
	if len(predsJSON) > 0 {
		if err := json.Unmarshal(predsJSON, &a.LifecyclePreds); err != nil {
			return nil, err
		}
	}
	return &a, nil
}

// ── CampaignEvent ─────────────────────────────────────────────────

func (r *BenefitRepository) AppendCampaignEvent(ctx context.Context, e *benefit.CampaignEvent) error {
	var payloadJSON []byte
	if e.Payload != nil {
		var err error
		if payloadJSON, err = json.Marshal(e.Payload); err != nil {
			return err
		}
	}
	return queryerForContext(ctx, r.pool).QueryRow(ctx, `
		INSERT INTO benefit.campaign_events (campaign_id, event_type, actor_id, payload, occurred_at)
		VALUES ($1,$2,$3,$4,$5) RETURNING event_id`,
		e.CampaignID, e.EventType, nullableString(e.ActorID), payloadJSON, e.OccurredAt).Scan(&e.ID)
}

// nullableString (see notification.go) turns a Go zero-value string into a
// real SQL NULL for optional foreign-key/text columns.
