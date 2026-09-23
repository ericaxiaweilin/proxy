package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// errRollbackProbe 用来在一个必定回滚的事务里跑探针：探针做完就返回它，
// runInTransaction 会把整个事务回滚掉（含临时的 DDL）。
var errRollbackProbe = errors.New("rollback probe complete")

// COMP-SELLER-001（写侧）的真库往返。
//
// 单测跑的是内存仓库，证明不了「写进去的东西生产读侧读得回来」。这一组用真
// PostgreSQL 钉四件事：
//  1. 走命令写进去的核验，生产读侧（SellerRealNameRepository）真的判为已实名
//     —— 写侧与读侧是同一张表，中间没有第二份状态；
//  2. 证件号明文没有落进任何一列；
//  3. 「重新核」真的能成功（084 的 partial unique index 不会把第二次核验挡掉），
//     且旧记录变成 EXPIRED、同一 agent 只剩一条 VERIFIED；
//  4. 迁移 118 的两条 CHECK 真的在拦：VERIFIED 没有有效期、verified_by 为空
//     都会被 DB 拒绝 —— 这一条同时证明迁移确实跑过了。
func TestSellerRealNameAttestationRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewSupplyRepository(pool)
	lookup := NewSellerRealNameRepository(pool)
	svc := supply.NewWithRepository(repo)

	tag := "srn_rt_" + time.Now().Format("150405.000000000")
	agentID := "agent_" + tag
	const idNumber = "001199012345"
	const operatorID = "ops_seller_rt"

	now := time.Now().UTC()
	if err := repo.CreateProfile(ctx, supply.AgentProfile{
		AgentID: agentID, Name: "Real Name RT", Status: "ACTIVE", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create profile: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM supply.seller_real_name_verifications WHERE agent_id = $1`, agentID)
		pool.Exec(ctx, `DELETE FROM supply.agent_profiles WHERE agent_id = $1`, agentID)
	})

	// 先确认起点是「未实名」—— 否则下面的 true 可能来自别处。
	if verified, err := lookup.RealNameVerified(ctx, agentID); err != nil || verified {
		t.Fatalf("a fresh agent must not be real-name verified, got verified=%v err=%v", verified, err)
	}

	attest := func(payload map[string]any) {
		t.Helper()
		r := svc.Handle(supplyEnvelope("AttestSellerRealName", payload, operatorID))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("attest %v: %s (%+v)", payload["decision"], r.Outcome, r.Error)
		}
	}
	payload := func(decision string) map[string]any {
		return map[string]any{
			"agentId": agentID, "legalName": "Nguyen Thi RoundTrip", "idType": "CCCD",
			"idNumber": idNumber, "taxCode": "0107654321", "decision": decision,
		}
	}

	attest(payload("APPROVE"))

	// (1) 生产读侧必须读得回来。
	verified, err := lookup.RealNameVerified(ctx, agentID)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !verified {
		t.Fatal("a freshly attested seller must read back as real-name verified — otherwise the write path and the read path are not talking about the same record")
	}

	// (2) 明文没有落在任何一列上。
	var (
		gotID, gotAgent, gotAccount, gotLegal, gotIDType, gotHash, gotTax, gotStatus, gotMethod, gotBy string
		gotExpiresAt                                                                                   *time.Time
	)
	if err := pool.QueryRow(ctx, `
		SELECT id, agent_id, COALESCE(user_account_id,''), legal_name, id_type, id_number_hash,
		       COALESCE(tax_code,''), status, method, verified_by, expires_at
		  FROM supply.seller_real_name_verifications
		 WHERE agent_id = $1`, agentID).Scan(
		&gotID, &gotAgent, &gotAccount, &gotLegal, &gotIDType, &gotHash, &gotTax, &gotStatus, &gotMethod, &gotBy, &gotExpiresAt,
	); err != nil {
		t.Fatalf("read stored row: %v", err)
	}
	for column, value := range map[string]string{
		"id": gotID, "agent_id": gotAgent, "user_account_id": gotAccount, "legal_name": gotLegal,
		"id_type": gotIDType, "id_number_hash": gotHash, "tax_code": gotTax, "status": gotStatus,
		"method": gotMethod, "verified_by": gotBy,
	} {
		if strings.Contains(value, idNumber) {
			t.Fatalf("column %s holds the raw id number (%q) — the document number must never be stored in the clear", column, value)
		}
	}
	if want := supply.HashIDNumber(idNumber); gotHash != want {
		t.Fatalf("stored id_number_hash = %q, want %q", gotHash, want)
	}
	// 「具名运营人员」：归属人必须是发起核验的那个 principal，不是占位字符串。
	if gotBy != operatorID {
		t.Fatalf("verified_by = %q, want the attesting operator %q", gotBy, operatorID)
	}
	if gotMethod != supply.SellerRealNameMethodOperatorAttestation {
		t.Fatalf("method = %q, want OPERATOR_ATTESTATION", gotMethod)
	}
	if gotExpiresAt == nil {
		t.Fatal("a VERIFIED row was stored without an expiry")
	}

	// (3) 重新核：第二次必须成功，且只留一条 VERIFIED。
	attest(payload("APPROVE"))
	var verifiedRows int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM supply.seller_real_name_verifications
		 WHERE agent_id = $1 AND status = 'VERIFIED'`, agentID).Scan(&verifiedRows); err != nil {
		t.Fatalf("count verified: %v", err)
	}
	if verifiedRows != 1 {
		t.Fatalf("re-attestation must leave exactly 1 VERIFIED row (084's uq_seller_realname_verified_agent), got %d", verifiedRows)
	}
	var expiredRows int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM supply.seller_real_name_verifications
		 WHERE agent_id = $1 AND status = 'EXPIRED'`, agentID).Scan(&expiredRows); err != nil {
		t.Fatalf("count expired: %v", err)
	}
	if expiredRows != 1 {
		t.Fatalf("the superseded record must be kept as EXPIRED (audit history), got %d", expiredRows)
	}
	if verified, err := lookup.RealNameVerified(ctx, agentID); err != nil || !verified {
		t.Fatalf("after re-attestation the seller must still read back as verified, got verified=%v err=%v", verified, err)
	}

	// (4) 否决必须真的把实名摘掉（读侧不得继续放行）。
	attest(payload("REJECT"))
	if verified, err := lookup.RealNameVerified(ctx, agentID); err != nil || verified {
		t.Fatalf("a REJECT must clear real-name status, got verified=%v err=%v", verified, err)
	}
}

// 读侧必须把「有效期已过」当成「未核验」，而不是当成仍然有效。
//
// 084 的原话是「expires_at 到点即失效，必须重新核。过期 ≠ 已核验」。
//
// 注意这里**测不到**「expires_at IS NULL 也算未核验」那一半：迁移 118 的
// seller_real_name_verified_has_expiry 已经让「VERIFIED 且无有效期」这种行
// 根本写不进去（NOT VALID 只跳过存量行的校验，新写入照拦 —— 见
// TestSellerRealNameMigrationGuardsAreEnforced）。读侧那一半是给存量行留的
// 兜底：118 之前写进去的行不会被追认校验，而 dev 库里恰好有一批这样的测试行。
// 它由钉脚本按 SQL 文本钉住（改掉就红），并在真库上人工复核过。
func TestSellerRealNameReadRefusesPastExpiry(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lookup := NewSellerRealNameRepository(pool)

	tag := "srn_exp_" + time.Now().Format("150405.000000000")
	pastAgent := "agent_" + tag + "_past"
	now := time.Now().UTC()
	past := now.Add(-24 * time.Hour)
	if _, err := pool.Exec(ctx, `
		INSERT INTO supply.seller_real_name_verifications
		    (id, agent_id, legal_name, id_type, id_number_hash, status, method, verified_by, verified_at, expires_at, created_at, updated_at)
		VALUES ($1,$2,'Expired Row','CCCD',$3,'VERIFIED','OPERATOR_ATTESTATION','ops_legacy',$4,$5,$4,$4)`,
		tag+"_past", pastAgent, supply.HashIDNumber("past"), past, past); err != nil {
		t.Fatalf("insert expired row: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM supply.seller_real_name_verifications WHERE agent_id = $1`, pastAgent)
	})
	if verified, err := lookup.RealNameVerified(ctx, pastAgent); err != nil {
		t.Fatalf("read back expired: %v", err)
	} else if verified {
		t.Fatal("an expired verification must not count as verified — '过期 ≠ 已核验' is the whole point of expires_at")
	}

	// 非 VERIFIED 状态（REJECTED）同样不算 —— 否决过的卖家不能因为「有一行记录」
	// 就被当成已核验。
	rejectedAgent := "agent_" + tag + "_rejected"
	if _, err := pool.Exec(ctx, `
		INSERT INTO supply.seller_real_name_verifications
		    (id, agent_id, legal_name, id_type, id_number_hash, status, method, verified_by, verified_at, expires_at, created_at, updated_at)
		VALUES ($1,$2,'Rejected Row','CCCD',$3,'REJECTED','OPERATOR_ATTESTATION','ops_legacy',$4,NULL,$4,$4)`,
		tag+"_rejected", rejectedAgent, supply.HashIDNumber("rejected"), now); err != nil {
		t.Fatalf("insert rejected row: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM supply.seller_real_name_verifications WHERE agent_id = $1`, rejectedAgent)
	})
	if verified, err := lookup.RealNameVerified(ctx, rejectedAgent); err != nil {
		t.Fatalf("read back rejected: %v", err)
	} else if verified {
		t.Fatal("a REJECTED row must not count as verified")
	}
}

