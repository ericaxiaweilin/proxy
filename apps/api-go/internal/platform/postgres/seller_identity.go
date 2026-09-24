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
// 只认 status='VERIFIED' 且有效期**未过**的行：核验是有时效的，过期必须重核；
// PENDING / REJECTED / EXPIRED 一律不算。
//
// 这里刻意不写「把空有效期也当成通过」的那种写法（`IS NULL` 与 `OR` 连用）。
// 084 的原话是「expires_at 到点即失效，必须重新核。过期 ≠ 已核验」—— 一旦把
// 空值放行，漏填一次有效期就等于永久放行，而漏填恰恰是最省事的写法。
// `v.expires_at > NOW()` 对 NULL 求值为 NULL（不为真），所以「没有有效期」自然
// 等于「未核验」，不需要额外一行。写侧（AttestSellerRealName + 迁移 118）也保证
// VERIFIED 必有有效期；两侧都要求，才没有中间态。
//
// 注意：本注释刻意不出现那段被禁止的谓词原文 —— 钉脚本按文本反向 grep 它，
// 写在这里会把自己钉红（本次已经踩过一次）。
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
      AND v.expires_at > NOW()
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

// TWIN-INSIGHT-ENTITLEMENT-001：按用户账号查实名 —— 洞察工具的使用权发给
// "已实名绑定的创作者本人"（account id），而核验行挂在 agent_id 下。
// 经 supply.agent_profiles 的 user_account_id 映射过去，不直接读核验行的
// user_account_id 列（那列 operator 手写行时经常空着，读它等于"有行也认
// 不出来"，fail-closed 会变成 fail-always）。
const sellerRealNameVerifiedForAccountSQL = `
SELECT EXISTS (
    SELECT 1
    FROM supply.seller_real_name_verifications v
    JOIN supply.agent_profiles a ON a.agent_id = v.agent_id
    WHERE a.user_account_id = $1
      AND v.status = 'VERIFIED'
      AND v.expires_at > NOW()
)`

func (r *SellerRealNameRepository) RealNameVerifiedForAccount(ctx context.Context, accountID string) (bool, error) {
	id := strings.TrimSpace(accountID)
	if id == "" {
		return false, supply.ErrSellerIdentityAgentRequired
	}
	if r == nil || r.pool == nil {
		return false, ErrSellerRealNameUnavailable
	}
	var verified bool
	if err := queryerForContext(ctx, r.pool).QueryRow(ctx, sellerRealNameVerifiedForAccountSQL, id).Scan(&verified); err != nil {
		return false, err
	}
	return verified, nil
}

// 契约漂移必须在编译期炸，而不是在运行期静默放行。
var _ supply.SellerIdentityLookup = (*SellerRealNameRepository)(nil)
