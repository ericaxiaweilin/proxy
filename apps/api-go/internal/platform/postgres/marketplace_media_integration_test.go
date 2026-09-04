package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/media"
)

// TestMarketplacePostgresLifecycle pins the marketplace PG adapter:
// Seed idempotency (ON CONFLICT DO NOTHING), Create, viewer-scoped List
// (Owned/Applied flags + dismissal hiding), Get not-found mapping,
// Apply idempotency (conflict returns the existing application without
// bumping responses), Dismiss semantics, and restart persistence.
func TestMarketplacePostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := time.Now().UnixNano()

	repo := NewMarketplaceRepository(pool)
	id := "mkt_op_pg_" + itoa(run)
	owner := "user_mkt_owner_" + itoa(run)
	viewer := "user_mkt_viewer_" + itoa(run)
	applicant := "user_mkt_app_" + itoa(run)
	applicant2 := "user_mkt_app2_" + itoa(run)

	op := marketplace.Opportunity{
		ID: id, OwnerID: owner, Title: "周五城市摄影局", ShortTitle: "摄影局",
		Theme: "城市", Date: "周五", Time: "19:00", Location: "西湖区",
		Price: "¥120", Owner: "Ken", OwnerType: "CREATOR", Match: "92%",
		Responses: 0, Posted: "1h", Skills: "摄影/修图", Verified: true,
	}
	if err := repo.Seed(ctx, []marketplace.Opportunity{op}); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	// Seed is idempotent: re-seed must not fail or duplicate.
	if err := repo.Seed(ctx, []marketplace.Opportunity{op}); err != nil {
		t.Fatalf("Seed idempotent: %v", err)
	}

	// 1. Viewer sees the opportunity, not owned, not applied.
	listed, err := repo.List(ctx, viewer)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var got marketplace.Opportunity
	found := false
	for _, o := range listed {
		if o.ID == id {
			got, found = o, true
		}
	}
	if !found {
		t.Fatalf("seeded opportunity not visible in List")
	}
	if got.Owned || got.Applied {
		t.Fatalf("stranger viewer must see Owned=false Applied=false, got %+v", got)
	}
	if got.Title != "周五城市摄影局" || got.OwnerID != owner {
		t.Fatalf("payload round-trip mismatch: %+v", got)
	}

	// 2. Owner sees it as owned.
	ownedList, err := repo.List(ctx, owner)
	if err != nil {
		t.Fatalf("List(owner): %v", err)
	}
	for _, o := range ownedList {
		if o.ID == id && !o.Owned {
			t.Fatalf("owner viewer must see Owned=true")
		}
	}

	// 3. Get round-trips; missing maps to ErrOpportunityNotFound.
	got, err = repo.Get(ctx, id)
	if err != nil || got.ID != id || got.Responses != 0 {
		t.Fatalf("Get: got=%+v err=%v", got, err)
	}
	if _, err := repo.Get(ctx, "mkt_op_pg_missing_"+itoa(run)); err != marketplace.ErrOpportunityNotFound {
		t.Fatalf("Get missing must be ErrOpportunityNotFound, got %v", err)
	}

	// 4. Apply: first created, duplicate returns existing without
	// bumping responses.
	app := marketplace.Application{
		ID: "mkt_ap_" + itoa(run), OpportunityID: id, ApplicantID: applicant,
		Quote: "¥110", Scope: "跟拍 2 小时", Status: "SUBMITTED",
		CreatedAt: time.Now().UTC().Truncate(time.Microsecond),
	}
	createdApp, created, err := repo.Apply(ctx, app)
	if err != nil || !created || createdApp.ID != app.ID {
		t.Fatalf("Apply first: app=%+v created=%v err=%v", createdApp, created, err)
	}
	dupeApp, created, err := repo.Apply(ctx, app)
	if err != nil || created {
		t.Fatalf("Apply duplicate: app=%+v created=%v err=%v", dupeApp, created, err)
	}
	if dupeApp.ID != app.ID || dupeApp.Quote != app.Quote {
		t.Fatalf("duplicate Apply must return the original application, got %+v", dupeApp)
	}
	after, _ := repo.Get(ctx, id)
	if after.Responses != 1 {
		t.Fatalf("responses must be bumped exactly once, got %d", after.Responses)
	}
	app2 := app
	app2.ID, app2.ApplicantID, app2.Quote = "mkt_ap2_"+itoa(run), applicant2, "¥100"
	if _, created, err := repo.Apply(ctx, app2); err != nil || !created {
		t.Fatalf("Apply second: created=%v err=%v", created, err)
	}
	apps, err := repo.ListApplications(ctx, id, owner)
	if err != nil || len(apps) != 2 {
		t.Fatalf("ListApplications: apps=%+v err=%v", apps, err)
	}
	if _, err := repo.ListApplications(ctx, id, viewer); err != marketplace.ErrOpportunityNotFound {
		t.Fatalf("non-owner list must fail closed: %v", err)
	}
	chosen, err := repo.SelectApplication(ctx, id, app.ID, owner)
	if err != nil || chosen.Status != "SELECTED" {
		t.Fatalf("SelectApplication: chosen=%+v err=%v", chosen, err)
	}
	if _, err := repo.ConfirmApplication(ctx, app.ID, applicant2, "order_wrong"); err != marketplace.ErrApplicationNotFound {
		t.Fatalf("wrong applicant confirmed: %v", err)
	}
	confirmed, err := repo.ConfirmApplication(ctx, app.ID, applicant, "order_"+app.ID)
	if err != nil || confirmed.Status != "CONFIRMED" || confirmed.OrderRef == "" {
		t.Fatalf("ConfirmApplication: app=%+v err=%v", confirmed, err)
	}
	// applied flag flips for the applicant.
	appliedList, err := repo.List(ctx, applicant)
	if err != nil {
		t.Fatalf("List(applicant): %v", err)
	}
	for _, o := range appliedList {
		if o.ID == id && !o.Applied {
			t.Fatalf("applicant must see Applied=true")
		}
	}

	// 5. Dismiss hides for that viewer only; idempotent; missing
	// opportunity rejected.
	if err := repo.Dismiss(ctx, viewer, id); err != nil {
		t.Fatalf("Dismiss: %v", err)
	}
	if err := repo.Dismiss(ctx, viewer, id); err != nil {
		t.Fatalf("Dismiss idempotent: %v", err)
	}
	listed, err = repo.List(ctx, viewer)
	if err != nil {
		t.Fatalf("List after dismiss: %v", err)
	}
	for _, o := range listed {
		if o.ID == id {
			t.Fatalf("dismissed opportunity must be hidden from viewer")
		}
	}
	stranger := "user_mkt_stranger_" + itoa(run)
	listed, err = repo.List(ctx, stranger)
	if err != nil {
		t.Fatalf("List(stranger): %v", err)
	}
	visible := false
	for _, o := range listed {
		if o.ID == id {
			visible = true
		}
	}
	if !visible {
		t.Fatalf("dismissal must be viewer-scoped, stranger still sees it")
	}
	if err := repo.Dismiss(ctx, viewer, "mkt_op_pg_missing_"+itoa(run)); err != marketplace.ErrOpportunityNotFound {
		t.Fatalf("Dismiss missing must be ErrOpportunityNotFound, got %v", err)
	}

	// 6. Create (distinct from Seed) lands and is visible.
	nextOp := op
	nextOp.ID = "mkt_op_pg2_" + itoa(run)
	nextOp.OwnerID = stranger
	nextOp.Title = "周六徒步"
	if err := repo.Create(ctx, nextOp); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := repo.Get(ctx, "mkt_op_pg2_"+itoa(run)); err != nil {
		t.Fatalf("Create did not persist: %v", err)
	}

	// 7. Simulated restart: fresh instance sees same state.
	repo2 := NewMarketplaceRepository(pool)
	after2, err := repo2.Get(ctx, id)
	if err != nil {
		t.Fatalf("Get after restart: %v", err)
	}
	if after2.Responses != 2 || after2.OwnerID != owner {
		t.Fatalf("restart lost state: %+v", after2)
	}
}

