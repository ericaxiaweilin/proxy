package postgres

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// COMP-SELLER-001 的生产实现：实名状态来自 supply.seller_real_name_verifications
// （migrations/084），不是来自 agent 自填的资料，也不是来自能力验证。
//
// 只认 status='VERIFIED' 且未过期的行：核验是有时效的，过期必须重核；
// PENDING / REJECTED / EXPIRED 一律不算。
type SellerRealNameRepository struct {
	pool *pgxpool.Pool
}

// ErrSellerRealNameUnavailable：仓库存在但没有连接池。返回错误 = 判定失败 =
// supply 侧 fail-closed（见 supply.SellerRealNameVerified）。
var ErrSellerRealNameUnavailable = errors.New("seller real-name verification store is unavailable")

func NewSellerRealNameRepository(pool *pgxpool.Pool) *SellerRealNameRepository {
	return &SellerRealNameRepository{pool: pool}
}

const sellerRealNameVerifiedSQL = `
SELECT EXISTS (
    SELECT 1
    FROM supply.seller_real_name_verifications v
    WHERE v.agent_id = $1
      AND v.status = 'VERIFIED'
      AND (v.expires_at IS NULL OR v.expires_at > NOW())
)`

func (r *SellerRealNameRepository) RealNameVerified(ctx context.Context, agentID string) (bool, error) {
	id := strings.TrimSpace(agentID)
	if id == "" {
		return false, supply.ErrSellerIdentityAgentRequired
	}
	// typed-nil 仍然满足接口；不挡的话调用方拿到的是 panic 而不是拒绝。
	if r == nil || r.pool == nil {
		return false, ErrSellerRealNameUnavailable
	}
	var verified bool
	if err := queryerForContext(ctx, r.pool).QueryRow(ctx, sellerRealNameVerifiedSQL, id).Scan(&verified); err != nil {
		return false, err
	}
	return verified, nil
}

// 契约漂移必须在编译期炸，而不是在运行期静默放行。
var _ supply.SellerIdentityLookup = (*SellerRealNameRepository)(nil)
