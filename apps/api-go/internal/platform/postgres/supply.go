package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// SupplyRepository 持久化 Agent Profile/Service/Capability/Availability/CandidateBatch。
type SupplyRepository struct {
	pool   *pgxpool.Pool
	outbox *OutboxRepository
}

func NewSupplyRepository(pool *pgxpool.Pool) *SupplyRepository {
	return &SupplyRepository{pool: pool}
}

func NewSupplyRepositoryWithOutbox(pool *pgxpool.Pool, outboxRepository *OutboxRepository) *SupplyRepository {
	return &SupplyRepository{pool: pool, outbox: outboxRepository}
}

// ---------- AgentProfile ----------

func (r *SupplyRepository) CreateProfile(ctx context.Context, p supply.AgentProfile) error {
	photos, languages, areas, err := encodeProfileJSON(p)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.agent_profiles (agent_id, name, bio, photos, languages, service_areas, status, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		p.AgentID, p.Name, p.Bio, photos, languages, areas, p.Status, p.CreatedAt, p.UpdatedAt,
	)
	return err
}

func (r *SupplyRepository) GetProfile(ctx context.Context, agentID string) (supply.AgentProfile, error) {
	var p supply.AgentProfile
	var photos, languages, areas []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT agent_id, name, bio, photos, languages, service_areas, status, created_at, updated_at
		FROM supply.agent_profiles WHERE agent_id = $1`, agentID).Scan(
		&p.AgentID, &p.Name, &p.Bio, &photos, &languages, &areas, &p.Status, &p.CreatedAt, &p.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return supply.AgentProfile{}, supply.ErrProfileNotFound
	}
	if err != nil {
		return supply.AgentProfile{}, err
	}
	_ = json.Unmarshal(photos, &p.Photos)
	_ = json.Unmarshal(languages, &p.Languages)
	_ = json.Unmarshal(areas, &p.ServiceAreas)
	return p, nil
}

func (r *SupplyRepository) UpdateProfile(ctx context.Context, p supply.AgentProfile) error {
	photos, languages, areas, err := encodeProfileJSON(p)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE supply.agent_profiles
		SET name=$1, bio=$2, photos=$3, languages=$4, service_areas=$5, status=$6, updated_at=$7
		WHERE agent_id=$8`,
		p.Name, p.Bio, photos, languages, areas, p.Status, p.UpdatedAt, p.AgentID,
	)
	return err
}

func encodeProfileJSON(p supply.AgentProfile) ([]byte, []byte, []byte, error) {
	photos, err := json.Marshal(p.Photos)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("encode photos: %w", err)
	}
	languages, err := json.Marshal(p.Languages)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("encode languages: %w", err)
	}
	areas, err := json.Marshal(p.ServiceAreas)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("encode service areas: %w", err)
	}
	return photos, languages, areas, nil
}

// ---------- AgentService ----------

func (r *SupplyRepository) CreateService(ctx context.Context, s supply.AgentService) error {
	markets, err := json.Marshal(s.Markets)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.agent_services (agent_id, service_type, status, reference_price, currency, markets, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		s.AgentID, s.ServiceType, s.Status, s.ReferencePrice, s.Currency, markets, s.UpdatedAt,
	)
	return err
}

func (r *SupplyRepository) GetService(ctx context.Context, agentID, serviceType string) (supply.AgentService, error) {
	var s supply.AgentService
	var markets []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT agent_id, service_type, status, reference_price, currency, markets, updated_at
		FROM supply.agent_services WHERE agent_id=$1 AND service_type=$2`, agentID, serviceType).Scan(
		&s.AgentID, &s.ServiceType, &s.Status, &s.ReferencePrice, &s.Currency, &markets, &s.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return supply.AgentService{}, supply.ErrServiceNotFound
	}
	if err != nil {
		return supply.AgentService{}, err
	}
	_ = json.Unmarshal(markets, &s.Markets)
	return s, nil
}

func (r *SupplyRepository) UpdateService(ctx context.Context, s supply.AgentService) error {
	markets, err := json.Marshal(s.Markets)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE supply.agent_services
		SET status=$1, reference_price=$2, currency=$3, markets=$4, updated_at=$5
		WHERE agent_id=$6 AND service_type=$7`,
		s.Status, s.ReferencePrice, s.Currency, markets, s.UpdatedAt, s.AgentID, s.ServiceType,
	)
	return err
}

// ---------- Capability ----------

