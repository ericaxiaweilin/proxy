package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/proxy-app/proxy-api/internal/usermodel"
)

// UserModelRepository 持久化 AI 分身的用户建模（AI-MANAGE-015，migrations/122_user_models.sql）。
type UserModelRepository struct {
	pool *pgxpool.Pool
}

func NewUserModelRepository(pool *pgxpool.Pool) *UserModelRepository {
	return &UserModelRepository{pool: pool}
}

func (r *UserModelRepository) Get(ctx context.Context, ownerID string) (usermodel.Profile, error) {
	var p usermodel.Profile
	var sources []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT owner_id, height_cm, weight_kg, age, body_type, skin_tone, hair, face_features, likeness_lock, sources, analyzed_photo_count, analyzed_at, updated_at
		FROM ai.user_models WHERE owner_id = $1`, ownerID).
		Scan(&p.OwnerID, &p.HeightCm, &p.WeightKg, &p.Age, &p.BodyType, &p.SkinTone, &p.Hair, &p.FaceFeatures, &p.LikenessLock, &sources, &p.AnalyzedPhotoCount, &p.AnalyzedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return usermodel.Profile{}, usermodel.ErrNotFound
	}
	if err != nil {
		return usermodel.Profile{}, err
	}
	p.Sources = map[string]string{}
	if len(sources) > 0 {
		if err := json.Unmarshal(sources, &p.Sources); err != nil {
			return usermodel.Profile{}, err
		}
	}
	return p, nil
}

func (r *UserModelRepository) Save(ctx context.Context, p usermodel.Profile) error {
	sources, err := json.Marshal(p.Sources)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO ai.user_models (owner_id, height_cm, weight_kg, age, body_type, skin_tone, hair, face_features, likeness_lock, sources, analyzed_photo_count, analyzed_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (owner_id) DO UPDATE SET height_cm=EXCLUDED.height_cm, weight_kg=EXCLUDED.weight_kg, age=EXCLUDED.age,
			body_type=EXCLUDED.body_type, skin_tone=EXCLUDED.skin_tone, hair=EXCLUDED.hair, face_features=EXCLUDED.face_features, likeness_lock=EXCLUDED.likeness_lock,
			sources=EXCLUDED.sources, analyzed_photo_count=EXCLUDED.analyzed_photo_count, analyzed_at=EXCLUDED.analyzed_at, updated_at=EXCLUDED.updated_at`,
		p.OwnerID, p.HeightCm, p.WeightKg, p.Age, p.BodyType, p.SkinTone, p.Hair, p.FaceFeatures, p.LikenessLock, sources, p.AnalyzedPhotoCount, p.AnalyzedAt, p.UpdatedAt)
	return err
}

var _ usermodel.Repository = (*UserModelRepository)(nil)
