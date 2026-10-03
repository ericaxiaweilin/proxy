package postgres

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// MERCHANT-AVATAR-001（2026-10-02，用户 P0「企业店铺的头像用了用户侧的头像」）：
//
// ListAccountsForUser 以前 LEFT JOIN identity.profiles，把店主**个人**头像填进
// Account.AvatarPath —— 于是企业/店铺身份卡上显示的是店主的脸。
// 店主的脸不是店的脸：business.accounts 本来就没有 avatar 列。
//
// 这条用真库验：给 owner 建一个**有头像**的 profile，再读他的 business account ——
// 回来的 AvatarPath 必须是空的。空了客户端才走店名首字 fallback，而不是画一张
// 属于用户的脸。
func TestListAccountsForUserDoesNotReturnOwnerAvatar(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewBusinessRepository(pool)

	run := time.Now().UnixNano()
	ownerID := "user_devseed_01"
	bizID := fmt.Sprintf("biz_avatar_probe_%d", run)

	// owner 本人有头像（user_devseed_01 的 profile.avatar_path 非空 —— 现实：
	// 店主一定有脸）。不断言它是什么，只要求它**不出现在 business account 上**。
	var ownerAvatar string
	err := pool.QueryRow(ctx, `SELECT avatar_path FROM identity.profiles WHERE user_account_id=$1`, ownerID).Scan(&ownerAvatar)
	if err != nil || ownerAvatar == "" {
		t.Fatalf("precondition: owner must have a personal avatar, got %q / %v", ownerAvatar, err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM business.memberships WHERE business_id=$1`, bizID)
		pool.Exec(ctx, `DELETE FROM business.accounts WHERE id=$1`, bizID)
	})

	_, err = pool.Exec(ctx, `INSERT INTO business.accounts (id, owner_user_id, name, status, created_at)
		VALUES ($1, $2, '测试店', 'ACTIVE', now())
		ON CONFLICT (id) DO NOTHING`, bizID, ownerID)
	if err != nil {
		t.Fatalf("seed business account: %v", err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO business.memberships (business_id, user_id, role, status, created_at)
		VALUES ($1, $2, 'OWNER', 'ACTIVE', now())
		ON CONFLICT (business_id, user_id) DO NOTHING`, bizID, ownerID)
	if err != nil {
		t.Fatalf("seed membership: %v", err)
	}

	accounts, err := repo.ListAccountsForUser(ctx, ownerID)
	if err != nil {
		t.Fatalf("ListAccountsForUser: %v", err)
	}
	// owner 名下不止一家店（devseed 本来就有），按 id 找这条新的。
	var found *struct{ AvatarPath string }
	for i := range accounts {
		if accounts[i].ID == bizID {
			found = &struct{ AvatarPath string }{accounts[i].AvatarPath}
			break
		}
	}
	if found == nil {
		t.Fatalf("new business account %s not in ListAccountsForUser result", bizID)
	}
	if found.AvatarPath != "" {
		t.Fatalf("business account must not carry the owner's personal avatar, got %q — "+
			"the store card would show the owner's face", found.AvatarPath)
	}
}

var _ = pgxpool.Pool{}