// 读侧必须把「没有有效期」当成「未核验」。
//
// 迁移 118 之后这种行已经写不进库了（NOT VALID 只跳过存量行，新写入照拦），
// 所以这里在一个**必定回滚的事务**里临时摘掉约束，构造出 118 之前的存量形状：
// Postgres 的 DDL 是事务性的，回滚后约束与数据都原样复原。
//
// 这条针对的是 dev 库里真实存在的那批 118 之前的行 —— NOT VALID 不会追认校验
// 它们，读侧这一半是它们唯一的兜底。少了它，「漏填一次有效期」就仍可能等于
// 「永久放行」，而 084 承诺的恰恰是「到点即失效，必须重新核」。
func TestSellerRealNameReadRefusesMissingExpiry(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lookup := NewSellerRealNameRepository(pool)

	tag := "srn_nullexp_" + time.Now().Format("150405.000000000")
	agentID := "agent_" + tag
	now := time.Now().UTC()

	err := runInTransaction(ctx, pool, func(txCtx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(txCtx, `ALTER TABLE supply.seller_real_name_verifications DROP CONSTRAINT seller_real_name_verified_has_expiry`); err != nil {
			return err
		}
		if _, err := tx.Exec(txCtx, `
			INSERT INTO supply.seller_real_name_verifications
			    (id, agent_id, legal_name, id_type, id_number_hash, status, method, verified_by, verified_at, expires_at, created_at, updated_at)
			VALUES ($1,$2,'Legacy No Expiry','CCCD',$3,'VERIFIED','OPERATOR_ATTESTATION','ops_legacy',$4,NULL,$4,$4)`,
			tag, agentID, supply.HashIDNumber("nullexp"), now); err != nil {
			return err
		}
		verified, err := lookup.RealNameVerified(txCtx, agentID)
		if err != nil {
			return err
		}
		if verified {
			t.Error("a VERIFIED row with a NULL expiry must NOT count as verified — a missing value must never read as 'never expires'")
		}
		return errRollbackProbe
	})
	if !errors.Is(err, errRollbackProbe) {
		t.Fatalf("the probe transaction did not roll back as expected: %v", err)
	}
}