func (r *SupplyRepository) SetCapability(ctx context.Context, c supply.Capability) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.capabilities (agent_id, capability, declared, verified, updated_at)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (agent_id, capability) DO UPDATE SET
			declared = EXCLUDED.declared, verified = EXCLUDED.verified, updated_at = EXCLUDED.updated_at`,
		c.AgentID, c.Capability, c.Declared, c.Verified, c.UpdatedAt,
	)
	return err
}

func (r *SupplyRepository) GetCapabilities(ctx context.Context, agentID string) ([]supply.Capability, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT agent_id, capability, declared, verified, updated_at
		FROM supply.capabilities WHERE agent_id=$1 ORDER BY capability`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []supply.Capability{}
	for rows.Next() {
		var c supply.Capability
		if err := rows.Scan(&c.AgentID, &c.Capability, &c.Declared, &c.Verified, &c.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// ---------- CapabilityVerification ----------

func (r *SupplyRepository) CreateVerification(ctx context.Context, v supply.CapabilityVerification) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.capability_verifications (id, agent_id, capability, status, method, verified_by, verified_at, expires_at, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		v.ID, v.AgentID, v.Capability, v.Status, v.Method, v.VerifiedBy, v.VerifiedAt, v.ExpiresAt, v.CreatedAt,
	)
	return err
}

func (r *SupplyRepository) GetVerifications(ctx context.Context, agentID string) ([]supply.CapabilityVerification, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, agent_id, capability, status, method, verified_by, verified_at, expires_at, created_at
		FROM supply.capability_verifications WHERE agent_id=$1 ORDER BY created_at DESC`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []supply.CapabilityVerification{}
	for rows.Next() {
		var v supply.CapabilityVerification
		var verifiedBy *string
		if err := rows.Scan(&v.ID, &v.AgentID, &v.Capability, &v.Status, &v.Method, &verifiedBy, &v.VerifiedAt, &v.ExpiresAt, &v.CreatedAt); err != nil {
			return nil, err
		}
		if verifiedBy != nil {
			v.VerifiedBy = *verifiedBy
		}
		result = append(result, v)
	}
	return result, rows.Err()
}

// ---------- AvailabilityWindow ----------

func (r *SupplyRepository) CreateWindow(ctx context.Context, w supply.AvailabilityWindow) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.availability_windows (id, agent_id, start_at, end_at, market_id, status, order_id, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		w.ID, w.AgentID, w.StartAt, w.EndAt, w.MarketID, w.Status, w.OrderID, w.CreatedAt, w.UpdatedAt,
	)
	return err
}

func (r *SupplyRepository) GetWindows(ctx context.Context, agentID string) ([]supply.AvailabilityWindow, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, agent_id, start_at, end_at, market_id, status, order_id, created_at, updated_at
		FROM supply.availability_windows WHERE agent_id=$1 ORDER BY start_at`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []supply.AvailabilityWindow{}
	for rows.Next() {
		var w supply.AvailabilityWindow
		var orderID *string
		if err := rows.Scan(&w.ID, &w.AgentID, &w.StartAt, &w.EndAt, &w.MarketID, &w.Status, &orderID, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, err
		}
		if orderID != nil {
			w.OrderID = *orderID
		}
		result = append(result, w)
	}
	return result, rows.Err()
}

func (r *SupplyRepository) GetWindow(ctx context.Context, windowID string) (supply.AvailabilityWindow, error) {
	var w supply.AvailabilityWindow
	var orderID *string
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, agent_id, start_at, end_at, market_id, status, order_id, created_at, updated_at
		FROM supply.availability_windows WHERE id=$1`, windowID).Scan(
		&w.ID, &w.AgentID, &w.StartAt, &w.EndAt, &w.MarketID, &w.Status, &orderID, &w.CreatedAt, &w.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return supply.AvailabilityWindow{}, errors.New("window not found")
	}
	if err != nil {
		return supply.AvailabilityWindow{}, err
	}
	if orderID != nil {
		w.OrderID = *orderID
	}
	return w, nil
}

func (r *SupplyRepository) UpdateWindowStatus(ctx context.Context, windowID string, status, orderID string) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE supply.availability_windows SET status=$1, order_id=$2 WHERE id=$3`,
		status, orderID, windowID,
	)
	return err
}

