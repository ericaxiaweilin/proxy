package postgres

import (
	"context"
	"testing"
	"time"
)

// MERCHANT-CREATOR-PROMO-002：专属码的品类读商家自己的门店资料。优先取填了品类的营业门店；
// 门店没填品类但认领了现实场景的，退到场景类型；没有门店就是空（不编一个品类）。
func TestMerchantStoreLookupPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	biz, biz2, scene, owner := "biz_ms_"+run, "biz_ms2_"+run, "scene_ms_"+run, "user_ms_"+run
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM business.stores WHERE business_id IN ($1,$2)`, biz, biz2)
		_, _ = pool.Exec(bg, `DELETE FROM business.accounts WHERE id IN ($1,$2)`, biz, biz2)
		_, _ = pool.Exec(bg, `DELETE FROM reality.scenes WHERE id=$1`, scene)
		_, _ = pool.Exec(bg, `DELETE FROM identity.user_accounts WHERE id=$1`, owner)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	exec(`INSERT INTO identity.user_accounts (id, status, created_at, updated_at) VALUES ($1,'ACTIVE',now(),now())`, owner)
	exec(`INSERT INTO business.accounts (id, owner_user_id, name, status, created_at) VALUES ($1,$3,'Three Beans','ACTIVE',now()), ($2,$3,'Quan Moi','ACTIVE',now())`, biz, biz2, owner)
	exec(`INSERT INTO business.stores (id, business_id, name, address, status, created_at, category) VALUES ($1,$2,'Main','x','ACTIVE',now(),''), ($3,$2,'Branch','x','ACTIVE',now() + interval '1 second','Cà phê / Bistro')`, "st1_"+run, biz, "st2_"+run)
	exec(`INSERT INTO reality.scenes (id, name, area, type, latitude, longitude, best) VALUES ($1,'Scene','a','咖啡 · 动态场景',21,105,'')`, scene)
	exec(`INSERT INTO business.stores (id, business_id, name, address, status, created_at, category, reality_scene_id) VALUES ($1,$2,'Main','x','ACTIVE',now(),'',$3)`, "st3_"+run, biz2, scene)

	repo := NewMerchantStoreRepository(pool)
	got, err := repo.MerchantStore(ctx, biz)
	if err != nil || got.Name != "Three Beans" || got.Category != "Cà phê / Bistro" {
		t.Fatalf("store with a category wins: %+v err=%v", got, err)
	}
	got, err = repo.MerchantStore(ctx, biz2)
	if err != nil || got.Category != "咖啡 · 动态场景" {
		t.Fatalf("no store category ⇒ the claimed scene's type: %+v err=%v", got, err)
	}
	got, err = repo.MerchantStore(ctx, "biz_missing_"+run)
	if err != nil || got.Name != "" || got.Category != "" {
		t.Fatalf("unknown merchant ⇒ empty, not invented: %+v err=%v", got, err)
	}
}
