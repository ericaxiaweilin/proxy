package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/scene"
)

// SceneRepository persists the R15.13 Scene Value Exchange aggregates
// (Scene, Invitation, Benefit, Checkin, Memory) in PostgreSQL. The
// in-memory scene.MemoryRepository remains the test fixture; this
// adapter is the production binding wired in cmd/api/main.go when
// DATABASE_URL is set.
//
// Schema source of truth: apps/api-go/migrations/028_scene_value_exchange.sql
// (Scene, Invitation, Attendance, Outcome) and 029_invite_funding_benefit.sql
// (funding/budget/aesthetic columns + benefits/checkins/memories tables).
//
// Conventions:
//   - Query helpers (queryerForContext) automatically join an
//     in-flight transaction when one is attached to the context, so
//     callers don't have to thread a Tx through every method.
//   - JSONB columns (anchor, benefits, card, price_corridor,
//     aesthetic_assets) are marshalled to []byte so the underlying
//     pgx driver stores them as JSONB without any extra conversion.
//   - All read paths return scene.ErrNotFound (or the per-aggregate
//     equivalent) so the service layer keeps using errors.Is without
//     knowing the storage is Postgres.
type SceneRepository struct {
	pool *pgxpool.Pool
}

func NewSceneRepository(pool *pgxpool.Pool) *SceneRepository {
	return &SceneRepository{pool: pool}
}

// ── Scene ───────────────────────────────────────────────────────

const sceneColumns = `
	scene_id, tool, title, intent, anchor, participation, cost,
	funding_mode, budget_minor, currency, benefits, venue_id,
	starts_at, ends_at, capacity_min, capacity_max,
	host_user_id, city_scope, aesthetic_score, price_corridor,
	status, version, created_at, updated_at
`

func (r *SceneRepository) Create(ctx context.Context, s scene.Scene) error {
	anchorJSON, err := json.Marshal(s.Anchor)
	if err != nil {
		return err
	}
	benefitsJSON, err := json.Marshal(s.Benefits)
	if err != nil {
		return err
	}
	corridorJSON, err := json.Marshal(s.PriceCorridor)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO scene.scenes (`+sceneColumns+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
		s.ID, s.Tool, s.Title, s.Intent, anchorJSON, s.Participation, s.Cost,
		s.FundingMode, s.BudgetMinor, s.Currency, benefitsJSON, nullIfEmpty(s.VenueID),
		s.StartsAt, s.EndsAt, nullInt(s.CapacityMin), nullInt(s.CapacityMax),
		s.HostUserID, nullIfEmpty(s.CityScope), s.AestheticScore, corridorJSON,
		s.Status, s.Version, s.CreatedAt, s.UpdatedAt,
	)
	return err
}

func (r *SceneRepository) Get(ctx context.Context, id string) (scene.Scene, error) {
	var s scene.Scene
	var anchorJSON, benefitsJSON, corridorJSON []byte
	var endsAt *time.Time
	var venueID, cityScope *string
	var capacityMin, capacityMax *int
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT `+sceneColumns+`
		FROM scene.scenes WHERE scene_id = $1`, id).Scan(
		&s.ID, &s.Tool, &s.Title, &s.Intent, &anchorJSON, &s.Participation, &s.Cost,
		&s.FundingMode, &s.BudgetMinor, &s.Currency, &benefitsJSON, &venueID,
		&s.StartsAt, &endsAt, &capacityMin, &capacityMax,
		&s.HostUserID, &cityScope, &s.AestheticScore, &corridorJSON,
		&s.Status, &s.Version, &s.CreatedAt, &s.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return scene.Scene{}, scene.ErrNotFound
	}
	if err != nil {
		return scene.Scene{}, err
	}
	if len(anchorJSON) > 0 {
		_ = json.Unmarshal(anchorJSON, &s.Anchor)
	}
	if len(benefitsJSON) > 0 {
		_ = json.Unmarshal(benefitsJSON, &s.Benefits)
	}
	if len(corridorJSON) > 0 {
		_ = json.Unmarshal(corridorJSON, &s.PriceCorridor)
	}
	if venueID != nil {
		s.VenueID = *venueID
	}
	if cityScope != nil {
		s.CityScope = *cityScope
	}
	if capacityMin != nil {
		s.CapacityMin = *capacityMin
	}
	if capacityMax != nil {
		s.CapacityMax = *capacityMax
	}
	if endsAt != nil {
		s.EndsAt = endsAt
	}
	return s, nil
}