func (r *SupplyRepository) OverlappingWindows(ctx context.Context, agentID string, startAt, endAt time.Time) ([]supply.AvailabilityWindow, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, agent_id, start_at, end_at, market_id, status, order_id, created_at, updated_at
		FROM supply.availability_windows
		WHERE agent_id=$1 AND start_at < $3 AND end_at > $2
		ORDER BY start_at`, agentID, startAt, endAt)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []supply.AvailabilityWindow{}
	for rows.Next() {
		var w supply.AvailabilityWindow
		var orderID *string
		if err := rows.Scan(&w.ID, &w.AgentID, &w.StartAt, &w.EndAt, &w.MarketID, &w.Status, &orderID, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, err
		}
		if orderID != nil {
			w.OrderID = *orderID
		}
		result = append(result, w)
	}
	return result, rows.Err()
}

// ---------- CandidateBatch ----------

func (r *SupplyRepository) SaveCandidateBatch(ctx context.Context, b supply.CandidateBatch) error {
	candidates, err := json.Marshal(b.Candidates)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.candidate_batches (id, need_id, market_id, owner_principal_id, created_at, candidates, shortage, shortage_note)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		b.ID, b.NeedID, b.MarketID, b.OwnerPrincipalID, b.CreatedAt, candidates, b.Shortage, b.ShortageNote,
	)
	return err
}

func (r *SupplyRepository) SaveCandidateBatchAndPublish(ctx context.Context, b supply.CandidateBatch, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("supply transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		candidates, err := json.Marshal(b.Candidates)
		if err != nil {
			return err
		}
		if _, err := transaction.Exec(ctx, `
			INSERT INTO supply.candidate_batches (id, need_id, market_id, created_at, candidates, shortage, shortage_note)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			b.ID, b.NeedID, b.MarketID, b.CreatedAt, candidates, b.Shortage, b.ShortageNote,
		); err != nil {
			return err
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *SupplyRepository) GetCandidateBatch(ctx context.Context, batchID string) (supply.CandidateBatch, error) {
	var b supply.CandidateBatch
	var candidates []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, need_id, market_id, COALESCE(owner_principal_id, ''), created_at, candidates, shortage, shortage_note
		FROM supply.candidate_batches WHERE id=$1`, batchID).Scan(
		&b.ID, &b.NeedID, &b.MarketID, &b.OwnerPrincipalID, &b.CreatedAt, &candidates, &b.Shortage, &b.ShortageNote,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return supply.CandidateBatch{}, supply.ErrBatchNotFound
	}
	if err != nil {
		return supply.CandidateBatch{}, err
	}
	if err := json.Unmarshal(candidates, &b.Candidates); err != nil {
		return b, fmt.Errorf("decode candidates: %w", err)
	}
	return b, nil
}

// ---------- Snapshots ----------

func (r *SupplyRepository) ProfilesSnapshot(ctx context.Context) ([]supply.AgentProfile, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT agent_id, name, bio, photos, languages, service_areas, status, created_at, updated_at
		FROM supply.agent_profiles ORDER BY agent_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []supply.AgentProfile{}
	for rows.Next() {
		var p supply.AgentProfile
		var photos, languages, areas []byte
		if err := rows.Scan(&p.AgentID, &p.Name, &p.Bio, &photos, &languages, &areas, &p.Status, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(photos, &p.Photos)
		_ = json.Unmarshal(languages, &p.Languages)
		_ = json.Unmarshal(areas, &p.ServiceAreas)
		result = append(result, p)
	}
	return result, rows.Err()
}

func (r *SupplyRepository) ServicesSnapshot(ctx context.Context) ([]supply.AgentService, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT agent_id, service_type, status, reference_price, currency, markets, updated_at
		FROM supply.agent_services ORDER BY agent_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []supply.AgentService{}
	for rows.Next() {
		var s supply.AgentService
		var markets []byte
		if err := rows.Scan(&s.AgentID, &s.ServiceType, &s.Status, &s.ReferencePrice, &s.Currency, &markets, &s.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(markets, &s.Markets)
		result = append(result, s)
	}
	return result, rows.Err()
}

func (r *SupplyRepository) WindowsSnapshot(ctx context.Context) ([]supply.AvailabilityWindow, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, agent_id, start_at, end_at, market_id, status, order_id, created_at, updated_at
		FROM supply.availability_windows ORDER BY start_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []supply.AvailabilityWindow{}
	for rows.Next() {
		var w supply.AvailabilityWindow
		var orderID *string
		if err := rows.Scan(&w.ID, &w.AgentID, &w.StartAt, &w.EndAt, &w.MarketID, &w.Status, &orderID, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, err
		}
		if orderID != nil {
			w.OrderID = *orderID
		}
		result = append(result, w)
	}
	return result, rows.Err()
}

func (r *SupplyRepository) BatchesSnapshot(ctx context.Context) ([]supply.CandidateBatch, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, need_id, market_id, created_at, candidates, shortage, shortage_note
		FROM supply.candidate_batches ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []supply.CandidateBatch{}
	for rows.Next() {
		var b supply.CandidateBatch
		var candidates []byte
		if err := rows.Scan(&b.ID, &b.NeedID, &b.MarketID, &b.CreatedAt, &candidates, &b.Shortage, &b.ShortageNote); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(candidates, &b.Candidates)
		result = append(result, b)
	}
	return result, rows.Err()
}

var _ supply.Repository = (*SupplyRepository)(nil)