// TestMarketplacePostgresJSONBRoundTripPreservesMoneyFlow is the
// R16.x tripwire for opportunity MoneyFlow + PriceLabel persistence.
//
// R16.x mandates that every Opportunity on the wire carries
// MoneyFlow ∈ {EARN, PAY, FREE, TBD} + PriceLabel. The marketplace
// service's normalizeOpportunityMoney() populates these in List() if
// the stored payload is missing them, but a regression that drops
// JSONB serialization of either field would still pass the in-memory
// tests (which start with normalized values). This PG test Seeds a row
// whose payload explicitly carries MoneyFlow=PAY + PriceLabel="你需支付"
// and verifies that List() — which goes through PG JSONB decode —
// preserves both. The PG adapter must not silently strip these fields
// during JSONB round-trip.
func TestMarketplacePostgresJSONBRoundTripPreservesMoneyFlow(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := time.Now().UnixNano()

	id := "mkt_op_pg_r16x_" + itoa(run)
	repo := NewMarketplaceRepository(pool)

	if err := repo.Seed(ctx, []marketplace.Opportunity{{
		ID:         id,
		Title:      "代订位 · 受托委托",
		ShortTitle: "代订位",
		Theme:      "委托",
		Date:       "周六",
		Time:       "18:30",
		Location:   "河内 · 西湖",
		Price:      "500,000₫",
		MoneyFlow:  "PAY",
		PriceLabel: "你需支付",
		Owner:      "Ken",
		OwnerID:    "user_seed_ken_" + itoa(run),
		OwnerType:  "CREATOR",
		Match:      "85%",
		Posted:     "1h",
		Skills:     "中文 · 代订位",
		Verified:   true,
	}}); err != nil {
		t.Fatalf("Seed: %v", err)
	}

	got, err := repo.Get(ctx, id)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.MoneyFlow != "PAY" {
		t.Fatalf("MoneyFlow round-trip: got %q, want PAY", got.MoneyFlow)
	}
	if got.PriceLabel != "你需支付" {
		t.Fatalf("PriceLabel round-trip: got %q, want 你需支付", got.PriceLabel)
	}
	if got.Price != "500,000₫" {
		t.Fatalf("Price round-trip: got %q", got.Price)
	}

	// List must surface the same fields.
	listed, err := repo.List(ctx, "viewer_"+itoa(run))
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, o := range listed {
		if o.ID == id {
			if o.MoneyFlow != "PAY" || o.PriceLabel != "你需支付" {
				t.Fatalf("List round-trip lost MoneyFlow/PriceLabel: %+v", o)
			}
			return
		}
	}
	t.Fatalf("seeded opportunity not visible in List")
}