// 迁移 118 的两条 CHECK 必须真的在拦 —— 这是「守卫必须见过它失败」的那一步。
func TestSellerRealNameMigrationGuardsAreEnforced(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	tag := "srn_guard_" + time.Now().Format("150405.000000000")
	agentID := "agent_" + tag
	now := time.Now().UTC()
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM supply.seller_real_name_verifications WHERE agent_id = $1`, agentID)
	})

	// VERIFIED 且 expires_at 为空 → 必须被 seller_real_name_verified_has_expiry 拒。
	_, err := pool.Exec(ctx, `
		INSERT INTO supply.seller_real_name_verifications
		    (id, agent_id, legal_name, id_type, id_number_hash, status, method, verified_by, verified_at, expires_at, created_at, updated_at)
		VALUES ($1,$2,'No Expiry','CCCD',$3,'VERIFIED','OPERATOR_ATTESTATION','ops_guard',$4,NULL,$4,$4)`,
		tag+"_1", agentID, supply.HashIDNumber("a"), now)
	if err == nil {
		t.Fatal("the DB accepted a VERIFIED row with no expiry — migration 118's seller_real_name_verified_has_expiry is not enforced")
	}
	if !strings.Contains(err.Error(), "seller_real_name_verified_has_expiry") {
		t.Fatalf("expected the expiry constraint to reject the row, got: %v", err)
	}

	// verified_by 为空 → 必须被 seller_real_name_attestor_named 拒。
	_, err = pool.Exec(ctx, `
		INSERT INTO supply.seller_real_name_verifications
		    (id, agent_id, legal_name, id_type, id_number_hash, status, method, verified_by, verified_at, expires_at, created_at, updated_at)
		VALUES ($1,$2,'Nameless','CCCD',$3,'VERIFIED','OPERATOR_ATTESTATION','',$4,$5,$4,$4)`,
		tag+"_2", agentID, supply.HashIDNumber("b"), now, now.AddDate(1, 0, 0))
	if err == nil {
		t.Fatal("the DB accepted a row with a blank verified_by — migration 118's seller_real_name_attestor_named is not enforced")
	}
	if !strings.Contains(err.Error(), "seller_real_name_attestor_named") {
		t.Fatalf("expected the named-attestor constraint to reject the row, got: %v", err)
	}
}
