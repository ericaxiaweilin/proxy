package main

// 供给种子数据。

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/platform/postgres"
	"github.com/proxy-app/proxy-api/internal/supply"
	"strings"
	"time"
)

func seedPostgresSupply(pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	now := time.Now().UTC()
	// Agent Profile
	profiles := merchantCreatorSeedProfiles()
	for _, p := range profiles {
		photos, _ := json.Marshal([]string{creatorAvatarPath(p.agentID)})
		languages, _ := json.Marshal(p.languages)
		areas, _ := json.Marshal(p.areas)
		if _, err := pool.Exec(ctx, `
			INSERT INTO supply.agent_profiles (agent_id, name, bio, photos, languages, service_areas, status, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$7)
			ON CONFLICT (agent_id) DO UPDATE SET name=EXCLUDED.name, bio=EXCLUDED.bio,
				photos=EXCLUDED.photos, languages=EXCLUDED.languages, service_areas=EXCLUDED.service_areas, status='ACTIVE', updated_at=EXCLUDED.updated_at`,
			p.agentID, p.name, p.bio, photos, languages, areas, now); err != nil {
			return err
		}
		// IDENTITY-ID-001: mock Creator 同样必须是「有系统 id 的账号」，不能只有手写
		// agent_id + 显示名 —— 否则同一显示名在不同页面各持一份头像，无法判断是否同一个人。
		// 账号 id 由 agent_id（固定 facet 键）确定性派生，与可编辑的显示名无关，保证幂等；
		// 名字改了不影响身份，同名也不会互相串头像。
		accountID := creatorAccountID(p.agentID)
		if _, err := pool.Exec(ctx, `
			INSERT INTO identity.user_accounts (id, status, created_at, updated_at)
			VALUES ($1,'REGISTERED',$2,$2)
			ON CONFLICT (id) DO NOTHING`, accountID, now); err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO identity.profiles (user_account_id, name, handle, bio, city, avatar_path, version, updated_at)
			VALUES ($1,$2,$3,$4,$5,'',1,$6)
			ON CONFLICT (user_account_id) DO UPDATE SET name=EXCLUDED.name, bio=EXCLUDED.bio,
				city=EXCLUDED.city, updated_at=EXCLUDED.updated_at`,
			accountID, p.name, "creator_"+strings.TrimPrefix(p.agentID, "agent_"), p.bio, creatorCity(p.areas), now); err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, `UPDATE supply.agent_profiles SET user_account_id=$1 WHERE agent_id=$2`, accountID, p.agentID); err != nil {
			return err
		}
	}
	// Agent Service（CITY_COMPANION）
	services := []struct {
		agentID string
		price   int64
		markets []string
	}{
		{"agent_linh", 1200000, []string{"hn"}},
		{"agent_mai", 1000000, []string{"hn"}},
		{"agent_an", 900000, []string{"hn"}},
		{"agent_thao", 1300000, []string{"hn"}},
		{"agent_yen", 1050000, []string{"hn"}},
		{"agent_minh", 1100000, []string{"hcm"}},
	}
	for _, svc := range services {
		markets, _ := json.Marshal(svc.markets)
		if _, err := pool.Exec(ctx, `
			INSERT INTO supply.agent_services (agent_id, service_type, status, reference_price, currency, markets, updated_at)
			VALUES ($1,'CITY_COMPANION','ACTIVE',$2,'VND',$3,$4)
			ON CONFLICT (agent_id, service_type) DO UPDATE SET status='ACTIVE',
				reference_price=EXCLUDED.reference_price, markets=EXCLUDED.markets, updated_at=EXCLUDED.updated_at`,
			svc.agentID, svc.price, markets, now); err != nil {
			return err
		}
	}
	// Capability（declared + verified 分开）
	caps := []struct {
		agentID, capability string
		verified            bool
	}{
		{"agent_linh", "ZH", true}, {"agent_linh", "VI", true}, {"agent_linh", "PHOTOGRAPHY", true},
		{"agent_mai", "VI", true}, {"agent_mai", "ZH", false},
		{"agent_an", "VI", true}, {"agent_an", "ZH", true},
		{"agent_thao", "VI", true}, {"agent_thao", "ZH", true},
		{"agent_yen", "VI", true}, {"agent_yen", "ZH", true},
		{"agent_minh", "ZH", true},
	}
	for _, c := range caps {
		if _, err := pool.Exec(ctx, `
			INSERT INTO supply.capabilities (agent_id, capability, declared, verified, updated_at)
			VALUES ($1,$2,TRUE,$3,$4)
			ON CONFLICT (agent_id, capability) DO UPDATE SET declared=TRUE, verified=EXCLUDED.verified, updated_at=EXCLUDED.updated_at`,
			c.agentID, c.capability, c.verified, now); err != nil {
			return err
		}
	}
	// CapabilityVerification 记录
	verifications := []struct {
		id, agentID, capability string
	}{
		{"cv_linh_zh", "agent_linh", "ZH"}, {"cv_linh_vi", "agent_linh", "VI"}, {"cv_linh_photo", "agent_linh", "PHOTOGRAPHY"},
		{"cv_mai_vi", "agent_mai", "VI"},
		{"cv_an_vi", "agent_an", "VI"}, {"cv_an_zh", "agent_an", "ZH"},
		{"cv_thao_vi", "agent_thao", "VI"}, {"cv_thao_zh", "agent_thao", "ZH"},
		{"cv_yen_vi", "agent_yen", "VI"}, {"cv_yen_zh", "agent_yen", "ZH"},
		{"cv_minh_zh", "agent_minh", "ZH"},
	}
	for _, v := range verifications {
		if _, err := pool.Exec(ctx, `
			INSERT INTO supply.capability_verifications (id, agent_id, capability, status, method, verified_by, verified_at, expires_at, created_at)
			VALUES ($1,$2,$3,'VERIFIED','INTERVIEW','ops_001',$4,$5,$4)
			ON CONFLICT (id) DO UPDATE SET status='VERIFIED'`,
			v.id, v.agentID, v.capability, now, now.AddDate(1, 0, 0)); err != nil {
			return err
		}
	}
	// COMP-SELLER-001：供给侧实名的种子。
	//
	// 这里刻意走**真实的写入口**，而不是再写一段手写 INSERT。之前那批
	// test-rn-* 行就是手写 SQL 造的：legal_name='TEST-ONLY *'、
	// id_number_hash 是字面量而不是哈希、verified_by 是一个会话标签而不是
	// 运营 principal、expires_at 为空 —— 而读侧当时把空有效期读成「永不过期」，
	// 于是 6 个卖家在没人核过的情况下一直显示为「已实名」。种子数据不该能造出
	// 这种形状：走写入口就自动拿到「具名运营 + 真哈希 + 必有有效期」三件事，
	// 与生产形态不可能漂移。
	//
	// 幂等：已经有一条「VERIFIED 且未过期」的记录就跳过。所以第一次启动会把
	// 旧的 test-rn-* 行置为 EXPIRED（写入口的作废语义）并写下 srn_* 行，
	// 之后每次启动都是 no-op —— 不会重复插入，也不会撞 084 的 partial unique
	// index（同一 agent 只允许一条 VERIFIED）。
	sellerLookup := postgres.NewSellerRealNameRepository(pool)
	supplyRepo := postgres.NewSupplyRepository(pool)
	for _, p := range profiles {
		alreadyVerified, err := sellerLookup.RealNameVerified(ctx, p.agentID)
		if err != nil {
			return err
		}
		if alreadyVerified {
			continue
		}
		expiresAt := now.AddDate(0, supply.SellerRealNameAttestationValidityMonths, 0)
		if err := supplyRepo.AttestSellerRealName(ctx, supply.SellerRealNameVerification{
			ID: "srn_" + p.agentID, AgentID: p.agentID,
			// 明确标注是种子数据：这条记录不该被误读成真实核验证据。
			LegalName: "DEV SEED " + p.name, IDType: "CCCD",
			IDNumberHash: supply.HashIDNumber("dev-seed-" + p.agentID),
			Status:       supply.SellerRealNameStatusVerified,
			Method:       supply.SellerRealNameMethodOperatorAttestation,
			VerifiedBy:   "ops_001", VerifiedAt: now, ExpiresAt: &expiresAt,
			CreatedAt: now, UpdatedAt: now,
		}); err != nil {
			return err
		}
	}
	// AvailabilityWindow is a rolling projection refreshed at every boot. A
	// fixed one-day seed becomes permanently stale after its first launch.
	windowStart, windowEnd := merchantCreatorAvailability(now)
	agents := []string{"agent_linh", "agent_mai", "agent_an", "agent_thao", "agent_yen", "agent_minh"}
	for _, agentID := range agents {
		marketID := "hn"
		if agentID == "agent_minh" {
			marketID = "hcm"
		}
		if _, err := pool.Exec(ctx, `
				INSERT INTO supply.availability_windows (id, agent_id, start_at, end_at, market_id, status, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,'AVAILABLE',$6,$6)
				ON CONFLICT (id) DO UPDATE SET start_at=EXCLUDED.start_at, end_at=EXCLUDED.end_at,
					market_id=EXCLUDED.market_id, status='AVAILABLE', updated_at=EXCLUDED.updated_at`,
			"aw_"+agentID, agentID, windowStart, windowEnd, marketID, now); err != nil {
			return err
		}
	}
	return nil
}
