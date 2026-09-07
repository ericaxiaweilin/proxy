package postgres

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/jurisdiction"
)

func TestJurisdictionPostgresSurvivesServiceRestart(t *testing.T) {
	pool := requireTestPool(t)
	ctx := context.Background()
	userID := fmt.Sprintf("jur_pg_%d", time.Now().UnixNano())
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM identity.user_jurisdiction WHERE user_id=$1`, userID) })

	first := jurisdiction.NewService(NewJurisdictionRepository(pool))
	if err := first.Set(ctx, userID, jurisdiction.Jurisdiction{Country: jurisdiction.CountryVietnam, Region: jurisdiction.RegionHanoi}, "USER_SELF"); err != nil {
		t.Fatalf("set: %v", err)
	}
	restarted := jurisdiction.NewService(NewJurisdictionRepository(pool))
	got, err := restarted.Resolve(ctx, userID)
	if err != nil {
		t.Fatalf("resolve after restart: %v", err)
	}
	if got.Jurisdiction.String() != "VN-HN" || got.Source != "USER_SELF" {
		t.Fatalf("unexpected persisted jurisdiction: %+v", got)
	}
}
