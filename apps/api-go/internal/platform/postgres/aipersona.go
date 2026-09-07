package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/aipersona"
)

// AIPersonaRepository persists AI account identity and likeness consent.
// Consent rows are append-only; revocation updates only the matching audit row.
type AIPersonaRepository struct{ pool *pgxpool.Pool }

func NewAIPersonaRepository(pool *pgxpool.Pool) *AIPersonaRepository {
	return &AIPersonaRepository{pool: pool}
}

func (r *AIPersonaRepository) CreatePersona(ctx context.Context, p aipersona.Persona) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO ai.ai_personas (id, owner_id, display_name, persona_type, description, created_at, archived_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (id) DO NOTHING`, p.ID, p.OwnerID, p.DisplayName, string(p.PersonaType), p.Description, p.CreatedAt, p.ArchivedAt)
	return err
}

func (r *AIPersonaRepository) GetPersona(ctx context.Context, id string) (*aipersona.Persona, error) {
	var p aipersona.Persona
	var kind string
	err := r.pool.QueryRow(ctx, `SELECT id, owner_id, display_name, persona_type, COALESCE(description,''), created_at, archived_at FROM ai.ai_personas WHERE id=$1`, id).
		Scan(&p.ID, &p.OwnerID, &p.DisplayName, &kind, &p.Description, &p.CreatedAt, &p.ArchivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, aipersona.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.PersonaType = aipersona.PersonaType(kind)
	return &p, nil
}

func (r *AIPersonaRepository) ListPersonasByOwner(ctx context.Context, ownerID string) ([]aipersona.Persona, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, owner_id, display_name, persona_type, COALESCE(description,''), created_at, archived_at FROM ai.ai_personas WHERE owner_id=$1 ORDER BY created_at DESC, id DESC`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]aipersona.Persona, 0)
	for rows.Next() {
		var p aipersona.Persona
		var kind string
		if err := rows.Scan(&p.ID, &p.OwnerID, &p.DisplayName, &kind, &p.Description, &p.CreatedAt, &p.ArchivedAt); err != nil {
			return nil, err
		}
		p.PersonaType = aipersona.PersonaType(kind)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *AIPersonaRepository) GrantConsent(ctx context.Context, c aipersona.LikenessConsent) error {
	_, err := r.pool.Exec(ctx, `INSERT INTO ai.likeness_consents (id, persona_id, subject_id, consent_kind, terms_version, granted_at, revoked_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`, c.ID, c.PersonaID, c.SubjectID, string(c.ConsentKind), c.TermsVersion, c.GrantedAt, c.RevokedAt, c.ExpiresAt)
	return err
}

func (r *AIPersonaRepository) RevokeConsent(ctx context.Context, id string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `UPDATE ai.likeness_consents SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL`, id, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return aipersona.ErrNotFound
	}
	return nil
}

func (r *AIPersonaRepository) LatestConsent(ctx context.Context, personaID, subjectID, termsVersion string, _ time.Time) (*aipersona.LikenessConsent, error) {
	var c aipersona.LikenessConsent
	var kind string
	err := r.pool.QueryRow(ctx, `SELECT id, persona_id, subject_id, consent_kind, terms_version, granted_at, revoked_at, expires_at FROM ai.likeness_consents WHERE persona_id=$1 AND subject_id=$2 AND terms_version=$3 ORDER BY granted_at DESC, id DESC LIMIT 1`, personaID, subjectID, termsVersion).
		Scan(&c.ID, &c.PersonaID, &c.SubjectID, &kind, &c.TermsVersion, &c.GrantedAt, &c.RevokedAt, &c.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, aipersona.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	c.ConsentKind = aipersona.ConsentKind(kind)
	return &c, nil
}
