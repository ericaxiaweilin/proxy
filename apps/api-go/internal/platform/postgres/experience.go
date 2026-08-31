package postgres

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/experience/runtime"
)

type ExperienceRepository struct{ pool *pgxpool.Pool }

func NewExperienceRepository(pool *pgxpool.Pool) *ExperienceRepository { return &ExperienceRepository{pool: pool} }

func (r *ExperienceRepository) CreateIntent(ctx context.Context, intent runtime.ExperienceIntent) error {
	allowed, _ := json.Marshal(intent.AllowedActions)
	forbidden, _ := json.Marshal(intent.ForbiddenActions)
	required, _ := json.Marshal(intent.RequiredInfo)
	reasonCodes, _ := json.Marshal(intent.ReasonCodes)
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO experience.experience_intent (
			intent_id, type, objective, priority, intervention_level,
			context_snapshot_id, decision_id, allowed_actions, forbidden_actions,
			required_information, expires_at, reason_codes
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (intent_id) DO NOTHING`,
		intent.IntentID, intent.Type, intent.Objective, intent.Priority, intent.InterventionLevel,
		intent.ContextSnapshotID, intent.DecisionID, allowed, forbidden, required, intent.ExpiresAt, reasonCodes,
	)
	return err
}

func (r *ExperienceRepository) CreateSurfacePlan(ctx context.Context, plan runtime.SurfacePlan) error {
	slots, _ := json.Marshal(plan.Slots)
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO experience.surface_plan (
			surface_plan_id, surface_id, surface_version, decision_id, experience_intent_id,
			context_snapshot_id, render_mode, native_component, schema_ref, slots, ttl_s, fallback_plan_id, policy_version
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (surface_plan_id) DO NOTHING`,
		plan.SurfacePlanID, plan.SurfaceID, plan.SurfaceVersion, plan.DecisionID, plan.ExperienceIntentID,
		plan.ContextSnapshotID, plan.RenderMode, plan.NativeComponent, plan.SchemaRef, slots, plan.TTLS, plan.FallbackPlanID, plan.PolicyVersion,
	)
	return err
}