// TestMediaReviewDecisionPostgresLifecycle pins the append-only review
// decision log: Append + server-clock default (ReviewedAt COALESCE),
// duplicate decision_id rejection, List filter + DESC order + limit
// clamping, Get not-found mapping, restart persistence.
func TestMediaReviewDecisionPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := time.Now().UnixNano()

	// FK: decisions must reference a real media asset. Create two.
	mediaRepo := NewMediaRepository(pool)
	assetID := "media_asset_dlg_" + itoa(run)
	asset2 := "media_asset_other_" + itoa(run)
	for _, id := range []string{assetID, asset2} {
		if err := mediaRepo.CreateAsset(ctx, media.MediaAsset{
			MediaAssetID:       id,
			OwnerPrincipalType: "INDIVIDUAL",
			OwnerPrincipalID:   "user_media_owner_" + itoa(run),
			MediaType:          "IMAGE",
			OriginalStorageKey: "test://" + id + "/original.jpg",
			ProcessingStatus:   "READY",
			ModerationStatus:   "QUARANTINED",
			VisibilityClass:    "OWNER_ONLY",
			CreatedAt:          time.Now().UTC(),
			UpdatedAt:          time.Now().UTC(),
		}); err != nil {
			t.Fatalf("CreateAsset %s: %v", id, err)
		}
	}

	repo := NewMediaReviewDecisionRepository(pool)

	// 1. Append with explicit timestamp.
	d1 := media.MediaReviewDecision{
		DecisionID: "mrd_pg_" + itoa(run) + "_1", MediaAssetID: assetID,
		FromStatus: "QUARANTINED", ToStatus: "APPROVED",
		Reason: "APPROVE", Note: "ok", OperatorID: "opr_admin_1",
		ReviewedAt: time.Now().UTC().Truncate(time.Microsecond),
	}
	if err := repo.AppendReviewDecision(ctx, d1); err != nil {
		t.Fatalf("Append d1: %v", err)
	}

	// 2. Append without timestamp: server clock fills ReviewedAt.
	d2 := media.MediaReviewDecision{
		DecisionID: "mrd_pg_" + itoa(run) + "_2", MediaAssetID: assetID,
		FromStatus: "QUARANTINED", ToStatus: "REJECTED_CONTENT_NUDITY",
		Reason: "REJECT_NUDITY", OperatorID: "opr_admin_2",
	}
	if err := repo.AppendReviewDecision(ctx, d2); err != nil {
		t.Fatalf("Append d2: %v", err)
	}
	if d2Reviewed, err := repo.GetReviewDecision(ctx, d2.DecisionID); err != nil {
		t.Fatalf("Get d2: %v", err)
	} else if d2Reviewed.ReviewedAt.IsZero() {
		t.Fatalf("COALESCE(now()) must fill ReviewedAt, got zero")
	}

	// 3. Duplicate decision_id is rejected.
	dup := d1
	dup.Reason = "APPROVE (retry)"
	if err := repo.AppendReviewDecision(ctx, dup); err == nil {
		t.Fatalf("duplicate decision_id must be rejected")
	}

	// 4. List: filter by asset, DESC order by reviewed_at.
	d3 := media.MediaReviewDecision{
		DecisionID: "mrd_pg_" + itoa(run) + "_3", MediaAssetID: assetID,
		FromStatus: "APPROVED", ToStatus: "REJECTED_CONTENT_POLITICS",
		Reason: "REJECT_POLITICS", Note: "escalated", OperatorID: "opr_admin_1",
		ReviewedAt: time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond),
	}
	if err := repo.AppendReviewDecision(ctx, d3); err != nil {
		t.Fatalf("Append d3: %v", err)
	}
	dOther := media.MediaReviewDecision{
		DecisionID: "mrd_pg_" + itoa(run) + "_4", MediaAssetID: asset2,
		FromStatus: "QUARANTINED", ToStatus: "APPROVED",
		Reason: "APPROVE", OperatorID: "opr_admin_1",
		ReviewedAt: time.Now().UTC().Truncate(time.Microsecond),
	}
	if err := repo.AppendReviewDecision(ctx, dOther); err != nil {
		t.Fatalf("Append dOther: %v", err)
	}

	list, err := repo.ListReviewDecisions(ctx, assetID, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("asset filter must return exactly 3 decisions, got %d", len(list))
	}
	if list[0].DecisionID != d3.DecisionID || list[1].DecisionID != d2.DecisionID || list[2].DecisionID != d1.DecisionID {
		t.Fatalf("List must be DESC by reviewed_at: %v %v %v", list[0].DecisionID, list[1].DecisionID, list[2].DecisionID)
	}

	// 5. Get not-found mapping.
	if _, err := repo.GetReviewDecision(ctx, "mrd_pg_never_"+itoa(run)); err != media.ErrReviewDecisionNotFound {
		t.Fatalf("Get missing must be ErrReviewDecisionNotFound, got %v", err)
	}

	// 6. Validation guards.
	empty := media.MediaReviewDecision{MediaAssetID: assetID, OperatorID: "opr_x"}
	if err := repo.AppendReviewDecision(ctx, empty); err == nil {
		t.Fatalf("empty DecisionID must be rejected")
	}

	// 7. Simulated restart: append-only log survives.
	repo2 := NewMediaReviewDecisionRepository(pool)
	after, err := repo2.ListReviewDecisions(ctx, assetID, 0)
	if err != nil {
		t.Fatalf("List after restart: %v", err)
	}
	if len(after) != 3 || after[0].DecisionID != d3.DecisionID {
		t.Fatalf("restart lost append-only log: %+v", after)
	}
}
