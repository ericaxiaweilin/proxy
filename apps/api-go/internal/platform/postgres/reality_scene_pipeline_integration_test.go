package postgres

import (
	"context"
	"testing"
	"time"
)

func TestRealityScenePipelinePostgresNearbyAndTimeline(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewRealitySceneRepository(pool)
	scenes, err := repo.ListNearbyScenes(ctx, 21.0454, 105.8361, 5, 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(scenes) == 0 || scenes[0].DistanceMeters < 0 || scenes[0].RecommendationScore == 0 {
		t.Fatalf("nearby ranking missing: %#v", scenes)
	}
	actor := "user_reality_pipeline_" + itoa(time.Now().UnixNano())
	visitedAt := time.Now().UTC().Add(-time.Minute)
	if err := repo.SetUserState(ctx, actor, "trucbach", "private_visited", true, visitedAt); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM reality.user_scene_states WHERE actor_id=$1`, actor)
	})
	states, err := repo.ListUserStates(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	if len(states) != 1 || !states[0].PrivateVisited || states[0].VisitedAt == nil || states[0].VisitedAt.Sub(visitedAt) > time.Second {
		t.Fatalf("timeline mismatch: %#v", states)
	}
}