func (r *SceneRepository) Update(ctx context.Context, s scene.Scene, expectedVersion int) error {
	anchorJSON, err := json.Marshal(s.Anchor)
	if err != nil {
		return err
	}
	benefitsJSON, err := json.Marshal(s.Benefits)
	if err != nil {
		return err
	}
	corridorJSON, err := json.Marshal(s.PriceCorridor)
	if err != nil {
		return err
	}
	commandTag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE scene.scenes SET
			tool=$2, title=$3, intent=$4, anchor=$5, participation=$6, cost=$7,
			funding_mode=$8, budget_minor=$9, currency=$10, benefits=$11, venue_id=$12,
			starts_at=$13, ends_at=$14, capacity_min=$15, capacity_max=$16,
			host_user_id=$17, city_scope=$18, aesthetic_score=$19, price_corridor=$20,
			status=$21, version=$22, updated_at=$23
		WHERE scene_id=$1 AND version=$24`,
		s.ID, s.Tool, s.Title, s.Intent, anchorJSON, s.Participation, s.Cost,
		s.FundingMode, s.BudgetMinor, s.Currency, benefitsJSON, nullIfEmpty(s.VenueID),
		s.StartsAt, s.EndsAt, nullInt(s.CapacityMin), nullInt(s.CapacityMax),
		s.HostUserID, nullIfEmpty(s.CityScope), s.AestheticScore, corridorJSON,
		s.Status, s.Version, s.UpdatedAt,
		expectedVersion,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		// Either the row doesn't exist or the version moved under us.
		// Distinguish so the service can return SCENE_NOT_FOUND vs
		// SCENE_VERSION_CONFLICT instead of a single opaque error.
		var exists bool
		_ = queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM scene.scenes WHERE scene_id=$1)`, s.ID).Scan(&exists)
		if !exists {
			return scene.ErrNotFound
		}
		return scene.ErrVersionConflict
	}
	return nil
}

func (r *SceneRepository) ListByHost(ctx context.Context, hostID string, limit int) ([]scene.Scene, error) {
	if limit <= 0 {
		return []scene.Scene{}, nil
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT `+sceneColumns+`
		FROM scene.scenes
		WHERE host_user_id = $1
		ORDER BY updated_at DESC
		LIMIT $2`, hostID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanScenes(rows)
}

// ── Invitation ─────────────────────────────────────────────────

func (r *SceneRepository) CreateInvitation(ctx context.Context, inv scene.Invitation) error {
	cardJSON, err := json.Marshal(inv.Card)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO scene.invitations (
			invitation_id, scene_id, host_user_id, invitee_user_id, card, status, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		inv.ID, inv.SceneID, inv.HostID, inv.InviteeID, cardJSON, inv.Status, inv.CreatedAt, inv.CreatedAt,
	)
	return err
}

func (r *SceneRepository) GetInvitation(ctx context.Context, id string) (scene.Invitation, error) {
	var inv scene.Invitation
	var cardJSON []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT invitation_id, scene_id, host_user_id, invitee_user_id, card, status, created_at
		FROM scene.invitations WHERE invitation_id = $1`, id).Scan(
		&inv.ID, &inv.SceneID, &inv.HostID, &inv.InviteeID, &cardJSON, &inv.Status, &inv.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return scene.Invitation{}, scene.ErrNotFound
	}
	if err != nil {
		return scene.Invitation{}, err
	}
	if len(cardJSON) > 0 {
		_ = json.Unmarshal(cardJSON, &inv.Card)
	}
	return inv, nil
}

