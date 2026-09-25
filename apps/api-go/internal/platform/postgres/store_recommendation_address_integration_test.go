package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/storeonboarding"
)

// STORE-REC-ADDRESS-001：地址与落点必须真的落到迁移 130 那三列上。
//
// 为什么不能只靠 memory 仓储的单测：内存实现根本不碰 SQL —— 列名写错、
// 参数顺序错位、坐标忘了扫进 sql.NullFloat64，内存测试**全绿**，而线上
// 要么 500、要么把每条推荐都读成「没有坐标」。这条是唯一能证明
// 「三列真的存在、真的往返」的证据。
func TestStoreRecommendationAddressPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewStoreOnboardingRepository(pool)
	now := time.Now().UTC()
	lat, lng := 21.0113, 105.7985

	withPin := storeonboarding.StoreRecommendation{
		ID: "sr_addr_" + itoa(time.Now().UnixNano()), StoreName: "Three Beans",
		City: "河内", Category: "咖啡", Reason: "适合 afterwork",
		Address: "12 Trần Duy Hưng, Cầu Giấy",
		Latitude: &lat, Longitude: &lng,
		RecommendedBy: "user_addr_test", Origin: "USER", CreatedAt: now,
	}
	withoutPin := storeonboarding.StoreRecommendation{
		ID: "sr_nopin_" + itoa(time.Now().UnixNano()), StoreName: "No Pin Store",
		City: "河内", Category: "咖啡", Reason: "没选点",
		RecommendedBy: "user_addr_test", Origin: "USER", CreatedAt: now,
	}
	for _, rec := range []storeonboarding.StoreRecommendation{withPin, withoutPin} {
		if err := repo.AddRecommendation(ctx, rec); err != nil {
			t.Fatalf("insert %s: %v", rec.ID, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM business.store_recommendations WHERE id = ANY($1)`,
			[]string{withPin.ID, withoutPin.ID})
	})

	rows, err := repo.ListRecommendations(ctx, storeonboarding.RecommendationFilter{
		RecommendedBy: "user_addr_test", Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]storeonboarding.StoreRecommendation{}
	for _, r := range rows {
		byID[r.ID] = r
	}

	got := byID[withPin.ID]
	if got.Address != "12 Trần Duy Hưng, Cầu Giấy" {
		t.Fatalf("address did not persist: %q", got.Address)
	}
	if got.Latitude == nil || got.Longitude == nil || *got.Latitude != lat || *got.Longitude != lng {
		t.Fatalf("pin did not round-trip: %+v", got)
	}

	// 「没选点」必须读回 nil，不能是 0 —— (0,0) 是真实坐标，
	// 混在一起会把河内的店画到几内亚湾去。
	none := byID[withoutPin.ID]
	if none.Address != "" || none.Latitude != nil || none.Longitude != nil {
		t.Fatalf("absent location must read back absent: %+v", none)
	}

	// FindRecommendation 是结论落库前的存在性校验，走的是另一条 SELECT，
	// 同样得把位置带出来，否则两条读路径会给出不同的推荐。
	found, ok, err := repo.FindRecommendation(ctx, withPin.ID)
	if err != nil || !ok {
		t.Fatalf("find: ok=%v err=%v", ok, err)
	}
	if found.Address != "12 Trần Duy Hưng, Cầu Giấy" || found.Latitude == nil || *found.Latitude != lat {
		t.Fatalf("find must carry the location too: %+v", found)
	}
}

// 迁移 130 的约束必须真的在。服务层已经拦了一道，但那是应用层 ——
// 约束是最后一道，而「从没见它失败过的守卫不算守卫」：这里直接绕开
// Go 代码往表里插一条只有纬度的行，它必须被数据库拒绝。
func TestStoreRecommendationHalfCoordinateRefusedByDatabase(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	id := "sr_half_" + itoa(time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM business.store_recommendations WHERE id = $1`, id)
	})
	_, err := pool.Exec(ctx, `
INSERT INTO business.store_recommendations
    (id, store_name, city, category, reason, address, latitude, longitude, recommended_by, origin, created_at)
VALUES ($1, '店', '河内', '', 'x', '', 21.0, NULL, 'user_addr_test', 'USER', now())`, id)
	if err == nil {
		t.Fatal("half a coordinate must be refused by store_recommendations_coordinate_pair")
	}
}
