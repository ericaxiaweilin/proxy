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
		Quote: "¥110", Scope: "跟拍 2 小时", Status: "PENDING",
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
	if after2.Responses != 1 || after2.OwnerID != owner {
		t.Fatalf("restart lost state: %+v", after2)
	}
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