func (r *SceneRepository) UpdateInvitation(ctx context.Context, inv scene.Invitation) error {
	cardJSON, err := json.Marshal(inv.Card)
	if err != nil {
		return err
	}
	commandTag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE scene.invitations SET card=$2, status=$3, updated_at=$4
		WHERE invitation_id=$1`,
		inv.ID, cardJSON, inv.Status, time.Now().UTC(),
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return scene.ErrNotFound
	}
	return nil
}

func (r *SceneRepository) ListInvitationsByInvitee(ctx context.Context, inviteeID string, limit int) ([]scene.Invitation, error) {
	if limit <= 0 {
		return []scene.Invitation{}, nil
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT invitation_id, scene_id, host_user_id, invitee_user_id, card, status, created_at
		FROM scene.invitations
		WHERE invitee_user_id = $1
		ORDER BY created_at DESC
		LIMIT $2`, inviteeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []scene.Invitation{}
	for rows.Next() {
		var inv scene.Invitation
		var cardJSON []byte
		if err := rows.Scan(&inv.ID, &inv.SceneID, &inv.HostID, &inv.InviteeID, &cardJSON, &inv.Status, &inv.CreatedAt); err != nil {
			return nil, err
		}
		if len(cardJSON) > 0 {
			_ = json.Unmarshal(cardJSON, &inv.Card)
		}
		out = append(out, inv)
	}
	return out, nil
}

// ── Benefit ────────────────────────────────────────────────────

func (r *SceneRepository) CreateBenefit(ctx context.Context, b scene.Benefit) error {
	now := b.CreatedAt
	if now.IsZero() {
		now = time.Now()
	}
	commandTag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO scene.benefits (benefit_id, scene_id, type, status, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$5)
		ON CONFLICT (scene_id) DO NOTHING`,
		b.ID, b.SceneID, b.Type, b.Status, now,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		// A benefit already exists for this scene; mirror the
		// in-memory repository's "benefit already exists for scene"
		// rejection so the service can be storage-agnostic.
		return errors.New("benefit already exists for scene")
	}
	return nil
}

func (r *SceneRepository) GetBenefit(ctx context.Context, sceneID string) (scene.Benefit, error) {
	var b scene.Benefit
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT benefit_id, scene_id, type, status, created_at
		FROM scene.benefits WHERE scene_id = $1
		ORDER BY created_at DESC LIMIT 1`, sceneID).Scan(
		&b.ID, &b.SceneID, &b.Type, &b.Status, &b.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return scene.Benefit{}, scene.ErrNotFound
	}
	if err != nil {
		return scene.Benefit{}, err
	}
	return b, nil
}

func (r *SceneRepository) UpdateBenefit(ctx context.Context, b scene.Benefit) error {
	commandTag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE scene.benefits SET status=$2, updated_at=$3
		WHERE benefit_id=$1`,
		b.ID, b.Status, time.Now(),
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return scene.ErrNotFound
	}
	return nil
}

// ── Checkin ────────────────────────────────────────────────────

func (r *SceneRepository) CreateCheckin(ctx context.Context, c scene.Checkin) error {
	if c.At.IsZero() {
		c.At = time.Now()
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO scene.checkins (scene_id, user_id, role, checked_at)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (scene_id, user_id) DO UPDATE
		SET role = EXCLUDED.role, checked_at = EXCLUDED.checked_at`,
		c.SceneID, c.UserID, c.Role, c.At,
	)
	return err
}

