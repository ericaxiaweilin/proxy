package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/supply"
)

// MERCHANT-CREATOR-PROMO-001（门槛 + 调整原因）：新加的 min_spend_vnd / note 必须真的
// 落库、读回、更新得到 —— 领域层先加了字段而仓储没跟上时，写进去会被悄悄丢掉，
// 内存仓的单元测试照样绿（它整个 struct 存），所以这一条必须在 Postgres 上跑。
func TestPromoBenefitMinSpendAndNotePersistPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewSupplyRepository(pool)
	run := itoa(time.Now().UnixNano())
	merchant := "m_ms_" + run
	code := "MS" + run[len(run)-8:]
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM supply.promo_benefits WHERE merchant_id=$1`, merchant)
		_, _ = pool.Exec(context.Background(), `DELETE FROM supply.promo_auto_benefits WHERE merchant_id=$1`, merchant)
	})

	now := time.Now().UTC().Truncate(time.Second)
	b := supply.PromoBenefit{
		MerchantID: merchant, Code: code, FaceValueVND: 50000, MinSpendVND: 200000,
		ScopeName: "全场饮品", ValidUntil: "2099-01-01", Status: "ACTIVE", Source: "MANUAL",
		Note: "她粉丝偏年轻，设个门槛", CreatedAt: now,
	}
	if err := repo.SavePromoBenefit(ctx, b); err != nil {
		t.Fatalf("save: %v", err)
	}
	got, err := repo.GetPromoBenefit(ctx, merchant, code)
	if err != nil || got.MinSpendVND != 200000 || got.Note != b.Note {
		t.Fatalf("read back must keep threshold and note: %+v err=%v", got, err)
	}
	got.MinSpendVND, got.Note = 300000, "提高门槛"
	if err := repo.UpdatePromoBenefit(ctx, got); err != nil {
		t.Fatalf("update: %v", err)
	}
	list, err := repo.ListPromoBenefitsByMerchant(ctx, merchant)
	if err != nil || len(list) != 1 || list[0].MinSpendVND != 300000 || list[0].Note != "提高门槛" {
		t.Fatalf("list must show the updated threshold and note: %+v err=%v", list, err)
	}

	auto := supply.PromoAutoBenefit{MerchantID: merchant, Enabled: true, FaceValueVND: 20000, MinSpendVND: 100000, ScopeName: "全场", ValidityDays: 30, UpdatedAt: now}
	if err := repo.SaveAutoPromoBenefit(ctx, auto); err != nil {
		t.Fatalf("save auto: %v", err)
	}
	gotAuto, err := repo.GetAutoPromoBenefit(ctx, merchant)
	if err != nil || gotAuto.MinSpendVND != 100000 {
		t.Fatalf("auto threshold must persist: %+v err=%v", gotAuto, err)
	}
}
