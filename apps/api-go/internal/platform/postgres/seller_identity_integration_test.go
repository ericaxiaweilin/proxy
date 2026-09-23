package postgres

import (
	"context"
	"testing"
	"time"
)

// TWIN-INSIGHT-ENTITLEMENT-001 — RealNameVerifiedForAccount 的 PG 回路。
//
// 洞察工具的使用权发给"已实名绑定的创作者本人"（account id），而核验行挂在
// agent_id 下 —— 经 supply.agent_profiles 的 user_account_id 映射过去。
// 这里钉三件事：映射对得上才放行；过期/PENDING/无行一律不算；空账号与
// 坏池直接报错（调用方翻成拒绝，不是"查不到就当有"）。
func TestSellerRealNameVerifiedForAccount(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewSellerRealNameRepository(pool)
	run := time.Now().UnixNano()

	// 每个 case 独立 agent：VERIFIED 行有 agent 粒度的部分唯一键，
	// 同一个 agent 挂两行 VERIFIED（即使一行过期）会撞键 —— 用例之间
	// 必须隔离，这也是生产约束的真实形状。
	setup := func(tag, verifyStatus string, expiresAt any) string {
		t.Helper()
		agent := "agent_ent_" + tag + "_" + itoa(run)
		account := "user_ent_" + tag + "_" + itoa(run)
		if _, err := pool.Exec(ctx, `INSERT INTO supply.agent_profiles (agent_id, name, user_account_id, created_at, updated_at)
			VALUES ($1,'Ent',$2,NOW(),NOW())`, agent, account); err != nil {
			t.Fatalf("insert agent profile: %v", err)
		}
		if verifyStatus != "" {
			if _, err := pool.Exec(ctx, `INSERT INTO supply.seller_real_name_verifications
				(id, agent_id, legal_name, id_type, id_number_hash, status, method, verified_by, expires_at, created_at, updated_at)
				VALUES ($1,$2,'Legal','CCCD','hash',$3,'OPERATOR_ATTESTATION','ops_001',$4,NOW(),NOW())`,
				"vid_ent_"+tag+"_"+itoa(run), agent, verifyStatus, expiresAt); err != nil {
				t.Fatalf("insert verification: %v", err)
			}
		}
		t.Cleanup(func() {
			pool.Exec(ctx, `DELETE FROM supply.seller_real_name_verifications WHERE agent_id=$1`, agent)
			pool.Exec(ctx, `DELETE FROM supply.agent_profiles WHERE agent_id=$1`, agent)
		})
		return account
	}

	// 无行 = 未发放。
	if ok, err := repo.RealNameVerifiedForAccount(ctx, setup("none", "", nil)); err != nil || ok {
		t.Fatalf("no rows must mean false, got ok=%v err=%v", ok, err)
	}
	// PENDING 不算发放。
	if ok, err := repo.RealNameVerifiedForAccount(ctx, setup("pend", "PENDING", nil)); err != nil || ok {
		t.Fatalf("PENDING must mean false, got ok=%v err=%v", ok, err)
	}
	// 过期的 VERIFIED 不算发放。
	if ok, err := repo.RealNameVerifiedForAccount(ctx, setup("exp", "VERIFIED", time.Now().Add(-time.Hour))); err != nil || ok {
		t.Fatalf("expired VERIFIED must mean false, got ok=%v err=%v", ok, err)
	}
	// 未过期的 VERIFIED = 已发放（必须带有效期：118 约束禁止无到期 VERIFIED，
	// 空值不再读成"永不过期"）。
	if ok, err := repo.RealNameVerifiedForAccount(ctx, setup("ok", "VERIFIED", time.Now().Add(24*time.Hour))); err != nil || !ok {
		t.Fatalf("unexpired VERIFIED must mean true, got ok=%v err=%v", ok, err)
	}
	// 陌生账号没有映射 = 未发放（不是报错）。
	if ok, err := repo.RealNameVerifiedForAccount(ctx, "user_ent_nobody_"+itoa(run)); err != nil || ok {
		t.Fatalf("unknown account must mean false, got ok=%v err=%v", ok, err)
	}
	// 空账号与坏池直接报错 —— 调用方翻成拒绝。
	if _, err := repo.RealNameVerifiedForAccount(ctx, "  "); err == nil {
		t.Fatal("empty account must error")
	}
	var nilRepo *SellerRealNameRepository
	if _, err := nilRepo.RealNameVerifiedForAccount(ctx, "user_ent_x"); err == nil {
		t.Fatal("nil pool must error (fail-closed)")
	}
}
