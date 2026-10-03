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
	photos, languages, areas, socials, err := encodeProfileJSON(p)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.agent_profiles (agent_id, name, bio, photos, languages, service_areas, status, created_at, updated_at, socials)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		p.AgentID, p.Name, p.Bio, photos, languages, areas, p.Status, p.CreatedAt, p.UpdatedAt, socials,
	)
	return err
}

func (r *SupplyRepository) GetProfile(ctx context.Context, agentID string) (supply.AgentProfile, error) {
	var p supply.AgentProfile
	var photos, languages, areas, socials []byte
	// CREATOR-HOME-001：user_account_id 一起读出来（agent→user 链路，给公开主页用）。
	// 为空就是没关联，不编一个。
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT agent_id, name, bio, photos, languages, service_areas, status, created_at, updated_at, COALESCE(socials, '[]'), COALESCE(user_account_id, '')
		FROM supply.agent_profiles WHERE agent_id = $1`, agentID).Scan(
		&p.AgentID, &p.Name, &p.Bio, &photos, &languages, &areas, &p.Status, &p.CreatedAt, &p.UpdatedAt, &socials, &p.UserAccountID,
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
	_ = json.Unmarshal(socials, &p.Socials)
	if p.Socials == nil {
		p.Socials = []supply.AgentSocial{}
	}
	return p, nil
}

func (r *SupplyRepository) UpdateProfile(ctx context.Context, p supply.AgentProfile) error {
	photos, languages, areas, socials, err := encodeProfileJSON(p)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE supply.agent_profiles
		SET name=$1, bio=$2, photos=$3, languages=$4, service_areas=$5, status=$6, updated_at=$7, socials=$8
		WHERE agent_id=$9`,
		p.Name, p.Bio, photos, languages, areas, p.Status, p.UpdatedAt, socials, p.AgentID,
	)
	return err
}

func encodeProfileJSON(p supply.AgentProfile) ([]byte, []byte, []byte, []byte, error) {
	photos, err := json.Marshal(p.Photos)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("encode photos: %w", err)
	}
	languages, err := json.Marshal(p.Languages)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("encode languages: %w", err)
	}
	areas, err := json.Marshal(p.ServiceAreas)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("encode service areas: %w", err)
	}
	socials, err := json.Marshal(p.Socials)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("encode socials: %w", err)
	}
	return nonNullJSONArray(photos), nonNullJSONArray(languages),
		nonNullJSONArray(areas), nonNullJSONArray(socials), nil
}

// PROFILE-JSONB-EMPTY-ARRAY-NULL-001：json.Marshal 对 **nil 切片**产出 "null"，
// 写进 JSONB 就是 jsonb_typeof='null' —— 而 157 的 agent_profiles_socials_ck 只认
// 'array'，于是「一个还没关联任何社媒的普通新建 Creator」直接插不进去（集成测试
// TestSellerRealNameAttestationRoundTrip 实测 SQLSTATE 23514）。读侧早就用
// COALESCE(socials,'[]') 兜了，写侧没有 —— 空集合在协议里是 [] 而不是 null 是仓库
// 的数据不变量，四个数组列一起兜，不让下一个加 CHECK 的人再踩一遍。
func nonNullJSONArray(encoded []byte) []byte {
	if len(encoded) == 0 || string(encoded) == "null" {
		return []byte("[]")
	}
	return encoded
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

// ---------- SellerRealName (COMP-SELLER-001 写侧) ----------

// ErrSupplyStoreUnavailable：仓库没有连接池。与 seller_identity.go 的
// ErrSellerRealNameUnavailable 同一理由 —— typed-nil 仍满足接口，不挡的话
// 调用方拿到的是 panic，而不是一次可判定的拒绝。
var ErrSupplyStoreUnavailable = errors.New("supply store is unavailable")

// expirePriorSellerRealNameSQL 把该 agent 上原有的 VERIFIED 记录置为 EXPIRED。
//
// 084 的 uq_seller_realname_verified_agent 是 partial unique index
// (agent_id) WHERE status='VERIFIED'：不先清掉旧的那条，第二次核验必然撞索引
// —— 而 084 承诺的「必须重新核」正好要求第二次能成功。
const expirePriorSellerRealNameSQL = `
UPDATE supply.seller_real_name_verifications
   SET status = 'EXPIRED', updated_at = $2
 WHERE agent_id = $1 AND status = 'VERIFIED'`

// NULLIF($3,'') / NULLIF($7,'')：user_account_id 与 tax_code 在 084 里可空，
// 语义是「尚未取得 / 未绑定」。空串不是「有值」—— tax_code='' 会让读的人
// 以为税务身份已绑定，而结算恰恰按这一列判定。
const insertSellerRealNameSQL = `
INSERT INTO supply.seller_real_name_verifications
    (id, agent_id, user_account_id, legal_name, id_type, id_number_hash, tax_code,
     status, method, verified_by, verified_at, expires_at, created_at, updated_at)
VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,NULLIF($7,''),$8,$9,$10,$11,$12,$13,$14)`

// AttestSellerRealName 在一个事务里「先作废旧核验、再写新核验」。
//
// 两步必须原子：只 UPDATE 不 INSERT = 卖家被摘掉实名；只 INSERT 不 UPDATE =
// 撞唯一索引。任一步失败整体回滚，不留半条状态（这正是「重新核」的语义：
// 新结论生效的那一刻，旧结论同时失效）。
//
// 入库前先过 SellerRealNameAttestationComplete —— 与内存实现同一条规则，
// 也让「VERIFIED 必须有有效期」在到达 DB CHECK 之前就变成一次可读的拒绝。
func (r *SupplyRepository) AttestSellerRealName(ctx context.Context, v supply.SellerRealNameVerification) error {
	if r == nil || r.pool == nil {
		return ErrSupplyStoreUnavailable
	}
	if err := supply.SellerRealNameAttestationComplete(v); err != nil {
		return err
	}
	return runInTransaction(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, expirePriorSellerRealNameSQL, v.AgentID, v.UpdatedAt); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, insertSellerRealNameSQL,
			v.ID, v.AgentID, v.UserAccountID, v.LegalName, v.IDType, v.IDNumberHash, v.TaxCode,
			v.Status, v.Method, v.VerifiedBy, v.VerifiedAt, v.ExpiresAt, v.CreatedAt, v.UpdatedAt)
		return err
	})
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
			INSERT INTO supply.candidate_batches (id, need_id, market_id, owner_principal_id, created_at, candidates, shortage, shortage_note)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			b.ID, b.NeedID, b.MarketID, b.OwnerPrincipalID, b.CreatedAt, candidates, b.Shortage, b.ShortageNote,
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
