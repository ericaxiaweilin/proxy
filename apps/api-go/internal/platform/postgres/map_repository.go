package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	mapx "github.com/proxy-app/proxy-api/internal/mapx"
)

// MapRepository implements mapx.Repository against the live PostgreSQL
// tables. It uses the (lat, lng) btree indexes added in migration 050.
type MapRepository struct {
	pool *pgxpool.Pool
}

func NewMapRepository(pool *pgxpool.Pool) *MapRepository { return &MapRepository{pool: pool} }

func (r *MapRepository) ListPostsInBBox(ctx context.Context, b mapx.BBox, limit int) ([]mapx.PostPin, error) {
	if limit <= 0 {
		limit = 200
	}
	// LEFT JOIN with post_media + media_assets to pull the cover
	// image (lowest sort_order). Posts with no media get NULLs which
	// we surface as empty thumbnail URLs.
	rows, err := r.pool.Query(ctx, `
		SELECT p.id, p.lat, p.lng, p.author_id, p.author_display_name,
		       COALESCE(p.city_scope, ''), p.scene_type, p.body, p.created_at,
		       (SELECT count(*) FROM localnet.post_media pm WHERE pm.post_id = p.id) AS media_count,
		       COALESCE(ma.media_type, ''),
		       COALESCE(ma.thumbnail_storage_key, '')
		FROM localnet.posts p
		LEFT JOIN LATERAL (
		    SELECT pm.media_asset_id
		    FROM localnet.post_media pm
		    WHERE pm.post_id = p.id
		    ORDER BY pm.sort_order ASC
		    LIMIT 1
		) first_media ON true
		LEFT JOIN media.media_assets ma
		    ON ma.media_asset_id = first_media.media_asset_id
		WHERE p.status = 'PUBLISHED'
		  AND p.lat BETWEEN $1 AND $2
		  AND p.lng BETWEEN $3 AND $4
		ORDER BY p.created_at DESC
		LIMIT $5`,
		b.SWLat, b.NELat, b.SWLng, b.NELng, limit)
	if err != nil {
		return nil, fmt.Errorf("query posts: %w", err)
	}
	defer rows.Close()
	out := make([]mapx.PostPin, 0, 32)
	for rows.Next() {
		var p mapx.PostPin
		if err := rows.Scan(&p.ID, &p.Lat, &p.Lng, &p.AuthorID, &p.AuthorName,
			&p.CityScope, &p.SceneType, &p.Body, &p.CreatedAt, &p.MediaCount,
			&p.MediaType, &p.ThumbnailURL); err != nil {
			return nil, fmt.Errorf("scan post: %w", err)
		}
		p.Kind = mapx.KindPost
		// Reshape the storage key into the public /v1/media/thumb/
		// path. The mobile client concatenates baseUrl + path. We
		// only include the thumb path (not the full playback) so the
		// map doesn't accidentally start a 1080p video decode just
		// for a 80×80 cover.
		if p.ThumbnailURL != "" {
			p.ThumbnailURL = "/v1/media/thumb/" + p.ThumbnailURL
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *MapRepository) ListAgentsInBBox(ctx context.Context, b mapx.BBox, limit int) ([]mapx.AgentPin, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := r.pool.Query(ctx, `
		SELECT a.agent_id, a.lat, a.lng, a.name, a.bio,
		       a.service_areas, a.languages, a.photos,
		       COALESCE((
		           SELECT w.status FROM supply.availability_windows w
		           WHERE w.agent_id = a.agent_id
		             AND w.status = 'AVAILABLE'
		             AND w.start_at <= now() AND w.end_at >= now()
		           ORDER BY w.start_at ASC LIMIT 1
		       ), 'OFFLINE') AS availability
		FROM supply.agent_profiles a
		WHERE a.lat BETWEEN $1 AND $2
		  AND a.lng BETWEEN $3 AND $4
		ORDER BY a.name ASC
		LIMIT $5`,
		b.SWLat, b.NELat, b.SWLng, b.NELng, limit)
	if err != nil {
		return nil, fmt.Errorf("query agents: %w", err)
	}
	defer rows.Close()
	out := make([]mapx.AgentPin, 0, 16)
	for rows.Next() {
		var a mapx.AgentPin
		var photosJSON []byte
		if err := rows.Scan(&a.ID, &a.Lat, &a.Lng, &a.Name, &a.Bio,
			&a.ServiceAreas, &a.Languages, &photosJSON, &a.Availability); err != nil {
			return nil, fmt.Errorf("scan agent: %w", err)
		}
		// photos is a jsonb array; we just need the count.
		// (decoding into []map keeps it permissive of any shape)
		var arr []any
		_ = decodeJSONBytes(photosJSON, &arr)
		a.PhotoCount = len(arr)
		a.Kind = mapx.KindAgent
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *MapRepository) ListOrdersInBBox(ctx context.Context, b mapx.BBox, limit int) ([]mapx.OrderPin, error) {
	if limit <= 0 {
		limit = 200
	}
	// Orders have no first-class title/city/budget columns — those live
	// in the snapshot jsonb (e.g. snapshot->>'title'). We surface them
	// straight from the json for the map preview; the full order fetch
	// still happens via the existing /v1/orders/{id} endpoint.
	rows, err := r.pool.Query(ctx, `
		SELECT o.id, o.lat, o.lng,
		       COALESCE(o.snapshot->>'title', '(untitled)') AS title,
		       o.lifecycle AS status,
		       COALESCE((o.settlement->>'amount')::bigint, 0) AS budget,
		       COALESCE(o.snapshot->>'city', '') AS city,
		       COALESCE(o.snapshot->>'area', '') AS area,
		       o.created_at AS start_at
		FROM fulfillment.orders o
		WHERE o.lat BETWEEN $1 AND $2
		  AND o.lng BETWEEN $3 AND $4
		ORDER BY o.created_at DESC
		LIMIT $5`,
		b.SWLat, b.NELat, b.SWLng, b.NELng, limit)
	if err != nil {
		return nil, fmt.Errorf("query orders: %w", err)
	}
	defer rows.Close()
	out := make([]mapx.OrderPin, 0, 16)
	for rows.Next() {
		var o mapx.OrderPin
		if err := rows.Scan(&o.ID, &o.Lat, &o.Lng, &o.Title, &o.Status, &o.Budget,
			&o.City, &o.Area, &o.StartAt); err != nil {
			return nil, fmt.Errorf("scan order: %w", err)
		}
		o.Kind = mapx.KindOrder
		out = append(out, o)
	}
	return out, rows.Err()
}

// decodeJSONBytes is a tiny shim so the inline json.Unmarshal call
// doesn't break the existing imports in this file.
func decodeJSONBytes(b []byte, v any) error {
	if len(b) == 0 {
		return nil
	}
	return json.Unmarshal(b, v)
}