func (r *SceneRepository) ListCheckins(ctx context.Context, sceneID string) ([]scene.Checkin, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT scene_id, user_id, role, checked_at
		FROM scene.checkins WHERE scene_id = $1
		ORDER BY checked_at ASC`, sceneID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []scene.Checkin{}
	for rows.Next() {
		var c scene.Checkin
		if err := rows.Scan(&c.SceneID, &c.UserID, &c.Role, &c.At); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

// ── Memory (R15.13 P2) ─────────────────────────────────────────

func (r *SceneRepository) UpsertMemory(ctx context.Context, m scene.Memory) error {
	if m.SceneID == "" {
		return errors.New("memory sceneId is required")
	}
	assetsJSON, err := json.Marshal(m.AestheticAssets)
	if err != nil {
		return err
	}
	if m.ID == "" {
		m.ID = synthesizeMemoryID()
	}
	now := m.CreatedAt
	if now.IsZero() {
		now = time.Now()
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO scene.memories (
			scene_id, host_id, guest_id, merchant_id, scene_type,
			funding_mode, planned_budget, actual_spend, duration_min,
			aesthetic_assets, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (scene_id) DO UPDATE SET
			host_id = EXCLUDED.host_id,
			guest_id = EXCLUDED.guest_id,
			merchant_id = EXCLUDED.merchant_id,
			scene_type = EXCLUDED.scene_type,
			funding_mode = EXCLUDED.funding_mode,
			planned_budget = EXCLUDED.planned_budget,
			actual_spend = EXCLUDED.actual_spend,
			duration_min = EXCLUDED.duration_min,
			aesthetic_assets = EXCLUDED.aesthetic_assets`,
		m.SceneID, m.HostID, m.GuestID, nullIfEmpty(m.MerchantID), m.SceneType,
		m.FundingMode, m.PlannedBudget, m.ActualSpend, m.DurationMin,
		assetsJSON, now,
	)
	return err
}

