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
	// 前置条件自建，不吃 dev seed。以前这条测试拿 user_devseed_01 当店主、
	// 断言他「有脸」—— 集成测试的临时库不跑 dev seed，前置条件不成立，
	// 于是这条专门钉「店卡不能画店主的脸」的回归测试长期红着，而红的原因跟
	// 被测行为（MERCHANT-AVATAR-001）毫无关系。改成 run-scoped 自建，
	// cleanup 只删本次造的那几行，不碰别人的数据。
	ownerID := fmt.Sprintf("user_avatarprobe_%d", run)
	ownerAvatar := fmt.Sprintf("assets/avatar_probe_portrait_%d", run)
	bizID := fmt.Sprintf("biz_avatar_probe_%d", run)

	if _, err := pool.Exec(ctx, `INSERT INTO identity.user_accounts (id, status, created_at, updated_at)
		VALUES ($1, 'REGISTERED', now(), now())
		ON CONFLICT (id) DO NOTHING`, ownerID); err != nil {
		t.Fatalf("seed owner account: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO identity.profiles (user_account_id, name, handle, bio, city, avatar_path, version, updated_at)
		VALUES ($1, '店主', $2, '', 'Hanoi', $3, 1, now())
		ON CONFLICT (user_account_id) DO UPDATE SET avatar_path=EXCLUDED.avatar_path`,
		ownerID, fmt.Sprintf("avatarprobe_%d", run), ownerAvatar); err != nil {
		t.Fatalf("seed owner profile: %v", err)
	}
	// 店主本人有脸（现实：店主一定有脸）。不断言路径长什么样，只要求它
	// **不出现在 business account 上**。
	var gotAvatar string
	if err := pool.QueryRow(ctx, `SELECT avatar_path FROM identity.profiles WHERE user_account_id=$1`, ownerID).Scan(&gotAvatar); err != nil {
		t.Fatalf("precondition: owner profile must exist: %v", err)
	}
	if gotAvatar == "" {
		t.Fatal("precondition: owner must have a personal avatar")
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM business.memberships WHERE business_id=$1`, bizID)
		pool.Exec(ctx, `DELETE FROM business.accounts WHERE id=$1`, bizID)
		pool.Exec(ctx, `DELETE FROM identity.profiles WHERE user_account_id=$1`, ownerID)
		pool.Exec(ctx, `DELETE FROM identity.user_accounts WHERE id=$1`, ownerID)
	})

	_, err := pool.Exec(ctx, `INSERT INTO business.accounts (id, owner_user_id, name, status, created_at)
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
	// 按 id 找这条新造的店（店主名下可能有别的店，不影响这条断言）。
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
