package postgres

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/facet"
)

type FacetRepository struct{ pool *pgxpool.Pool }

func NewFacetRepository(pool *pgxpool.Pool) *FacetRepository { return &FacetRepository{pool: pool} }

func (r *FacetRepository) List(ctx context.Context) ([]facet.Object, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, display_name, relation, goal, current_state, pill_label, gap_summary, gap_next_show_at, avatar_url FROM facet.objects ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []facet.Object
	for rows.Next() {
		var o facet.Object
		var gapSummary, gapNext string
		if err := rows.Scan(&o.ID, &o.DisplayName, &o.Relation, &o.Goal, &o.CurrentState, &o.PillLabel, &gapSummary, &gapNext, &o.AvatarURL); err != nil {
			return nil, err
		}
		o.Gap = facet.Gap{Summary: gapSummary, NextShowAt: gapNext}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (r *FacetRepository) Seed(ctx context.Context, objects []facet.Object) error {
	for _, o := range objects {
		gapJSON, _ := json.Marshal(o.Gap)
		_ = gapJSON
		if _, err := r.pool.Exec(ctx, `
			INSERT INTO facet.objects (id, display_name, relation, goal, current_state, pill_label, gap_summary, gap_next_show_at, avatar_url)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, relation=EXCLUDED.relation, goal=EXCLUDED.goal, current_state=EXCLUDED.current_state, pill_label=EXCLUDED.pill_label, gap_summary=EXCLUDED.gap_summary, gap_next_show_at=EXCLUDED.gap_next_show_at, avatar_url=EXCLUDED.avatar_url
		`, o.ID, o.DisplayName, o.Relation, o.Goal, o.CurrentState, o.PillLabel, o.Gap.Summary, o.Gap.NextShowAt, o.AvatarURL); err != nil {
			return err
		}
	}
	return nil
}