func (r *SceneRepository) GetMemory(ctx context.Context, sceneID string) (scene.Memory, error) {
	var m scene.Memory
	var merchantID *string
	var assetsJSON []byte
	var rating float64
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT scene_id, host_id, guest_id, merchant_id, scene_type,
		       funding_mode, planned_budget, actual_spend, duration_min,
		       aesthetic_assets, created_at
		FROM scene.memories WHERE scene_id = $1`, sceneID).Scan(
		&m.SceneID, &m.HostID, &m.GuestID, &merchantID, &m.SceneType,
		&m.FundingMode, &m.PlannedBudget, &m.ActualSpend, &m.DurationMin,
		&assetsJSON, &m.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return scene.Memory{}, scene.ErrNotFound
	}
	if err != nil {
		return scene.Memory{}, err
	}
	if merchantID != nil {
		m.MerchantID = *merchantID
	}
	if len(assetsJSON) > 0 {
		_ = json.Unmarshal(assetsJSON, &m.AestheticAssets)
	}
	// Memory.ID isn't persisted (we key on scene_id) — synthesise a
	// stable id from the scene_id so the mobile client keeps its
	// contract.
	m.ID = "mem_" + m.SceneID
	// Rating is derived in the service layer (aesthetic + budget
	// adherence). We don't store it because it's a function of the
	// scene + outcome, not a user-asserted fact. Leave at zero;
	// the service can re-derive on the fly from the persisted Scene
	// row + Memory row. We expose rating here for the OperationRef
	// payload; recomputing on read keeps writes cheap and avoids
	// drift if the scene's aesthetic_score is later corrected.
	if m.PlannedBudget > 0 {
		ratio := float64(m.ActualSpend) / float64(m.PlannedBudget)
		if ratio > 1 {
			ratio = 2 - ratio
		}
		if ratio < 0 {
			ratio = 0
		}
		// We don't have aesthetic_score here; the service is
		// responsible for blending. Set rating to the budget-
		// adherence leg and let the service apply the aesthetic
		// blend if it wants. (Tests for the integration layer
		// verify the full path through the service.)
		rating = ratio
	}
	m.Rating = rating
	return m, nil
}

func (r *SceneRepository) ListMemoriesByUser(ctx context.Context, userID string, limit int) ([]scene.Memory, error) {
	if limit <= 0 {
		return []scene.Memory{}, nil
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT scene_id, host_id, guest_id, merchant_id, scene_type,
		       funding_mode, planned_budget, actual_spend, duration_min,
		       aesthetic_assets, created_at
		FROM scene.memories
		WHERE host_id = $1 OR guest_id = $1
		ORDER BY created_at DESC
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []scene.Memory{}
	for rows.Next() {
		m, err := scanMemoryRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

func (r *SceneRepository) ListMemoriesByScene(ctx context.Context, sceneID string) ([]scene.Memory, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT scene_id, host_id, guest_id, merchant_id, scene_type,
		       funding_mode, planned_budget, actual_spend, duration_min,
		       aesthetic_assets, created_at
		FROM scene.memories WHERE scene_id = $1`, sceneID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []scene.Memory{}
	for rows.Next() {
		m, err := scanMemoryRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

// ── helpers ────────────────────────────────────────────────────

type memoryRow interface {
	Scan(dest ...any) error
}

func scanMemoryRow(row memoryRow) (scene.Memory, error) {
	var m scene.Memory
	var merchantID *string
	var assetsJSON []byte
	if err := row.Scan(
		&m.SceneID, &m.HostID, &m.GuestID, &merchantID, &m.SceneType,
		&m.FundingMode, &m.PlannedBudget, &m.ActualSpend, &m.DurationMin,
		&assetsJSON, &m.CreatedAt,
	); err != nil {
		return scene.Memory{}, err
	}
	if merchantID != nil {
		m.MerchantID = *merchantID
	}
	if len(assetsJSON) > 0 {
		_ = json.Unmarshal(assetsJSON, &m.AestheticAssets)
	}
	m.ID = "mem_" + m.SceneID
	if m.PlannedBudget > 0 {
		ratio := float64(m.ActualSpend) / float64(m.PlannedBudget)
		if ratio > 1 {
			ratio = 2 - ratio
		}
		if ratio < 0 {
			ratio = 0
		}
		m.Rating = ratio
	}
	return m, nil
}

func scanScenes(rows pgx.Rows) ([]scene.Scene, error) {
	defer rows.Close()
	out := []scene.Scene{}
	for rows.Next() {
		var s scene.Scene
		var anchorJSON, benefitsJSON, corridorJSON []byte
		var endsAt *time.Time
		var venueID, cityScope *string
		var capacityMin, capacityMax *int
		if err := rows.Scan(
			&s.ID, &s.Tool, &s.Title, &s.Intent, &anchorJSON, &s.Participation, &s.Cost,
			&s.FundingMode, &s.BudgetMinor, &s.Currency, &benefitsJSON, &venueID,
			&s.StartsAt, &endsAt, &capacityMin, &capacityMax,
			&s.HostUserID, &cityScope, &s.AestheticScore, &corridorJSON,
			&s.Status, &s.Version, &s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if len(anchorJSON) > 0 {
			_ = json.Unmarshal(anchorJSON, &s.Anchor)
		}
		if len(benefitsJSON) > 0 {
			_ = json.Unmarshal(benefitsJSON, &s.Benefits)
		}
		if len(corridorJSON) > 0 {
			_ = json.Unmarshal(corridorJSON, &s.PriceCorridor)
		}
		if venueID != nil {
			s.VenueID = *venueID
		}
		if cityScope != nil {
			s.CityScope = *cityScope
		}
		if capacityMin != nil {
			s.CapacityMin = *capacityMin
		}
		if capacityMax != nil {
			s.CapacityMax = *capacityMax
		}
		if endsAt != nil {
			s.EndsAt = endsAt
		}
		out = append(out, s)
	}
	return out, nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullInt(i int) any {
	if i == 0 {
		return nil
	}
	return i
}

// synthesizeMemoryID is a placeholder ID for the rare path where the
// caller hands us a Memory without an ID — the production call
// sites always set it, but the integration tests construct Memory
// literals and rely on the repository to fill the gap. The id is
// never used as a key in the database (scene_id is the natural
// key) so a random hex is fine.
func synthesizeMemoryID() string {
	buf := make([]byte, 6)
	_, _ = rand.Read(buf)
	return "mem_" + hex.EncodeToString(buf)
}
